import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { MODELS, createMessage } from "../claude";
import type { Outcome, Persona } from "../types";
import { describe, formFields, isQuoteForm, type ObservedElement } from "./observe";
import { LimitReached, type AuditSession } from "./session";

export interface DriverContext {
  session: AuditSession;
  persona: Persona;
  insurerName: string;
  productLine: string;
}

export interface Driver {
  name: string;
  run(ctx: DriverContext): Promise<{ cost: number }>;
}

const OUTCOMES = ["price_shown", "blocked_account", "blocked_otp", "blocked_captcha", "callback_only", "no_online_quote", "gave_up", "error"] as const;

// ---------------------------------------------------------------- Claude agent

export const AGENT_PROMPT_VERSION = "agent-v1";

const AGENT_SYSTEM = `You are an auditor measuring how easy it is for an ordinary customer to get an insurance quote online.
You operate a real browser through tools. Each observation lists the page's interactive elements as [id] kind "label".

Goal: get from the insurer's home page to a price, the way a typical customer would, using ONLY the synthetic persona details you are given.

How to work:
- Take the most direct, visible route to a quote for the requested product line. Avoid site search unless there is no link.
- Fill required fields. Leave optional fields empty unless the form will not continue without them.
- Use address, postcode or registration lookups when the site offers them, as a customer would.
- For questions the persona does not cover, give the plain, low-risk answer a typical customer would (for example "No" to modifications), and mention it in your finish notes.
- Close or reject cookie banners; accept only what is needed to continue.
- You may send several fill/choose/set_checked calls in one turn. Send a click last, on its own.
- Element ids are valid only for the most recent observation.

Hard rules (never break them):
- Never create an account, type a password, or log in. If a price needs an account, finish with blocked_account.
- Never solve or tick a CAPTCHA. Finish with blocked_captcha.
- Never enter a verification code. If one is required, finish with blocked_otp.
- Never press buttons that buy, pay, apply, submit an application or request a callback. If the only route is a callback form, finish with callback_only. If the site says quotes are by phone or in branch only, finish with no_online_quote.
- Never type personal details other than the persona's.

When a price (a premium per year or per month) is displayed for the persona, call finish with outcome price_shown immediately.
If you are stuck after several honest attempts, finish with gave_up and explain where.
Your finish notes should be short and factual: what the journey was like, anything confusing, and any assumptions you made.`;

const idProp = { type: "string", description: "Element id from the latest observation, without brackets." };

const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "fill",
    description: "Type a value into a text, email, phone, number, date (YYYY-MM-DD) or textarea field.",
    strict: true,
    input_schema: { type: "object", properties: { element_id: idProp, value: { type: "string" } }, required: ["element_id", "value"], additionalProperties: false },
  },
  {
    name: "choose",
    description: "Pick an option in a select dropdown or radio group by its visible label.",
    strict: true,
    input_schema: { type: "object", properties: { element_id: idProp, option: { type: "string" } }, required: ["element_id", "option"], additionalProperties: false },
  },
  {
    name: "set_checked",
    description: "Tick or untick a checkbox.",
    strict: true,
    input_schema: { type: "object", properties: { element_id: idProp, checked: { type: "boolean" } }, required: ["element_id", "checked"], additionalProperties: false },
  },
  {
    name: "click",
    description: "Click a link or button. Returns the new page state.",
    strict: true,
    input_schema: { type: "object", properties: { element_id: idProp }, required: ["element_id"], additionalProperties: false },
  },
  {
    name: "finish",
    description: "End the journey and record the outcome.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        outcome: { type: "string", enum: [...OUTCOMES] },
        notes: { type: "string", description: "Two or three factual sentences about the journey and any assumptions made." },
      },
      required: ["outcome", "notes"],
      additionalProperties: false,
    },
  },
];

const Inputs = {
  fill: z.object({ element_id: z.string(), value: z.string() }),
  choose: z.object({ element_id: z.string(), option: z.string() }),
  set_checked: z.object({ element_id: z.string(), checked: z.boolean() }),
  click: z.object({ element_id: z.string() }),
  finish: z.object({ outcome: z.enum(OUTCOMES), notes: z.string() }),
};

export const claudeDriver: Driver = {
  name: "claude",
  async run({ session, persona, insurerName, productLine }) {
    let cost = 0;
    const messages: Anthropic.Beta.BetaMessageParam[] = [
      {
        role: "user",
        content: `Insurer: ${insurerName}\nProduct line: ${productLine} insurance\nPersona: ${persona.label}\nPersona details (JSON): ${JSON.stringify(persona.fields)}\nToday's date: ${new Date().toISOString().slice(0, 10)}\n\nCurrent page:\n${describe(session.last)}`,
      },
    ];
    let nudges = 0;

    while (!session.outcome) {
      const { message, cost: c } = await createMessage({
        model: MODELS.agent,
        max_tokens: 8000,
        system: [{ type: "text", text: AGENT_SYSTEM, cache_control: { type: "ephemeral" } }],
        tools: TOOLS,
        cache_control: { type: "ephemeral" },
        output_config: { effort: "medium" },
        messages,
      });
      cost += c;
      messages.push({ role: "assistant", content: message.content });

      const calls = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      if (message.stop_reason === "max_tokens") throw new Error("Agent turn hit max_tokens.");
      if (!calls.length) {
        if (++nudges > 2) {
          await session.finish("gave_up", "The agent stopped without choosing an outcome.");
          break;
        }
        messages.push({ role: "user", content: "Continue with a tool call, or call finish with the outcome." });
        continue;
      }
      nudges = 0;

      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const call of calls) {
        let text: string;
        let isError = false;
        try {
          text = await runTool(session, call);
        } catch (err) {
          if (err instanceof LimitReached) {
            await session.finish("gave_up", err.message);
            text = err.message;
          } else {
            isError = true;
            text = `Action failed: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`;
            await session.observe().catch(() => {});
          }
        }
        results.push({ type: "tool_result", tool_use_id: call.id, content: text, is_error: isError });
      }
      if (!session.outcome) {
        const last = results[results.length - 1];
        last.content = `${last.content as string}\n\nCurrent page:\n${describe(session.last)}`;
      }
      messages.push({ role: "user", content: results });
    }
    return { cost };
  },
};

async function runTool(session: AuditSession, call: Anthropic.Beta.BetaToolUseBlock): Promise<string> {
  switch (call.name) {
    case "fill": {
      const i = Inputs.fill.parse(call.input);
      return session.fill(i.element_id, i.value);
    }
    case "choose": {
      const i = Inputs.choose.parse(call.input);
      return session.choose(i.element_id, i.option);
    }
    case "set_checked": {
      const i = Inputs.set_checked.parse(call.input);
      return session.setChecked(i.element_id, i.checked);
    }
    case "click": {
      const i = Inputs.click.parse(call.input);
      return session.click(i.element_id);
    }
    case "finish": {
      const i = Inputs.finish.parse(call.input);
      await session.finish(i.outcome, i.notes);
      return "Journey recorded.";
    }
    default:
      return `Unknown tool ${call.name}.`;
  }
}

// ---------------------------------------------------------------- Rule-based fallback

/** Label patterns mapped to persona keys; order matters (first match wins). */
const FIELD_MAP: [RegExp, string][] = [
  [/registration|\breg\b|number plate/, "reg"],
  [/first name|forename/, "first_name"],
  [/last name|surname/, "last_name"],
  [/full name|^name$/, "full_name"],
  [/date of birth|\bdob\b|birth/, "dob"],
  [/e-?mail/, "email"],
  [/phone|mobile|telephone/, "phone"],
  [/postcode|post code|zip|eircode/, "postcode"],
  [/address line|street|^address/, "address_line"],
  [/town|city|suburb/, "city"],
  [/occupation|job title/, "occupation"],
  [/marital/, "marital_status"],
  [/^title$/, "title"],
  [/licen[cs]e type/, "licence_type"],
  [/licen[cs]e/, "licence_years"],
  [/claim/, "claims"],
  [/conviction/, "convictions"],
  [/mileage|miles/, "annual_mileage"],
  [/start date/, "__start_date"],
  [/manufacturer|\bmake\b/, "make"],
  [/model/, "model"],
  [/year built/, "year_built"],
  [/year/, "year"],
  [/rebuild/, "rebuild_cost"],
  [/contents/, "contents_value"],
  [/value/, "car_value"],
  [/modif/, "modified"],
  [/overnight|kept/, "overnight"],
  [/level of cover|cover type|type of cover/, "cover"],
  [/excess/, "excess"],
  [/payment/, "payment"],
  [/best time/, "best_time"],
  [/property type|type of property/, "property_type"],
  [/bedroom/, "bedrooms"],
];

function personaValue(label: string, persona: Persona): string | undefined {
  const l = label.toLowerCase().replace(/\*/g, "").trim();
  for (const [re, key] of FIELD_MAP) {
    if (!re.test(l)) continue;
    if (key === "__start_date") return new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    return persona.fields[key];
  }
  return undefined;
}

function isEmpty(f: ObservedElement): boolean {
  if (f.kind === "checkbox") return !f.checked;
  return !f.value || /please select|choose|select\.\.\./i.test(f.value);
}

const START_LINK = /get (a|my|your)? ?(car |home )?quote|start (a|your)? ?(car |home )?(insurance )?quote|^quote$/i;
const PRIMARY = /continue|next|get (my |your )?(price|quote)|show (my )?price|see (my )?price|calculate|submit/i;
const LOOKUP = /find|look ?up/i;

export const ruleDriver: Driver = {
  name: "rules",
  async run({ session, persona, productLine }) {
    const clicked = new Set<string>();
    const attempted = new Set<string>();
    let stuck = 0;
    let lastSig = "";
    let errorRounds = 0;
    let submitted = 0;
    let failures = 0;

    try {
      for (let round = 0; round < 40 && !session.outcome; round++) {
        try {
          const obs = session.last;
          const f = obs.flags;
          if (f.priceText && submitted > 0) return finish(session, "price_shown", "Price shown after the final step.");
          if (f.otp) return finish(session, "blocked_otp", "The site asks for a verification code before any price.");

          const fields = formFields(obs);
          const isForm = isQuoteForm(obs);

          if (!isForm) {
            const links = obs.elements.filter((e) => (e.kind === "link" || e.kind === "button") && !clicked.has(e.label));
            const pick =
              links.find((e) => START_LINK.test(e.label)) ??
              links.find((e) => new RegExp(`${productLine} insurance`, "i").test(e.label)) ??
              links.find((e) => /products|insurance/i.test(e.label));
            if (!pick) {
              if (f.password) return finish(session, "blocked_account", "The site asks for an account (password) before any price.");
              return finish(session, "no_online_quote", "No link to an online quote was found.");
            }
            clicked.add(pick.label);
            await session.click(pick.id);
            continue;
          }

          if (f.password && submitted > 0) return finish(session, "blocked_account", "The journey asks for an account (password) before any price.");
          if (f.captcha && fields.some((x) => /robot|captcha/i.test(x.label))) {
            return finish(session, "blocked_captcha", "A CAPTCHA must be solved before continuing.");
          }

          // Fill required fields in page order, using a lookup as soon as its input is filled.
          for (let n = 0; n < 60; n++) {
            const current = session.last;
            const field = formFields(current).find((x) => x.required && isEmpty(x) && !x.disabled && !attempted.has(x.id));
            if (!field) break;
            attempted.add(field.id);
            const value = personaValue(field.label, persona);
            if (field.kind === "checkbox") {
              await session.setChecked(field.id, true);
            } else if (field.kind === "select" || field.kind === "radio") {
              const opts = (field.options ?? []).filter((o) => !/please select|choose/i.test(o));
              const match = value && opts.find((o) => o.toLowerCase() === value.toLowerCase() || o.toLowerCase().includes(value.toLowerCase()) || value.toLowerCase().includes(o.toLowerCase()));
              const fallback = opts.find((o) => o.toLowerCase() === "no") ?? opts[0];
              if (match || fallback) await session.choose(field.id, match || fallback);
            } else {
              await session.fill(field.id, value ?? (field.kind === "number" ? "1" : "N/A"));
              const at = current.elements.findIndex((e) => e.id === field.id);
              const btn = current.elements[at + 1];
              if (btn?.kind === "button" && LOOKUP.test(btn.label) && !clicked.has(btn.label)) {
                clicked.add(btn.label);
                await session.click(btn.id);
              }
            }
          }

          // Fix invalid fields the way a person would: digits only for phones.
          const invalid = formFields(session.last).filter((x) => x.invalid);
          if (invalid.length) {
            if (++errorRounds > 3) return finish(session, "gave_up", "Validation errors could not be resolved.");
            for (const field of invalid) {
              if (field.kind === "tel") await session.fill(field.id, field.value.replace(/\D/g, ""));
            }
          }

          const primary = session.last.elements.filter((e) => e.kind === "button" && !LOOKUP.test(e.label));
          const callback = primary.find((e) => /call ?back|call me/i.test(e.label));
          if (callback && session.last.flags.callback) return finish(session, "callback_only", "Only a callback request form is offered; no online price.");
          const next = primary.find((e) => PRIMARY.test(e.label)) ?? primary.at(-1);
          if (!next) return finish(session, "gave_up", "No button to continue.");
          if (/account|register|sign up/i.test(next.label)) return finish(session, "blocked_account", "The only way forward is to create an account.");

          const sigBefore = JSON.stringify(formFields(session.last).map((x) => x.label));
          await session.click(next.id);
          submitted++;
          const sigAfter = JSON.stringify(formFields(session.last).map((x) => x.label));
          if (sigAfter === sigBefore && sigAfter === lastSig && !session.last.flags.priceText) {
            if (++stuck >= 3) return finish(session, "gave_up", "The form would not move past this step.");
          } else stuck = 0;
          lastSig = sigAfter;
        } catch (err) {
          // One failed action shouldn't end the journey; the next round tries something else.
          if (err instanceof LimitReached) throw err;
          if (++failures > 4) return finish(session, "gave_up", `Page actions kept failing: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
        }
      }
      if (!session.outcome) await finish(session, "gave_up", "Stopped after 40 rounds.");
    } catch (err) {
      if (err instanceof LimitReached) await finish(session, "gave_up", err.message);
      else throw err;
    }
    return { cost: 0 };
  },
};

async function finish(session: AuditSession, outcome: Outcome, notes: string) {
  await session.finish(outcome, notes);
  return { cost: 0 };
}

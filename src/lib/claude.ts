import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";

export const MODELS = {
  agent: process.env.ARENA_AGENT_MODEL ?? "claude-opus-5-5",
  scorer: process.env.ARENA_SCORER_MODEL ?? "claude-opus-5-5",
  judge: process.env.ARENA_JUDGE_MODEL ?? "claude-opus-5-5",
};

// Claude Opus 5.5 list prices per 1M tokens; used for the audit cost column only.
const PRICE_PER_MTOK = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 };

let client: Anthropic | null = null;

/** The SDK also resolves ANTHROPIC_AUTH_TOKEN and `ant auth login` profiles; set ARENA_FORCE_CLAUDE=1 to rely on those. */
export function claudeAvailable(): boolean {
  if (process.env.ARENA_DISABLE_CLAUDE === "1") return false;
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ARENA_FORCE_CLAUDE === "1");
}

export function claude(): Anthropic {
  client ??= new Anthropic();
  return client;
}

export function costOf(usage: Anthropic.Beta.BetaUsage): number {
  const read = usage.cache_read_input_tokens ?? 0;
  const write = usage.cache_creation_input_tokens ?? 0;
  return (
    (usage.input_tokens * PRICE_PER_MTOK.input +
      usage.output_tokens * PRICE_PER_MTOK.output +
      read * PRICE_PER_MTOK.cacheRead +
      write * PRICE_PER_MTOK.cacheWrite) /
    1_000_000
  );
}

export class ClaudeRefusal extends Error {}

type CreateParams = Omit<Anthropic.Beta.MessageCreateParamsNonStreaming, "betas" | "fallbacks" | "stream">;

/**
 * One Messages API call with server-side refusal fallback enabled
 * (`fallbacks: "default"` routes a declined request to Anthropic's recommended fallback model).
 */
export async function createMessage(params: CreateParams): Promise<{ message: Anthropic.Beta.BetaMessage; cost: number }> {
  const stream = claude().beta.messages.stream({
    ...params,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  });
  const message = await stream.finalMessage();
  if (message.stop_reason === "refusal") {
    throw new ClaudeRefusal(`Claude declined the request (${message.stop_details?.category ?? "no category"}).`);
  }
  return { message, cost: costOf(message.usage) };
}

export function textOf(message: Anthropic.Beta.BetaMessage): string {
  return message.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/** Structured output: constrains the response to `jsonSchema`, then validates it with `schema`. */
export async function createStructured<T>(
  params: Omit<CreateParams, "output_config"> & { effort?: "low" | "medium" | "high" | "xhigh" | "max" },
  schema: z.ZodType<T>,
  jsonSchema: Record<string, unknown>,
): Promise<{ data: T; cost: number }> {
  const { effort, ...rest } = params;
  const { message, cost } = await createMessage({
    ...rest,
    output_config: { effort: effort ?? "high", format: { type: "json_schema", schema: jsonSchema } },
  });
  if (message.stop_reason === "max_tokens") throw new Error("Structured response was cut off at max_tokens.");
  const data = schema.parse(JSON.parse(textOf(message)));
  return { data, cost };
}

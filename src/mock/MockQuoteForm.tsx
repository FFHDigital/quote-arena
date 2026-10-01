"use client";

import { useState } from "react";
import type { MockField, MockSite } from "./sites";

type Values = Record<string, string>;

export default function MockQuoteForm({ site }: { site: MockSite }) {
  const [stepIndex, setStepIndex] = useState(0);
  const [values, setValues] = useState<Values>({});
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState<null | "price" | "callback" | "account">(null);

  const step = site.steps[stepIndex];
  const set = (id: string, v: string) => setValues((s) => ({ ...s, [id]: v }));

  function lookup(field: MockField) {
    if (!values[field.id]?.trim()) {
      setErrors((e) => ({ ...e, [field.id]: `Enter your ${field.label.toLowerCase()} first.` }));
      return;
    }
    setValues((s) => ({ ...s, ...field.lookup!.fills }));
    setRevealed((r) => ({ ...r, ...Object.fromEntries(Object.keys(field.lookup!.fills).map((k) => [k, true])) }));
    setErrors((e) => ({ ...e, [field.id]: "" }));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};
    for (const f of step.fields) {
      if (f.hiddenUntilLookup && !revealed[f.id]) {
        if (f.required) {
          const source = step.fields.find((s) => s.lookup && f.id in s.lookup.fills);
          if (source) next[source.id] = `Use "${source.lookup!.button}" to continue.`;
        }
        continue;
      }
      const v = f.type === "checkbox" ? (checked[f.id] ? "yes" : "") : (values[f.id] ?? "").trim();
      if (f.required && !v) next[f.id] = f.type === "checkbox" ? "Please confirm to continue." : `${f.label} is required.`;
      else if (v && f.pattern && !new RegExp(f.pattern).test(v)) next[f.id] = f.patternError ?? `${f.label} is not valid.`;
    }
    setErrors(next);
    if (Object.keys(next).length) return;
    if (stepIndex < site.steps.length - 1) {
      setStepIndex(stepIndex + 1);
      window.scrollTo(0, 0);
      return;
    }
    setDone(site.final.kind === "price" ? "price" : site.final.kind === "callback" ? "callback" : "account");
  }

  if (done === "price" && site.final.kind === "price") {
    return (
      <div style={{ border: `2px solid ${site.color}`, borderRadius: 12, padding: 24, background: "#fff" }}>
        <h2 style={{ margin: 0, fontSize: 22 }}>Here&apos;s your quote</h2>
        <p style={{ fontSize: 30, fontWeight: 700, margin: "12px 0", color: site.color }}>{site.final.text}</p>
        <p style={{ color: "#555" }}>Comprehensive cover. Price includes insurance premium tax.</p>
        <button type="button" style={btn(site.color)} onClick={() => alert("Demo site: nothing is sold here.")}>Buy now</button>
      </div>
    );
  }
  if (done === "callback") {
    return <p role="status">Thanks. An adviser will call you back within 2 working days.</p>;
  }
  if (done === "account") {
    return (
      <div>
        <h2>Check your email</h2>
        <p>We&apos;ve sent a verification code to your email address. Enter the code to continue.</p>
        <label htmlFor="otp">Verification code</label>
        <input id="otp" style={input} />
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate style={{ background: "#fff", borderRadius: 12, padding: 24, border: "1px solid #ddd" }}>
      <h2 style={{ marginTop: 0, fontSize: 22 }}>{step.title}</h2>
      {step.intro && <p style={{ color: "#444" }}>{step.intro}</p>}
      {step.fields.map((f) => {
        if (f.hiddenUntilLookup && !revealed[f.id]) return null;
        const err = errors[f.id];
        const errId = `${f.id}-error`;
        const common = { id: f.id, name: f.id, required: f.required, "aria-invalid": err ? true : undefined, "aria-describedby": err ? errId : undefined };
        return (
          <div key={f.id} style={{ marginBottom: 16 }}>
            {f.type === "radio" ? (
              <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
                <legend style={labelStyle}>{f.label}{f.required ? " *" : ""}</legend>
                {f.options!.map((o) => (
                  <label key={o} htmlFor={`${f.id}-${o}`} style={{ marginRight: 16 }}>
                    <input type="radio" id={`${f.id}-${o}`} name={f.id} value={o} required={f.required} checked={values[f.id] === o} onChange={() => set(f.id, o)} /> {o}
                  </label>
                ))}
              </fieldset>
            ) : f.type === "checkbox" ? (
              <label htmlFor={f.id}>
                <input type="checkbox" {...common} checked={!!checked[f.id]} onChange={(e) => setChecked((c) => ({ ...c, [f.id]: e.target.checked }))} /> {f.label}{f.required ? " *" : ""}
              </label>
            ) : (
              <>
                <label htmlFor={f.id} style={labelStyle}>{f.label}{f.required ? " *" : ""}</label>
                <div style={{ display: "flex", gap: 8 }}>
                  {f.type === "select" ? (
                    <select {...common} value={values[f.id] ?? ""} onChange={(e) => set(f.id, e.target.value)} style={input}>
                      {f.options!.map((o, i) => <option key={o} value={i === 0 ? "" : o}>{o}</option>)}
                    </select>
                  ) : (
                    <input {...common} type={f.type} value={values[f.id] ?? ""} onChange={(e) => set(f.id, e.target.value)} style={input} />
                  )}
                  {f.lookup && <button type="button" onClick={() => lookup(f)} style={btn("#333")}>{f.lookup.button}</button>}
                </div>
              </>
            )}
            {f.help && <p style={{ fontSize: 13, color: "#666", margin: "4px 0 0" }}>{f.help}</p>}
            {err && <p id={errId} role="alert" style={{ color: "#b42318", fontSize: 14, margin: "4px 0 0" }}>{err}</p>}
          </div>
        );
      })}
      <button type="submit" style={btn(site.color)}>{step.button}</button>
    </form>
  );
}

const labelStyle: React.CSSProperties = { display: "block", fontWeight: 600, marginBottom: 4 };
const input: React.CSSProperties = { padding: "10px 12px", border: "1px solid #bbb", borderRadius: 6, fontSize: 16, minWidth: 240, flex: "0 1 320px" };
function btn(color: string): React.CSSProperties {
  return { background: color, color: "#fff", border: 0, borderRadius: 6, padding: "10px 18px", fontSize: 16, fontWeight: 600, cursor: "pointer" };
}

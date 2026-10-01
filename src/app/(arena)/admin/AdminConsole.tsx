"use client";

import { useCallback, useEffect, useState } from "react";
import type { AdminInsurer } from "@/app/api/admin/insurers/route";

interface Job { id: number; type: string; payload: Record<string, unknown>; status: string; error: string | null; lastMessage: string | null; created_at: string }
interface Flag { id: number; verdict_id: number; reason: string; status: string; verdict_reason: string; insurer_a: string; insurer_b: string; created_at: string }
interface Review { id: number; reason: string; insurer_a: string; insurer_b: string }

type Tab = "insurers" | "jobs" | "flags";

export default function AdminConsole() {
  const [token, setToken] = useState("");
  const [tab, setTab] = useState<Tab>("insurers");
  const [insurers, setInsurers] = useState<AdminInsurer[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [flags, setFlags] = useState<{ flags: Flag[]; review: Review[] }>({ flags: [], review: [] });
  const [country, setCountry] = useState("all");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        setToken(sessionStorage.getItem("arena-admin-token") ?? "");
      } catch {}
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const call = useCallback(
    async <T,>(url: string, init?: RequestInit): Promise<T | null> => {
      const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", "x-admin-token": token, ...(init?.headers ?? {}) } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(data.error ?? `Request failed (${res.status})`);
        return null;
      }
      return data as T;
    },
    [token],
  );

  const load = useCallback(async () => {
    const [i, j, f] = await Promise.all([
      call<AdminInsurer[]>("/api/admin/insurers"),
      call<Job[]>("/api/admin/jobs"),
      call<{ flags: Flag[]; review: Review[] }>("/api/admin/flags"),
    ]);
    if (i) setInsurers(i);
    if (j) setJobs(j);
    if (f) setFlags(f);
  }, [call]);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const t = setInterval(() => call<Job[]>("/api/admin/jobs").then((j) => j && setJobs(j)), 4000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [load, call]);

  async function patch(id: number, body: Record<string, unknown>) {
    if (await call(`/api/admin/insurers/${id}`, { method: "PATCH", body: JSON.stringify(body) })) load();
  }

  async function audit(insurerId: number, product: string) {
    const r = await call<{ jobId: number }>("/api/admin/audits", { method: "POST", body: JSON.stringify({ insurerId, product }) });
    if (r) {
      setMessage(`Queued audit job ${r.jobId}.`);
      load();
    }
  }

  async function resolve(id: number, status: string) {
    if (await call(`/api/admin/flags/${id}`, { method: "PATCH", body: JSON.stringify({ status, resolution: "" }) })) load();
  }

  const countries = [...new Set(insurers.map((i) => i.country_code))];
  const shown = insurers.filter((i) => country === "all" || i.country_code === country);
  const openFlags = flags.flags.filter((f) => f.status === "open").length;

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-sm">
          Admin token
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            onBlur={() => {
              try {
                sessionStorage.setItem("arena-admin-token", token);
              } catch {}
              load();
            }}
            placeholder="Not needed in development"
            className="w-64 rounded-lg border border-line bg-surface px-3 py-2"
          />
        </label>
        <div role="tablist" className="ml-auto flex gap-1 rounded-lg border border-line bg-surface p-1 text-sm">
          {([["insurers", "Insurers"], ["jobs", "Jobs"], ["flags", `Flags${openFlags ? ` (${openFlags})` : ""}`]] as const).map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`rounded-md px-3 py-1.5 ${tab === k ? "bg-accent-soft font-medium text-accent" : "text-muted hover:text-ink"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {message && (
        <p className="flex justify-between rounded-lg border border-line bg-surface px-4 py-2 text-sm" role="status">
          {message}
          <button onClick={() => setMessage(null)} className="text-muted" aria-label="Dismiss">✕</button>
        </p>
      )}

      {tab === "insurers" && (
        <>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2">
              Country
              <select value={country} onChange={(e) => setCountry(e.target.value)} className="rounded-lg border border-line bg-surface px-2 py-1.5">
                <option value="all">All</option>
                {countries.map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
            <span className="text-muted">Only tick &ldquo;Cleared for audits&rdquo; after checking the insurer&apos;s website terms allow automated access.</span>
          </div>
          <div className="overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="px-4 py-3 font-medium">Insurer</th>
                  <th className="px-3 py-3 font-medium">Active</th>
                  <th className="px-3 py-3 font-medium">Cleared for audits</th>
                  <th className="px-3 py-3 font-medium">Last audit</th>
                  <th className="px-4 py-3 font-medium">Run audit</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((i) => (
                  <tr key={i.id} className="border-t border-line">
                    <td className="px-4 py-2.5">
                      <span className="font-medium">{i.name}</span> <span className="text-xs text-muted">{i.country_code}{i.is_demo ? " · demo" : ""}</span>
                      <a href={i.home_url} target="_blank" rel="noreferrer" className="block truncate text-xs text-accent">{i.home_url}</a>
                    </td>
                    <td className="px-3 py-2.5"><input type="checkbox" aria-label={`${i.name} active`} checked={!!i.active} onChange={(e) => patch(i.id, { active: e.target.checked })} /></td>
                    <td className="px-3 py-2.5"><input type="checkbox" aria-label={`${i.name} cleared for audits`} checked={!!i.audit_allowed} onChange={(e) => patch(i.id, { auditAllowed: e.target.checked })} /></td>
                    <td className="px-3 py-2.5 text-muted">{i.last_audit ? new Date(i.last_audit).toLocaleString("en-GB") : "never"}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {(i.products ?? "").split(",").filter(Boolean).map((p) => (
                          <button key={p} onClick={() => audit(i.id, p)} disabled={!i.audit_allowed} className="rounded-md border border-line px-2 py-1 text-xs hover:bg-surface-2 disabled:opacity-40">
                            {p}
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <AddInsurer onAdd={(body) => call("/api/admin/insurers", { method: "POST", body: JSON.stringify(body) }).then((r) => r && load())} />
        </>
      )}

      {tab === "jobs" && (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="px-4 py-3 font-medium">Job</th>
                <th className="px-3 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Latest</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} className="border-t border-line align-top">
                  <td className="px-4 py-2.5">
                    #{j.id} {j.type} <span className="block text-xs text-muted">{new Date(j.created_at).toLocaleString("en-GB")} · {JSON.stringify(j.payload)}</span>
                  </td>
                  <td className={`px-3 py-2.5 ${j.status === "failed" ? "text-lose" : j.status === "done" ? "text-win" : ""}`}>{j.status}</td>
                  <td className="px-4 py-2.5 text-muted">{j.error ?? j.lastMessage}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!jobs.length && <p className="p-4 text-sm text-muted">No jobs yet.</p>}
        </div>
      )}

      {tab === "flags" && (
        <div className="grid gap-4">
          <section className="grid gap-2">
            <h2 className="font-medium">Reported by users</h2>
            {flags.flags.length === 0 && <p className="text-sm text-muted">No reports.</p>}
            {flags.flags.map((f) => (
              <div key={f.id} className="rounded-xl border border-line bg-surface p-4 text-sm">
                <p className="text-xs text-muted">{f.insurer_a} vs {f.insurer_b} · verdict #{f.verdict_id} · {f.status}</p>
                <p className="mt-1 font-medium">&ldquo;{f.reason}&rdquo;</p>
                <p className="mt-1 text-muted">Verdict said: {f.verdict_reason}</p>
                {f.status === "open" && (
                  <div className="mt-3 flex gap-2">
                    <button onClick={() => resolve(f.id, "confirmed")} className="rounded-md border border-line px-3 py-1 hover:bg-surface-2">Verdict stands</button>
                    <button onClick={() => resolve(f.id, "overturned")} className="rounded-md border border-line px-3 py-1 text-lose hover:bg-lose-soft">Overturn and re-judge</button>
                    <button onClick={() => resolve(f.id, "dismissed")} className="rounded-md px-3 py-1 text-muted hover:bg-surface-2">Dismiss</button>
                  </div>
                )}
              </div>
            ))}
          </section>
          <section className="grid gap-2">
            <h2 className="font-medium">Flagged by the judge</h2>
            {flags.review.length === 0 && <p className="text-sm text-muted">Nothing needs review.</p>}
            {flags.review.map((r) => (
              <p key={r.id} className="rounded-xl border border-line bg-surface p-4 text-sm">
                <span className="text-xs text-muted">{r.insurer_a} vs {r.insurer_b} · verdict #{r.id}</span>
                <span className="mt-1 block">{r.reason}</span>
              </p>
            ))}
          </section>
        </div>
      )}
    </div>
  );
}

function AddInsurer({ onAdd }: { onAdd: (body: Record<string, unknown>) => void }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ country: "GB", name: "", slug: "", homeUrl: "", car: "", home: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  if (!open) return <button onClick={() => setOpen(true)} className="justify-self-start text-sm text-accent hover:underline">Add an insurer</button>;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const products = Object.fromEntries(([["car", f.car], ["home", f.home]] as const).filter(([, url]) => url));
        onAdd({ country: f.country, name: f.name, slug: f.slug, homeUrl: f.homeUrl, products });
        setOpen(false);
      }}
      className="grid gap-3 rounded-xl border border-line bg-surface p-4 text-sm sm:grid-cols-3"
    >
      {([["country", "Country code"], ["name", "Name"], ["slug", "Slug (a-z, 0-9, -)"], ["homeUrl", "Home page URL"], ["car", "Car quote start URL"], ["home", "Home quote start URL"]] as const).map(([k, label]) => (
        <label key={k} className="grid gap-1">
          {label}
          <input value={f[k]} onChange={set(k)} required={k !== "car" && k !== "home"} className="rounded-lg border border-line bg-surface px-3 py-2" />
        </label>
      ))}
      <div className="flex gap-2 sm:col-span-3">
        <button className="rounded-md bg-accent px-3 py-1.5 font-medium text-surface">Add</button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-md px-3 py-1.5 text-muted">Cancel</button>
      </div>
    </form>
  );
}

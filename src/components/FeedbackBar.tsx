"use client";

import { useState } from "react";

export default function FeedbackBar({ verdictId }: { verdictId: number }) {
  const [voted, setVoted] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [shared, setShared] = useState(false);

  async function vote(helpful: boolean) {
    setVoted(helpful);
    await fetch(`/api/verdicts/${verdictId}/feedback`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ helpful }) });
  }

  async function report(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    const res = await fetch(`/api/verdicts/${verdictId}/flags`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) });
    setState(res.ok ? "sent" : "error");
  }

  async function share() {
    await navigator.clipboard.writeText(window.location.href).catch(() => {});
    setShared(true);
    setTimeout(() => setShared(false), 2000);
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted">Was this verdict useful?</span>
        {voted === null ? (
          <>
            <button type="button" onClick={() => vote(true)} className="rounded-md border border-line px-3 py-1 hover:bg-surface-2">Yes</button>
            <button type="button" onClick={() => vote(false)} className="rounded-md border border-line px-3 py-1 hover:bg-surface-2">No</button>
          </>
        ) : (
          <span>Thanks for the feedback.</span>
        )}
        <span className="mx-1 text-line">|</span>
        <button type="button" onClick={() => setOpen((o) => !o)} className="text-accent hover:underline" aria-expanded={open}>
          Report a problem
        </button>
        <button type="button" onClick={share} className="text-accent hover:underline">
          {shared ? "Link copied" : "Copy link"}
        </button>
      </div>
      {open &&
        (state === "sent" ? (
          <p className="text-sm text-win">Reported. An admin will review this verdict.</p>
        ) : (
          <form onSubmit={report} className="grid max-w-xl gap-2">
            <label htmlFor="flag-reason" className="text-sm">What looks wrong?</label>
            <textarea
              id="flag-reason"
              required
              minLength={5}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="rounded-lg border border-line bg-surface p-2 text-sm"
              placeholder="For example: this insurer does offer an online quote from the car insurance page."
            />
            <div className="flex items-center gap-3">
              <button type="submit" disabled={state === "sending"} className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-surface disabled:opacity-50">
                Send report
              </button>
              {state === "error" && <span className="text-sm text-lose">Could not send. Try again.</span>}
            </div>
          </form>
        ))}
    </div>
  );
}

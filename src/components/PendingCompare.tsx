"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface JobState {
  status: "queued" | "running" | "done" | "failed";
  queuedAhead: number;
  progress: { t: string; msg: string }[];
  error: string | null;
}

export default function PendingCompare(props: { country: string; product: string; a: string; b: string; llm: string; names: [string, string] }) {
  const router = useRouter();
  const [job, setJob] = useState<JobState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Starting twice is harmless: the server reuses an open job for the same pair.
    let timer: ReturnType<typeof setTimeout>;
    let live = true;

    async function poll(id: number) {
      const res = await fetch(`/api/jobs/${id}`, { cache: "no-store" });
      const data = (await res.json()) as JobState;
      if (!live) return;
      setJob(data);
      if (data.status === "done") router.refresh();
      else if (data.status === "failed") setError(data.error ?? "The comparison failed.");
      else timer = setTimeout(() => poll(id), 2000);
    }

    fetch("/api/compare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ country: props.country, product: props.product, insurerA: props.a, insurerB: props.b, llm: props.llm }),
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Could not start the comparison.");
        if (data.status === "ready") router.refresh();
        else poll(data.jobId);
      })
      .catch((err: Error) => setError(err.message));

    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [props.country, props.product, props.a, props.b, props.llm, router]);

  if (error) {
    return (
      <div role="alert" className="rounded-xl border border-lose/30 bg-lose-soft p-5 text-lose">
        <p className="font-medium">We couldn&apos;t compare these insurers.</p>
        <p className="mt-1 text-sm">{error}</p>
      </div>
    );
  }

  const steps = job?.progress ?? [];
  return (
    <div className="rounded-xl border border-line bg-surface p-5" aria-live="polite">
      <div className="flex items-center gap-3">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" aria-hidden />
        <p className="font-medium">
          {!job || job.status === "queued"
            ? job?.queuedAhead
              ? `Waiting in the queue (${job.queuedAhead} ahead of you)…`
              : "Starting the comparison…"
            : `Auditing ${props.names[0]} and ${props.names[1]}…`}
        </p>
      </div>
      <p className="mt-2 text-sm text-muted">
        A fresh audit walks each insurer&apos;s quote journey in a real browser. It usually takes 1 to 5 minutes per insurer. You can leave this page open; it updates by itself.
      </p>
      {steps.length > 0 && (
        <ol className="mt-4 grid gap-1.5 border-l border-line pl-4 text-sm">
          {steps.map((s, i) => (
            <li key={i} className={i === steps.length - 1 ? "text-ink" : "text-muted"}>
              <span className="mr-2 font-mono text-xs text-muted">{new Date(s.t).toLocaleTimeString("en-GB")}</span>
              {s.msg}
            </li>
          ))}
        </ol>
      )}
      <p className="mt-4 text-xs text-muted">Needs the background worker (<code>npm run worker</code>) to be running.</p>
    </div>
  );
}

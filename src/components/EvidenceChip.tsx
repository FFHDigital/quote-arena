"use client";

import { useRef } from "react";
import type { EvidenceItem } from "@/lib/views";

export default function EvidenceChip({ item, insurer, auditId }: { item: EvidenceItem; insurer: string; auditId: number }) {
  const ref = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.showModal()}
        className="rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-muted hover:border-accent hover:text-accent"
        aria-label={`Evidence ${item.ref} for ${insurer}: ${item.summary}`}
      >
        {item.ref}
      </button>
      <dialog
        ref={ref}
        onClick={(e) => e.target === ref.current && ref.current?.close()}
        className="m-auto w-[min(92vw,720px)] rounded-xl border border-line bg-surface p-0 text-ink backdrop:bg-black/50"
      >
        <div className="flex items-start justify-between gap-4 border-b border-line p-4">
          <div>
            <p className="text-xs text-muted">
              {insurer} · {item.ref} · {item.kind}
              {item.step ? ` · step ${item.step}` : ""}
            </p>
            <p className="mt-1 font-medium">{item.summary}</p>
          </div>
          <button type="button" onClick={() => ref.current?.close()} className="rounded-md px-2 py-1 text-muted hover:bg-surface-2" aria-label="Close">
            ✕
          </button>
        </div>
        <div className="max-h-[70vh] overflow-auto p-4">
          {item.screenshot && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.screenshot} alt={`Screenshot: ${item.summary}`} className="w-full rounded-lg border border-line" loading="lazy" />
          )}
          {item.fields && (
            <ul className="mt-3 grid gap-1 text-sm sm:grid-cols-2">
              {item.fields.map((f) => (
                <li key={f.label} className="truncate">
                  {f.label.replace(/\s*\*$/, "")} <span className="text-muted">({f.kind}{f.required ? ", required" : ""})</span>
                </li>
              ))}
            </ul>
          )}
          {item.url && <p className="mt-3 break-all text-xs text-muted">{item.url}</p>}
          <a href={`/audits/${auditId}#${item.ref}`} className="mt-3 inline-block text-sm text-accent hover:underline">
            Open the full journey
          </a>
        </div>
      </dialog>
    </>
  );
}

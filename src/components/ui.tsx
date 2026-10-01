import type { ReactNode } from "react";

export function InsurerMark({ name, color, size = 32 }: { name: string; color: string; size?: number }) {
  const initials = name
    .replace(/[^A-Za-z ]/g, "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  return (
    <span
      aria-hidden
      className="inline-grid shrink-0 place-items-center rounded-full font-semibold text-white"
      style={{ background: color, width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials || "?"}
    </span>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-line bg-surface p-5 ${className}`}>{children}</section>;
}

export function ScoreBar({ score, max = 10, tone = "neutral" }: { score: number; max?: number; tone?: "win" | "lose" | "neutral" }) {
  const pct = Math.max(0, Math.min(100, (score / max) * 100));
  const fill = tone === "win" ? "bg-win" : tone === "lose" ? "bg-muted/50" : "bg-accent";
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2" role="presentation">
      <div className={`h-full rounded-full ${fill}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

const OUTCOME_LABEL: Record<string, string> = {
  price_shown: "Price shown online",
  blocked_account: "Account needed first",
  blocked_otp: "Verification code needed",
  blocked_captcha: "CAPTCHA before price",
  callback_only: "Callback only",
  no_online_quote: "No online quote",
  gave_up: "Journey could not finish",
  error: "Audit error",
};

export function OutcomePill({ outcome }: { outcome: string }) {
  const ok = outcome === "price_shown";
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${ok ? "bg-win-soft text-win" : "bg-lose-soft text-lose"}`}>
      {OUTCOME_LABEL[outcome] ?? outcome}
    </span>
  );
}

export function formatDate(iso: string | null): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null) return "n/a";
  if (seconds < 60) return `${seconds} s`;
  return `${Math.round(seconds / 6) / 10} min`;
}

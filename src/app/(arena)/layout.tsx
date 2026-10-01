import Link from "next/link";

const NAV = [
  { href: "/", label: "Arena" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/methodology", label: "Methodology" },
];

export default function ArenaLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-screen flex-col bg-bg text-ink">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <span aria-hidden className="grid h-7 w-7 place-items-center rounded-md bg-accent text-sm font-bold text-surface">QA</span>
            Quote Arena
          </Link>
          <nav aria-label="Main" className="flex gap-1 text-sm">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="rounded-md px-3 py-1.5 text-muted hover:bg-surface-2 hover:text-ink">
                {n.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
      <footer className="border-t border-line text-xs text-muted">
        <div className="mx-auto max-w-5xl px-4 py-5">
          Quote Arena measures how easy it is to get a quote online. It does not rate price, cover or claims handling, and it is not advice.{" "}
          <Link href="/methodology" className="underline">How it works</Link> · <Link href="/admin" className="underline">Admin</Link>
        </div>
      </footer>
    </div>
  );
}

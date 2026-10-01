import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { mockSite } from "@/mock/sites";

export async function generateMetadata({ params }: LayoutProps<"/mock/[slug]">): Promise<Metadata> {
  const site = mockSite((await params).slug);
  return { title: site ? `${site.name} | Car insurance` : "Not found", robots: { index: false } };
}

export default async function MockLayout({ children, params }: LayoutProps<"/mock/[slug]">) {
  const { slug } = await params;
  const site = mockSite(slug);
  if (!site) notFound();
  return (
    <div style={{ minHeight: "100vh", background: "#f4f5f7", color: "#1b1b1b", fontFamily: "Georgia, serif", minWidth: site.fixedWidth }}>
      <header style={{ background: site.color, color: "#fff", padding: "16px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <a href={`/mock/${site.slug}`} style={{ color: "#fff", fontWeight: 700, fontSize: 22, textDecoration: "none" }}>{site.name}</a>
        <nav style={{ display: "flex", gap: 16, fontSize: 14 }}>
          <span>About us</span>
          <span>Help</span>
          <span>Log in</span>
        </nav>
      </header>
      <main style={{ maxWidth: site.fixedWidth ?? 760, margin: "0 auto", padding: "32px 24px" }}>{children}</main>
      <footer style={{ textAlign: "center", fontSize: 12, color: "#666", padding: 24 }}>
        {site.name} is a fictional insurer used to test Quote Arena. Nothing here is sold.
      </footer>
    </div>
  );
}

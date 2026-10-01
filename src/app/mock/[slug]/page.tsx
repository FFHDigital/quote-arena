import { notFound } from "next/navigation";
import MockQuoteForm from "@/mock/MockQuoteForm";
import { mockSite } from "@/mock/sites";

export default async function MockHome({ params }: PageProps<"/mock/[slug]">) {
  const { slug } = await params;
  const site = mockSite(slug);
  if (!site) notFound();
  const first = site.navPath[0];
  return (
    <>
      <h1 style={{ fontSize: 34, marginTop: 0 }}>{first?.heading ?? site.tagline}</h1>
      <p style={{ fontSize: 18, color: "#444" }}>{first?.body ?? "Straightforward cover from a name you can trust."}</p>
      {site.formOnHome && <MockQuoteForm site={site} />}
      {first && (
        <a href={site.navPath.length > 1 ? `/mock/${site.slug}/nav/1` : `/mock/${site.slug}/quote`} style={{ color: site.color, fontSize: 18 }}>{first.link}</a>
      )}
      {site.homeCta && (
        <a href={`/mock/${site.slug}/quote`} style={{ display: "inline-block", background: site.color, color: "#fff", padding: "14px 24px", borderRadius: 8, fontWeight: 700, textDecoration: "none", fontSize: 18 }}>
          {site.homeCta}
        </a>
      )}
      <section style={{ marginTop: 40, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16 }}>
        {["Rated 4.6 by customers", "UK-based claims team", "Cover from day one"].map((t) => (
          <div key={t} style={{ background: "#fff", padding: 16, borderRadius: 8, border: "1px solid #e2e2e2" }}>{t}</div>
        ))}
      </section>
    </>
  );
}

import { notFound } from "next/navigation";
import { mockSite } from "@/mock/sites";

export default async function MockNav({ params }: PageProps<"/mock/[slug]/nav/[n]">) {
  const { slug, n } = await params;
  const site = mockSite(slug);
  const i = Number(n);
  const page = site?.navPath[i];
  if (!site || !page) notFound();
  const last = i === site.navPath.length - 1;
  return (
    <>
      <h1 style={{ fontSize: 30, marginTop: 0 }}>{page.heading}</h1>
      <p style={{ fontSize: 18, color: "#444" }}>{page.body}</p>
      <ul style={{ lineHeight: 2 }}>
        <li>Frequently asked questions</li>
        <li>Policy documents</li>
      </ul>
      <a href={last ? `/mock/${site.slug}/quote` : `/mock/${site.slug}/nav/${i + 1}`} style={{ color: site.color, fontSize: 18 }}>
        {page.link}
      </a>
    </>
  );
}

import { notFound } from "next/navigation";
import MockQuoteForm from "@/mock/MockQuoteForm";
import { mockSite } from "@/mock/sites";

export default async function MockQuote({ params }: PageProps<"/mock/[slug]/quote">) {
  const { slug } = await params;
  const site = mockSite(slug);
  if (!site) notFound();
  return (
    <>
      <MockQuoteForm site={site} />
    </>
  );
}

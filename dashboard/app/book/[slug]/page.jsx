import BookPageClient from './BookPageClient';

// Jira 16y "SEO public profile pages" — a server component wrapper so this route can
// export generateMetadata and render structured data; the actual booking wizard stays a
// client component (BookPageClient) since it's all interactive state, not something that
// needs to be in the initial HTML for a crawler.
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

async function getBusiness(slug) {
  try {
    const res = await fetch(`${API_URL}/api/public/${slug}`, { next: { revalidate: 300 } });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const biz = await getBusiness(slug);
  if (!biz) return { title: 'Book an appointment' };

  const where = [biz.address, biz.city && !biz.address?.includes(biz.city) ? biz.city : null].filter(Boolean).join(', ');
  const title = `Book with ${biz.name}`;
  const description = biz.description || `Book an appointment online with ${biz.name}${where ? ` in ${where}` : ''}. No phone call needed.`;

  return {
    title,
    description,
    openGraph: { title, description, type: 'website' },
    twitter: { card: 'summary', title, description },
  };
}

export default async function BookPage({ params }) {
  const { slug } = await params;
  const biz = await getBusiness(slug);

  // schema.org LocalBusiness — lets search engines show hours/address directly in results.
  // Only emitted when the business actually resolved; BookPageClient handles the
  // "not found" state on its own (it re-fetches client-side regardless).
  const jsonLd = biz && {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: biz.name,
    address: biz.address || undefined,
    telephone: biz.phone || undefined,
    areaServed: biz.city || undefined,
    openingHoursSpecification: (biz.hours ?? []).map((h) => ({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][h.day_of_week],
      opens: h.open_time,
      closes: h.close_time,
    })),
  };

  return (
    <>
      {jsonLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />}
      <BookPageClient />
    </>
  );
}

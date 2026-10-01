// Jira 16y "SEO public profile pages" — lists /find and every listed business's booking
// page so crawlers discover them without needing an explicit link from somewhere else.
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3002';

async function allListedSlugs() {
  const slugs = [];
  let page = 1;
  for (;;) {
    const res = await fetch(`${API_URL}/api/public/directory?${new URLSearchParams({ page })}`, { next: { revalidate: 3600 } });
    if (!res.ok) break;
    const data = await res.json();
    slugs.push(...data.results.map((b) => b.slug));
    if (page * data.pageSize >= data.total) break;
    page += 1;
  }
  return slugs;
}

export default async function sitemap() {
  const slugs = await allListedSlugs().catch(() => []);
  return [
    { url: `${SITE_URL}/find`, changeFrequency: 'daily', priority: 0.8 },
    ...slugs.map((slug) => ({ url: `${SITE_URL}/book/${slug}`, changeFrequency: 'weekly', priority: 0.6 })),
  ];
}

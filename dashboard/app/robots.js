// Jira 16y — crawl the public-facing pages (directory, booking pages), not the admin
// dashboard, customer portal, or signed-link pages, which carry no useful public content
// and in the portal/manage-link cases are meant to stay unlisted.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3002';

export default function robots() {
  return {
    rules: {
      userAgent: '*',
      allow: ['/find', '/book/'],
      disallow: ['/my/', '/manage/', '/accept-invite/', '/login', '/signup', '/platform', '/overview', '/calendar', '/bookings', '/customers', '/calls', '/services', '/team', '/exceptions', '/onboarding', '/billing', '/settings', '/audit-log'],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}

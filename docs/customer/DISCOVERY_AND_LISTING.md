# Discovery and listing

How businesses are found (`/find`) and how an owner controls that. Jira parent 16.

## Rules
- **Opt-in.** `listing.listed` defaults to `false`; the owner turns it on in Settings.
- **Live only when ready.** A listed business appears in search only if: go-live is done (`onboarding_completed_at`), it is not suspended, it has at least one service, and hours are saved (`isListingEligible`, already built and tested).
- **Moderation.** The platform admin can hide a listing (`listing.hidden_by_platform`), no approval queue before listing. Hiding is a later task (Jira 16w).
- **Unlisted is not private.** A business with a booking link works for anyone who has the link, listed or not. The owner can turn the booking page off (`booking_page_enabled: false`).
- **Closed or deactivated** accounts (suspended, `deleted_at` set) never appear and their link answers 404.

## Fields (on `businesses`)
| Field | Meaning |
|---|---|
| `slug` | The link name: `/book/<slug>`. Unique, lowercase `a-z 0-9 -`, 3 to 40 characters, reserved words blocked (`directory`, `api`, `admin`, `login`, `find`, `book`...). Created at signup and platform registration; owner can change it. A collision gets the city, then a number (`abc-salon`, `abc-salon-tampa`, `abc-salon-2`). |
| `booking_page_enabled` | Booking page on/off (default on once a slug exists). |
| `listing.listed`, `listing.hidden_by_platform` | See rules. |
| `listing.categories[]` | Up to 3 tags from a fixed list: `hair-salon, barber, nail-salon, spa-massage, dentist, doctor, physiotherapy, fitness, home-services, restaurant, professional-services, other`. |
| `listing.city / region / country / description` | Shown on result cards; `city` is what tells same-name businesses apart. |

## Search (no extra index or denormalised text)
`GET /api/public/directory?q=&category=&city=&page=` does two small queries:
1. Listed, not hidden, not suspended businesses matching the category and city filters.
2. If `q` is given, keep those whose name matches, or that have a service whose name matches `q` (a second query on `services`).
Then drop any that are not eligible (no service / no hours / go-live not done), sort by name, return 20 per page. At this scale regex matching is fine; Atlas Search and "near me" (geo) are later tasks.

Result card: name, categories, city and street address, contact phone, top 3 services (name and price), `slug`. **Never** returned: emails of staff, internal ids other than the slug, anything about customers.

Other endpoints: `GET /api/public/directory/categories` (categories with counts) and `/cities` (cities with counts), both only over live businesses.

## Owner controls (Settings > "Booking page & listing")
Copy the booking link, change the slug (with a live check), turn the booking page on or off, turn directory listing on, pick categories, city, region, country and a short description. The card shows whether the listing is **live** or **on but not visible yet** with the reason ("add a service", "save your hours", "finish go-live").

## Abuse and safety
Public reads are rate limited per IP; nothing public returns customer data; slugs cannot impersonate system routes; listing is opt-in so a business is never exposed without the owner choosing it.

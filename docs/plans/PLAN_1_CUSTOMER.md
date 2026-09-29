# PLAN 1 — CUSTOMER (find the right business, book, be recognised, see everything)

**Status: not started.** Design is complete; build waits for the order from the team lead.

Problem you raised: a customer opens the booking site — how do they reach **ABC Salon, not XYZ Salon**, or **ABC Dentist**, or find "an appointment for something" when they don't know who provides it?
Today: impossible (no public booking at all, no business link, no directory). Only phone calls (the number decides the business) and reschedule/cancel via a signed link exist.

## 1A. How a customer reaches the correct business (the missing piece)
```
Customer arrives by...
 A) a business link / QR / SMS from ABC Salon ─────────► /book/abc-salon ── business is FIXED; name + address on every screen
 B) only a need ("dentist in Tampa", "haircut", "ABC Dentist") ► /find ─ search name / category / city / service
        ─► result cards (name, category, city + address, matching services, "Book") ─► pick ABC Dentist ─► /book/abc-dentist
 C) phones the business number ─────────────────────────► that number IS that business (works today)
```
- **Direct link (A)** is the zero-ambiguity path every business shares on Instagram, website, Google Business Profile, shop QR poster, receipts, or an SMS the AI agent sends.
- **Directory `/find` (B)**: one public search page for the whole platform. Search box (business name OR service word like "teeth cleaning"), category chips
  (Salon, Dentist, Barber, Spa, Fitness…), city/area field. Cards show name, category, **city + street address**, top services, and a Book button.
  Two businesses called "ABC Salon" are told apart by city/address (and a short distance/phone hint later). A link "Looking to book? Find a business" is added on the login page.
- **Wrong-business guardrails:** business name + address in the header of every booking step; breadcrumb "Find a business > ABC Dentist > Book"; confirmation screen and SMS/email repeat name, address, map link;
  "Not the right business?" link back to `/find`; free cancel via the manage link; services shown are only that business's; a service search still forces an explicit business pick before slots.
- **Listing is opt-in** (`listed=false` by default): the owner turns on "List my business in the directory" in Settings. It only goes live if: onboarding go-live done, business active (not suspended), >=1 service, hours set.
  Platform admin can hide a listing (moderation). The direct link works even when unlisted. Default = auto-list when criteria met + admin can hide (no approval queue); change if boss wants approval first.
- **Data (public profile on `businesses`):** `slug` (unique), `booking_page_enabled`, `listing.{listed, hidden_by_platform, display_name, categories[] (structured tags e.g. dentist, hair-salon, barber; max 3), city, region, country, description}`, denormalised `search_text` (name+services+categories+city, rebuilt when services/listing change).
  Today `industry` is only a coarse free string ("Medical / Dental"), so we add finer `categories[]` and structured `city`.
- **API (public, no login):** `GET /api/public/directory?q=&category=&city=&page=` (only listed+active fields), `/directory/categories`, `/directory/cities`,
  then per business `GET /api/public/:slug`, `/services`, `/staff?serviceId=`, `/availability`, `POST /bookings`. Search = case-insensitive match on `search_text` + category/city filters (fine at this scale; Atlas Search/geo "near me" later).
- **Slug rules:** lowercase a-z0-9-, reserved words blocked; collision -> `abc-salon-tampa` then numeric. Owner edits it in Settings.
- Multi-location businesses: the page shows the location picker (locations already exist).

## 1B. Customer identity, salon vs dentist, stylist
- Identity = **phone number per business** (`customers` unique on business_id+phone; `upsertCustomer` normalises). Internal customer ID is a UUID; customers never remember an ID — phone + one-time code is their login (portal, Stage 2).
- **Old customer** (already in DB from calls) books on web with the same phone -> matched to the SAME customer record (calls + web + dashboard on one profile). **New customer** -> record created at first booking, no password step.
  Different phone/email later -> "possible duplicate" -> staff merge tool. No pre-fill / "you're already a customer" from a phone alone (privacy).
- **Salon vs dentist:** separate tenants (own link, services, staff, hours, number, customers). Same person = two independent profiles, nothing crosses tenants.
- **Stylist "Jessica":** staff picker filtered by `service_ids` (enforced server-side; today only a UI filter) or "Any available" (server picks a free eligible staff and retries on slot conflict).
- Booking `source` = phone | web | dashboard (badge in dashboard); web booking stores SMS/email consent (time + checkbox text); STOP handling already exists.

## 1C. Access levels
Guest (public link, books) -> Link holder (signed manage link: that one booking) -> Verified customer (Stage 2: SMS code or email magic link, "My appointments": upcoming/past/cancelled, reschedule/cancel, profile, preferences, data export/delete) -> Staff (dashboard).

## 1D. Steps — doable now vs tomorrow
| # | Step | NOW (me, tonight) | TOMORROW |
|---|---|---|---|
| C1 | Design docs: `docs/customer/CUSTOMER_JOURNEY.md`, `DISCOVERY_AND_LISTING.md`, `PUBLIC_BOOKING_API.md`, `PORTAL_SPEC.md` + visual journey map (artifact + PDF) | yes | — |
| C2 | Listing model: slug, categories, city, opt-in, `search_text`, schema index | code + tests | teammate `npm run migrate` |
| C3 | Public APIs (directory + booking) with rate limit, honeypot, daily cap, suspended->404, staff-service check, offered-slot check, idempotency | code + tests | deploy |
| C4 | Customer UI: `/find` directory, `/book/[slug]` 5-step wizard, confirmation, closed/empty/conflict states, mobile-first | code + browser check | `next build` + restart |
| C5 | Owner UI: Settings "Booking page & listing" card (link copy, slug edit, listing toggle, categories, city) | code | deploy |
| C6 | Identity: `source`, consent record, returning match test, source badge in dashboard | code + tests | deploy |
| C7 | Platform admin "hide listing" control | later | — |
| C8 | Portal Stage 2 (OTP/magic link, my-appointments) | spec only | needs SMS (Twilio registration) and/or SendGrid = teammate/boss, then build |
| C9 | Deploy + smoke: `/find`, `/book/<slug>`, real booking | — | teammate (runbook) |
Recommended order: C1 -> C2 -> C3 -> C6 -> C4 -> C5 -> C9 (C7, C8 later).

## 1E. Jira (parents 16-19)
- **16. Customer Discovery & Directory**: 16a define public categories taxonomy; 16b listing opt-in rules; 16c `listing` fields on business; 16d structured city/region; 16e `search_text` builder; 16f rebuild on service/listing change; 16g directory search endpoint; 16h categories endpoint; 16i cities endpoint; 16j listing eligibility check (onboarding/active/service/hours); 16k slug rules + reserved words; 16l slug collision suffix (city, number); 16m slug at signup/platform registration; 16n slug edit endpoint; 16o `/find` page: search box; 16p category chips; 16q city filter; 16r result cards (address/services); 16s empty results state; 16t "wrong business?" link; 16u login-page "Find a business" link; 16v Settings listing card; 16w hide-listing (platform admin) [T]; 16x geo "near me" [T]; 16y SEO public profile pages [T]; 16z "tell us what you need" lead form [T].
- **17. Public Booking (guest)**: 17a business info endpoint; 17b services endpoint; 17c staff endpoint filtered by service; 17d availability (specific staff); 17e availability "Any available"; 17f create-booking endpoint; 17g any-staff auto-assign with retry; 17h enforce staff-service; 17i offered-slot validation; 17j idempotency/double-click; 17k rate limit IP; 17l rate limit phone; 17m honeypot; 17n daily cap per business; 17o suspended/closed handling; 17p trust-proxy real client IP; 17q booking `source` field; 17r UI step 1 service; 17s step 2 stylist/any; 17t step 3 date+slots+timezone; 17u step 4 details+consent; 17v step 5 confirmation+manage link; 17w slot-taken recovery; 17x business header (name/address) on all steps; 17y mobile-first; 17z Settings "Booking page" copy link.
- **18. Customer Identity & Returning Customers**: 18a identity rules doc; 18b E.164 normalisation on web; 18c auto-match by phone; 18d no pre-fill/enumeration rule; 18e unified history calls+web+dashboard; 18f source badge bookings/calendar; 18g source on customer profile; 18h same phone salon vs dentist test; 18i web consent record; 18j STOP parity; 18k duplicate detection [T]; 18l staff merge tool [T]; 18m different-phone returning customer [T]; 18n short booking reference code [T]; 18o language preference [T]; 18p `upsertCustomer` atomic against simultaneous creates [T] (KG-09).
- **19. Customer Portal Stage 2**: 19a spec+screens (done in C1); 19b OTP challenge + TTL [T]; 19c SMS code [T]; 19d email magic link [T]; 19e verify + attempt limits [T]; 19f customer session token [T]; 19g upcoming [T]; 19h past/cancelled [T]; 19i reschedule [T]; 19j cancel [T]; 19k profile [T]; 19l preferences [T]; 19m data export [T]; 19n delete request [T]; 19o login page per business [T]; 19p unavailable state when SMS/email unset [T]; 19q logout/expiry [T]; 19r OTP abuse limits [T]; 19s enumeration/timing review [T]; 19t link from confirmations [T]; 19u portal tests [T].

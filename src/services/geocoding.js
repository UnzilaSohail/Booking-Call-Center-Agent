// Free, keyless geocoding via OpenStreetMap's Nominatim (Jira 16x "near me" search) — no
// API key/account needed, good enough at this scale. Only called once per business, when
// its listing city/region/country changes (src/routes/settings.js), not per search, so
// this stays well within Nominatim's usage policy (max ~1 req/s, descriptive User-Agent):
// https://operations.osmfoundation.org/policies/nominatim/
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

export async function geocode(query) {
  if (!query?.trim()) return null;
  try {
    const url = `${NOMINATIM_URL}?${new URLSearchParams({ q: query, format: 'json', limit: '1' })}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'booking-call-center-agent/1.0 (directory geocoding)' } });
    if (!res.ok) return null;
    const [result] = await res.json();
    if (!result) return null;
    const lat = Number(result.lat);
    const lng = Number(result.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch (err) {
    console.error('geocoding failed:', err.message);
    return null;
  }
}

// Haversine distance in kilometers between two {lat, lng} points. Plain JS, no geospatial
// DB index needed — the directory already scans its (small, capped) candidate list in JS
// (src/routes/publicBooking.js), so sorting that same list by distance costs nothing extra.
export function distanceKm(a, b) {
  if (!a || !b || !Number.isFinite(a.lat) || !Number.isFinite(b.lat)) return null;
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * sinLng * sinLng;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

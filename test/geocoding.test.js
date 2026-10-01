// Pure logic, no network needed — geocode() itself hits a real external API, so it's not
// unit-tested here, same convention as other third-party-dependent calls in this repo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distanceKm } from '../src/services/geocoding.js';

test('distanceKm is ~0 for the same point', () => {
  assert.ok(distanceKm({ lat: 40.7128, lng: -74.006 }, { lat: 40.7128, lng: -74.006 }) < 0.001);
});

test('distanceKm(NYC, LA) is roughly the known ~3940km great-circle distance', () => {
  const d = distanceKm({ lat: 40.7128, lng: -74.006 }, { lat: 34.0522, lng: -118.2437 });
  assert.ok(d > 3900 && d < 4000, `expected ~3940km, got ${d}`);
});

test('distanceKm returns null when either point is missing', () => {
  assert.equal(distanceKm(null, { lat: 1, lng: 1 }), null);
  assert.equal(distanceKm({ lat: 1, lng: 1 }, undefined), null);
});

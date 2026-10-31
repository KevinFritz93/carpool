// Driving distance between two addresses using free OpenStreetMap services (no API key):
//   Nominatim for address → coordinates, OSRM for the driving route.

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const OSRM = 'https://router.project-osrm.org/route/v1/driving/';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function geocode(query) {
  const lang = (globalThis.navigator?.language || 'de').slice(0, 2);
  const url = `${NOMINATIM}?format=jsonv2&limit=1&accept-language=${lang}&q=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Address lookup failed (HTTP ${res.status})`);
  const data = await res.json();
  if (!data.length) throw new Error(`Address not found: "${query}"`);
  return { lat: +data[0].lat, lon: +data[0].lon, label: data[0].display_name };
}

async function drivingKm(a, b) {
  const res = await fetch(`${OSRM}${a.lon},${a.lat};${b.lon},${b.lat}?overview=false`);
  if (!res.ok) throw new Error(`Route calculation failed (HTTP ${res.status})`);
  const data = await res.json();
  if (data.code !== 'Ok' || !data.routes?.length) throw new Error('No driving route found');
  return Math.round(data.routes[0].distance / 100) / 10;
}

export async function computeRoute(from, to) {
  const a = await geocode(from);
  await sleep(1100); // Nominatim usage policy: at most one request per second
  const b = await geocode(to);
  const [kmThere, kmBack] = await Promise.all([drivingKm(a, b), drivingKm(b, a)]);
  return { kmThere, kmBack, fromLabel: a.label, toLabel: b.label };
}

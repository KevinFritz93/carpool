// Local persistence (localStorage) and data model defaults.

const KEY = 'carpool-data-v1';

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function localDate(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function newTopic(name, template = {}) {
  return {
    id: uid(),
    name,
    tankL: template.tankL ?? 40, // litres per tank ...
    tankKm: template.tankKm ?? 550, // ... are good for this many km  → 7.27 L/100 km
    estPrice: template.estPrice ?? 1.75, // €/L, used until the month has a refuel
    defaultRouteId: null,
    routes: [],
    trips: [],
    fuel: [],
  };
}

function defaultState() {
  const topic = newTopic('Driving to work');
  // Distances pre-computed with OpenStreetMap/OSRM; can be recalculated in Setup.
  const route = { id: uid(), name: 'Work commute', from: '70190 Stuttgart', to: '72585 Riederich', kmThere: 33.3, kmBack: 33.0 };
  topic.routes.push(route);
  topic.defaultRouteId = route.id;
  return { version: 1, people: [], topics: [topic], currentTopicId: topic.id };
}

export function isValidState(s) {
  return !!s && Array.isArray(s.people) && Array.isArray(s.topics) && s.topics.length > 0 &&
    s.topics.every((t) => Array.isArray(t.trips) && Array.isArray(t.fuel) && Array.isArray(t.routes));
}

export function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (isValidState(s)) return s;
  } catch {
    /* fall through to defaults */
  }
  return defaultState();
}

export function saveState(s) {
  localStorage.setItem(KEY, JSON.stringify(s));
}

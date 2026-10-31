// Local persistence (localStorage) and data model defaults.
//
// State (version 2):
//   { version, topics: [{ id, name, tankL, tankKm, estPrice, defaultRouteId,
//                         people: [{ id, name, archived }],
//                         routes: [{ id, name, from, to, kmThere, kmBack }],
//                         trips:  [{ id, date, slot, routeId, dir, km, people: [personId] }],
//                         fuel:   [{ id, date, liters, pricePerL, note }] }] }

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
    people: [],
    routes: [],
    trips: [],
    fuel: [],
  };
}

function defaultState() {
  const topic = newTopic('Driving to work');
  // Distances pre-computed with OpenStreetMap/OSRM; can be recalculated in the settings.
  const route = { id: uid(), name: 'Work commute', from: '70190 Stuttgart', to: '72585 Riederich', kmThere: 33.3, kmBack: 33.0 };
  topic.routes.push(route);
  topic.defaultRouteId = route.id;
  return { version: 2, topics: [topic] };
}

// Version 1 had one people list shared by all topics; version 2 keeps people per topic.
export function migrate(s) {
  if (s && s.version === 1 && Array.isArray(s.people) && Array.isArray(s.topics)) {
    for (const t of s.topics) {
      const used = new Set((t.trips ?? []).flatMap((x) => x.people));
      t.people = s.people.filter((p) => !p.archived || used.has(p.id)).map((p) => ({ ...p }));
    }
    delete s.people;
    delete s.currentTopicId;
    s.version = 2;
  }
  return s;
}

export function isValidState(s) {
  return !!s && s.version === 2 && Array.isArray(s.topics) &&
    s.topics.every((t) => ['trips', 'fuel', 'routes', 'people'].every((k) => Array.isArray(t[k])));
}

export function loadState() {
  try {
    const s = migrate(JSON.parse(localStorage.getItem(KEY)));
    if (isValidState(s)) return s;
  } catch {
    /* fall through to defaults */
  }
  return defaultState();
}

export function saveState(s) {
  localStorage.setItem(KEY, JSON.stringify(s));
}

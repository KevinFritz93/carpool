// Pure calculation functions (no DOM, no storage) — shared by the app and the tests.
//
// Cost model:
//   cost per km   = (tank litres / km per tank) × average fuel price of the month
//   trip cost     = trip km × cost per km, split equally between everyone in the car
//   person cost   = sum of that person's trip shares in the month
// Per-person amounts are rounded to cents with the largest-remainder method, so the
// shares always add up exactly to the month's total.

export const monthOf = (date) => date.slice(0, 7);

const sum = (xs) => xs.reduce((a, b) => a + b, 0);

export function litersPerKm(topic) {
  return topic.tankKm > 0 ? topic.tankL / topic.tankKm : 0;
}

// Refuels of one month; the average price is weighted by litres (total paid / total litres).
export function fuelSummary(fuel, month) {
  const entries = fuel.filter((f) => monthOf(f.date) === month && f.liters > 0 && f.pricePerL > 0);
  const liters = sum(entries.map((f) => f.liters));
  const paid = sum(entries.map((f) => f.liters * f.pricePerL));
  return { count: entries.length, liters, paid, avgPrice: liters > 0 ? paid / liters : null };
}

// Actual average price if the month has refuels, otherwise the topic's estimated price.
export function priceForMonth(topic, month) {
  const fuel = fuelSummary(topic.fuel, month);
  if (fuel.avgPrice != null) return { price: fuel.avgPrice, source: 'refuels', fuel };
  return { price: topic.estPrice, source: 'estimate', fuel };
}

// Rounds exact cent amounts to integers whose sum is exactly totalCents.
export function splitCents(exactCents, totalCents) {
  const floors = exactCents.map((x) => Math.floor(x + 1e-7));
  let rest = totalCents - sum(floors);
  const order = exactCents
    // fractions rounded so floating-point noise can't break ties (ties → list order)
    .map((x, i) => ({ i, frac: Math.round((x - floors[i]) * 1e6) / 1e6 }))
    .sort((a, b) => (rest >= 0 ? b.frac - a.frac : a.frac - b.frac) || a.i - b.i);
  const result = floors.slice();
  for (let k = 0; rest !== 0 && order.length; k = (k + 1) % order.length) {
    const step = rest > 0 ? 1 : -1;
    result[order[k].i] += step;
    rest -= step;
  }
  return result;
}

export function settleMonth(topic, month) {
  const { price, source, fuel } = priceForMonth(topic, month);
  const lpk = litersPerKm(topic);
  const costPerKm = lpk * price;
  const per = new Map();
  let carKm = 0;
  let tripCount = 0;
  let skippedTrips = 0;

  for (const trip of topic.trips) {
    if (monthOf(trip.date) !== month) continue;
    const riders = [...new Set(trip.people)];
    if (!riders.length || !(trip.km > 0)) {
      skippedTrips++;
      continue;
    }
    tripCount++;
    carKm += trip.km;
    const share = (trip.km * costPerKm) / riders.length;
    for (const pid of riders) {
      const p = per.get(pid) ?? { personId: pid, trips: 0, km: 0, exact: 0, slots: { morning: 0, evening: 0, other: 0 } };
      p.trips++;
      p.km += trip.km;
      p.exact += share;
      p.slots[trip.slot] = (p.slots[trip.slot] ?? 0) + 1;
      per.set(pid, p);
    }
  }

  const totalCents = Math.round(carKm * costPerKm * 100);
  const persons = [...per.values()];
  const cents = splitCents(persons.map((p) => p.exact * 100), totalCents);
  persons.forEach((p, i) => (p.cents = cents[i]));

  return {
    month,
    price,
    priceSource: source,
    fuel,
    litersPerKm: lpk,
    costPerKm,
    carKm,
    liters: carKm * lpk,
    totalCents,
    persons,
    tripCount,
    skippedTrips,
  };
}

export function monthsWithData(topic) {
  const months = new Set([...topic.trips.map((t) => monthOf(t.date)), ...topic.fuel.map((f) => monthOf(f.date))]);
  return [...months].sort();
}

// Sum of the monthly settlements (each month priced with its own fuel price).
export function allTimeStats(topic) {
  const months = monthsWithData(topic).map((m) => settleMonth(topic, m));
  const per = new Map();
  for (const m of months) {
    for (const p of m.persons) {
      const a = per.get(p.personId) ?? { personId: p.personId, trips: 0, km: 0, cents: 0, months: 0, slots: { morning: 0, evening: 0, other: 0 } };
      a.trips += p.trips;
      a.km += p.km;
      a.cents += p.cents;
      a.months++;
      for (const s of Object.keys(p.slots)) a.slots[s] = (a.slots[s] ?? 0) + p.slots[s];
      per.set(p.personId, a);
    }
  }
  return {
    months,
    persons: [...per.values()],
    totalCents: sum(months.map((m) => m.totalCents)),
    carKm: sum(months.map((m) => m.carKm)),
  };
}

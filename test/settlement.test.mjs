// Settlement logic tests. Run with:  node test/settlement.test.mjs
import assert from 'node:assert/strict';
import { settleMonth, allTimeStats, fuelSummary, splitCents } from '../js/logic.js';

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    failures++;
    console.log(`✗ ${name}\n  ${err.message}`);
  }
}

const sumCents = (r) => r.persons.reduce((a, p) => a + p.cents, 0);
const cents = (r, id) => r.persons.find((p) => p.personId === id)?.cents ?? 0;
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

const baseTopic = (over = {}) => ({ tankL: 40, tankKm: 550, estPrice: 1.75, routes: [], trips: [], fuel: [], ...over });
let n = 0;
const trip = (date, slot, km, people) => ({ id: `t${n++}`, date, slot, km, people, routeId: 'r', dir: slot === 'evening' ? 'back' : 'there' });

// ---------- worked example ----------
test('worked example: 1 day, different people morning and evening', () => {
  // 1.65 €/L × 40/550 L/km = 0.12 €/km
  const t = baseTopic({
    fuel: [{ date: '2026-10-05', liters: 40, pricePerL: 1.65 }],
    trips: [trip('2026-10-05', 'morning', 33.3, ['A', 'B', 'C']), trip('2026-10-05', 'evening', 33.0, ['A', 'B'])],
  });
  const r = settleMonth(t, '2026-10');
  near(r.costPerKm, 0.12);
  // morning 3.996 € / 3 = 1.332 each; evening 3.96 € / 2 = 1.98 each
  // exact: A 3.312, B 3.312, C 1.332 → total 7.956 → 7.96; the leftover cent goes to A
  assert.equal(r.totalCents, 796);
  assert.deepEqual([cents(r, 'A'), cents(r, 'B'), cents(r, 'C')], [332, 331, 133]);
  assert.equal(sumCents(r), r.totalCents);
});

// ---------- one month of sample data ----------
const people = { K: 'Kevin (driver)', A: 'Anna', B: 'Ben', C: 'Clara' };
const october = baseTopic({
  fuel: [
    { date: '2026-10-02', liters: 38.0, pricePerL: 1.759 },
    { date: '2026-10-14', liters: 40.0, pricePerL: 1.699 },
    { date: '2026-10-27', liters: 36.5, pricePerL: 1.729 },
  ],
});
// Weekly patterns (Mon..Fri): who is in the car in the morning / evening.
const morningPattern = [['K', 'A', 'B'], ['K', 'A', 'B', 'C'], ['K', 'B'], ['K', 'A', 'C'], ['K', 'A']];
const eveningPattern = [['K', 'A', 'B'], ['K', 'A', 'C'], ['K', 'B', 'C'], ['K', 'A'], ['K']];
for (let day = 1; day <= 31; day++) {
  const d = new Date(2026, 9, day);
  const wd = d.getDay(); // 0 = Sun
  if (wd === 0 || wd === 6) continue;
  const date = `2026-10-${String(day).padStart(2, '0')}`;
  if (day === 15) continue; // Kevin on holiday, nobody drove
  october.trips.push(trip(date, 'morning', 33.3, morningPattern[wd - 1]));
  if (day === 22) october.trips.push(trip(date, 'evening', 41.8, ['K', 'C'])); // detour via Metzingen
  else october.trips.push(trip(date, 'evening', 33.0, eveningPattern[wd - 1]));
}
october.trips.push(trip('2026-10-24', 'other', 12.4, ['K', 'A'])); // Saturday errand
october.trips.push(trip('2026-10-08', 'morning', 33.3, [])); // forgot to select people → not counted (duplicate slot just for the test)

const oct = settleMonth(october, '2026-10');

test('average price is weighted by litres', () => {
  const f = fuelSummary(october.fuel, '2026-10');
  near(f.avgPrice, (38 * 1.759 + 40 * 1.699 + 36.5 * 1.729) / (38 + 40 + 36.5));
  assert.equal(oct.priceSource, 'refuels');
});

test('sum of all shares equals the month total exactly', () => {
  assert.equal(sumCents(oct), oct.totalCents);
  assert.equal(oct.totalCents, Math.round(oct.carKm * (40 / 550) * oct.price * 100));
});

test('morning and evening have different people on the same day', () => {
  const tuesday = october.trips.filter((x) => x.date === '2026-10-06');
  assert.notDeepEqual(tuesday[0].people, tuesday[1].people);
  const ben = oct.persons.find((p) => p.personId === 'B');
  assert.notEqual(ben.slots.morning, ben.slots.evening);
});

test('trips without passengers are skipped and reported', () => {
  assert.equal(oct.skippedTrips, 1);
});

test('topics are calculated independently', () => {
  const other = baseTopic({ estPrice: 2.5, fuel: [{ date: '2026-10-10', liters: 10, pricePerL: 2.2 }], trips: [trip('2026-10-10', 'other', 300, ['A'])] });
  const again = settleMonth(october, '2026-10');
  assert.deepEqual(again.persons.map((p) => p.cents), oct.persons.map((p) => p.cents));
  const r = settleMonth(other, '2026-10');
  assert.equal(r.totalCents, Math.round(300 * (40 / 550) * 2.2 * 100));
});

test('estimated price is used while a month has no refuel', () => {
  const t = baseTopic({ trips: [trip('2026-11-02', 'morning', 33.3, ['K', 'A'])] });
  const r = settleMonth(t, '2026-11');
  assert.equal(r.priceSource, 'estimate');
  assert.equal(r.totalCents, Math.round(33.3 * (40 / 550) * 1.75 * 100));
  assert.equal(sumCents(r), r.totalCents);
});

test('all-time statistics are the sum of the monthly settlements', () => {
  const t = { ...october, trips: [...october.trips, trip('2026-11-02', 'morning', 33.3, ['K', 'A', 'B'])] };
  const all = allTimeStats(t);
  const nov = settleMonth(t, '2026-11');
  assert.equal(all.totalCents, oct.totalCents + nov.totalCents);
  for (const id of Object.keys(people)) {
    assert.equal(all.persons.find((p) => p.personId === id).cents, cents(oct, id) + cents(nov, id));
  }
});

test('rounding: shares always add up (2000 random months)', () => {
  let seed = 42;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  for (let i = 0; i < 2000; i++) {
    const ids = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].slice(0, 1 + Math.floor(rnd() * 7));
    const t = baseTopic({ tankL: 30 + rnd() * 40, tankKm: 400 + rnd() * 600, fuel: [{ date: '2026-03-01', liters: 1 + rnd() * 60, pricePerL: 1.4 + rnd() }] });
    for (let k = 0; k < 1 + rnd() * 50; k++) {
      t.trips.push(trip('2026-03-15', 'other', Math.round(rnd() * 1000) / 10 + 0.1, ids.filter(() => rnd() < 0.6)));
    }
    const r = settleMonth(t, '2026-03');
    assert.equal(sumCents(r), r.totalCents, `case ${i}`);
  }
  assert.deepEqual(splitCents([100.5, 100.5, 100.5], 301), [101, 100, 100]);
  assert.deepEqual(splitCents([0.99999999, 1.00000001], 2), [1, 1]);
});

// ---------- report ----------
console.log(`\nSample month: October 2026 (${oct.tripCount} trips counted, ${oct.skippedTrips} skipped)`);
console.log(`Fuel price  ${oct.price.toFixed(4)} €/L (Ø of ${oct.fuel.count} refuels, ${oct.fuel.liters} L, ${oct.fuel.paid.toFixed(2)} € paid)`);
console.log(`Consumption ${(oct.litersPerKm * 100).toFixed(2)} L/100 km → ${oct.costPerKm.toFixed(4)} €/km`);
console.log(`Car km      ${oct.carKm.toFixed(1)} km → ${oct.liters.toFixed(1)} L → total ${(oct.totalCents / 100).toFixed(2)} €\n`);
console.log('Person           Trips (M/E/O)       km      Cost');
for (const p of oct.persons) {
  const slots = `${p.trips} (${p.slots.morning}/${p.slots.evening}/${p.slots.other})`;
  console.log(`${people[p.personId].padEnd(16)} ${slots.padEnd(14)} ${p.km.toFixed(1).padStart(8)} ${(p.cents / 100).toFixed(2).padStart(9)} €`);
}
console.log(`${'Sum'.padEnd(16)} ${''.padEnd(14)} ${''.padStart(8)} ${(sumCents(oct) / 100).toFixed(2).padStart(9)} €  (total ${(oct.totalCents / 100).toFixed(2)} €)`);

if (failures) {
  console.log(`\n${failures} test(s) FAILED`);
  process.exit(1);
}
console.log('\nAll tests passed.');

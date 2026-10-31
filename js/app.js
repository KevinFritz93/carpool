import { loadState, saveState, uid, localDate, newTopic, isValidState } from './store.js';
import * as calc from './logic.js';
import { computeRoute } from './geo.js';

let S = loadState();
const ui = { tab: 'day', date: localDate(), month: localDate().slice(0, 7), fuelEdit: null, routeEdit: null };

const $ = (sel) => document.querySelector(sel);
const main = $('#main');

// ---------- helpers ----------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const eur = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR' });
const fmtEur = (v) => eur.format(v);
const fmtCents = (c) => eur.format(c / 100);
const fmtNum = (v, d = 1) => Number(v).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
const parseNum = (v) => {
  const n = parseFloat(String(v ?? '').trim().replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
};

const toDate = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d || 1);
};
const addDays = (s, n) => {
  const d = toDate(s);
  d.setDate(d.getDate() + n);
  return localDate(d);
};
const addMonths = (ym, n) => {
  const d = toDate(ym + '-01');
  d.setMonth(d.getMonth() + n);
  return localDate(d).slice(0, 7);
};
const fmtDateLong = (s) => toDate(s).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const fmtDateShort = (s) => toDate(s).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const fmtMonth = (ym) => toDate(ym + '-01').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

const topic = () => S.topics.find((t) => t.id === S.currentTopicId) ?? S.topics[0];
const person = (id) => S.people.find((p) => p.id === id);
const personName = (id) => person(id)?.name ?? '(removed)';
const activePeople = () => S.people.filter((p) => !p.archived);
const byName = (a, b) => personName(a.personId).localeCompare(personName(b.personId));

const routeLabel = (r, dir) => (dir === 'back' ? `${r.to} → ${r.from}` : `${r.from} → ${r.to}`);
const routeKm = (r, dir) => (dir === 'back' ? r.kmBack : r.kmThere);
const defaultRoute = (t) => t.routes.find((r) => r.id === t.defaultRouteId) ?? t.routes[0];

function commit() {
  saveState(S);
  render();
}

// ---------- views ----------

const SLOT = {
  morning: { icon: '🌅', title: 'Morning' },
  evening: { icon: '🌇', title: 'Evening' },
  other: { icon: '🚗', title: 'Other trip' },
};

function tripCard(slot, trip) {
  const t = topic();
  const { icon, title } = SLOT[slot];
  if (!trip) {
    return `<section class="card trip off">
      <div class="trip-head"><h3>${icon} ${title}</h3>
      <button class="btn primary" data-action="trip-on" data-slot="${slot}">Record trip</button></div>
      <p class="muted small">No ${title.toLowerCase()} trip recorded.</p>
    </section>`;
  }
  const routeOpts = t.routes
    .flatMap((r) =>
      ['there', 'back'].map((dir) => {
        const sel = r.id === trip.routeId && dir === trip.dir ? 'selected' : '';
        return `<option value="${r.id}|${dir}" ${sel}>${esc(r.name)}: ${esc(routeLabel(r, dir))} (${fmtNum(routeKm(r, dir))} km)</option>`;
      })
    )
    .join('');
  const missingRoute = !t.routes.some((r) => r.id === trip.routeId) ? '<option selected>(route deleted)</option>' : '';
  const shown = S.people.filter((p) => !p.archived || trip.people.includes(p.id));
  const chips = shown
    .map((p) => `<button class="chip ${trip.people.includes(p.id) ? 'on' : ''}" data-action="trip-person" data-id="${trip.id}" data-pid="${p.id}">${esc(p.name)}</button>`)
    .join('');
  const n = trip.people.length;
  const price = calc.priceForMonth(t, calc.monthOf(trip.date)).price;
  const tripCost = trip.km * calc.litersPerKm(t) * price;
  const morning = topic().trips.find((x) => x.date === trip.date && x.slot === 'morning');
  return `<section class="card trip">
    <div class="trip-head"><h3>${icon} ${title}</h3>
      <button class="btn ghost" data-action="trip-off" data-id="${trip.id}">Remove</button></div>
    <label>Route
      <select data-change="trip-route" data-id="${trip.id}">${missingRoute}${routeOpts}</select></label>
    <label class="inline">Distance <input class="num" inputmode="decimal" data-change="trip-km" data-id="${trip.id}" value="${fmtNum(trip.km)}"> km</label>
    <div class="label-row"><span>Who was in the car?</span>
      ${slot === 'evening' && morning ? `<button class="link" data-action="trip-same" data-id="${trip.id}">Same as morning</button>` : ''}</div>
    <div class="chips">${chips || '<span class="muted small">Add people in Setup first.</span>'}</div>
    <p class="trip-foot ${n ? '' : 'warn-text'}">${
      n ? `${n} ${n === 1 ? 'person' : 'people'} · ${fmtEur(tripCost)} trip · ≈ ${fmtEur(tripCost / n)} each` : 'Select who was in the car — otherwise this trip is not counted.'
    }</p>
  </section>`;
}

function viewDay() {
  const t = topic();
  const d = ui.date;
  const dayTrips = t.trips.filter((x) => x.date === d);
  const today = localDate();
  const month = calc.monthOf(d);

  const prevMonth = addMonths(today.slice(0, 7), -1);
  const settleHint =
    Number(today.slice(8)) <= 7 && t.trips.some((x) => calc.monthOf(x.date) === prevMonth)
      ? `<button class="banner ok block" data-action="goto-month" data-month="${prevMonth}">✅ The settlement for ${fmtMonth(prevMonth)} is ready — tap to view</button>`
      : '';

  const days = [...new Set(t.trips.filter((x) => calc.monthOf(x.date) === month).map((x) => x.date))].sort().reverse();
  const overview = days.length
    ? days
        .map((day) => {
          const parts = t.trips
            .filter((x) => x.date === day)
            .sort((a, b) => ['morning', 'evening', 'other'].indexOf(a.slot) - ['morning', 'evening', 'other'].indexOf(b.slot))
            .map((x) => `${SLOT[x.slot].icon} ${x.people.map((id) => esc(personName(id))).join(', ') || '<span class="warn-text">nobody</span>'}`);
          return `<button class="list-item ${day === d ? 'current' : ''}" data-action="goto-date" data-date="${day}">
            <strong>${fmtDateShort(day)}</strong><span>${parts.join('<br>')}</span></button>`;
        })
        .join('')
    : '<p class="muted small">No trips recorded this month yet.</p>';

  return `${settleHint}
  <div class="datebar">
    <button class="btn round" data-action="day-shift" data-n="-1" aria-label="Previous day">‹</button>
    <input type="date" data-change="day-set" value="${d}">
    <button class="btn round" data-action="day-shift" data-n="1" aria-label="Next day">›</button>
  </div>
  <p class="center date-label">${fmtDateLong(d)}${d === today ? ' · today' : ` · <button class="link" data-action="day-today">go to today</button>`}</p>
  ${tripCard('morning', dayTrips.find((x) => x.slot === 'morning'))}
  ${tripCard('evening', dayTrips.find((x) => x.slot === 'evening'))}
  ${dayTrips.filter((x) => x.slot === 'other').map((x) => tripCard('other', x)).join('')}
  <button class="btn block" data-action="trip-add-other">+ Add another trip this day</button>
  <section class="card"><h3>${fmtMonth(month)}</h3>${overview}</section>`;
}

function viewFuel() {
  const t = topic();
  const e = t.fuel.find((f) => f.id === ui.fuelEdit);
  const months = [...new Set(t.fuel.map((f) => calc.monthOf(f.date)))].sort().reverse();
  const history = months.length
    ? months
        .map((m) => {
          const s = calc.fuelSummary(t.fuel, m);
          const rows = t.fuel
            .filter((f) => calc.monthOf(f.date) === m)
            .sort((a, b) => b.date.localeCompare(a.date))
            .map(
              (f) => `<div class="fuel-row">
                <div><strong>${fmtDateShort(f.date)}</strong> · ${fmtNum(f.liters, 2)} L × ${fmtNum(f.pricePerL, 3)} €<br>
                  <span class="muted small">${fmtEur(f.liters * f.pricePerL)}${f.note ? ' · ' + esc(f.note) : ''}</span></div>
                <div class="row-actions">
                  <button class="btn ghost small" data-action="fuel-edit" data-id="${f.id}">Edit</button>
                  <button class="btn ghost small danger" data-action="fuel-delete" data-id="${f.id}">✕</button></div>
              </div>`
            )
            .join('');
          return `<h4>${fmtMonth(m)} <span class="muted small">· Ø ${fmtNum(s.avgPrice, 3)} €/L · ${fmtNum(s.liters, 1)} L · ${fmtEur(s.paid)}</span></h4>${rows}`;
        })
        .join('')
    : '<p class="muted small">No refuels recorded yet. Until then the estimated price from Setup is used.</p>';

  return `<section class="card">
    <h3>${e ? 'Edit refuel' : 'Add refuel'}</h3>
    <form data-form="fuel">
      <label>Date <input type="date" name="date" value="${e?.date ?? localDate()}" required></label>
      <div class="row2">
        <label>Litres <input name="liters" inputmode="decimal" placeholder="e.g. 38,5" value="${e ? fmtNum(e.liters, 2) : ''}" required></label>
        <label>Price per litre (€) <input name="price" inputmode="decimal" placeholder="e.g. 1,749" value="${e ? fmtNum(e.pricePerL, 3) : ''}" required></label>
      </div>
      <label>Note (optional) <input name="note" value="${esc(e?.note ?? '')}" placeholder="e.g. Aral Metzingen"></label>
      <p class="total">Total: <strong id="fuelTotal">${e ? fmtEur(e.liters * e.pricePerL) : '–'}</strong></p>
      <button class="btn primary block">${e ? 'Save changes' : 'Add refuel'}</button>
      ${e ? '<button type="button" class="btn ghost block" data-action="fuel-cancel">Cancel</button>' : ''}
    </form>
  </section>
  <section class="card"><h3>Refuel history</h3>${history}</section>`;
}

function updateFuelTotal() {
  const f = $('form[data-form=fuel]');
  const l = parseNum(f.liters.value);
  const p = parseNum(f.price.value);
  $('#fuelTotal').textContent = l > 0 && p > 0 ? fmtEur(l * p) : '–';
}

function settlementText(t, r) {
  const lines = r.persons
    .slice()
    .sort(byName)
    .map((p) => `${personName(p.personId)}: ${fmtCents(p.cents)} (${p.trips} trips, ${fmtNum(p.km, 0)} km)`);
  return [
    `⛽ ${t.name} – ${fmtMonth(r.month)}`,
    `Fuel price: ${fmtNum(r.price, 3)} €/L (${r.priceSource === 'refuels' ? `average of ${r.fuel.count} refuels` : 'estimate'})`,
    `Consumption: ${fmtNum(r.litersPerKm * 100, 2)} L/100 km → ${fmtNum(r.costPerKm, 3)} €/km`,
    '',
    ...lines,
    '',
    `Total: ${fmtCents(r.totalCents)} for ${fmtNum(r.carKm, 0)} km`,
  ].join('\n');
}

function viewCosts() {
  const t = topic();
  const m = ui.month;
  const r = calc.settleMonth(t, m);
  const cur = localDate().slice(0, 7);

  let banner;
  if (m >= cur) {
    banner = `<div class="banner info">📊 <strong>Running estimate</strong> — ${fmtMonth(m)} is not over yet. ${
      r.priceSource === 'estimate' ? 'No refuel recorded yet, so the estimated fuel price from Setup is used.' : 'Uses the average price of the refuels recorded so far.'
    }</div>`;
  } else if (r.priceSource === 'estimate') {
    banner = `<div class="banner warn">⚠️ No refuel recorded in ${fmtMonth(m)} — the estimated price is used. Add the refuels in the Fuel tab for an exact settlement.</div>`;
  } else {
    banner = `<div class="banner ok">✅ <strong>Final settlement</strong> for ${fmtMonth(m)}</div>`;
  }

  const persons = r.persons.slice().sort(byName);
  const sumCents = persons.reduce((a, p) => a + p.cents, 0);
  const table = persons.length
    ? `<table class="table">
        <thead><tr><th>Person</th><th>Trips</th><th>km</th><th>Cost</th></tr></thead>
        <tbody>${persons
          .map((p) => `<tr><td>${esc(personName(p.personId))}</td><td>${p.trips}</td><td>${fmtNum(p.km, 0)}</td><td><strong>${fmtCents(p.cents)}</strong></td></tr>`)
          .join('')}</tbody>
        <tfoot><tr><td>Total</td><td>${r.tripCount}</td><td>${fmtNum(r.carKm, 0)}</td><td><strong>${fmtCents(sumCents)}</strong></td></tr></tfoot>
      </table>
      <p class="muted small">${sumCents === r.totalCents ? '✓ Shares add up exactly to the fuel cost.' : '⚠ Rounding mismatch'}${
        r.skippedTrips ? ` · ${r.skippedTrips} trip(s) without passengers are not counted.` : ''
      } “km” is the distance each person rode along.</p>
      <button class="btn primary block" data-action="share">Share settlement</button>`
    : '<p class="muted">No trips recorded in this month.</p>';

  return `<div class="datebar">
    <button class="btn round" data-action="month-shift" data-n="-1" aria-label="Previous month">‹</button>
    <h2>${fmtMonth(m)}</h2>
    <button class="btn round" data-action="month-shift" data-n="1" aria-label="Next month">›</button>
  </div>
  ${banner}
  <section class="card">
    <dl class="facts">
      <dt>Fuel price</dt><dd>${fmtNum(r.price, 3)} €/L <span class="muted small">${r.priceSource === 'refuels' ? `Ø of ${r.fuel.count} refuel(s)` : 'estimate'}</span></dd>
      <dt>Consumption</dt><dd>${fmtNum(r.litersPerKm * 100, 2)} L/100 km</dd>
      <dt>Cost per km</dt><dd>${fmtNum(r.costPerKm, 3)} €</dd>
      <dt>Car km</dt><dd>${fmtNum(r.carKm, 1)} km (${r.tripCount} trips)</dd>
      <dt>Fuel used</dt><dd>${fmtNum(r.liters, 1)} L</dd>
      <dt>Total to split</dt><dd><strong>${fmtCents(r.totalCents)}</strong></dd>
    </dl>
  </section>
  <section class="card"><h3>Cost per person</h3>${table}</section>
  ${
    r.fuel.count
      ? `<p class="muted small center">For reference: actually paid at the pump this month: ${fmtEur(r.fuel.paid)} for ${fmtNum(r.fuel.liters, 1)} L.</p>`
      : ''
  }`;
}

function viewStats() {
  const t = topic();
  const cur = calc.settleMonth(t, localDate().slice(0, 7));
  const all = calc.allTimeStats(t);
  if (!all.persons.length) return '<section class="card"><h3>Statistics</h3><p class="muted">No trips recorded yet.</p></section>';
  const curBy = new Map(cur.persons.map((p) => [p.personId, p]));
  const cards = all.persons
    .slice()
    .sort(byName)
    .map((a) => {
      const c = curBy.get(a.personId) ?? { trips: 0, km: 0, cents: 0 };
      const share = all.totalCents ? Math.round((a.cents / all.totalCents) * 100) : 0;
      return `<section class="card">
        <h3>${esc(personName(a.personId))}</h3>
        <table class="table stats">
          <thead><tr><th></th><th>This month</th><th>All time</th></tr></thead>
          <tbody>
            <tr><td>Trips</td><td>${c.trips}</td><td>${a.trips}</td></tr>
            <tr><td>Kilometres</td><td>${fmtNum(c.km, 0)}</td><td>${fmtNum(a.km, 0)}</td></tr>
            <tr><td>Cost</td><td><strong>${fmtCents(c.cents)}</strong></td><td><strong>${fmtCents(a.cents)}</strong></td></tr>
          </tbody>
        </table>
        <p class="muted small">All time: ${a.slots.morning} morning · ${a.slots.evening} evening · ${a.slots.other} other trips ·
          Ø ${fmtCents(Math.round(a.cents / a.months))} per month · ${share}% of all fuel costs</p>
      </section>`;
    })
    .join('');
  return `<section class="card">
    <h3>${esc(t.name)}</h3>
    <dl class="facts">
      <dt>This month</dt><dd>${fmtNum(cur.carKm, 0)} km · ${fmtCents(cur.totalCents)}</dd>
      <dt>All time</dt><dd>${fmtNum(all.carKm, 0)} km · ${fmtCents(all.totalCents)}</dd>
      <dt>Months</dt><dd>${all.months.length}</dd>
    </dl>
  </section>${cards}`;
}

function routeForm(r) {
  return `<form data-form="route" class="route-form">
    <label>Name <input name="name" value="${esc(r.name ?? '')}" placeholder="e.g. Work commute" required></label>
    <label>From (outbound / morning) <input name="from" value="${esc(r.from ?? '')}" placeholder="Street, postcode, city" required></label>
    <label>To <input name="to" value="${esc(r.to ?? '')}" placeholder="Street, postcode, city" required></label>
    <button type="button" class="btn block" data-action="route-calc">📍 Calculate distance automatically</button>
    <p id="routeStatus" class="muted small"></p>
    <div class="row2">
      <label>km there <input name="kmThere" inputmode="decimal" value="${r.kmThere != null ? fmtNum(r.kmThere) : ''}" required></label>
      <label>km back <input name="kmBack" inputmode="decimal" value="${r.kmBack != null ? fmtNum(r.kmBack) : ''}" required></label>
    </div>
    <button class="btn primary block">Save route</button>
    <button type="button" class="btn ghost block" data-action="route-cancel">Cancel</button>
  </form>`;
}

function viewSetup() {
  const t = topic();
  const people = S.people
    .filter((p) => !p.archived)
    .map(
      (p) => `<div class="person-row">
        <input value="${esc(p.name)}" data-change="person-rename" data-pid="${p.id}" aria-label="Name">
        <button class="btn ghost small danger" data-action="person-remove" data-pid="${p.id}">Remove</button></div>`
    )
    .join('');
  const archived = S.people.filter((p) => p.archived);

  const routes = t.routes
    .map((r) =>
      ui.routeEdit === r.id
        ? routeForm(r)
        : `<div class="route-row">
          <div><strong>${esc(r.name)}</strong>${r.id === t.defaultRouteId ? ' <span class="badge">default</span>' : ''}<br>
            <span class="small">${esc(r.from)} → ${esc(r.to)}: ${fmtNum(r.kmThere)} km · back ${fmtNum(r.kmBack)} km</span></div>
          <div class="row-actions">
            <button class="btn ghost small" data-action="route-edit" data-id="${r.id}">Edit</button>
            <button class="btn ghost small danger" data-action="route-delete" data-id="${r.id}">✕</button></div>
        </div>`
    )
    .join('');

  return `<section class="card">
    <h3>Topic settings</h3>
    <p class="muted small">Every topic has its own routes, trips, refuels and calculation.</p>
    <label>Topic name <input value="${esc(t.name)}" data-change="topic-field" data-field="name"></label>
    <div class="row2">
      <label>Litres per tank <input inputmode="decimal" value="${fmtNum(t.tankL, 1)}" data-change="topic-field" data-field="tankL"></label>
      <label>km per tank <input inputmode="decimal" value="${fmtNum(t.tankKm, 0)}" data-change="topic-field" data-field="tankKm"></label>
    </div>
    <p class="muted small">→ Consumption ${fmtNum(calc.litersPerKm(t) * 100, 2)} L/100 km</p>
    <label>Estimated fuel price (€/L) <input inputmode="decimal" value="${fmtNum(t.estPrice, 3)}" data-change="topic-field" data-field="estPrice"></label>
    <p class="muted small">Used for a month until its first refuel is recorded.</p>
    <label>Default route for new trips
      <select data-change="topic-field" data-field="defaultRouteId">${t.routes
        .map((r) => `<option value="${r.id}" ${r.id === t.defaultRouteId ? 'selected' : ''}>${esc(r.name)}</option>`)
        .join('')}</select></label>
    <div class="row2">
      <button class="btn" data-action="topic-new">+ New topic</button>
      <button class="btn danger" data-action="topic-delete" ${S.topics.length < 2 ? 'disabled' : ''}>Delete topic</button>
    </div>
  </section>

  <section class="card">
    <h3>People</h3>
    ${people || '<p class="muted small">No people yet. Add everyone who rides along — including the driver.</p>'}
    <form data-form="person" class="person-row">
      <input name="name" placeholder="Name" autocomplete="off" required>
      <button class="btn primary">Add</button>
    </form>
    ${
      archived.length
        ? `<p class="muted small">Removed (kept for history): ${archived
            .map((p) => `${esc(p.name)} <button class="link" data-action="person-restore" data-pid="${p.id}">restore</button>`)
            .join(' · ')}</p>`
        : ''
    }
  </section>

  <section class="card">
    <h3>Routes in “${esc(t.name)}”</h3>
    ${routes || '<p class="muted small">No routes yet.</p>'}
    ${ui.routeEdit === 'new' ? routeForm({}) : '<button class="btn block" data-action="route-new">+ Add route</button>'}
  </section>

  <section class="card">
    <h3>Backup</h3>
    <p class="muted small">All data is stored only on this phone. Export a backup now and then (e.g. save it to Google Drive).</p>
    <div class="row2">
      <button class="btn" data-action="export">⬇ Export</button>
      <button class="btn" data-action="import">⬆ Import</button>
    </div>
  </section>

  <section class="card">
    <h3>How costs are calculated</h3>
    <p class="small">Cost per km = litres per km × the month's average fuel price (total paid ÷ litres bought; the estimate
    if there was no refuel yet). Each trip's cost (km × cost per km) is split equally between everyone in the car, the
    driver included. A person's monthly cost is the sum of their shares, rounded to cents so that all shares add up exactly to the total.</p>
  </section>`;
}

const VIEWS = { day: viewDay, fuel: viewFuel, costs: viewCosts, stats: viewStats, setup: viewSetup };

function render() {
  const t = topic();
  $('#topicSelect').innerHTML = S.topics.map((x) => `<option value="${x.id}" ${x.id === t.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
  document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.tab === ui.tab));
  main.innerHTML = VIEWS[ui.tab]();
}

// ---------- actions ----------

const findTrip = (id) => topic().trips.find((x) => x.id === id);

function lastPeople(t, slot, date) {
  const prev = t.trips.filter((x) => x.slot === slot && x.date < date).sort((a, b) => b.date.localeCompare(a.date))[0];
  return (prev?.people ?? []).filter((id) => person(id) && !person(id).archived);
}

function addTrip(slot) {
  const t = topic();
  const r = defaultRoute(t);
  if (!r) {
    alert('Please add a route first (Setup tab).');
    ui.tab = 'setup';
    return render();
  }
  const dir = slot === 'evening' ? 'back' : 'there';
  t.trips.push({ id: uid(), date: ui.date, slot, routeId: r.id, dir, km: routeKm(r, dir), people: slot === 'other' ? [] : lastPeople(t, slot, ui.date) });
  commit();
}

const actions = {
  tab(el) {
    ui.tab = el.dataset.tab;
    ui.fuelEdit = ui.routeEdit = null;
    render();
    scrollTo(0, 0);
  },
  'day-shift'(el) {
    ui.date = addDays(ui.date, Number(el.dataset.n));
    render();
  },
  'day-today'() {
    ui.date = localDate();
    render();
  },
  'goto-date'(el) {
    ui.date = el.dataset.date;
    render();
    scrollTo(0, 0);
  },
  'goto-month'(el) {
    ui.month = el.dataset.month;
    ui.tab = 'costs';
    render();
  },
  'trip-on'(el) {
    addTrip(el.dataset.slot);
  },
  'trip-add-other'() {
    addTrip('other');
  },
  'trip-off'(el) {
    const t = topic();
    t.trips = t.trips.filter((x) => x.id !== el.dataset.id);
    commit();
  },
  'trip-person'(el) {
    const trip = findTrip(el.dataset.id);
    const pid = el.dataset.pid;
    trip.people = trip.people.includes(pid) ? trip.people.filter((x) => x !== pid) : [...trip.people, pid];
    commit();
  },
  'trip-same'(el) {
    const trip = findTrip(el.dataset.id);
    const morning = topic().trips.find((x) => x.date === trip.date && x.slot === 'morning');
    trip.people = [...morning.people];
    commit();
  },
  'month-shift'(el) {
    ui.month = addMonths(ui.month, Number(el.dataset.n));
    render();
  },
  'fuel-edit'(el) {
    ui.fuelEdit = el.dataset.id;
    render();
    scrollTo(0, 0);
  },
  'fuel-cancel'() {
    ui.fuelEdit = null;
    render();
  },
  'fuel-delete'(el) {
    if (!confirm('Delete this refuel?')) return;
    const t = topic();
    t.fuel = t.fuel.filter((f) => f.id !== el.dataset.id);
    commit();
  },
  async share() {
    const text = settlementText(topic(), calc.settleMonth(topic(), ui.month));
    try {
      if (navigator.share) await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(text);
        alert('Copied to clipboard.');
      }
    } catch (err) {
      if (err.name !== 'AbortError') alert(text);
    }
  },
  'topic-new'() {
    const name = prompt('Name of the new topic (e.g. "Holiday trips"):');
    if (!name?.trim()) return;
    const t = newTopic(name.trim(), topic());
    S.topics.push(t);
    S.currentTopicId = t.id;
    ui.routeEdit = 'new';
    commit();
  },
  'topic-delete'() {
    const t = topic();
    if (S.topics.length < 2) return;
    if (!confirm(`Delete topic “${t.name}” with all its trips and refuels? This cannot be undone.`)) return;
    S.topics = S.topics.filter((x) => x.id !== t.id);
    S.currentTopicId = S.topics[0].id;
    commit();
  },
  'person-remove'(el) {
    const p = person(el.dataset.pid);
    const used = S.topics.some((t) => t.trips.some((x) => x.people.includes(p.id)));
    if (!confirm(used ? `Remove ${p.name}? Past trips are kept and still count in the settlements.` : `Remove ${p.name}?`)) return;
    if (used) p.archived = true;
    else S.people = S.people.filter((x) => x.id !== p.id);
    commit();
  },
  'person-restore'(el) {
    person(el.dataset.pid).archived = false;
    commit();
  },
  'route-new'() {
    ui.routeEdit = 'new';
    render();
  },
  'route-edit'(el) {
    ui.routeEdit = el.dataset.id;
    render();
  },
  'route-cancel'() {
    ui.routeEdit = null;
    render();
  },
  'route-delete'(el) {
    const t = topic();
    const r = t.routes.find((x) => x.id === el.dataset.id);
    const n = t.trips.filter((x) => x.routeId === r.id).length;
    if (!confirm(`Delete route “${r.name}”?${n ? ` The ${n} recorded trips keep their distance.` : ''}`)) return;
    t.routes = t.routes.filter((x) => x.id !== r.id);
    if (t.defaultRouteId === r.id) t.defaultRouteId = t.routes[0]?.id ?? null;
    commit();
  },
  async 'route-calc'(el) {
    const f = el.closest('form');
    const status = $('#routeStatus');
    if (!f.from.value.trim() || !f.to.value.trim()) return (status.textContent = 'Please enter both addresses first.');
    el.disabled = true;
    status.textContent = 'Looking up addresses and route…';
    try {
      const r = await computeRoute(f.from.value.trim(), f.to.value.trim());
      f.kmThere.value = fmtNum(r.kmThere);
      f.kmBack.value = fmtNum(r.kmBack);
      status.innerHTML = `✓ Found:<br>From: ${esc(r.fromLabel)}<br>To: ${esc(r.toLabel)}<br>Please check the places are right.`;
    } catch (err) {
      status.textContent = `${err.message}. Check the address (or your internet connection), or enter the km manually.`;
    } finally {
      el.disabled = false;
    }
  },
  export() {
    const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `carpool-backup-${localDate()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
  import() {
    $('#importFile').click();
  },
};

const changes = {
  'topic-switch'(el) {
    S.currentTopicId = el.value;
    ui.fuelEdit = ui.routeEdit = null;
    commit();
  },
  'day-set'(el) {
    if (el.value) ui.date = el.value;
    render();
  },
  'trip-route'(el) {
    const trip = findTrip(el.dataset.id);
    const [routeId, dir] = el.value.split('|');
    const r = topic().routes.find((x) => x.id === routeId);
    if (!r) return;
    Object.assign(trip, { routeId, dir, km: routeKm(r, dir) });
    commit();
  },
  'trip-km'(el) {
    const km = parseNum(el.value);
    if (km > 0) findTrip(el.dataset.id).km = Math.round(km * 10) / 10;
    else alert('Please enter a distance greater than 0.');
    commit();
  },
  'topic-field'(el) {
    const t = topic();
    const f = el.dataset.field;
    if (f === 'name' || f === 'defaultRouteId') {
      if (el.value.trim()) t[f] = el.value.trim();
    } else {
      const v = parseNum(el.value);
      if (v > 0) t[f] = v;
      else alert('Please enter a number greater than 0.');
    }
    commit();
  },
  'person-rename'(el) {
    if (el.value.trim()) person(el.dataset.pid).name = el.value.trim();
    commit();
  },
};

const forms = {
  fuel(f) {
    const liters = parseNum(f.liters.value);
    const pricePerL = parseNum(f.price.value);
    if (!f.date.value || !(liters > 0) || !(pricePerL > 0)) return alert('Please enter date, litres and price per litre.');
    const t = topic();
    const entry = { date: f.date.value, liters, pricePerL, note: f.note.value.trim() };
    const existing = t.fuel.find((x) => x.id === ui.fuelEdit);
    if (existing) Object.assign(existing, entry);
    else t.fuel.push({ id: uid(), ...entry });
    ui.fuelEdit = null;
    commit();
  },
  person(f) {
    const name = f.name.value.trim();
    if (!name) return;
    S.people.push({ id: uid(), name, archived: false });
    commit();
    $('form[data-form=person] input')?.focus();
  },
  route(f) {
    const t = topic();
    const data = {
      name: f.name.value.trim(),
      from: f.from.value.trim(),
      to: f.to.value.trim(),
      kmThere: Math.round(parseNum(f.kmThere.value) * 10) / 10,
      kmBack: Math.round(parseNum(f.kmBack.value) * 10) / 10,
    };
    if (!data.name || !data.from || !data.to) return alert('Please fill in name, from and to.');
    if (!(data.kmThere > 0) || !(data.kmBack > 0)) return alert('Please enter both distances (or tap “Calculate distance automatically”).');
    const r = t.routes.find((x) => x.id === ui.routeEdit);
    if (r) {
      const stale = t.trips.filter(
        (x) => x.routeId === r.id && ((x.dir === 'there' && x.km === r.kmThere && r.kmThere !== data.kmThere) || (x.dir === 'back' && x.km === r.kmBack && r.kmBack !== data.kmBack))
      );
      if (stale.length && confirm(`Also update the distance of ${stale.length} already recorded trip(s) on this route?`)) {
        for (const x of stale) x.km = x.dir === 'back' ? data.kmBack : data.kmThere;
      }
      Object.assign(r, data);
    } else {
      t.routes.push({ id: uid(), ...data });
      if (!t.defaultRouteId) t.defaultRouteId = t.routes.at(-1).id;
    }
    ui.routeEdit = null;
    commit();
  },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.action];
  if (fn) {
    e.preventDefault();
    fn(el);
  }
});
document.addEventListener('change', (e) => {
  const el = e.target.closest('[data-change]');
  if (el) changes[el.dataset.change]?.(el);
});
document.addEventListener('submit', (e) => {
  const f = e.target;
  if (!forms[f.dataset.form]) return;
  e.preventDefault();
  forms[f.dataset.form](f);
});
document.addEventListener('input', (e) => {
  if (e.target.closest('form[data-form=fuel]')) updateFuelTotal();
});
$('#importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!isValidState(data)) throw new Error('not a backup file');
    if (!confirm('Replace ALL data on this phone with the backup?')) return;
    S = data;
    if (!S.topics.some((t) => t.id === S.currentTopicId)) S.currentTopicId = S.topics[0].id;
    commit();
    alert('Backup imported.');
  } catch (err) {
    alert(`Import failed: ${err.message}`);
  }
});

render();
navigator.storage?.persist?.();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');

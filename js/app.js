import { loadState, saveState, uid, localDate, newTopic, migrate, isValidState } from './store.js';
import * as calc from './logic.js';
import { computeRoute } from './geo.js';

let S = loadState();
const ui = { date: localDate(), month: localDate().slice(0, 7), fuelEdit: null, routeEdit: null, tripEdit: null, draft: null };

const $ = (sel) => document.querySelector(sel);
const main = $('#main');

// Text size is a per-phone display preference, kept outside the data (and the backup).
const ZOOM_KEY = 'carpool-zoom';
const ZOOMS = [
  { value: 1, label: 'A' },
  { value: 1.15, label: 'A+' },
  { value: 1.3, label: 'A++' },
];
const getZoom = () => Number(localStorage.getItem(ZOOM_KEY)) || 1.15;
const applyZoom = () => (document.documentElement.style.zoom = getZoom());
applyZoom();

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
const fmtDate = (s, opts) => toDate(s).toLocaleDateString(undefined, opts);
const fmtDateShort = (s) => fmtDate(s, { weekday: 'short', day: 'numeric', month: 'short' });
const fmtMonth = (ym) => fmtDate(ym + '-01', { month: 'long', year: 'numeric' });

const person = (t, id) => t.people.find((p) => p.id === id);
const personName = (t, id) => person(t, id)?.name ?? '(removed)';
const activePeople = (t) => t.people.filter((p) => !p.archived);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const routeLabel = (r, dir) => (dir === 'back' ? `${r.to} → ${r.from}` : `${r.from} → ${r.to}`);
const routeKm = (r, dir) => (dir === 'back' ? r.kmBack : r.kmThere);
const defaultRoute = (t) => t.routes.find((r) => r.id === t.defaultRouteId) ?? t.routes[0];
const findTrip = (t, id) => t.trips.find((x) => x.id === id);

function commit() {
  saveState(S);
  render();
}

// ---------- navigation ----------
// Screens live in the URL hash (#/ · #/new · #/t/<id>/<tab>) so Android's back button works.

const TABS = ['day', 'fuel', 'costs', 'stats', 'settings'];

function current() {
  const [, kind, id, tab] = location.hash.split('/');
  if (kind === 'new') return { screen: 'new' };
  const t = kind === 't' && S.topics.find((x) => x.id === id);
  if (t) return { screen: 'topic', t, tab: TABS.includes(tab) ? tab : 'day' };
  return { screen: 'home' };
}
const topic = () => current().t;

function go(hash, mode = 'push') {
  const depth = (history.state?.depth ?? 0) + (mode === 'push' ? 1 : 0);
  history[mode === 'push' ? 'pushState' : 'replaceState']({ depth }, '', hash);
  ui.tripEdit = ui.routeEdit = ui.fuelEdit = null;
  render();
  scrollTo(0, 0);
}

function back(fallback) {
  if ((history.state?.depth ?? 0) > 0) history.back();
  else go(fallback, 'replace');
}

function openTopic(id, mode = 'push') {
  ui.date = localDate();
  ui.month = ui.date.slice(0, 7);
  go(`#/t/${id}`, mode);
}

// ---------- home: list of topics ----------

function viewHome() {
  const month = localDate().slice(0, 7);
  const cards = S.topics
    .map((t) => {
      const r = defaultRoute(t);
      const s = calc.settleMonth(t, month);
      return `<button class="topic-card" data-action="open-topic" data-id="${t.id}">
        <span class="topic-main">
          <strong>${esc(t.name)}</strong>
          ${r ? `<span class="small muted">${esc(r.from)} ⇄ ${esc(r.to)}</span>` : ''}
          <span class="small muted">${plural(activePeople(t).length, 'person', 'people')} · ${fmtDate(month + '-01', { month: 'long' })}: ${fmtCents(s.totalCents)}</span>
        </span>
        <span class="chev">›</span>
      </button>`;
    })
    .join('');
  return `<p class="muted center">Choose a topic or create a new one.</p>
  ${cards}
  <button class="btn primary block big" data-action="new-topic">+ New topic</button>
  <div class="card text-size">
    <span>Text size</span>
    <div class="segmented">${ZOOMS.map(
      (z) => `<button class="${z.value === getZoom() ? 'on' : ''}" data-action="zoom" data-zoom="${z.value}" style="font-size:${Math.round(14 * z.value)}px">${z.label}</button>`
    ).join('')}</div>
  </div>
  <details class="card">
    <summary>Backup &amp; restore</summary>
    <p class="muted small">All data is stored only on this phone. Export a backup now and then (e.g. to Google Drive).</p>
    <div class="row2">
      <button class="btn" data-action="export">⬇ Export</button>
      <button class="btn" data-action="import">⬆ Import</button>
    </div>
  </details>`;
}

// ---------- new topic ----------

const emptyDraft = () => ({ name: '', from: '', to: '', kmThere: '', kmBack: '', people: [], newPerson: '', status: '', busy: false });

function viewNew() {
  const d = (ui.draft ??= emptyDraft());
  const people = d.people
    .map((name, i) => `<button class="chip on removable" data-action="draft-person-remove" data-i="${i}">${esc(name)} ✕</button>`)
    .join('');
  return `<section class="card">
    <h3><span class="step">1</span>Name</h3>
    <input data-draft="name" value="${esc(d.name)}" placeholder="e.g. Driving to work" autocomplete="off">
  </section>

  <section class="card">
    <h3><span class="step">2</span>Route</h3>
    <label>Start (outward trip) <input data-draft="from" value="${esc(d.from)}" placeholder="e.g. 70190 Stuttgart"></label>
    <label>Destination <input data-draft="to" value="${esc(d.to)}" placeholder="e.g. 72585 Riederich"></label>
    <p class="muted small">The way back is the same route in reverse.</p>
    <button class="btn block" data-action="draft-calc" ${d.busy ? 'disabled' : ''}>📍 Calculate distance</button>
    ${d.status ? `<p class="small muted">${esc(d.status)}</p>` : ''}
    <div class="row2">
      <label>km there <input data-draft="kmThere" inputmode="decimal" value="${esc(d.kmThere)}" placeholder="auto"></label>
      <label>km back <input data-draft="kmBack" inputmode="decimal" value="${esc(d.kmBack)}" placeholder="auto"></label>
    </div>
  </section>

  <section class="card">
    <h3><span class="step">3</span>People</h3>
    <p class="muted small">Everyone who rides along — including the driver.</p>
    ${people ? `<div class="chips">${people}</div>` : ''}
    <div class="add-row">
      <input id="draftPerson" data-draft="newPerson" value="${esc(d.newPerson)}" placeholder="Name" autocomplete="off" enterkeyhint="done">
      <button class="btn primary" data-action="draft-person-add">Add</button>
    </div>
  </section>

  <button class="btn primary block big" data-action="draft-create" ${d.busy ? 'disabled' : ''}>Create topic</button>`;
}

async function calcDraft() {
  const d = ui.draft;
  if (!d.from.trim() || !d.to.trim()) {
    d.status = 'Please enter start and destination first.';
    render();
    return false;
  }
  d.busy = true;
  d.status = 'Calculating the distance…';
  render();
  try {
    const r = await computeRoute(d.from.trim(), d.to.trim());
    d.kmThere = fmtNum(r.kmThere);
    d.kmBack = fmtNum(r.kmBack);
    d.status = `✓ Found: ${r.fromLabel} → ${r.toLabel}`;
    return true;
  } catch (err) {
    d.status = `${err.message}. Check the addresses or enter the km yourself.`;
    return false;
  } finally {
    d.busy = false;
    render();
  }
}

function addDraftPerson() {
  const d = ui.draft;
  const name = d.newPerson.trim();
  if (name && !d.people.includes(name)) d.people.push(name);
  d.newPerson = '';
  render();
  $('#draftPerson')?.focus();
}

// ---------- topic: day ----------

const SLOT = {
  morning: { icon: '🌅', title: 'Morning' },
  evening: { icon: '🌇', title: 'Evening' },
  other: { icon: '🚗', title: 'Other trip' },
};

function lastPeople(t, slot, date) {
  const prev = t.trips
    .filter((x) => x.slot === slot && x.date < date && x.people.length)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  return (prev?.people ?? []).filter((id) => person(t, id) && !person(t, id).archived);
}

function tripEditor(t, trip) {
  const opts = t.routes
    .flatMap((r) =>
      ['there', 'back'].map((dir) => {
        const sel = r.id === trip.routeId && dir === trip.dir ? 'selected' : '';
        return `<option value="${r.id}|${dir}" ${sel}>${esc(routeLabel(r, dir))} (${fmtNum(routeKm(r, dir))} km)</option>`;
      })
    )
    .join('');
  const missing = t.routes.some((r) => r.id === trip.routeId) ? '' : '<option selected>(route deleted)</option>';
  return `<div class="trip-edit">
    <label>Route <select data-change="trip-route" data-id="${trip.id}">${missing}${opts}</select></label>
    <label class="inline">Distance <input class="num" inputmode="decimal" data-change="trip-km" data-id="${trip.id}" value="${fmtNum(trip.km)}"> km</label>
    <div class="row2">
      <button class="btn" data-action="trip-edit-close">Done</button>
      <button class="btn danger" data-action="trip-delete" data-id="${trip.id}">Delete trip</button>
    </div>
  </div>`;
}

function tripCard(t, slot, trip) {
  const { icon, title } = SLOT[slot];
  const r = trip ? t.routes.find((x) => x.id === trip.routeId) : defaultRoute(t);
  const dir = trip?.dir ?? (slot === 'evening' ? 'back' : 'there');
  const km = trip?.km ?? (r ? routeKm(r, dir) : 0);
  const sel = trip?.people ?? [];
  const tripAttr = `data-slot="${slot}" data-trip="${trip?.id ?? ''}"`;

  const chips =
    t.people
      .filter((p) => !p.archived || sel.includes(p.id))
      .map((p) => `<button class="chip ${sel.includes(p.id) ? 'on' : ''}" data-action="chip" ${tripAttr} data-pid="${p.id}">${esc(p.name)}</button>`)
      .join('') + `<button class="chip add" data-action="person-quick" ${tripAttr} aria-label="Add a person">＋</button>`;

  let fill = '';
  if (!sel.length && slot !== 'other') {
    const morning = t.trips.find((x) => x.date === ui.date && x.slot === 'morning');
    const last = lastPeople(t, slot, ui.date);
    if (slot === 'evening' && morning?.people.length) {
      fill = `<button class="link" data-action="fill" ${tripAttr} data-source="morning">Same as morning</button>`;
    } else if (last.length) {
      fill = `<button class="link" data-action="fill" ${tripAttr} data-source="last">Same as last time (${esc(last.map((id) => personName(t, id)).join(', '))})</button>`;
    }
  }

  const n = sel.length;
  const share = n ? (km * calc.litersPerKm(t) * calc.priceForMonth(t, calc.monthOf(ui.date)).price) / n : 0;
  const foot = n
    ? `${n} in the car · ≈ ${fmtEur(share)} each`
    : trip
      ? '<span class="warn-text">Tap who was in the car — otherwise this trip doesn’t count.</span>'
      : 'Tap who was in the car.';

  return `<section class="card trip ${n ? 'active' : ''}">
    <h3>${icon} ${title}</h3>
    <button class="route-line" data-action="trip-edit" ${tripAttr}>${r ? esc(routeLabel(r, dir)) : 'Route deleted'} · ${fmtNum(km)} km <span class="edit-hint">✎</span></button>
    ${trip && ui.tripEdit === trip.id ? tripEditor(t, trip) : ''}
    <div class="chips">${chips}</div>
    ${fill}
    <p class="trip-foot">${foot}</p>
  </section>`;
}

function viewDay(t) {
  if (!t.routes.length) {
    return `<section class="card"><h3>No route yet</h3>
      <p class="muted">Add a route in the settings first.</p>
      <button class="btn primary block" data-action="open-settings">Open settings</button></section>`;
  }
  const d = ui.date;
  const today = localDate();
  const month = calc.monthOf(d);
  const dayTrips = t.trips.filter((x) => x.date === d);

  const prevMonth = addMonths(today.slice(0, 7), -1);
  const settleHint =
    d === today && Number(today.slice(8)) <= 7 && t.trips.some((x) => calc.monthOf(x.date) === prevMonth)
      ? `<button class="banner ok" data-action="goto-month" data-month="${prevMonth}">✅ The settlement for ${fmtMonth(prevMonth)} is ready — tap to view</button>`
      : '';

  const days = [...new Set(t.trips.filter((x) => calc.monthOf(x.date) === month).map((x) => x.date))].sort().reverse();
  const overview = days
    .map((day) => {
      const parts = ['morning', 'evening', 'other'].flatMap((slot) =>
        t.trips
          .filter((x) => x.date === day && x.slot === slot)
          .map((x) => `${SLOT[slot].icon} ${x.people.map((id) => esc(personName(t, id))).join(', ') || '<span class="warn-text">nobody</span>'}`)
      );
      return `<button class="list-item ${day === d ? 'current' : ''}" data-action="goto-date" data-date="${day}">
        <strong>${fmtDateShort(day)}</strong><span>${parts.join('<br>')}</span></button>`;
    })
    .join('');

  return `${settleHint}
  <div class="datebar">
    <button class="btn round" data-action="day-shift" data-n="-1" aria-label="Previous day">‹</button>
    <button class="date-btn" data-action="pick-date">
      <strong>${d === today ? 'Today' : fmtDate(d, { weekday: 'long' })}</strong>
      <span>${fmtDate(d, { weekday: d === today ? 'long' : undefined, day: 'numeric', month: 'long', year: 'numeric' })}</span>
    </button>
    <button class="btn round" data-action="day-shift" data-n="1" aria-label="Next day">›</button>
    <input type="date" id="datePicker" class="visually-hidden" data-change="day-set" value="${d}" tabindex="-1" aria-hidden="true">
  </div>
  ${d !== today ? '<p class="center tight"><button class="link" data-action="day-today">Back to today</button></p>' : ''}
  ${tripCard(t, 'morning', dayTrips.find((x) => x.slot === 'morning'))}
  ${tripCard(t, 'evening', dayTrips.find((x) => x.slot === 'evening'))}
  ${dayTrips.filter((x) => x.slot === 'other').map((x) => tripCard(t, 'other', x)).join('')}
  <p class="center tight"><button class="link" data-action="trip-add-other">+ Add another trip this day</button></p>
  ${days.length ? `<details class="card"><summary>${fmtMonth(month)} · ${plural(days.length, 'day', 'days')} recorded</summary>${overview}</details>` : ''}`;
}

// ---------- topic: fuel ----------

function viewFuel(t) {
  const e = t.fuel.find((f) => f.id === ui.fuelEdit);
  const months = [...new Set(t.fuel.map((f) => calc.monthOf(f.date)))].sort().reverse();
  const history = months
    .map((m) => {
      const s = calc.fuelSummary(t.fuel, m);
      const rows = t.fuel
        .filter((f) => calc.monthOf(f.date) === m)
        .sort((a, b) => b.date.localeCompare(a.date))
        .map(
          (f) => `<div class="row">
            <div><strong>${fmtDateShort(f.date)}</strong> · ${fmtNum(f.liters, 2)} L × ${fmtNum(f.pricePerL, 3)} €<br>
              <span class="muted small">${fmtEur(f.liters * f.pricePerL)}${f.note ? ' · ' + esc(f.note) : ''}</span></div>
            <div class="row-actions">
              <button class="btn ghost small" data-action="fuel-edit" data-id="${f.id}">Edit</button>
              <button class="btn ghost small danger" data-action="fuel-delete" data-id="${f.id}" aria-label="Delete">✕</button></div>
          </div>`
        )
        .join('');
      return `<h4>${fmtMonth(m)} <span class="muted small">· Ø ${fmtNum(s.avgPrice, 3)} €/L · ${fmtEur(s.paid)}</span></h4>${rows}`;
    })
    .join('');

  return `<section class="card">
    <h3>${e ? 'Edit refuel' : 'Add refuel'}</h3>
    <form data-form="fuel">
      <label>Date <input type="date" name="date" value="${e?.date ?? localDate()}" required></label>
      <div class="row2">
        <label>Litres <input name="liters" inputmode="decimal" placeholder="e.g. 38,5" value="${e ? fmtNum(e.liters, 2) : ''}" required></label>
        <label>Price per litre (€) <input name="price" inputmode="decimal" placeholder="e.g. 1,749" value="${e ? fmtNum(e.pricePerL, 3) : ''}" required></label>
      </div>
      <label>Note (optional) <input name="note" value="${esc(e?.note ?? '')}" placeholder="e.g. petrol station"></label>
      <p class="total">Total: <strong id="fuelTotal">${e ? fmtEur(e.liters * e.pricePerL) : '–'}</strong></p>
      <button class="btn primary block">${e ? 'Save changes' : 'Add refuel'}</button>
      ${e ? '<button type="button" class="btn ghost block" data-action="fuel-cancel">Cancel</button>' : ''}
    </form>
  </section>
  <section class="card"><h3>Refuels</h3>${
    history || '<p class="muted small">No refuels recorded yet. Until then the estimated price from the settings is used.</p>'
  }</section>`;
}

function updateFuelTotal() {
  const f = $('form[data-form=fuel]');
  const l = parseNum(f.liters.value);
  const p = parseNum(f.price.value);
  $('#fuelTotal').textContent = l > 0 && p > 0 ? fmtEur(l * p) : '–';
}

// ---------- topic: costs ----------

function settlementText(t, r) {
  const lines = r.persons
    .slice()
    .sort((a, b) => personName(t, a.personId).localeCompare(personName(t, b.personId)))
    .map((p) => `${personName(t, p.personId)}: ${fmtCents(p.cents)} (${p.trips} trips, ${fmtNum(p.km, 0)} km)`);
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

function viewCosts(t) {
  const m = ui.month;
  const r = calc.settleMonth(t, m);
  const cur = localDate().slice(0, 7);

  let banner;
  if (m >= cur) {
    banner = `<div class="banner info">📊 <strong>Running estimate</strong> — the month is not over yet. ${
      r.priceSource === 'estimate' ? 'No refuel recorded yet, so the estimated fuel price is used.' : 'Uses the average price of the refuels so far.'
    }</div>`;
  } else if (r.priceSource === 'estimate') {
    banner = `<div class="banner warn">⚠️ No refuel recorded in ${fmtMonth(m)} — the estimated price is used. Add the refuels in the Fuel tab for an exact result.</div>`;
  } else {
    banner = `<div class="banner ok">✅ <strong>Final settlement</strong></div>`;
  }

  const persons = r.persons.slice().sort((a, b) => personName(t, a.personId).localeCompare(personName(t, b.personId)));
  const sumCents = persons.reduce((a, p) => a + p.cents, 0);
  const table = persons.length
    ? `<table class="table">
        <thead><tr><th>Person</th><th>Trips</th><th>km</th><th>Cost</th></tr></thead>
        <tbody>${persons
          .map((p) => `<tr><td>${esc(personName(t, p.personId))}</td><td>${p.trips}</td><td>${fmtNum(p.km, 0)}</td><td><strong>${fmtCents(p.cents)}</strong></td></tr>`)
          .join('')}</tbody>
        <tfoot><tr><td>Total</td><td>${r.tripCount}</td><td>${fmtNum(r.carKm, 0)}</td><td>${fmtCents(sumCents)}</td></tr></tfoot>
      </table>
      ${r.skippedTrips ? `<p class="small warn-text">${plural(r.skippedTrips, 'trip', 'trips')} without people selected ${r.skippedTrips === 1 ? 'is' : 'are'} not counted.</p>` : ''}
      <button class="btn primary block" data-action="share">Share settlement</button>`
    : '<p class="muted">No trips recorded in this month.</p>';

  return `<div class="datebar">
    <button class="btn round" data-action="month-shift" data-n="-1" aria-label="Previous month">‹</button>
    <h2>${fmtMonth(m)}</h2>
    <button class="btn round" data-action="month-shift" data-n="1" aria-label="Next month">›</button>
  </div>
  ${banner}
  <section class="card">${table}</section>
  <details class="card">
    <summary>Details &amp; how it is calculated</summary>
    <dl class="facts">
      <dt>Fuel price</dt><dd>${fmtNum(r.price, 3)} €/L <span class="muted small">${r.priceSource === 'refuels' ? `Ø of ${plural(r.fuel.count, 'refuel', 'refuels')}` : 'estimate'}</span></dd>
      <dt>Consumption</dt><dd>${fmtNum(r.litersPerKm * 100, 2)} L/100 km</dd>
      <dt>Cost per km</dt><dd>${fmtNum(r.costPerKm, 3)} €</dd>
      <dt>Car km</dt><dd>${fmtNum(r.carKm, 1)} km</dd>
      <dt>Fuel used</dt><dd>${fmtNum(r.liters, 1)} L</dd>
      ${r.fuel.count ? `<dt>Paid at the pump</dt><dd>${fmtEur(r.fuel.paid)} <span class="muted small">(${fmtNum(r.fuel.liters, 1)} L)</span></dd>` : ''}
    </dl>
    <p class="small">Each trip costs km × cost per km. That amount is split equally between everyone who was in the car,
    the driver included. Your monthly amount is the sum of your shares, rounded so all shares add up exactly to the total.</p>
  </details>`;
}

// ---------- topic: stats ----------

function viewStats(t) {
  const cur = calc.settleMonth(t, localDate().slice(0, 7));
  const all = calc.allTimeStats(t);
  if (!all.persons.length) return '<section class="card"><h3>Statistics</h3><p class="muted">No trips recorded yet.</p></section>';
  const curBy = new Map(cur.persons.map((p) => [p.personId, p]));
  const cards = all.persons
    .slice()
    .sort((a, b) => personName(t, a.personId).localeCompare(personName(t, b.personId)))
    .map((a) => {
      const c = curBy.get(a.personId) ?? { trips: 0, km: 0, cents: 0 };
      const share = all.totalCents ? Math.round((a.cents / all.totalCents) * 100) : 0;
      return `<section class="card">
        <h3>${esc(personName(t, a.personId))}</h3>
        <table class="table stats">
          <thead><tr><th></th><th>This month</th><th>All time</th></tr></thead>
          <tbody>
            <tr><td>Trips</td><td>${c.trips}</td><td>${a.trips}</td></tr>
            <tr><td>Kilometres</td><td>${fmtNum(c.km, 0)}</td><td>${fmtNum(a.km, 0)}</td></tr>
            <tr><td>Cost</td><td><strong>${fmtCents(c.cents)}</strong></td><td><strong>${fmtCents(a.cents)}</strong></td></tr>
          </tbody>
        </table>
        <p class="muted small">${a.slots.morning} morning · ${a.slots.evening} evening · ${a.slots.other} other ·
          Ø ${fmtCents(Math.round(a.cents / a.months))} per month · ${share}% of all costs</p>
      </section>`;
    })
    .join('');
  return `<section class="card">
    <dl class="facts">
      <dt>This month</dt><dd>${fmtNum(cur.carKm, 0)} km · ${fmtCents(cur.totalCents)}</dd>
      <dt>All time</dt><dd>${fmtNum(all.carKm, 0)} km · ${fmtCents(all.totalCents)}</dd>
    </dl>
  </section>${cards}`;
}

// ---------- topic: settings ----------

function routeForm(r) {
  return `<form data-form="route" class="route-form">
    <label>Name <input name="name" value="${esc(r.name ?? '')}" placeholder="e.g. Work commute" required></label>
    <label>Start <input name="from" value="${esc(r.from ?? '')}" placeholder="Street, postcode, city" required></label>
    <label>Destination <input name="to" value="${esc(r.to ?? '')}" placeholder="Street, postcode, city" required></label>
    <button type="button" class="btn block" data-action="route-calc">📍 Calculate distance</button>
    <p id="routeStatus" class="muted small"></p>
    <div class="row2">
      <label>km there <input name="kmThere" inputmode="decimal" value="${r.kmThere != null ? fmtNum(r.kmThere) : ''}" required></label>
      <label>km back <input name="kmBack" inputmode="decimal" value="${r.kmBack != null ? fmtNum(r.kmBack) : ''}" required></label>
    </div>
    <div class="row2">
      <button type="button" class="btn" data-action="route-cancel">Cancel</button>
      <button class="btn primary">Save</button>
    </div>
  </form>`;
}

function viewSettings(t) {
  const people = activePeople(t)
    .map(
      (p) => `<div class="row">
        <input value="${esc(p.name)}" data-change="person-rename" data-pid="${p.id}" aria-label="Name">
        <button class="btn ghost small danger" data-action="person-remove" data-pid="${p.id}">Remove</button></div>`
    )
    .join('');
  const archived = t.people.filter((p) => p.archived);

  const routes = t.routes
    .map((r) =>
      ui.routeEdit === r.id
        ? routeForm(r)
        : `<div class="row">
          <div><strong>${esc(r.name)}</strong> ${
            r.id === t.defaultRouteId ? '<span class="badge">default</span>' : `<button class="link small" data-action="route-default" data-id="${r.id}">make default</button>`
          }<br>
            <span class="small muted">${esc(r.from)} ⇄ ${esc(r.to)} · ${fmtNum(r.kmThere)} / ${fmtNum(r.kmBack)} km</span></div>
          <div class="row-actions">
            <button class="btn ghost small" data-action="route-edit" data-id="${r.id}">Edit</button>
            <button class="btn ghost small danger" data-action="route-delete" data-id="${r.id}" aria-label="Delete">✕</button></div>
        </div>`
    )
    .join('');

  return `<section class="card">
    <h3>People</h3>
    ${people || '<p class="muted small">No people yet. Add everyone who rides along — including the driver.</p>'}
    <form data-form="person" class="add-row">
      <input name="name" placeholder="New person" autocomplete="off" required>
      <button class="btn primary">Add</button>
    </form>
    ${
      archived.length
        ? `<p class="muted small">Removed (kept for past trips): ${archived
            .map((p) => `${esc(p.name)} <button class="link small" data-action="person-restore" data-pid="${p.id}">restore</button>`)
            .join(' · ')}</p>`
        : ''
    }
  </section>

  <section class="card">
    <h3>Routes</h3>
    ${routes || '<p class="muted small">No routes yet.</p>'}
    ${ui.routeEdit === 'new' ? routeForm({}) : '<button class="btn block" data-action="route-new">+ Add route</button>'}
  </section>

  <section class="card">
    <h3>Car &amp; fuel price</h3>
    <div class="row2">
      <label>Litres per tank <input inputmode="decimal" value="${fmtNum(t.tankL, 1)}" data-change="topic-field" data-field="tankL"></label>
      <label>km per tank <input inputmode="decimal" value="${fmtNum(t.tankKm, 0)}" data-change="topic-field" data-field="tankKm"></label>
    </div>
    <p class="muted small">→ Consumption ${fmtNum(calc.litersPerKm(t) * 100, 2)} L/100 km</p>
    <label>Estimated fuel price (€/L) <input inputmode="decimal" value="${fmtNum(t.estPrice, 3)}" data-change="topic-field" data-field="estPrice"></label>
    <p class="muted small">Used for a month until its first refuel is recorded.</p>
  </section>

  <section class="card">
    <h3>Topic</h3>
    <label>Name <input value="${esc(t.name)}" data-change="topic-field" data-field="name"></label>
    <button class="btn danger block" data-action="topic-delete">Delete this topic</button>
  </section>`;
}

const VIEWS = { day: viewDay, fuel: viewFuel, costs: viewCosts, stats: viewStats, settings: viewSettings };

// ---------- render ----------

function header(c) {
  if (c.screen === 'home') return '<span class="logo">⛽</span><h1>Carpool</h1>';
  const backBtn = (fallback) => `<button class="icon-btn" data-action="back" data-fallback="${fallback}" aria-label="Back">‹</button>`;
  if (c.screen === 'new') return `${backBtn('#/')}<h1>New topic</h1>`;
  if (c.tab === 'settings') return `${backBtn(`#/t/${c.t.id}`)}<h1>Settings<small>${esc(c.t.name)}</small></h1>`;
  return `${backBtn('#/')}<h1>${esc(c.t.name)}</h1><button class="icon-btn" data-action="open-settings" aria-label="Settings">⚙︎</button>`;
}

function render() {
  const c = current();
  $('#header').innerHTML = header(c);
  const nav = $('#nav');
  nav.hidden = c.screen !== 'topic';
  nav.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.tab === c.tab));
  main.innerHTML = c.screen === 'home' ? viewHome() : c.screen === 'new' ? viewNew() : VIEWS[c.tab](c.t);
}

// ---------- actions ----------

function ensureTrip(t, slot, tripId) {
  if (tripId) return findTrip(t, tripId);
  const r = defaultRoute(t);
  if (!r) {
    alert('Please add a route in the settings first.');
    return null;
  }
  const dir = slot === 'evening' ? 'back' : 'there';
  const trip = { id: uid(), date: ui.date, slot, routeId: r.id, dir, km: routeKm(r, dir), people: [] };
  t.trips.push(trip);
  return trip;
}

// Morning/evening trips exist only while someone is selected; "other" trips are removed explicitly.
function dropIfEmpty(t, trip) {
  if (trip.slot !== 'other' && !trip.people.length && ui.tripEdit !== trip.id) t.trips = t.trips.filter((x) => x !== trip);
}

const actions = {
  back(el) {
    back(el.dataset.fallback);
  },
  'open-topic'(el) {
    openTopic(el.dataset.id);
  },
  'new-topic'() {
    ui.draft = emptyDraft();
    go('#/new');
  },
  'open-settings'() {
    go(`#/t/${topic().id}/settings`);
  },
  tab(el) {
    if (el.dataset.tab === 'costs') ui.month = calc.monthOf(ui.date);
    go(`#/t/${topic().id}/${el.dataset.tab}`, 'replace');
  },

  // new topic
  'draft-calc'() {
    calcDraft();
  },
  'draft-person-add'() {
    addDraftPerson();
  },
  'draft-person-remove'(el) {
    ui.draft.people.splice(Number(el.dataset.i), 1);
    render();
  },
  async 'draft-create'() {
    const d = ui.draft;
    if (!d.name.trim()) return alert('Please enter a name for the topic.');
    if (!d.from.trim() || !d.to.trim()) return alert('Please enter start and destination.');
    if (!(parseNum(d.kmThere) > 0 && parseNum(d.kmBack) > 0) && !(await calcDraft())) {
      return alert('The distance could not be calculated. Please enter the km yourself.');
    }
    if (d.newPerson.trim()) d.people.push(d.newPerson.trim());
    if (!d.people.length && !confirm('No people added yet. Create the topic anyway? You can add people later.')) return;
    const t = newTopic(d.name.trim(), S.topics.at(-1));
    const r = { id: uid(), name: 'Main route', from: d.from.trim(), to: d.to.trim(), kmThere: parseNum(d.kmThere), kmBack: parseNum(d.kmBack) };
    t.routes.push(r);
    t.defaultRouteId = r.id;
    t.people = d.people.map((name) => ({ id: uid(), name, archived: false }));
    S.topics.push(t);
    saveState(S);
    ui.draft = null;
    openTopic(t.id, 'replace');
  },

  // day
  'day-shift'(el) {
    ui.date = addDays(ui.date, Number(el.dataset.n));
    ui.tripEdit = null;
    render();
  },
  'day-today'() {
    ui.date = localDate();
    render();
  },
  'pick-date'() {
    const input = $('#datePicker');
    try {
      input.showPicker();
    } catch {
      input.click();
    }
  },
  'goto-date'(el) {
    ui.date = el.dataset.date;
    render();
    scrollTo(0, 0);
  },
  'goto-month'(el) {
    ui.month = el.dataset.month;
    go(`#/t/${topic().id}/costs`, 'replace');
  },
  chip(el) {
    const t = topic();
    const trip = ensureTrip(t, el.dataset.slot, el.dataset.trip);
    if (!trip) return;
    const pid = el.dataset.pid;
    trip.people = trip.people.includes(pid) ? trip.people.filter((x) => x !== pid) : [...trip.people, pid];
    dropIfEmpty(t, trip);
    commit();
  },
  fill(el) {
    const t = topic();
    const trip = ensureTrip(t, el.dataset.slot, el.dataset.trip);
    if (!trip) return;
    const morning = t.trips.find((x) => x.date === ui.date && x.slot === 'morning');
    trip.people = el.dataset.source === 'morning' ? [...morning.people] : lastPeople(t, trip.slot, ui.date);
    commit();
  },
  'person-quick'(el) {
    const name = prompt('Name of the new person:')?.trim();
    if (!name) return;
    const t = topic();
    const p = { id: uid(), name, archived: false };
    t.people.push(p);
    const trip = ensureTrip(t, el.dataset.slot, el.dataset.trip);
    if (trip) trip.people.push(p.id);
    commit();
  },
  'trip-edit'(el) {
    const t = topic();
    const trip = ensureTrip(t, el.dataset.slot, el.dataset.trip);
    if (!trip) return;
    ui.tripEdit = ui.tripEdit === trip.id ? null : trip.id;
    dropIfEmpty(t, trip);
    commit();
  },
  'trip-edit-close'() {
    const t = topic();
    const trip = findTrip(t, ui.tripEdit);
    ui.tripEdit = null;
    if (trip) dropIfEmpty(t, trip);
    commit();
  },
  'trip-delete'(el) {
    const t = topic();
    t.trips = t.trips.filter((x) => x.id !== el.dataset.id);
    ui.tripEdit = null;
    commit();
  },
  'trip-add-other'() {
    const trip = ensureTrip(topic(), 'other');
    if (trip) ui.tripEdit = trip.id;
    commit();
  },

  // costs
  'month-shift'(el) {
    ui.month = addMonths(ui.month, Number(el.dataset.n));
    render();
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

  // fuel
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

  // settings
  'person-remove'(el) {
    const t = topic();
    const p = person(t, el.dataset.pid);
    const used = t.trips.some((x) => x.people.includes(p.id));
    if (!confirm(used ? `Remove ${p.name}? Past trips are kept and still count.` : `Remove ${p.name}?`)) return;
    if (used) p.archived = true;
    else t.people = t.people.filter((x) => x.id !== p.id);
    commit();
  },
  'person-restore'(el) {
    person(topic(), el.dataset.pid).archived = false;
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
  'route-default'(el) {
    topic().defaultRouteId = el.dataset.id;
    commit();
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
    if (!f.from.value.trim() || !f.to.value.trim()) return (status.textContent = 'Please enter start and destination first.');
    el.disabled = true;
    status.textContent = 'Calculating the distance…';
    try {
      const r = await computeRoute(f.from.value.trim(), f.to.value.trim());
      f.kmThere.value = fmtNum(r.kmThere);
      f.kmBack.value = fmtNum(r.kmBack);
      status.textContent = `✓ Found: ${r.fromLabel} → ${r.toLabel}`;
    } catch (err) {
      status.textContent = `${err.message}. Check the addresses or enter the km yourself.`;
    } finally {
      el.disabled = false;
    }
  },
  'topic-delete'() {
    const t = topic();
    if (!confirm(`Delete “${t.name}” with all its trips and refuels? This cannot be undone.`)) return;
    S.topics = S.topics.filter((x) => x.id !== t.id);
    saveState(S);
    go('#/', 'replace');
  },

  zoom(el) {
    localStorage.setItem(ZOOM_KEY, el.dataset.zoom);
    applyZoom();
    render();
  },

  // backup
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
  'day-set'(el) {
    if (el.value) ui.date = el.value;
    render();
  },
  'trip-route'(el) {
    const t = topic();
    const trip = findTrip(t, el.dataset.id);
    const [routeId, dir] = el.value.split('|');
    const r = t.routes.find((x) => x.id === routeId);
    if (!r) return;
    Object.assign(trip, { routeId, dir, km: routeKm(r, dir) });
    commit();
  },
  'trip-km'(el) {
    const km = parseNum(el.value);
    if (km > 0) findTrip(topic(), el.dataset.id).km = Math.round(km * 10) / 10;
    else alert('Please enter a distance greater than 0.');
    commit();
  },
  'topic-field'(el) {
    const t = topic();
    const f = el.dataset.field;
    if (f === 'name') {
      if (el.value.trim()) t.name = el.value.trim();
    } else {
      const v = parseNum(el.value);
      if (v > 0) t[f] = v;
      else alert('Please enter a number greater than 0.');
    }
    commit();
  },
  'person-rename'(el) {
    if (el.value.trim()) person(topic(), el.dataset.pid).name = el.value.trim();
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
    topic().people.push({ id: uid(), name, archived: false });
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
    if (!data.name || !data.from || !data.to) return alert('Please fill in name, start and destination.');
    if (!(data.kmThere > 0) || !(data.kmBack > 0)) return alert('Please enter both distances (or tap “Calculate distance”).');
    const r = t.routes.find((x) => x.id === ui.routeEdit);
    if (r) {
      const stale = t.trips.filter(
        (x) =>
          x.routeId === r.id &&
          ((x.dir === 'there' && x.km === r.kmThere && r.kmThere !== data.kmThere) || (x.dir === 'back' && x.km === r.kmBack && r.kmBack !== data.kmBack))
      );
      if (stale.length && confirm(`Also update the distance of ${plural(stale.length, 'recorded trip', 'recorded trips')} on this route?`)) {
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
  const key = e.target.dataset?.draft;
  if (key && ui.draft) ui.draft[key] = e.target.value;
  if (e.target.closest('form[data-form=fuel]')) updateFuelTotal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id === 'draftPerson') {
    e.preventDefault();
    addDraftPerson();
  }
});
$('#importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = migrate(JSON.parse(await file.text()));
    if (!isValidState(data)) throw new Error('this is not a backup file');
    if (!confirm('Replace ALL data on this phone with the backup?')) return;
    S = data;
    saveState(S);
    go('#/', 'replace');
    alert('Backup imported.');
  } catch (err) {
    alert(`Import failed: ${err.message}`);
  }
});
addEventListener('popstate', () => {
  ui.tripEdit = ui.routeEdit = ui.fuelEdit = null;
  render();
});

if (!history.state) history.replaceState({ depth: 0 }, '', location.hash || '#/');
render();
navigator.storage?.persist?.();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');

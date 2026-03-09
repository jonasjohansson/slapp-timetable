const STOPS = [
  { id: 2070, name: 'Larsbergsvägen', icon: '🚌', lines: [206], color: '#1e6bc9' },
  { id: 9220, name: 'Ropsten → Larsberg', icon: '🚌', lines: [206], directions: [1], color: '#1e6bc9' },
  { id: 9249, name: 'Larsberg', icon: '🚃', lines: [21], color: '#7b4fa0' },
  { id: 9255, name: 'Dalénum', icon: '⛴', lines: [80], color: '#00a4b7' },
  { id: 1442, name: 'Saltsjöqvarn', icon: '⛴', lines: [80], color: '#00a4b7' },
  { id: 9191, name: 'Medborgarplatsen', icon: '🚇', lines: [17, 18, 19], directions: [1], color: '#4ca85b' },
];

const ZONES = [
  { lat: 59.356, lng: 18.130, radius: 800, stops: ['Larsbergsvägen', 'Ropsten → Larsberg', 'Larsberg', 'Dalénum'] },
  { lat: 59.320, lng: 18.100, radius: 500, stops: ['Saltsjöqvarn'] },
  { lat: 59.314, lng: 18.074, radius: 500, stops: ['Medborgarplatsen'] },
];

const ROUTE = {
  origin: 'Larsbergsvägen 27, Lidingö',
  destination: 'Åsögatan 122, Stockholm',
};

const JOURNEY_API = 'https://journeyplanner.integration.sl.se/v2/trips';
const API_BASE = 'https://transport.integration.sl.se/v1/sites';
const MAX_DEPARTURES = 5;
const MAX_MINUTES = 30;
const REFRESH_INTERVAL = 30000;

const departuresEl = document.getElementById('departures');
const routeCardEl = document.getElementById('route-card');
const updatedEl = document.getElementById('updated');

let userPosition = null;

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

/* ---- Journey planner ---- */

const MODE_ICONS = {
  1: '🚇',   // metro
  2: '🚇',   // metro
  4: '🚃',   // tram
  5: '🚌',   // bus
  6: '🚌',   // bus
  7: '⛴',   // ship
  9: '🚆',   // train
  99: '🚶',  // transfer walk
  100: '🚶', // walk
};

async function fetchRoute() {
  const params = new URLSearchParams({
    type_origin: 'any',
    name_origin: ROUTE.origin,
    type_destination: 'any',
    name_destination: ROUTE.destination,
    calc_number_of_trips: '3',
    language: 'sv',
  });
  const res = await fetch(`${JOURNEY_API}?${params}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return (data.journeys || []).slice(0, 3);
}

function renderLeg(leg) {
  const tp = leg.transportation?.product;
  const iconId = tp?.iconId || 100;
  const icon = MODE_ICONS[iconId] || '🚶';
  const line = leg.transportation?.disassembledName || '';
  const isWalk = iconId >= 99;

  if (isWalk && !line) {
    const mins = Math.round(leg.duration / 60);
    if (mins <= 1) return '';
    return `<span class="route-leg walk">${icon} ${mins}m</span>`;
  }

  return `<span class="route-leg transit">${icon} ${esc(line)}</span>`;
}

function renderJourney(journey) {
  const legs = journey.legs || [];
  const firstDep = legs[0]?.origin?.departureTimePlanned || '';
  const lastArr = legs[legs.length - 1]?.destination?.arrivalTimePlanned || '';
  const depTime = firstDep.slice(11, 16);
  const arrTime = lastArr.slice(11, 16);
  const totalMin = Math.round(journey.tripDuration / 60);

  const legHtml = legs.map(renderLeg).filter(Boolean).join('<span class="route-arrow">→</span>');

  return `
    <div class="route-journey">
      <div class="route-times">
        <span class="route-dep">${esc(depTime)}</span>
        <span class="route-dur">${totalMin} min</span>
        <span class="route-arr">${esc(arrTime)}</span>
      </div>
      <div class="route-legs">${legHtml}</div>
    </div>`;
}

async function refreshRoute() {
  try {
    const journeys = await fetchRoute();
    if (!journeys.length) {
      routeCardEl.innerHTML = '';
      return;
    }
    routeCardEl.innerHTML = `
      <div class="route-card">
        <div class="route-header">🏠 → 💼 ${esc(ROUTE.destination)}</div>
        ${journeys.map(renderJourney).join('')}
      </div>`;
  } catch (err) {
    console.error('Failed to fetch route:', err);
    routeCardEl.innerHTML = '';
  }
}

/* ---- Departures ---- */

function minutesUntil(dep) {
  if (dep.display === 'Nu') return 0;
  const minMatch = dep.display.match(/^(\d+)\s*min/);
  if (minMatch) return parseInt(minMatch[1]);
  // Time format like "13:28" — calculate from now
  const timeMatch = dep.display.match(/^(\d{1,2}):(\d{2})$/);
  if (timeMatch) {
    const now = new Date();
    const depTime = new Date();
    depTime.setHours(parseInt(timeMatch[1]), parseInt(timeMatch[2]), 0, 0);
    const diff = (depTime - now) / 60000;
    return diff < 0 ? diff + 1440 : diff;
  }
  return 0;
}

async function fetchDepartures(stop) {
  const res = await fetch(`${API_BASE}/${stop.id}/departures`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const filtered = (data.departures || []).filter((dep) =>
    stop.lines.includes(dep.line?.id) &&
    (!stop.directions || stop.directions.includes(dep.direction_code)) &&
    minutesUntil(dep) <= MAX_MINUTES
  );
  // Sort by destination name then by time
  filtered.sort((a, b) => {
    const cmp = a.destination.localeCompare(b.destination, 'sv');
    if (cmp !== 0) return cmp;
    return minutesUntil(a) - minutesUntil(b);
  });
  return { stop, departures: filtered.slice(0, MAX_DEPARTURES) };
}

function renderDeparture(dep, color) {
  const isNow = dep.display === 'Nu';
  return `
    <div class="departure-row">
      <span class="line-badge" style="background:${color}">${esc(dep.line.designation)}</span>
      <span class="destination">${esc(dep.destination)}</span>
      <span class="time${isNow ? ' now' : ''}">${esc(dep.display)}</span>
    </div>`;
}

function renderStop({ stop, departures }, dimmed) {
  const rows = departures.length
    ? departures.map((dep) => renderDeparture(dep, stop.color)).join('')
    : '<div class="no-departures">Inga avgångar</div>';

  return `
    <section class="stop-section${dimmed ? ' dimmed' : ''}">
      <div class="stop-header">${stop.icon} ${stop.name}</div>
      ${rows}
    </section>`;
}

/* ---- GPS ---- */

function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getRelevantStops() {
  if (!userPosition) return null;
  for (const zone of ZONES) {
    const dist = distanceMeters(userPosition.lat, userPosition.lng, zone.lat, zone.lng);
    if (dist <= zone.radius) return zone.stops;
  }
  return null;
}

function updateGPS() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => { userPosition = { lat: pos.coords.latitude, lng: pos.coords.longitude }; },
    () => { userPosition = null; },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
  );
}

/* ---- Timestamp ---- */

function updateTimestamp() {
  const now = new Date();
  const time = now.toLocaleTimeString('sv-SE', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  updatedEl.textContent = `Uppdaterad ${time}`;
}

/* ---- Main loop ---- */

updateGPS();

async function refresh() {
  updateGPS();
  const relevant = getRelevantStops();
  const [, ...depResults] = await Promise.allSettled([
    refreshRoute(),
    ...STOPS.map(fetchDepartures),
  ]);
  const html = depResults.map((result, i) => {
    const dimmed = relevant !== null && !relevant.includes(STOPS[i].name);
    if (result.status === 'fulfilled') {
      return renderStop(result.value, dimmed);
    }
    console.error(`Failed to fetch ${STOPS[i].name}:`, result.reason);
    return `
      <section class="stop-section${dimmed ? ' dimmed' : ''}">
        <div class="stop-header">${STOPS[i].icon} ${esc(STOPS[i].name)}</div>
        <div class="no-departures">Kunde inte hämta avgångar</div>
      </section>`;
  });
  departuresEl.innerHTML = html.join('');
  updateTimestamp();
}

refresh();
setInterval(refresh, REFRESH_INTERVAL);

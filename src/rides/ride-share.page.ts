// The "share my trip" page people open from a link (WhatsApp, SMS). Plain
// HTML + Leaflet with OpenStreetMap tiles, so it needs no map key and no app.
// It reads /api/v1/share/<token> every 5 seconds. Everything shown is put in
// with textContent, never as HTML.
export const SHARE_PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>FAZL Live Trip</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
  integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="">
<style>
  :root { --brand:#0E9F6E; --ink:#111827; --muted:#6B7280; --line:#E5E7EB; --bg:#F9FAFB; }
  * { box-sizing:border-box; }
  html, body { margin:0; height:100%; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; color:var(--ink); background:var(--bg); }
  #map { position:fixed; inset:0 0 auto 0; height:58vh; }
  .sheet { position:fixed; left:0; right:0; bottom:0; min-height:42vh; max-height:70vh; overflow:auto;
    background:#fff; border-radius:18px 18px 0 0; box-shadow:0 -6px 24px rgba(0,0,0,.12); padding:18px 16px 24px; z-index:1000; }
  .brand { font-weight:800; color:var(--brand); letter-spacing:.5px; font-size:13px; }
  h1 { font-size:20px; margin:6px 0 2px; }
  .eta { color:var(--brand); font-weight:700; font-size:15px; min-height:18px; }
  .card { display:flex; gap:12px; align-items:center; border:1px solid var(--line); border-radius:12px; padding:12px; margin:14px 0; }
  .avatar { width:44px; height:44px; border-radius:50%; background:#D1FAE5; color:var(--brand); display:flex; align-items:center; justify-content:center; font-weight:800; font-size:18px; flex:none; }
  .plate { display:inline-block; border:1.5px solid var(--ink); border-radius:6px; padding:1px 7px; font-weight:700; font-size:13px; margin-top:4px; }
  .muted { color:var(--muted); font-size:13px; }
  .route { list-style:none; margin:0; padding:0; }
  .route li { display:flex; gap:10px; padding:7px 0; font-size:14px; }
  .dot { width:10px; height:10px; border-radius:50%; margin-top:5px; flex:none; }
  .msg { text-align:center; padding:40px 16px; }
  .hidden { display:none; }
  .foot { margin-top:14px; font-size:12px; color:var(--muted); }
</style>
</head>
<body>
<div id="map"></div>
<div class="sheet">
  <div class="brand">FAZL · LIVE TRIP</div>
  <div id="error" class="msg hidden"><h1 id="errorTitle"></h1><p class="muted" id="errorText"></p></div>
  <div id="trip">
    <h1 id="status">Loading…</h1>
    <div class="eta" id="eta"></div>
    <div class="card hidden" id="driverCard">
      <div class="avatar" id="avatar"></div>
      <div>
        <div><b id="driverName"></b> <span class="muted" id="rating"></span></div>
        <div class="muted" id="vehicle"></div>
        <div class="plate hidden" id="plate"></div>
      </div>
    </div>
    <ul class="route" id="route"></ul>
    <div class="foot" id="foot"></div>
  </div>
</div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
  integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script>
<script>
(function () {
  var token = location.pathname.split('/').filter(Boolean).pop();
  var api = location.origin + '/api/v1/share/' + encodeURIComponent(token);
  var map = null, carMarker = null, fitted = false, timer = null;

  function $(id) { return document.getElementById(id); }
  function text(id, value) { $(id).textContent = value || ''; }
  function show(id, on) { $(id).classList.toggle('hidden', !on); }

  function statusLine(t) {
    var who = t.rider || 'The rider';
    switch (t.status) {
      case 'scheduled': return 'Trip booked for ' + when(t.scheduledAt);
      case 'requested': return 'Looking for a driver';
      case 'accepted': return 'Driver is on the way to ' + who;
      case 'arrived': return 'Driver has arrived at the pickup';
      case 'started': return who + ' is on the way';
      case 'completed': return who + ' has arrived';
      case 'cancelled': return 'This trip was cancelled';
      case 'expired': return 'No driver was found';
      default: return t.status;
    }
  }
  function when(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleString([], { weekday:'short', hour:'2-digit', minute:'2-digit' });
  }
  function minutes(s) { var m = Math.max(1, Math.round(s / 60)); return m + ' min'; }

  function ensureMap(t) {
    if (map || !window.L) return;
    map = L.map('map', { zoomControl:false, attributionControl:false });
    // At the top: the sheet covers the bottom of the map.
    L.control.attribution({ position:'topright', prefix:false }).addTo(map);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);
    var pts = [t.pickup].concat(t.stops || [], [t.dropoff]);
    pts.forEach(function (p, i) {
      var last = i === pts.length - 1;
      L.circleMarker([p.lat, p.lng], {
        radius: 8, weight: 3, color: '#fff',
        fillColor: i === 0 ? '#0E9F6E' : last ? '#111827' : '#F59E0B', fillOpacity: 1
      }).addTo(map);
    });
    L.polyline(pts.map(function (p) { return [p.lat, p.lng]; }),
      { color:'#0E9F6E', weight:4, opacity:.6, dashArray:'6 8' }).addTo(map);
    map.fitBounds(L.latLngBounds(pts.map(function (p) { return [p.lat, p.lng]; })), { padding:[40, 40] });
  }

  function render(t) {
    ensureMap(t);
    text('status', statusLine(t));
    var eta = '';
    if (t.etaSeconds != null && t.status === 'accepted') eta = 'Arriving in about ' + minutes(t.etaSeconds);
    if (t.etaSeconds != null && t.status === 'started') eta = 'About ' + minutes(t.etaSeconds) + ' to the drop-off';
    text('eta', eta);

    var d = t.driver;
    show('driverCard', !!d);
    if (d) {
      text('avatar', (d.name || '?').charAt(0).toUpperCase());
      text('driverName', d.name || 'Driver');
      text('rating', d.rating && d.rating.count ? '★ ' + d.rating.average.toFixed(1) : '');
      var v = d.vehicle;
      text('vehicle', v ? [v.color, v.make, v.model].filter(Boolean).join(' ') : (t.vehicleType || ''));
      show('plate', !!(v && v.plateNumber));
      text('plate', v ? v.plateNumber : '');
    }

    var route = $('route');
    route.textContent = '';
    var rows = [['#0E9F6E', 'Pickup', t.pickup.address]];
    (t.stops || []).forEach(function (s, i) { rows.push(['#F59E0B', 'Stop ' + (i + 1), s.address]); });
    rows.push(['#111827', 'Drop-off', t.dropoff.address]);
    rows.forEach(function (r) {
      var li = document.createElement('li');
      var dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = r[0];
      var body = document.createElement('div');
      var label = document.createElement('div'); label.className = 'muted'; label.textContent = r[1];
      var addr = document.createElement('div'); addr.textContent = r[2];
      body.appendChild(label); body.appendChild(addr);
      li.appendChild(dot); li.appendChild(body); route.appendChild(li);
    });

    var loc = t.driverLocation;
    if (map && loc) {
      if (!carMarker) {
        carMarker = L.circleMarker([loc.lat, loc.lng], { radius: 10, weight: 4, color: '#fff', fillColor: '#2563EB', fillOpacity: 1 }).addTo(map);
      } else {
        carMarker.setLatLng([loc.lat, loc.lng]);
      }
      if (!fitted) { map.panTo([loc.lat, loc.lng]); fitted = true; }
    } else if (carMarker && map) {
      map.removeLayer(carMarker); carMarker = null;
    }
    text('foot', loc ? 'Live · updates every few seconds' : '');
    var done = ['completed', 'cancelled', 'expired'].indexOf(t.status) >= 0;
    if (done && timer) { clearInterval(timer); timer = null; }
  }

  function fail(title, msg) {
    show('trip', false); show('error', true);
    text('errorTitle', title); text('errorText', msg);
    if (timer) { clearInterval(timer); timer = null; }
  }

  function load() {
    fetch(api, { cache: 'no-store' }).then(function (res) {
      if (res.status === 404) return fail('Link not found', 'Check that the whole link was copied.');
      if (res.status === 410) return fail('This link has expired', 'The trip has ended or sharing was stopped.');
      if (!res.ok) return;
      return res.json().then(render);
    }).catch(function () { /* offline for a moment: try again on the next tick */ });
  }

  load();
  timer = setInterval(load, 5000);
})();
</script>
</body>
</html>`;

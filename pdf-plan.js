import * as pdfjsLib from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.2.108/build/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.2.108/build/pdf.worker.min.mjs';

const ATS_SERVICE = 'https://geospatial.alberta.ca/titan/rest/services/base/alberta_township_system/MapServer';
const DEFAULT_CENTER = [54.5, -115.0];

const state = {
  mode: 'shape',
  pdf: null,
  pdfText: '',
  map: null,
  drawn: null,
  candidate: null,
  atsLayer: null,
  atsEnabled: true,
  confirmed: false,
  detected: {},
  currentFile: null,
};

const $ = (id) => document.getElementById(id);

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if ([...document.scripts].some((s) => s.src === src)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(s);
  });
}

function loadCss(href) {
  if ([...document.styleSheets].some((s) => s.href === href)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

async function loadMappingLibraries() {
  loadCss('https://unpkg.com/leaflet@1.9.4/dist/leaflet.css');
  loadCss('https://unpkg.com/leaflet-draw@1.0.4/dist/leaflet.draw.css');
  await loadScript('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js');
  await loadScript('https://unpkg.com/leaflet-draw@1.0.4/dist/leaflet.draw.js');
  await loadScript('https://unpkg.com/@mapbox/shp-write@0.4.3/shpwrite.js');
}

function waitForApp() {
  return new Promise((resolve) => {
    const check = () => {
      const hero = document.querySelector('#root .hero');
      const workspace = document.querySelector('#root .workspace');
      if (hero && workspace) return resolve({ hero, workspace });
      requestAnimationFrame(check);
    };
    check();
  });
}

function injectUi(hero, workspace) {
  if ($('pdfPlanMode')) return;
  const shell = document.createElement('section');
  shell.id = 'pdfPlanMode';
  shell.className = 'pdf-plan-shell';
  shell.innerHTML = `
    <div class="source-switch" role="group" aria-label="Choose starting file type">
      <button type="button" class="source-tab active" id="sourceShape">Shapefile ZIP</button>
      <button type="button" class="source-tab" id="sourcePdf">Survey Plan PDF</button>
    </div>

    <div class="pdf-workspace hidden" id="pdfWorkspace">
      <div class="pdf-intro">
        <div>
          <div class="pdf-kicker">PDF plan beta</div>
          <h2>Turn a survey plan into a map-confirmed boundary.</h2>
          <p>The tool reads usable PDF text and coordinates when available, creates a starting boundary, and requires you to confirm the shape and location on the map before it can continue into the LAT / OneStop converter.</p>
        </div>
        <div class="pdf-confidence" id="pdfConfidence">Waiting for a PDF</div>
      </div>

      <div class="pdf-grid">
        <section class="pdf-card">
          <div class="pdf-step">01 &nbsp; Upload plan</div>
          <input id="planPdfInput" type="file" accept="application/pdf,.pdf" hidden>
          <label class="pdf-drop" id="planPdfDrop" for="planPdfInput">
            <span class="pdf-upload-arrow">↑</span>
            <strong id="planPdfName">Drop a survey plan PDF here or click to browse</strong>
            <span>Digital/vector plans work best. Flattened plans can still be positioned using the legal location and map.</span>
          </label>
          <div class="pdf-status" id="pdfStatus">No PDF loaded.</div>
          <div class="pdf-preview-wrap hidden" id="pdfPreviewWrap">
            <canvas id="pdfCanvas"></canvas>
          </div>
        </section>

        <section class="pdf-card">
          <div class="pdf-step">02 &nbsp; Plan information</div>
          <div class="detected-box" id="detectedBox">Upload a PDF to detect coordinates and legal-location text.</div>
          <div class="pdf-fields">
            <label>Legal location
              <input id="legalInput" type="text" placeholder="11-15-73-17-W4M">
            </label>
            <div class="pdf-two">
              <label>Latitude
                <input id="latInput" type="number" step="any" placeholder="56.958842">
              </label>
              <label>Longitude
                <input id="lonInput" type="number" step="any" placeholder="-111.819941">
              </label>
            </div>
            <div class="pdf-two">
              <label>Width (m)
                <input id="widthInput" type="number" min="1" step="0.1" placeholder="150">
              </label>
              <label>Height (m)
                <input id="heightInput" type="number" min="1" step="0.1" placeholder="150">
              </label>
            </div>
            <label>Rotation clockwise from north (°)
              <input id="rotationInput" type="number" step="0.1" value="0">
            </label>
          </div>
          <div class="pdf-button-row">
            <button type="button" class="pdf-secondary" id="locatePlan">Locate on map</button>
            <button type="button" class="pdf-secondary" id="applyRectangle">Build / reset rectangle</button>
          </div>
          <p class="pdf-help">If the PDF does not contain extractable text, enter the legal location and dimensions shown on the plan. You can then edit or redraw the polygon directly on the map.</p>
        </section>
      </div>

      <section class="pdf-card map-card">
        <div class="map-head">
          <div>
            <div class="pdf-step">03 &nbsp; Confirm boundary on map</div>
            <h3>Verify the proposed boundary before continuing.</h3>
            <p>Use the satellite or street basemap, ATS grid, and editing tools. Any geometry change clears the confirmation.</p>
          </div>
          <div class="map-actions">
            <button type="button" class="pdf-secondary" id="toggleAts">ATS grid: on</button>
            <button type="button" class="pdf-secondary" id="fitBoundary">Fit boundary</button>
          </div>
        </div>
        <div id="planMap" class="plan-map"></div>
        <div class="map-bottom">
          <div class="boundary-summary" id="boundarySummary">No boundary has been created yet.</div>
          <button type="button" class="confirm-button" id="confirmBoundary" disabled>Confirm location and boundary</button>
        </div>
      </section>

      <section class="pdf-card continue-card">
        <div>
          <div class="pdf-step">04 &nbsp; Continue to submission setup</div>
          <h3 id="continueTitle">Confirm the boundary to continue.</h3>
          <p>The confirmed polygon will be packaged as a temporary source shapefile and loaded into the existing converter. You can then choose LAT or OneStop / EDPT and create the final submission ZIP.</p>
        </div>
        <button type="button" class="continue-button" id="continueWithBoundary" disabled>Use confirmed boundary in converter →</button>
      </section>
    </div>
  `;
  hero.insertAdjacentElement('afterend', shell);

  $('sourceShape').addEventListener('click', () => setMode('shape', workspace));
  $('sourcePdf').addEventListener('click', () => setMode('pdf', workspace));
  $('planPdfInput').addEventListener('change', (e) => handlePdf(e.target.files?.[0]));
  $('locatePlan').addEventListener('click', locateFromFields);
  $('applyRectangle').addEventListener('click', buildRectangleFromFields);
  $('toggleAts').addEventListener('click', toggleAts);
  $('fitBoundary').addEventListener('click', fitBoundary);
  $('confirmBoundary').addEventListener('click', confirmBoundary);
  $('continueWithBoundary').addEventListener('click', () => continueToConverter(workspace));

  ['legalInput','latInput','lonInput','widthInput','heightInput','rotationInput'].forEach((id) => {
    $(id).addEventListener('input', invalidateConfirmation);
  });
}

function setMode(mode, workspace) {
  state.mode = mode;
  const pdf = mode === 'pdf';
  $('sourcePdf').classList.toggle('active', pdf);
  $('sourceShape').classList.toggle('active', !pdf);
  $('pdfWorkspace').classList.toggle('hidden', !pdf);
  workspace.classList.toggle('pdf-hidden', pdf);
  if (pdf) {
    ensureMap().then(() => setTimeout(() => state.map.invalidateSize(), 60));
  }
}

async function ensureMap() {
  if (state.map) return;
  await loadMappingLibraries();
  const L = window.L;
  state.map = L.map('planMap', { zoomControl: true }).setView(DEFAULT_CENTER, 5);
  const imagery = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 20,
    attribution: 'Tiles © Esri'
  }).addTo(state.map);
  const streets = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap contributors'
  });
  L.control.layers({ 'Satellite': imagery, 'Street map': streets }, null, { collapsed: false }).addTo(state.map);

  state.drawn = new L.FeatureGroup().addTo(state.map);
  const drawControl = new L.Control.Draw({
    position: 'topleft',
    draw: {
      polyline: false,
      circle: false,
      circlemarker: false,
      marker: false,
      polygon: { allowIntersection: false, showArea: true },
      rectangle: { showArea: true }
    },
    edit: { featureGroup: state.drawn, remove: true }
  });
  state.map.addControl(drawControl);

  state.map.on(L.Draw.Event.CREATED, (e) => {
    replaceBoundary(e.layer);
  });
  state.map.on(L.Draw.Event.EDITED, () => {
    state.candidate = firstBoundaryLayer();
    invalidateConfirmation();
    updateBoundarySummary();
  });
  state.map.on(L.Draw.Event.DELETED, () => {
    state.candidate = firstBoundaryLayer();
    invalidateConfirmation();
    updateBoundarySummary();
  });
  state.map.on('moveend', () => {
    if (state.atsEnabled) refreshAtsGrid();
  });
  refreshAtsGrid();
}

async function handlePdf(file) {
  if (!file) return;
  state.currentFile = file;
  state.confirmed = false;
  $('planPdfName').textContent = file.name;
  $('pdfStatus').textContent = 'Reading PDF…';
  $('pdfConfidence').textContent = 'Analyzing plan';
  try {
    const data = new Uint8Array(await file.arrayBuffer());
    const doc = await pdfjsLib.getDocument({ data }).promise;
    state.pdf = doc;
    let text = '';
    for (let i = 1; i <= doc.numPages; i += 1) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      text += ' ' + tc.items.map((item) => item.str).join(' ');
      if (i === 1) await renderPage(page);
    }
    state.pdfText = text.replace(/\s+/g, ' ').trim();
    state.detected = detectPlanInfo(state.pdfText);
    applyDetectedFields(state.detected);
    renderDetectedInfo(state.detected, doc.numPages);
    $('pdfStatus').textContent = state.pdfText.length > 40
      ? `Loaded ${doc.numPages} page${doc.numPages === 1 ? '' : 's'} with extractable plan text.`
      : `Loaded ${doc.numPages} page${doc.numPages === 1 ? '' : 's'}. Little or no extractable text was found, so use the plan information fields to position it.`;
    $('pdfConfidence').textContent = confidenceLabel(state.detected);
    await ensureMap();
    await locateFromFields();
    if (numberValue('widthInput') && numberValue('heightInput')) buildRectangleFromFields();
  } catch (err) {
    console.error(err);
    $('pdfStatus').textContent = `The PDF could not be read: ${err.message || err}`;
    $('pdfConfidence').textContent = 'PDF read failed';
  }
}

async function renderPage(page) {
  const canvas = $('pdfCanvas');
  const wrap = $('pdfPreviewWrap');
  const base = page.getViewport({ scale: 1 });
  const targetWidth = Math.min(760, Math.max(420, wrap.parentElement.clientWidth - 40));
  const scale = targetWidth / base.width;
  const viewport = page.getViewport({ scale });
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  wrap.classList.remove('hidden');
}

function detectPlanInfo(text) {
  const result = { textLength: text.length };
  if (!text) return result;

  const lat = text.match(/LATITUDE\s*:?\s*(\d{2}\.\d{4,})/i);
  const lon = text.match(/LONGITUDE\s*:?\s*(-?\d{3}\.\d{4,})/i);
  if (lat && lon) {
    result.lat = Number(lat[1]);
    result.lon = Number(lon[1]);
  }

  if (result.lat == null || result.lon == null) {
    const geo = text.match(/(\d{2})[°\s]+(\d{1,2})['’\s]+(\d{1,2}(?:\.\d+)?)\s*["”]?\s*N[^0-9]{0,40}(\d{3})[°\s]+(\d{1,2})['’\s]+(\d{1,2}(?:\.\d+)?)\s*["”]?\s*W/i);
    if (geo) {
      result.lat = dmsToDecimal(Number(geo[1]), Number(geo[2]), Number(geo[3]), false);
      result.lon = dmsToDecimal(Number(geo[4]), Number(geo[5]), Number(geo[6]), true);
    }
  }

  const lsdPatterns = [
    /\b(?:LSD\s*)?(\d{1,2})[-\s]+(\d{1,2})[-\s]+(\d{1,3})[-\s]+(\d{1,2})\s*W\s*([456])\s*M?\b/i,
    /\b(\d{1,2})[-\s]+(\d{1,2})[-\s]+(\d{1,3})[-\s]+(\d{1,2})[-\s]*([456])\b/i,
  ];
  for (const re of lsdPatterns) {
    const m = text.match(re);
    if (m) {
      result.legal = `${Number(m[1])}-${Number(m[2])}-${Number(m[3])}-${Number(m[4])}-W${Number(m[5])}M`;
      break;
    }
  }

  const dims = [...text.matchAll(/\b(\d{2,3}(?:\.\d{1,2})?)\s*(?:m|metres)?\b/gi)]
    .map((m) => Number(m[1]))
    .filter((v) => v >= 20 && v <= 500);
  if (dims.length) {
    const counts = new Map();
    dims.forEach((v) => counts.set(v, (counts.get(v) || 0) + 1));
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
    if (ranked[0]?.[1] >= 2) {
      result.width = ranked[0][0];
      result.height = ranked[0][0];
    }
  }

  return result;
}

function dmsToDecimal(d, m, s, west) {
  const value = d + m / 60 + s / 3600;
  return west ? -value : value;
}

function applyDetectedFields(info) {
  if (info.legal) $('legalInput').value = info.legal;
  if (Number.isFinite(info.lat)) $('latInput').value = info.lat.toFixed(7);
  if (Number.isFinite(info.lon)) $('lonInput').value = info.lon.toFixed(7);
  if (Number.isFinite(info.width)) $('widthInput').value = String(info.width);
  if (Number.isFinite(info.height)) $('heightInput').value = String(info.height);
}

function renderDetectedInfo(info, pages) {
  const found = [];
  if (info.legal) found.push(`<strong>Legal location:</strong> ${escapeHtml(info.legal)}`);
  if (Number.isFinite(info.lat) && Number.isFinite(info.lon)) found.push(`<strong>Coordinate:</strong> ${info.lat.toFixed(6)}, ${info.lon.toFixed(6)}`);
  if (Number.isFinite(info.width) && Number.isFinite(info.height)) found.push(`<strong>Likely dimensions:</strong> ${info.width} m × ${info.height} m`);
  if (!found.length) {
    $('detectedBox').innerHTML = `<strong>No reliable spatial text was detected.</strong><br>This is common with flattened survey PDFs. Enter the legal location and dimensions from the plan, then verify the result on the map.`;
    return;
  }
  $('detectedBox').innerHTML = `<strong>Detected from PDF (${pages} page${pages === 1 ? '' : 's'}):</strong><br>${found.join('<br>')}<br><span class="detected-note">These values are a starting point only. Map confirmation is still required.</span>`;
}

function confidenceLabel(info) {
  if (Number.isFinite(info.lat) && Number.isFinite(info.lon) && info.legal) return 'Good spatial anchors found';
  if (Number.isFinite(info.lat) && Number.isFinite(info.lon)) return 'Coordinate found';
  if (info.legal) return 'Legal location found';
  return 'Manual positioning required';
}

function parseLegal(raw) {
  const s = String(raw || '').trim().toUpperCase().replace(/[–—]/g, '-').replace(/\s+/g, '');
  let m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{1,3})-(\d{1,2})-?W?([456])M?$/);
  if (m) return { ls: +m[1], sec: +m[2], twp: +m[3], rge: +m[4], mer: +m[5], level: 'lsd' };
  m = s.match(/^(?:SEC-?)?(\d{1,2})-(\d{1,3})-(\d{1,2})-?W?([456])M?$/);
  if (m) return { sec: +m[1], twp: +m[2], rge: +m[3], mer: +m[4], level: 'section' };
  return null;
}

async function locateFromFields() {
  await ensureMap();
  const lat = numberValue('latInput');
  const lon = numberValue('lonInput');
  if (validLatLon(lat, lon)) {
    state.map.setView([lat, lon], 17);
    if (!state.candidate && numberValue('widthInput') && numberValue('heightInput')) buildRectangleFromFields();
    if (state.atsEnabled) refreshAtsGrid();
    return [lat, lon];
  }

  const legal = parseLegal($('legalInput').value);
  if (!legal) {
    setPdfStatus('Enter a valid latitude/longitude or Alberta legal location such as 11-15-73-17-W4M.');
    return null;
  }
  try {
    setPdfStatus('Locating the legal land description using the Alberta Township System…');
    const feature = await queryAtsLegal(legal);
    const center = geojsonCenter(feature.geometry);
    $('latInput').value = center[1].toFixed(7);
    $('lonInput').value = center[0].toFixed(7);
    state.map.fitBounds(window.L.geoJSON(feature).getBounds(), { padding: [30, 30], maxZoom: 17 });
    setPdfStatus('Legal location found. Use the map and plan to adjust the proposed boundary before confirming.');
    if (!state.candidate && numberValue('widthInput') && numberValue('heightInput')) buildRectangleFromFields();
    if (state.atsEnabled) refreshAtsGrid();
    return [center[1], center[0]];
  } catch (err) {
    setPdfStatus(err.message || 'The legal location could not be found.');
    return null;
  }
}

async function queryAtsLegal(legal) {
  const layer = legal.level === 'lsd' ? 20 : 15;
  const clauses = [`M=${legal.mer}`, `RGE=${legal.rge}`, `TWP=${legal.twp}`, `SEC=${legal.sec}`];
  if (legal.level === 'lsd') clauses.push(`LS=${legal.ls}`);
  const p = new URLSearchParams({
    where: clauses.join(' AND '),
    outFields: 'M,RGE,TWP,SEC,LS,QS,DESCRIPTOR',
    returnGeometry: 'true',
    outSR: '4326',
    f: 'geojson',
    resultRecordCount: '20',
  });
  const res = await fetch(`${ATS_SERVICE}/${layer}/query?${p}`);
  if (!res.ok) throw new Error(`ATS service returned ${res.status}.`);
  const data = await res.json();
  if (!data.features?.length) throw new Error('No matching ATS parcel was found. Check the legal location.');
  return data.features[0];
}

function geojsonCenter(geometry) {
  const coords = [];
  collectCoordinates(geometry.coordinates, coords);
  const xs = coords.map((p) => p[0]);
  const ys = coords.map((p) => p[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}

function collectCoordinates(value, out) {
  if (!Array.isArray(value)) return;
  if (typeof value[0] === 'number' && typeof value[1] === 'number') out.push(value);
  else value.forEach((v) => collectCoordinates(v, out));
}

function buildRectangleFromFields() {
  ensureMap().then(async () => {
    let lat = numberValue('latInput');
    let lon = numberValue('lonInput');
    const width = numberValue('widthInput');
    const height = numberValue('heightInput');
    const rotation = numberValue('rotationInput') || 0;
    if (!validLatLon(lat, lon)) {
      const found = await locateFromFields();
      if (!found) return;
      [lat, lon] = found;
    }
    if (!(width > 0 && height > 0)) {
      setPdfStatus('Enter the plan width and height in metres before building the rectangle.');
      return;
    }
    const corners = rectangleCorners(lat, lon, width, height, rotation);
    const layer = window.L.polygon(corners, { color: '#2463a0', weight: 3, fillOpacity: 0.18 });
    replaceBoundary(layer);
    state.map.fitBounds(layer.getBounds(), { padding: [60, 60], maxZoom: 18 });
    setPdfStatus('Starting boundary created. Edit or redraw it on the map, then confirm the location and shape.');
  });
}

function rectangleCorners(lat, lon, width, height, rotationDeg) {
  const hw = width / 2;
  const hh = height / 2;
  const theta = rotationDeg * Math.PI / 180;
  const local = [[-hw, hh], [hw, hh], [hw, -hh], [-hw, -hh]];
  return local.map(([east, north]) => {
    const e = east * Math.cos(theta) + north * Math.sin(theta);
    const n = -east * Math.sin(theta) + north * Math.cos(theta);
    return offsetLatLon(lat, lon, e, n);
  });
}

function offsetLatLon(lat, lon, eastM, northM) {
  const r = 6378137;
  const dLat = northM / r;
  const dLon = eastM / (r * Math.cos(lat * Math.PI / 180));
  return [lat + dLat * 180 / Math.PI, lon + dLon * 180 / Math.PI];
}

function replaceBoundary(layer) {
  state.drawn.clearLayers();
  state.drawn.addLayer(layer);
  state.candidate = layer;
  invalidateConfirmation();
  updateBoundarySummary();
}

function firstBoundaryLayer() {
  let layer = null;
  state.drawn.eachLayer((l) => { if (!layer) layer = l; });
  return layer;
}

function updateBoundarySummary() {
  const layer = state.candidate || firstBoundaryLayer();
  if (!layer) {
    $('boundarySummary').textContent = 'No boundary has been created yet.';
    $('confirmBoundary').disabled = true;
    return;
  }
  const gj = layer.toGeoJSON();
  const ring = gj.geometry.type === 'Polygon' ? gj.geometry.coordinates[0] : null;
  const area = ring ? polygonAreaApprox(ring) : null;
  const center = layer.getBounds().getCenter();
  $('boundarySummary').innerHTML = `<strong>Boundary ready for review.</strong> ${area ? `Approx. ${area.toLocaleString(undefined, { maximumFractionDigits: 0 })} m². ` : ''}Map centre ${center.lat.toFixed(6)}, ${center.lng.toFixed(6)}.`;
  $('confirmBoundary').disabled = false;
}

function polygonAreaApprox(ring) {
  if (!ring?.length) return 0;
  const lat0 = ring.reduce((s, p) => s + p[1], 0) / ring.length * Math.PI / 180;
  const r = 6378137;
  const xy = ring.map(([lon, lat]) => [lon * Math.PI / 180 * r * Math.cos(lat0), lat * Math.PI / 180 * r]);
  let area = 0;
  for (let i = 0, j = xy.length - 1; i < xy.length; j = i++) area += xy[j][0] * xy[i][1] - xy[i][0] * xy[j][1];
  return Math.abs(area) / 2;
}

function confirmBoundary() {
  const layer = state.candidate || firstBoundaryLayer();
  if (!layer) return;
  state.confirmed = true;
  $('confirmBoundary').textContent = '✓ Location and boundary confirmed';
  $('confirmBoundary').classList.add('confirmed');
  $('continueWithBoundary').disabled = false;
  $('continueTitle').textContent = 'Boundary confirmed. Continue to LAT / OneStop setup.';
  $('boundarySummary').innerHTML = `<strong>Confirmed.</strong> Any further map edit will require confirmation again.`;
}

function invalidateConfirmation() {
  state.confirmed = false;
  if (!$('confirmBoundary')) return;
  $('confirmBoundary').textContent = 'Confirm location and boundary';
  $('confirmBoundary').classList.remove('confirmed');
  $('continueWithBoundary').disabled = true;
  $('continueTitle').textContent = 'Confirm the boundary to continue.';
  if (state.candidate || firstBoundaryLayer()) $('confirmBoundary').disabled = false;
}

async function continueToConverter(workspace) {
  if (!state.confirmed) return;
  const layer = state.candidate || firstBoundaryLayer();
  if (!layer) return;
  try {
    const geo = layer.toGeoJSON();
    const fc = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: geo.geometry,
        properties: { SOURCE: 'PDF_PLAN', CONFIRMED: 'YES' }
      }]
    };
    const zipData = window.shpwrite.zip(fc, {
      folder: 'PDF_Plan_Boundary',
      filename: 'PDF_Plan_Boundary',
      outputType: 'arraybuffer',
      compression: 'STORE'
    });
    const payload = zipData instanceof Promise ? await zipData : zipData;
    const blob = payload instanceof Blob ? payload : new Blob([payload], { type: 'application/zip' });
    const file = new File([blob], 'PDF_Plan_Boundary.zip', { type: 'application/zip' });
    const input = document.querySelector('#root input[type="file"][accept*=".zip"]');
    if (!input) throw new Error('The submission converter upload control was not found.');
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    setMode('shape', workspace);
    workspace.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    console.error(err);
    setPdfStatus(`The confirmed boundary could not be passed to the converter: ${err.message || err}`);
  }
}

async function toggleAts() {
  await ensureMap();
  state.atsEnabled = !state.atsEnabled;
  $('toggleAts').textContent = `ATS grid: ${state.atsEnabled ? 'on' : 'off'}`;
  if (!state.atsEnabled) {
    if (state.atsLayer) state.atsLayer.clearLayers();
    return;
  }
  refreshAtsGrid();
}

async function refreshAtsGrid() {
  if (!state.map || !state.atsEnabled || state.map.getZoom() < 11) {
    if (state.atsLayer) state.atsLayer.clearLayers();
    return;
  }
  const b = state.map.getBounds();
  const envelope = `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`;
  const p = new URLSearchParams({
    where: '1=1',
    geometry: envelope,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'M,RGE,TWP,SEC,LS,QS,DESCRIPTOR',
    returnGeometry: 'true',
    outSR: '4326',
    f: 'geojson',
    resultRecordCount: '800'
  });
  try {
    const res = await fetch(`${ATS_SERVICE}/20/query?${p}`);
    if (!res.ok) return;
    const data = await res.json();
    if (state.atsLayer) state.atsLayer.clearLayers();
    else state.atsLayer = window.L.geoJSON(null, {
      style: { color: '#6b7f91', weight: 1, fillOpacity: 0 },
      onEachFeature: (feature, layer) => {
        const a = feature.properties || {};
        layer.bindTooltip(`LSD ${a.LS}, Sec. ${a.SEC}-${a.TWP}-${a.RGE}-W${a.M}M`, { sticky: true });
      }
    }).addTo(state.map);
    state.atsLayer.addData(data);
    state.atsLayer.bringToBack();
  } catch {
    // The map remains usable if the public ATS service is temporarily unavailable.
  }
}

function fitBoundary() {
  const layer = state.candidate || firstBoundaryLayer();
  if (layer && state.map) state.map.fitBounds(layer.getBounds(), { padding: [50, 50], maxZoom: 18 });
}

function numberValue(id) {
  const v = Number($(id).value);
  return Number.isFinite(v) ? v : null;
}

function validLatLon(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= 48 && lat <= 61 && lon >= -121 && lon <= -109;
}

function setPdfStatus(text) {
  $('pdfStatus').textContent = text;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
}

(async () => {
  const { hero, workspace } = await waitForApp();
  injectUi(hero, workspace);
})();

import { Camera, findConfig } from './camera.js';

const $ = id => document.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- saved preferences ---------- */

const PREF_DEFAULTS = {
  grid: false,
  peaking: false,
  afBeforeShot: true,
  // Tap to focus sends coordinates in the camera's own live view space. For the D7100 that should be
  // the sensor size; if taps land in the wrong spot, change it in Settings → This app.
  afSpace: '6000x4000',
  mfSmall: 50,
  mfLarge: 400,
};
const prefs = { ...PREF_DEFAULTS };
try { Object.assign(prefs, JSON.parse(localStorage.getItem('mirrorup-prefs') || '{}')); } catch {}
function savePrefs() {
  try { localStorage.setItem('mirrorup-prefs', JSON.stringify(prefs)); } catch {}
}

/* ---------- state ---------- */

const camera = new Camera();
const state = {
  config: null,
  live: true,          // the user wants live view running
  busy: false,         // a capture is in progress
  openChip: null,
  lastShot: null,      // { file, url }
  wakeLock: null,
  refreshTimer: 0,
};

/* Settings shown as chips under the picture. The first name the camera actually has wins. */
const QUICK = [
  { label: 'Shutter', names: ['shutterspeed2', 'shutterspeed'] },
  { label: 'Aperture', names: ['f-number', 'aperture'] },
  { label: 'ISO', names: ['iso'] },
  { label: 'EV', names: ['exposurecompensation'], format: signed },
  { label: 'WB', names: ['whitebalance'] },
  { label: 'Focus', names: ['focusmode2', 'focusmode'] },
  { label: 'Quality', names: ['imagequality'] },
];

function signed(v) {
  const n = parseFloat(v);
  if (Number.isNaN(n)) return v;
  const r = Math.round(n * 10) / 10;
  return (r > 0 ? '+' : '') + r.toFixed(1);
}

/* ---------- small ui helpers ---------- */

let toastTimer = 0;
function toast(msg, ms = 3000) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

function errText(e) {
  const msg = (e && e.message) || String(e);
  return msg.replace(/^Error:\s*/, '');
}

function setSplashStatus(msg) {
  $('splashStatus').textContent = msg;
}

function el(tag, props = {}, ...kids) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...kids);
  return node;
}

/* ---------- connect / disconnect ---------- */

async function connect() {
  const btn = $('connectBtn');
  btn.disabled = true;
  try {
    if (!(await Camera.alreadyAllowed())) await Camera.pick();
    setSplashStatus('Talking to the camera…');
    await camera.connect();
    state.config = await camera.config();
    enterLive();
  } catch (e) {
    await camera.disconnect();
    if (e && e.name === 'NotFoundError') {
      setSplashStatus('No camera picked. Is it switched on and plugged in?');
    } else {
      setSplashStatus(`Could not connect: ${errText(e)}. Unplug the cable, plug it back in, dismiss any Android popup and try again.`);
    }
  } finally {
    btn.disabled = false;
  }
}

function enterLive() {
  $('app').dataset.state = 'live';
  $('splash').hidden = true;
  $('frame').hidden = false;
  $('hud').hidden = false;
  $('panel').hidden = false;
  setSplashStatus('');
  state.live = true;
  renderAll();
  layoutFrame();
  holdWakeLock();
  runLoop();
}

async function leaveLive(message) {
  if ($('app').dataset.state === 'splash') return;
  $('app').dataset.state = 'splash';
  $('splash').hidden = false;
  $('frame').hidden = true;
  $('hud').hidden = true;
  $('panel').hidden = true;
  $('sheet').hidden = true;
  closePicker();
  releaseWakeLock();
  setSplashStatus(message || '');
  await camera.disconnect();
}

/* ---------- the main loop: frames, plus a regular check for changes made on the camera ---------- */

const view = $('view');
const ctx = view.getContext('2d', { willReadFrequently: true });
let loopRunning = false;

async function runLoop() {
  if (loopRunning) return;
  loopRunning = true;
  let failures = 0;
  let lastEvents = 0;
  let frames = 0;
  let fpsSince = performance.now();

  while (camera.connected) {
    const wantFrames = state.live && !state.busy && !document.hidden;
    try {
      if (wantFrames) {
        const blob = await camera.previewFrame();
        const bitmap = await createImageBitmap(blob);
        drawFrame(bitmap);
        bitmap.close();
        failures = 0;
        frames++;
      } else {
        await sleep(250);
      }

      const now = performance.now();
      if (now - fpsSince >= 1000) {
        $('hudFps').textContent = wantFrames ? `${Math.round(frames * 1000 / (now - fpsSince))} fps` : '';
        frames = 0;
        fpsSince = now;
      }
      if (!state.busy && now - lastEvents > 1500) {
        lastEvents = now;
        if (await camera.events()) scheduleRefresh(0);
      }
    } catch (e) {
      if (!camera.connected) break;
      failures++;
      if (failures >= 8) {
        loopRunning = false;
        leaveLive(`Lost the camera: ${errText(e)}`);
        return;
      }
      await sleep(300);
    }
  }
  loopRunning = false;
}

function drawFrame(bitmap) {
  if (view.width !== bitmap.width || view.height !== bitmap.height) {
    view.width = bitmap.width;
    view.height = bitmap.height;
    layoutFrame();
  }
  ctx.drawImage(bitmap, 0, 0);
  if (prefs.peaking) drawPeaking();
}

/* Focus peaking: paint strong edges hot pink. Sharp areas have the hardest edges, so they light up. */
function drawPeaking() {
  const { width: w, height: h } = view;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const lum = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < lum.length; i++, p += 4) {
    lum[i] = (d[p] * 77 + d[p + 1] * 150 + d[p + 2] * 29) >> 8;
  }
  const THRESHOLD = 48;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = lum[i + 1] - lum[i - 1];
      const gy = lum[i + w] - lum[i - w];
      if (Math.abs(gx) + Math.abs(gy) > THRESHOLD) {
        const p = i * 4;
        d[p] = 255; d[p + 1] = 45; d[p + 2] = 150;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

/* Fit the picture inside the stage, keeping its shape. Overlays are children of the frame, so they follow. */
function layoutFrame() {
  const stage = $('stage').getBoundingClientRect();
  if (!stage.width || !stage.height) return;
  // In portrait the top bar sits above the picture and takes its own room; in landscape it floats over it.
  const hud = $('hud');
  const room = stage.height - (getComputedStyle(hud).position === 'absolute' ? 0 : hud.offsetHeight);
  const ratio = view.width / view.height;
  let w = stage.width;
  let h = w / ratio;
  if (h > room) {
    h = room;
    w = h * ratio;
  }
  const frame = $('frame');
  frame.style.width = `${Math.floor(w)}px`;
  frame.style.height = `${Math.floor(h)}px`;
}

/* ---------- config: read, show, change ---------- */

function scheduleRefresh(delay = 1200) {
  clearTimeout(state.refreshTimer);
  state.refreshTimer = setTimeout(refreshConfig, delay);
}

async function refreshConfig() {
  if (!camera.connected) return;
  try {
    state.config = await camera.config();
    renderAll();
  } catch (e) {
    console.warn('config refresh failed', e);
  }
}

function quickConfig(quick) {
  for (const name of quick.names) {
    const cfg = findConfig(state.config, name);
    if (cfg && Array.isArray(cfg.choices) && cfg.choices.length) return cfg;
  }
  return null;
}

function renderAll() {
  renderHud();
  renderChips();
  if (state.openChip) renderPicker();
}

function renderHud() {
  const mode = findConfig(state.config, 'expprogram');
  $('hudMode').textContent = mode ? mode.value : '–';
  const battery = findConfig(state.config, 'batterylevel');
  $('hudBattery').textContent = battery ? `BAT ${battery.value}` : '';
  $('gridBtn').setAttribute('aria-pressed', prefs.grid);
  $('peakBtn').setAttribute('aria-pressed', prefs.peaking);
  $('liveBtn').setAttribute('aria-pressed', state.live);
  $('grid').hidden = !prefs.grid;
  $('pausedNote').hidden = state.live;
}

function renderChips() {
  const box = $('chips');
  const scroll = box.scrollLeft;
  box.textContent = '';
  for (const quick of QUICK) {
    const cfg = quickConfig(quick);
    if (!cfg) continue;
    const value = quick.format ? quick.format(cfg.value) : cfg.value;
    const chip = el('button', { className: 'chip' },
      el('span', { className: 'chip-label', textContent: quick.label }),
      el('span', { className: 'chip-value', textContent: value }));
    chip.setAttribute('aria-expanded', state.openChip === quick);
    chip.disabled = cfg.readonly;
    chip.addEventListener('click', () => {
      state.openChip = state.openChip === quick ? null : quick;
      renderChips();
      renderPicker();
    });
    box.append(chip);
  }
  box.scrollLeft = scroll;
}

function closePicker() {
  state.openChip = null;
  $('picker').hidden = true;
}

function renderPicker() {
  const box = $('picker');
  const quick = state.openChip;
  const cfg = quick && quickConfig(quick);
  if (!cfg) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  box.textContent = '';
  let current = null;
  for (const choice of cfg.choices) {
    const btn = el('button', { className: 'choice', textContent: quick.format ? quick.format(choice) : choice });
    if (choice === cfg.value) {
      btn.classList.add('current');
      current = btn;
    }
    btn.addEventListener('click', () => changeSetting(cfg, choice));
    box.append(btn);
  }
  if (current) current.scrollIntoView({ inline: 'center', block: 'nearest' });
}

async function changeSetting(cfg, value) {
  const before = cfg.value;
  cfg.value = value;      // show it straight away, the camera confirms a moment later
  renderAll();
  try {
    await camera.set(cfg.name, value);
  } catch (e) {
    cfg.value = before;
    renderAll();
    toast(`${cfg.label}: ${errText(e)}`);
  }
  scheduleRefresh();
}

/* ---------- focus ---------- */

function focusIsManual() {
  const cfg = findConfig(state.config, 'focusmode2') || findConfig(state.config, 'focusmode');
  return !!cfg && /^M/i.test(String(cfg.value));
}

let markTimer = 0;
function hideMarkSoon() {
  clearTimeout(markTimer);
  markTimer = setTimeout(() => { $('afMark').hidden = true; }, 1200);
}

async function autofocus() {
  const mark = $('afMark');
  try {
    await camera.set('autofocusdrive', true);
    mark.dataset.result = 'ok';
    return true;
  } catch (e) {
    mark.dataset.result = 'fail';
    toast(`Autofocus: ${errText(e)}`);
    return false;
  } finally {
    hideMarkSoon();
  }
}

async function tapToFocus(ev) {
  if (state.busy || !state.live) return;
  const rect = $('frame').getBoundingClientRect();
  const rx = (ev.clientX - rect.left) / rect.width;
  const ry = (ev.clientY - rect.top) / rect.height;
  if (rx < 0 || rx > 1 || ry < 0 || ry > 1) return;

  const mark = $('afMark');
  mark.style.left = `${rx * 100}%`;
  mark.style.top = `${ry * 100}%`;
  mark.dataset.result = '';
  mark.hidden = false;

  const [spaceW, spaceH] = prefs.afSpace.split('x').map(Number);
  const x = Math.round(rx * (spaceW || 6000));
  const y = Math.round(ry * (spaceH || 4000));
  try {
    await camera.set('changeafarea', `${x}x${y}`);
  } catch (e) {
    mark.dataset.result = 'fail';
    hideMarkSoon();
    toast(`Move focus point: ${errText(e)}`);
    return;
  }
  if (!focusIsManual()) await autofocus();
  else hideMarkSoon();
}

async function nudgeFocus(code) {
  const size = code.endsWith('large') ? prefs.mfLarge : prefs.mfSmall;
  const steps = (code.startsWith('-') ? -1 : 1) * Number(size);
  try {
    await camera.set('manualfocusdrive', steps);
  } catch (e) {
    toast(`Focus step: ${errText(e)}`);
  }
}

/* ---------- taking a photo ---------- */

async function shoot() {
  if (state.busy) return;
  state.busy = true;
  $('shutterBtn').classList.add('busy');
  try {
    if (prefs.afBeforeShot && state.live && !focusIsManual()) {
      try { await camera.set('autofocusdrive', true); } catch {}   // shoot anyway, like a half press that gave up
    }
    const file = await camera.capture();
    keepShot(file);
  } catch (e) {
    toast(`Photo failed: ${errText(e)}`, 4500);
  } finally {
    state.busy = false;
    $('shutterBtn').classList.remove('busy');
  }
}

function keepShot(file) {
  if (state.lastShot) URL.revokeObjectURL(state.lastShot.url);
  state.lastShot = { file, url: URL.createObjectURL(file) };
  const btn = $('lastShotBtn');
  btn.disabled = false;
  const showable = /^image\/(jpeg|png)$/.test(file.type);
  btn.style.backgroundImage = showable ? `url(${state.lastShot.url})` : '';
  btn.textContent = showable ? '' : 'RAW';
  toast(`Got ${file.name}`);
}

function openReview() {
  const shot = state.lastShot;
  if (!shot) return;
  const showable = /^image\/(jpeg|png)$/.test(shot.file.type);
  $('reviewImg').hidden = !showable;
  if (showable) $('reviewImg').src = shot.url;
  $('reviewName').textContent = `${shot.file.name} · ${(shot.file.size / 1e6).toFixed(1)} MB`;
  $('shareBtn').hidden = !(navigator.canShare && navigator.canShare({ files: [shot.file] }));
  $('review').hidden = false;
}

function saveShot() {
  const shot = state.lastShot;
  if (!shot) return;
  const a = el('a', { href: shot.url, download: shot.file.name });
  document.body.append(a);
  a.click();
  a.remove();
}

async function shareShot() {
  try {
    await navigator.share({ files: [state.lastShot.file] });
  } catch (e) {
    if (e.name !== 'AbortError') toast(errText(e));
  }
}

/* ---------- live view on / off ---------- */

async function toggleLive() {
  state.live = !state.live;
  renderHud();
  if (!state.live) {
    // Drops the mirror so the sensor and battery get a rest.
    try { await camera.set('viewfinder', false); } catch {}
  }
}

/* ---------- full settings sheet ---------- */

async function openSheet() {
  $('sheet').hidden = false;
  const body = $('sheetBody');
  body.textContent = '';
  body.append(appSettingsSection());
  const note = el('p', { className: 'sheet-note', textContent: 'Reading the camera…' });
  body.append(note);
  await refreshConfig();
  if (note.parentNode !== body) return;   // the sheet was closed and reopened meanwhile; that call fills it
  note.remove();
  if (!state.config) return;
  for (const section of Object.values(state.config.children || {})) {
    body.append(renderSection(section));
  }
}

function renderSection(section) {
  const details = el('details', { className: 'section' }, el('summary', { textContent: section.label }));
  for (const cfg of Object.values(section.children || {})) {
    details.append(cfg.children ? renderSection(cfg) : renderRow(cfg));
  }
  return details;
}

function renderRow(cfg) {
  const row = el('label', { className: 'row' }, el('span', { className: 'row-label', textContent: cfg.label }));
  let input;
  const apply = async value => {
    try {
      await camera.set(cfg.name, value);
      cfg.value = value;
    } catch (e) {
      toast(`${cfg.label}: ${errText(e)}`);
    }
    scheduleRefresh();
  };

  if (cfg.type === 'menu' || cfg.type === 'radio') {
    input = el('select');
    for (const choice of cfg.choices) input.append(el('option', { value: choice, textContent: choice }));
    input.value = cfg.value;
    input.addEventListener('change', () => apply(input.value));
  } else if (cfg.type === 'toggle') {
    input = el('input', { type: 'checkbox', checked: !!cfg.value });
    input.addEventListener('change', () => apply(input.checked));
  } else if (cfg.type === 'range') {
    input = el('input', { type: 'number', min: cfg.min, max: cfg.max, step: cfg.step, value: cfg.value });
    input.addEventListener('change', () => apply(Number(input.value)));
  } else if (cfg.type === 'datetime') {
    input = el('span', { className: 'row-value', textContent: new Date(cfg.value * 1000).toLocaleString() });
  } else {
    input = el('input', { type: 'text', value: cfg.value ?? '' });
    input.addEventListener('change', () => apply(input.value));
  }
  if (cfg.readonly && 'disabled' in input) input.disabled = true;
  row.append(input);
  return row;
}

function appSettingsSection() {
  const details = el('details', { className: 'section', open: true }, el('summary', { textContent: 'This app' }));

  const prefRow = (label, input, read) => {
    input.addEventListener('change', () => {
      read();
      savePrefs();
    });
    details.append(el('label', { className: 'row' }, el('span', { className: 'row-label', textContent: label }), input));
  };

  const af = el('input', { type: 'checkbox', checked: prefs.afBeforeShot });
  prefRow('Autofocus before each photo', af, () => { prefs.afBeforeShot = af.checked; });

  const space = el('input', { type: 'text', value: prefs.afSpace, inputMode: 'text' });
  prefRow('Tap to focus coordinate space', space, () => {
    if (/^\d+x\d+$/.test(space.value.trim())) prefs.afSpace = space.value.trim();
    else space.value = prefs.afSpace;
  });

  const small = el('input', { type: 'number', min: 1, max: 32767, value: prefs.mfSmall });
  prefRow('Focus step, small ‹ ›', small, () => { prefs.mfSmall = Number(small.value) || PREF_DEFAULTS.mfSmall; });

  const large = el('input', { type: 'number', min: 1, max: 32767, value: prefs.mfLarge });
  prefRow('Focus step, big « »', large, () => { prefs.mfLarge = Number(large.value) || PREF_DEFAULTS.mfLarge; });

  const bye = el('button', { className: 'btn-ghost', textContent: 'Disconnect camera' });
  bye.addEventListener('click', async () => {
    try { await camera.set('viewfinder', false); } catch {}
    leaveLive('Disconnected.');
  });
  details.append(bye);
  details.append(el('p', { className: 'sheet-note', textContent: 'Mirror Up · Unfortunate Name Studios' }));
  return details;
}

/* ---------- screen wake lock ---------- */

async function holdWakeLock() {
  try {
    if ('wakeLock' in navigator && !state.wakeLock) {
      state.wakeLock = await navigator.wakeLock.request('screen');
      state.wakeLock.addEventListener('release', () => { state.wakeLock = null; });
    }
  } catch {}
}
function releaseWakeLock() {
  if (state.wakeLock) state.wakeLock.release().catch(() => {});
  state.wakeLock = null;
}

/* ---------- wiring ---------- */

$('connectBtn').addEventListener('click', connect);
$('frame').addEventListener('click', tapToFocus);
$('afBtn').addEventListener('click', () => {
  const mark = $('afMark');
  if (!mark.style.left) { mark.style.left = '50%'; mark.style.top = '50%'; }   // never tapped: the camera's point is in the middle
  mark.dataset.result = '';
  mark.hidden = false;
  autofocus();
});
for (const btn of document.querySelectorAll('[data-mf]')) {
  btn.addEventListener('click', () => nudgeFocus(btn.dataset.mf));
}
$('shutterBtn').addEventListener('click', shoot);
$('lastShotBtn').addEventListener('click', openReview);
$('reviewClose').addEventListener('click', () => { $('review').hidden = true; });
$('saveBtn').addEventListener('click', saveShot);
$('shareBtn').addEventListener('click', shareShot);
$('gridBtn').addEventListener('click', () => { prefs.grid = !prefs.grid; savePrefs(); renderHud(); });
$('peakBtn').addEventListener('click', () => { prefs.peaking = !prefs.peaking; savePrefs(); renderHud(); });
$('liveBtn').addEventListener('click', toggleLive);
$('settingsBtn').addEventListener('click', openSheet);
$('sheetClose').addEventListener('click', () => { $('sheet').hidden = true; });

window.addEventListener('resize', layoutFrame);
const resizes = new ResizeObserver(layoutFrame);
resizes.observe($('stage'));
resizes.observe($('hud'));
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && camera.connected) holdWakeLock();
});
if (Camera.supported()) {
  navigator.usb.addEventListener('disconnect', () => leaveLive('The camera was unplugged or switched off.'));
}

/* ---------- start up ---------- */

async function boot() {
  const btn = $('connectBtn');
  btn.disabled = true;   // until the page is ready; a tap before that would fail with a cryptic SharedArrayBuffer error
  if (!Camera.supported()) {
    setSplashStatus('This browser has no USB access. Open the page in Chrome on Android (or Chrome on a computer).');
    return;
  }
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('sw.js');
      await navigator.serviceWorker.ready;
    } catch (e) {
      console.warn('service worker failed', e);
    }
  }
  if (!crossOriginIsolated) {
    // First visit: the service worker that isolates the page only takes effect after one reload.
    let reloaded = false;
    try {
      reloaded = sessionStorage.getItem('mirrorup-reloaded') === '1';
      sessionStorage.setItem('mirrorup-reloaded', '1');
    } catch {}
    if (!reloaded) {
      location.reload();
      return;
    }
    setSplashStatus('The page could not switch on cross-origin isolation, which the camera library needs. Try closing the tab and opening it again.');
    return;
  }
  try { sessionStorage.removeItem('mirrorup-reloaded'); } catch {}
  btn.disabled = false;
}
boot();

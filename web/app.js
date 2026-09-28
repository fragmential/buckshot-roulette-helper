'use strict';

/* Buckshot Helper
 * Top half = blanks, bottom half = live rounds.
 * SETUP:  tap a half to add a shell, then START ROUND.
 * FIRING: tap a half each time that kind of shell is fired.
 * Everything is drawn into a tiny canvas and upscaled with hard pixels,
 * then dithered + grained, to get the grimy low-res look of the game.
 */

const MAX_PER_SIDE = 8;
const TARGET_LOW_WIDTH = 190;           // game pixels across the screen
const FPS = 24;
const STORE_KEY = 'buckshot-helper-v1';

const COLORS = {
  blank: { hull: '#3f5869', hi: '#7d98a8', lo: '#1c2a34', lamp: 'rgba(95,130,150,', text: '#c9d6dc', glow: '#6f95ab' },
  live:  { hull: '#9e1519', hi: '#dc3d3f', lo: '#4f080b', lamp: 'rgba(170,32,24,',  text: '#e9d3c6', glow: '#d0302a' },
  brass: { base: '#a9843c', hi: '#e6c774', lo: '#56411c' },
  lcd:   { bg: '#08130a', text: '#8df07c', dim: '#2c5a2a', sub: '#4f9a47' },
  ui:    { bar: '#110f0d', edge: '#39322a', btn: '#221e19', btnHi: '#4a4136', btnLo: '#090807', text: '#d8cfbb', dim: '#5a5247', hint: '#81776a' },
};

/* ------------------------------------------------------------------ state */

const blankState = () => ({ mode: 'setup', blank: 0, live: 0, loadedBlank: 0, loadedLive: 0 });
let state = blankState();
let history = [];

function snapshot() {
  const { mode, blank, live, loadedBlank, loadedLive } = state;
  return { mode, blank, live, loadedBlank, loadedLive };
}
function pushHistory() {
  history.push(snapshot());
  if (history.length > 100) history.shift();
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ state: snapshot(), history })); } catch (e) {}
}
function restore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data && data.state) state = Object.assign(blankState(), data.state);
    if (data && Array.isArray(data.history)) history = data.history;
  } catch (e) {}
  if (state.mode === 'loading') state.mode = 'firing';
  if (state.mode === 'over') state = blankState();
}

/* ------------------------------------------------------------------ audio */

const Sound = (() => {
  let ctx = null, master = null, wet = null, noise = null, primed = false;
  const custom = {};
  const CUSTOM_FILES = { insert: 'sounds/insert.mp3', rack: 'sounds/rack.mp3', live: 'sounds/live.mp3', blank: 'sounds/blank.mp3' };

  function init() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    // Play through the silent switch (iOS 17+).
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
    ctx = new AC();

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -8; comp.knee.value = 6; comp.ratio.value = 6;
    comp.attack.value = 0.002; comp.release.value = 0.2;
    master = ctx.createGain(); master.gain.value = 0.9;
    master.connect(comp); comp.connect(ctx.destination);

    const conv = ctx.createConvolver();
    conv.buffer = impulse(1.8, 2.6);
    wet = ctx.createGain(); wet.gain.value = 0.5;
    wet.connect(conv); conv.connect(master);

    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    loadCustom();
  }

  function impulse(seconds, decay) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = buf.getChannelData(c);
      for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  // Optional: drop your own recordings into web/sounds/ to replace the synth.
  function loadCustom() {
    for (const [name, url] of Object.entries(CUSTOM_FILES)) {
      fetch(url).then(r => (r.ok ? r.arrayBuffer() : null)).then(ab => {
        if (!ab || !ab.byteLength) return;
        ctx.decodeAudioData(ab, buf => { custom[name] = buf; }, () => {});
      }).catch(() => {});
    }
  }

  function unlock() {
    init();
    if (!ctx) return;
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    if (!primed) {
      primed = true;
      const s = ctx.createBufferSource();
      s.buffer = ctx.createBuffer(1, 1, 22050);
      s.connect(ctx.destination); s.start(0);
    }
  }

  function route(node, send, dest) {
    node.connect(dest || master);
    if (send) {
      const g = ctx.createGain(); g.gain.value = send;
      node.connect(g); g.connect(wet);
    }
  }

  function nz(t, dur, o) {
    const s = ctx.createBufferSource(); s.buffer = noise;
    const f = ctx.createBiquadFilter(); f.type = o.type || 'bandpass';
    f.frequency.setValueAtTime(o.f || 1000, t);
    if (o.f2) f.frequency.exponentialRampToValueAtTime(o.f2, t + dur);
    f.Q.value = o.q || 0.8;
    const g = ctx.createGain();
    const a = o.a || 0.001;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.g || 1, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(dur, a + 0.005));
    s.connect(f); f.connect(g); route(g, o.send, o.dest);
    s.start(t, Math.random() * 1.5, dur + 0.05);
  }

  function tone(t, dur, o) {
    const s = ctx.createOscillator(); s.type = o.type || 'sine';
    s.frequency.setValueAtTime(o.f, t);
    if (o.f2) s.frequency.exponentialRampToValueAtTime(o.f2, t + dur);
    const g = ctx.createGain();
    const a = o.a || 0.002;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.g || 0.5, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(g); route(g, o.send, o.dest);
    s.start(t); s.stop(t + dur + 0.05);
  }

  function playBuffer(buf, t) {
    const s = ctx.createBufferSource(); s.buffer = buf;
    s.connect(master); s.start(t);
  }

  function now() { return ctx.currentTime + 0.01; }
  const jitter = (amt) => 1 + (Math.random() - 0.5) * amt;

  function rack(t, v = 1) {
    if (custom.rack) return playBuffer(custom.rack, t);
    // pump back
    nz(t, 0.09, { f: 1100, f2: 2600, q: 2, g: 0.3 * v, a: 0.03 });
    nz(t + 0.085, 0.03, { type: 'highpass', f: 2200, g: 0.9 * v, send: 0.25 });
    nz(t + 0.09, 0.12, { f: 3300, q: 16, g: 0.25 * v, send: 0.2 });
    tone(t + 0.085, 0.06, { type: 'triangle', f: 320, f2: 140, g: 0.4 * v });
    // pump forward
    nz(t + 0.2, 0.08, { f: 2400, f2: 1200, q: 2, g: 0.3 * v, a: 0.03 });
    nz(t + 0.275, 0.035, { type: 'highpass', f: 1700, g: 1.0 * v, send: 0.25 });
    nz(t + 0.28, 0.14, { f: 2900, q: 16, g: 0.25 * v, send: 0.2 });
    tone(t + 0.275, 0.08, { type: 'triangle', f: 260, f2: 110, g: 0.5 * v });
  }

  const api = {
    unlock,
    get ready() { return !!ctx; },

    insert(delay = 0) {
      if (!ctx) return;
      const t = now() + delay;
      if (custom.insert) return playBuffer(custom.insert, t);
      const p = jitter(0.12);
      nz(t - 0.05, 0.06, { f: 900 * p, f2: 1900 * p, q: 1.5, g: 0.12, a: 0.04 });
      nz(t, 0.05, { f: 1600 * p, q: 2.5, g: 0.8, send: 0.15 });
      nz(t + 0.012, 0.13, { f: 3400 * p, q: 14, g: 0.3, send: 0.2 });
      tone(t, 0.07, { f: 220 * p, f2: 90, g: 0.5 });
    },

    rack(delay = 0) { if (ctx) rack(now() + delay); },

    live() {
      if (!ctx) return;
      const t = now();
      if (custom.live) return playBuffer(custom.live, t);
      const bus = ctx.createGain();
      const sh = ctx.createWaveShaper();
      const n = 1024, curve = new Float32Array(n);
      for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; curve[i] = Math.tanh(3.2 * x); }
      sh.curve = curve; sh.oversample = '2x';
      bus.connect(sh); route(sh, 0.9);
      nz(t, 0.08, { type: 'highpass', f: 1400, g: 1.3, dest: bus });                // crack
      nz(t, 1.0, { type: 'lowpass', f: 7500, f2: 160, q: 0.7, g: 1.5, dest: bus });  // blast
      tone(t, 0.5, { f: 150, f2: 36, g: 1.4, dest: bus });                         // chest thump
      tone(t, 0.25, { type: 'triangle', f: 90, f2: 40, g: 0.8, dest: bus });
      nz(t + 0.03, 2.2, { type: 'lowpass', f: 900, f2: 90, g: 0.45, dest: bus, a: 0.05 }); // room rumble
      nz(t + 0.004, 0.5, { f: 5200, f2: 1500, q: 4, g: 0.2, send: 0.6 });             // ringing
      rack(t + 0.9, 0.55);
    },

    blank() {
      if (!ctx) return;
      const t = now();
      if (custom.blank) return playBuffer(custom.blank, t);
      nz(t, 0.016, { type: 'highpass', f: 2600, g: 1.0, send: 0.35 });
      nz(t, 0.1, { f: 2300, q: 18, g: 0.55, send: 0.35 });
      nz(t + 0.002, 0.07, { f: 4100, q: 12, g: 0.25, send: 0.3 });
      tone(t, 0.05, { type: 'triangle', f: 430, f2: 170, g: 0.35 });
      rack(t + 0.55, 0.45);
    },

    place() {
      if (!ctx) return;
      const t = now(); const p = jitter(0.2);
      tone(t, 0.05, { type: 'triangle', f: 950 * p, f2: 620 * p, g: 0.16 });
      nz(t, 0.03, { f: 2600 * p, q: 3, g: 0.3, send: 0.1 });
      tone(t + 0.004, 0.08, { f: 190 * p, f2: 90, g: 0.3 });
    },

    tick() {
      if (!ctx) return;
      const t = now();
      nz(t, 0.02, { type: 'highpass', f: 3000, g: 0.35 });
      tone(t, 0.03, { type: 'square', f: 1800, f2: 1200, g: 0.05 });
    },

    deny() {
      if (!ctx) return;
      const t = now();
      tone(t, 0.14, { type: 'square', f: 110, f2: 95, g: 0.12 });
      nz(t, 0.05, { type: 'lowpass', f: 600, g: 0.3 });
    },
  };
  return api;
})();

/* ---------------------------------------------------------------- haptics */

const hapticLabel = document.getElementById('haptic');
function haptic() {
  // iOS 18 Safari: toggling a <input switch> gives a light haptic tick.
  try { hapticLabel.click(); } catch (e) {}
  try { if (navigator.vibrate) navigator.vibrate(12); } catch (e) {}
}

/* ------------------------------------------------------------ wake lock */

let wakeLock = null;
async function keepAwake() {
  try {
    if ('wakeLock' in navigator && !wakeLock && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch (e) {}
}

/* ----------------------------------------------------------------- canvas */

const canvas = document.getElementById('screen');
const g = canvas.getContext('2d', { willReadFrequently: true });
const scanEl = document.getElementById('scan');
const safeEl = document.getElementById('safe');

let W = 190, H = 400, K = 3, DPR = 1;
let L = null;                  // layout
let vignette = null;           // Float32Array per pixel
let grime = null;              // offscreen texture
const NOISE_LEN = 1 << 16;
const noiseTable = new Float32Array(NOISE_LEN);
for (let i = 0; i < NOISE_LEN; i++) noiseTable[i] = Math.random() - 0.5;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => v / 16 - 0.5);

function layout() {
  DPR = window.devicePixelRatio || 1;
  const cssW = window.innerWidth, cssH = window.innerHeight;
  const devW = cssW * DPR, devH = cssH * DPR;
  K = Math.max(2, Math.round(devW / TARGET_LOW_WIDTH)); // device px per game px (integer = even pixels)
  W = Math.ceil(devW / K);
  H = Math.ceil(devH / K);
  canvas.width = W; canvas.height = H;
  canvas.style.width = (W * K / DPR) + 'px';
  canvas.style.height = (H * K / DPR) + 'px';
  const px = K / DPR;
  scanEl.style.setProperty('--scan', px + 'px');
  scanEl.style.setProperty('--scan-on', (px * 0.62) + 'px');

  const cs = getComputedStyle(safeEl);
  const toLow = v => Math.ceil((parseFloat(v) || 0) * DPR / K);
  const safeTop = toLow(cs.paddingTop), safeBottom = toLow(cs.paddingBottom);

  const barH = 44;
  const usable = H - safeTop - safeBottom;
  const barY = Math.round(safeTop + usable / 2 - barH / 2);
  const side = 44, gap = 4, pad = 5;
  L = {
    safeTop, safeBottom, barY, barH,
    blank: { y0: 0, y1: barY, cy0: safeTop, cy1: barY },
    live: { y0: barY + barH, y1: H, cy0: barY + barH, cy1: H - safeBottom },
    undo:  { x: pad, y: barY + 7, w: side, h: barH - 14 },
    reset: { x: W - pad - side, y: barY + 7, w: side, h: barH - 14 },
    main:  { x: pad + side + gap, y: barY + 5, w: W - 2 * (pad + side + gap), h: barH - 10 },
  };

  // vignette
  vignette = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = (x / W - 0.5) * 2, dy = (y / H - 0.5) * 2;
      const r = Math.sqrt(dx * dx * 0.9 + dy * dy * 0.55);
      vignette[y * W + x] = Math.max(0.15, 1 - 0.62 * Math.pow(r, 2.2));
    }
  }
  grime = makeGrime(W, H);
}

function makeGrime(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, w, h);
  // blotchy multi-octave value noise
  for (const [cells, alpha] of [[5, 0.55], [12, 0.35], [30, 0.25]]) {
    const cw = cells, ch = Math.ceil(cells * h / w);
    const s = document.createElement('canvas'); s.width = cw; s.height = ch;
    const sx = s.getContext('2d');
    const img = sx.createImageData(cw, ch);
    for (let i = 0; i < cw * ch; i++) {
      const v = 120 + Math.random() * 135;
      img.data[i * 4] = v; img.data[i * 4 + 1] = v * 0.97; img.data[i * 4 + 2] = v * 0.9; img.data[i * 4 + 3] = 255;
    }
    sx.putImageData(img, 0, 0);
    x.globalAlpha = alpha; x.imageSmoothingEnabled = true;
    x.globalCompositeOperation = 'multiply';
    x.drawImage(s, 0, 0, w, h);
  }
  // scratches and specks
  x.globalCompositeOperation = 'multiply';
  x.globalAlpha = 0.35;
  x.strokeStyle = '#6a625a'; x.lineWidth = 1;
  for (let i = 0; i < 18; i++) {
    const sx = Math.random() * w, sy = Math.random() * h, len = 6 + Math.random() * 30, a = Math.random() * Math.PI;
    x.beginPath(); x.moveTo(sx, sy); x.lineTo(sx + Math.cos(a) * len, sy + Math.sin(a) * len); x.stroke();
  }
  x.fillStyle = '#403830';
  for (let i = 0; i < 260; i++) x.fillRect(Math.random() * w | 0, Math.random() * h | 0, 1, 1);
  x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
  return c;
}

/* ------------------------------------------------------------ fx + timers */

const fx = {
  flash: 0, flashColor: '255,210,160',
  shake: 0,
  pulse: { blank: 0, live: 0 },
  deny: { blank: 0, live: 0, main: 0 },
  press: { undo: 0, reset: 0, main: 0 },
  loading: null,      // { start, n, done }
  overAt: 0,
  msg: null,          // { text, until }
};
const clock = () => performance.now() / 1000;

/* ---------------------------------------------------------------- actions */

function tapSide(side) {
  const t = clock();
  if (state.mode === 'setup') {
    if (state[side] >= MAX_PER_SIDE) { fx.deny[side] = t; Sound.deny(); return; }
    pushHistory();
    state[side]++;
    fx.pulse[side] = t;
    Sound.place(); haptic();
  } else if (state.mode === 'firing') {
    if (state[side] <= 0) { fx.deny[side] = t; Sound.deny(); return; }
    pushHistory();
    state[side]--;
    fx.pulse[side] = t;
    if (side === 'live') {
      Sound.live();
      fx.flash = 1; fx.flashColor = '255,205,150'; fx.shake = 6;
    } else {
      Sound.blank();
      fx.shake = 1.5; fx.flash = 0.18; fx.flashColor = '140,170,190';
    }
    haptic();
    if (state.blank + state.live === 0) {
      state.mode = 'over';
      fx.overAt = t;
    }
  } else {
    return;
  }
  save();
}

function startRound() {
  const n = state.blank + state.live;
  if (n === 0) { fx.deny.main = clock(); Sound.deny(); return; }
  pushHistory();
  state.loadedBlank = state.blank;
  state.loadedLive = state.live;
  state.mode = 'loading';
  const gapS = 0.26;
  fx.loading = { start: clock(), n, gap: gapS, done: n * gapS + 0.25 + 0.45 };
  for (let i = 0; i < n; i++) Sound.insert(i * gapS);
  Sound.rack(n * gapS + 0.25);
  haptic();
  save();
}

function finishLoading() {
  fx.loading = null;
  state.mode = 'firing';
  save();
}

function undo() {
  if (!history.length || state.mode === 'loading') { fx.deny.main = clock(); Sound.deny(); return; }
  state = Object.assign(blankState(), history.pop());
  if (state.mode === 'over') state.mode = 'firing';
  fx.overAt = 0;
  Sound.tick(); haptic();
  save();
}

function resetAll() {
  if (state.mode === 'loading') return;
  if (state.mode === 'setup' && state.blank + state.live === 0) { Sound.deny(); return; }
  pushHistory();
  state = blankState();
  fx.overAt = 0;
  Sound.tick(); haptic();
  save();
}

/* ------------------------------------------------------------------ input */

const inRect = (r, x, y) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  Sound.unlock();
  keepAwake();
  const x = e.clientX * DPR / K, y = e.clientY * DPR / K;
  const t = clock();
  if (y >= L.barY && y < L.barY + L.barH) {
    if (inRect(L.undo, x, y)) { fx.press.undo = t; undo(); }
    else if (inRect(L.reset, x, y)) { fx.press.reset = t; resetAll(); }
    else if (inRect(L.main, x, y) && state.mode === 'setup') { fx.press.main = t; startRound(); }
    return;
  }
  tapSide(y < L.barY ? 'blank' : 'live');
}, { passive: false });

// Belt and braces against zoom / scroll / callouts in Safari.
['touchstart', 'touchmove', 'gesturestart', 'dblclick', 'contextmenu'].forEach(ev =>
  document.addEventListener(ev, e => { if (ev !== 'touchstart' || e.touches.length > 1) e.preventDefault(); }, { passive: false }));
document.addEventListener('touchend', () => Sound.unlock(), { passive: true });

/* ---------------------------------------------------------------- drawing */

function text(str, x, y, size, color, align = 'center', spacing = 0) {
  g.font = `${size}px VT323, monospace`;
  g.fillStyle = color;
  g.textBaseline = 'middle';
  if (!spacing) { g.textAlign = align; g.fillText(str, Math.round(x), Math.round(y)); return; }
  g.textAlign = 'left';
  const widths = [...str].map(ch => g.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + spacing * (str.length - 1);
  let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  [...str].forEach((ch, i) => { g.fillText(ch, Math.round(cx), Math.round(y)); cx += widths[i] + spacing; });
}

function drawShell(x, y, kind, st) {
  const c = COLORS[kind], b = COLORS.brass;
  const w = 9, h = 22, bh = 6, hullH = h - bh;
  if (st === 'slot') {
    g.fillStyle = 'rgba(255,255,255,0.1)';
    g.fillRect(x, y, w, 1); g.fillRect(x, y + h - 1, w, 1);
    g.fillRect(x, y, 1, h); g.fillRect(x + w - 1, y, 1, h);
    return;
  }
  if (st === 'spent') {
    g.globalAlpha = 0.5;
    g.fillStyle = c.lo; g.fillRect(x, y + 3, w, hullH - 3);
    g.fillStyle = '#0a0808'; g.fillRect(x + 2, y + 3, w - 4, 3);    // opened crimp
    g.fillStyle = b.lo; g.fillRect(x, y + hullH, w, bh);
    g.fillRect(x - 1, y + h - 2, w + 2, 2);
    g.globalAlpha = 1;
    return;
  }
  // hull
  g.fillStyle = c.hull; g.fillRect(x, y, w, hullH);
  g.fillStyle = c.hi; g.fillRect(x + 1, y + 2, 2, hullH - 3);
  g.fillStyle = c.lo; g.fillRect(x + w - 2, y, 2, hullH); g.fillRect(x, y, w, 2);
  g.fillStyle = c.hull; g.fillRect(x + 3, y, 3, 1);                   // crimp star
  g.fillStyle = c.lo; g.fillRect(x, y + hullH - 1, w, 1);
  // brass head
  g.fillStyle = b.base; g.fillRect(x, y + hullH, w, bh);
  g.fillStyle = b.hi; g.fillRect(x + 1, y + hullH + 1, 2, bh - 3);
  g.fillStyle = b.lo; g.fillRect(x + w - 2, y + hullH, 2, bh);
  g.fillStyle = b.base; g.fillRect(x - 1, y + h - 2, w + 2, 2);        // rim
  g.fillStyle = b.lo; g.fillRect(x - 1, y + h - 1, w + 2, 1);
}

function drawHalf(side, t) {
  const r = L[side], c = COLORS[side];
  const h = r.cy1 - r.cy0;
  const firing = state.mode === 'firing' || state.mode === 'over' || state.mode === 'loading';

  // floor
  g.fillStyle = side === 'live' ? '#120807' : '#080b0c';
  g.fillRect(0, r.y0, W, r.y1 - r.y0);

  // hanging lamp glow, flickering like a bad bulb
  const flick = 0.85 + 0.1 * Math.sin(t * 7.3 + (side === 'live' ? 1 : 0)) * Math.sin(t * 2.1)
    + (Math.random() < 0.02 ? -0.25 : 0);
  const lx = W / 2, ly = r.cy0 + h * 0.45;
  const lamp = g.createRadialGradient(lx, ly, 2, lx, ly, W * 0.85);
  lamp.addColorStop(0, c.lamp + (0.55 * flick).toFixed(3) + ')');
  lamp.addColorStop(0.45, c.lamp + (0.18 * flick).toFixed(3) + ')');
  lamp.addColorStop(1, c.lamp + '0)');
  g.fillStyle = lamp;
  g.fillRect(0, r.y0, W, r.y1 - r.y0);

  g.globalCompositeOperation = 'multiply';
  g.drawImage(grime, 0, r.y0, W, r.y1 - r.y0, 0, r.y0, W, r.y1 - r.y0);
  g.globalCompositeOperation = 'source-over';

  const count = state[side];
  const loaded = side === 'live' ? state.loadedLive : state.loadedBlank;
  const denyT = t - fx.deny[side];
  const jx = denyT < 0.3 ? Math.round(Math.sin(denyT * 70) * 3 * (1 - denyT / 0.3)) : 0;

  // label
  const label = side === 'live' ? (count === 1 ? 'LIVE ROUND' : 'LIVE ROUNDS') : (count === 1 ? 'BLANK' : 'BLANKS');
  text(label, W / 2, r.cy0 + h * 0.12 + 2, 16, c.text, 'center', 1);

  // big count
  const pt = t - fx.pulse[side];
  const pulse = pt < 0.35 ? Math.exp(-pt / 0.08) : 0;
  const size = Math.min(88, Math.floor(h * 0.46)) * (1 + 0.18 * pulse);
  const dimmed = firing && count === 0;
  g.shadowColor = c.glow; g.shadowBlur = dimmed ? 0 : 8 + pulse * 10;
  text(String(count), W / 2 + jx, r.cy0 + h * 0.43, Math.round(size), dimmed ? '#3a3531' : c.text);
  g.shadowBlur = 0;

  // shells
  const shellY = Math.round(r.cy0 + h * 0.68);
  const step = 12;
  if (firing) {
    const n = Math.max(loaded, count);
    const x0 = Math.round(W / 2 - (n * step - 3) / 2);
    for (let i = 0; i < n; i++) drawShell(x0 + i * step + jx, shellY, side, i < count ? 'full' : 'spent');
  } else {
    const x0 = Math.round(W / 2 - (MAX_PER_SIDE * step - 3) / 2);
    for (let i = 0; i < MAX_PER_SIDE; i++) drawShell(x0 + i * step + jx, shellY, side, i < count ? 'full' : 'slot');
  }

  // hint
  let hint = '';
  if (state.mode === 'setup') hint = count >= MAX_PER_SIDE ? 'FULL' : 'TAP TO ADD';
  else if (state.mode === 'firing') hint = count === 0 ? 'NONE LEFT' : 'TAP WHEN FIRED';
  if (hint) text(hint, W / 2, r.cy0 + h * 0.9, 14, COLORS.ui.hint, 'center', 1);
}

function bevelButton(r, label, pressed, enabled) {
  const u = COLORS.ui;
  g.fillStyle = u.btnLo; g.fillRect(r.x - 1, r.y - 1, r.w + 2, r.h + 2);
  g.fillStyle = pressed ? '#15120f' : u.btn; g.fillRect(r.x, r.y, r.w, r.h);
  g.fillStyle = pressed ? u.btnLo : u.btnHi;
  g.fillRect(r.x, r.y, r.w, 1); g.fillRect(r.x, r.y, 1, r.h);
  g.fillStyle = pressed ? u.btnHi : '#0c0a08';
  g.fillRect(r.x, r.y + r.h - 1, r.w, 1); g.fillRect(r.x + r.w - 1, r.y, 1, r.h);
  text(label, r.x + r.w / 2 + (pressed ? 1 : 0), r.y + r.h / 2 + (pressed ? 1 : 0), 14, enabled ? u.text : u.dim, 'center', 1);
}

function drawBar(t) {
  const u = COLORS.ui, y = L.barY, h = L.barH;
  g.fillStyle = u.bar; g.fillRect(0, y, W, h);
  g.fillStyle = u.edge; g.fillRect(0, y, W, 1); g.fillRect(0, y + h - 1, W, 1);
  g.fillStyle = '#000'; g.fillRect(0, y + 1, W, 1); g.fillRect(0, y + h - 2, W, 1);
  for (let i = 0; i < W; i += 3) { g.fillStyle = i % 6 ? '#16130f' : '#0d0b09'; g.fillRect(i, y + 3, 1, h - 6); } // brushed metal

  const pressed = k => t - fx.press[k] < 0.12;
  const busy = state.mode === 'loading';
  bevelButton(L.undo, 'UNDO', pressed('undo'), history.length > 0 && !busy);
  const resetLabel = state.mode === 'setup' ? 'CLEAR' : 'RESET';
  const resetOn = !busy && (state.mode !== 'setup' || state.blank + state.live > 0);
  bevelButton(L.reset, resetLabel, pressed('reset'), resetOn);

  // centre: defibrillator-style LCD
  const m = L.main;
  const dT = t - fx.deny.main;
  const mjx = dT < 0.3 ? Math.round(Math.sin(dT * 70) * 2 * (1 - dT / 0.3)) : 0;
  const mx = m.x + mjx;
  g.fillStyle = '#000'; g.fillRect(mx - 2, m.y - 2, m.w + 4, m.h + 4);
  g.fillStyle = '#2b2620'; g.fillRect(mx - 1, m.y - 1, m.w + 2, 1); g.fillRect(mx - 1, m.y - 1, 1, m.h + 2);
  const setupPress = state.mode === 'setup' && pressed('main');
  g.fillStyle = setupPress ? '#10240f' : COLORS.lcd.bg; g.fillRect(mx, m.y, m.w, m.h);
  for (let yy = m.y; yy < m.y + m.h; yy += 2) { g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(mx, yy, m.w, 1); }

  const cx = mx + m.w / 2, cy = m.y + m.h / 2;
  const lcd = COLORS.lcd;
  g.shadowColor = lcd.text; g.shadowBlur = 4;
  if (state.mode === 'setup') {
    const n = state.blank + state.live;
    if (n === 0) {
      text('LOAD SHELLS', cx, cy, 15, lcd.dim, 'center', 1);
    } else {
      const blink = Math.floor(t * 2) % 2 === 0;
      text((blink ? '> ' : '  ') + 'START ROUND', cx, cy - 6, 15, lcd.text, 'center', 0);
      g.shadowBlur = 0;
      text(`${n} SHELL${n === 1 ? '' : 'S'}`, cx, cy + 9, 13, lcd.sub, 'center', 1);
    }
  } else if (state.mode === 'loading' && fx.loading) {
    const el = t - fx.loading.start;
    const inserted = Math.min(fx.loading.n, Math.floor(el / fx.loading.gap) + 1);
    text('LOADING', cx, cy - 6, 15, lcd.text, 'center', 2);
    const dots = fx.loading.n, dw = 4;
    const dx0 = Math.round(cx - (dots * dw - 1) / 2);
    for (let i = 0; i < dots; i++) {
      g.fillStyle = i < inserted ? lcd.text : lcd.dim;
      g.fillRect(dx0 + i * dw, Math.round(cy + 6), 3, 3);
    }
  } else if (state.mode === 'firing') {
    const n = state.blank + state.live;
    const pct = n ? Math.round(state.live / n * 100) : 0;
    text(`${pct}% LIVE`, cx, cy - 6, 17, lcd.text, 'center', 1);
    g.shadowBlur = 0;
    text(`${n} IN GUN`, cx, cy + 9, 13, lcd.sub, 'center', 1);
  } else if (state.mode === 'over') {
    if (Math.floor(t * 3) % 2 === 0) text('EMPTY', cx, cy, 18, lcd.text, 'center', 3);
  }
  g.shadowBlur = 0;

  // rivets
  for (const rx of [2, W - 3]) for (const ry of [y + 4, y + h - 5]) {
    g.fillStyle = '#4a4238'; g.fillRect(rx, ry, 1, 1);
  }
}

function postProcess(t) {
  const img = g.getImageData(0, 0, W, H);
  const d = img.data;
  const levels = 10, step = 255 / (levels - 1), inv = 1 / step;
  const grain = 22;
  let off = (Math.random() * NOISE_LEN) | 0;
  for (let y = 0, p = 0; y < H; y++) {
    const by = (y & 3) << 2;
    for (let x = 0; x < W; x++, p++) {
      const i = p << 2;
      const v = vignette[p];
      const n = noiseTable[(p + off) & (NOISE_LEN - 1)] * grain;
      const b = BAYER[by | (x & 3)] * step;
      let r = d[i] * v + n + b, gg = d[i + 1] * v + n + b, bb = d[i + 2] * v * 1.02 + n + b + 2;
      r = Math.round(r * inv) * step; gg = Math.round(gg * inv) * step; bb = Math.round(bb * inv) * step;
      d[i] = r < 0 ? 0 : r > 255 ? 255 : r;
      d[i + 1] = gg < 0 ? 0 : gg > 255 ? 255 : gg;
      d[i + 2] = bb < 0 ? 0 : bb > 255 ? 255 : bb;
    }
  }
  g.putImageData(img, 0, 0);
}

let lastT = 0, lastFrame = 0, running = true;

function frame(ms) {
  if (!running) return;
  requestAnimationFrame(frame);
  if (ms - lastFrame < 1000 / FPS - 2) return;
  lastFrame = ms;
  const t = ms / 1000;
  const dt = lastT ? Math.min(0.1, t - lastT) : 0;
  lastT = t;

  if (fx.loading && clock() - fx.loading.start >= fx.loading.done) finishLoading();
  if (state.mode === 'loading' && fx.loading) {
    const el = clock() - fx.loading.start;
    const idx = Math.floor(el / fx.loading.gap);
    if (idx < fx.loading.n && idx !== fx.loading.lastIdx) { fx.loading.lastIdx = idx; fx.shake = Math.max(fx.shake, 1); }
    if (el > fx.loading.n * fx.loading.gap + 0.25 && !fx.loading.racked) { fx.loading.racked = true; fx.shake = 2.5; }
  }
  if (state.mode === 'over' && fx.overAt && clock() - fx.overAt > 1.8) {
    state = blankState(); fx.overAt = 0; save();
  }

  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  const sx = fx.shake ? Math.round((Math.random() - 0.5) * 2 * fx.shake) : 0;
  const sy = fx.shake ? Math.round((Math.random() - 0.5) * 2 * fx.shake) : 0;
  g.setTransform(1, 0, 0, 1, sx, sy);

  const now = clock();
  drawHalf('blank', now);
  drawHalf('live', now);
  drawBar(now);

  if (fx.flash > 0.01) {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = `rgba(${fx.flashColor},${Math.min(1, fx.flash) * 0.85})`;
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'source-over';
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
  postProcess(now);

  fx.flash *= Math.pow(0.0005, dt);
  fx.shake = fx.shake > 0.3 ? fx.shake * Math.pow(0.002, dt) : 0;
}

/* ------------------------------------------------------------------- boot */

function onResize() { layout(); }
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', () => setTimeout(onResize, 200));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    running = true; requestAnimationFrame(frame); keepAwake();
  } else {
    running = false; save();
  }
});

async function boot() {
  restore();
  try {
    const face = new FontFace('VT323', 'url(fonts/vt323-latin.woff2)');
    await face.load();
    document.fonts.add(face);
  } catch (e) {}
  layout();
  requestAnimationFrame(frame);
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}
boot();

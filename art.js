// the breathing field: a plane of isometric blocks rising and falling.
// projection + prism math adapted from utopia's city renderer.

const BG = '#0c2340';
const FACE_L = '#4d84c3';
const FACE_R = '#33608f';
const TOPS = ['#e9f2fb', '#e0edf9', '#d6e7f7'];
const HOVER_TOP = '#ffffff';

const IN = 0.06; // footprint inset, leaves a navy seam between blocks
const Z0 = -1.4; // faces extend this far below ground so seams read as depth
const ZMIN = 0.12;

const hero = document.getElementById('hero');
const canvas = document.getElementById('field');
const ctx = canvas.getContext('2d');
const tip = document.getElementById('tip');

const fine = matchMedia('(pointer: fine)').matches;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

const view = { w: 0, h: 0, tw: 40, th: 20, ox: 0, oy: 0 };
const hover = { gx: -1, gy: -1, on: false, lift: 0 };

let N = 0;
let count = 0;
let tx, ty, ph, fr, tint; // per visible tile, in back-to-front diagonal order

function hash(x, y) {
  let h = ((x * 374761393 + y * 668265263) ^ 88339) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function isoX(x, y) {
  return view.ox + ((x - y) * view.tw) / 2;
}
function isoY(x, y, z) {
  return view.oy + ((x + y) * view.th) / 2 - z * view.th;
}

// extruded block: two shaded side faces dropping to Z0, flat top
function prism(x0, y0, x1, y1, z, top) {
  const ax = isoX(x0, y0), ay = isoY(x0, y0, z);
  const bx = isoX(x1, y0), by = isoY(x1, y0, z);
  const cx = isoX(x1, y1), cy = isoY(x1, y1, z);
  const dx = isoX(x0, y1), dy = isoY(x0, y1, z);
  const drop = (z - Z0) * view.th;
  ctx.fillStyle = FACE_L;
  ctx.beginPath();
  ctx.moveTo(dx, dy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + drop); ctx.lineTo(dx, dy + drop);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = FACE_R;
  ctx.beginPath();
  ctx.moveTo(cx, cy); ctx.lineTo(bx, by); ctx.lineTo(bx, by + drop); ctx.lineTo(cx, cy + drop);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = top;
  ctx.beginPath();
  ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(cx, cy); ctx.lineTo(dx, dy);
  ctx.closePath(); ctx.fill();
}

function build() {
  const w = hero.clientWidth, h = hero.clientHeight;
  view.w = w; view.h = h;
  const dpr = Math.min(window.devicePixelRatio || 1, w < 700 ? 1.5 : 2);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const tw = Math.max(30, Math.min(52, w / 26));
  view.tw = tw;
  view.th = tw / 2;
  // top vertex of the field; sky above. peak sits right of center in landscape
  // so the hero copy gets clear sky
  const y0 = h * (h > w ? 0.62 : 0.4);
  view.ox = h > w ? w / 2 : w * 0.62;
  view.oy = y0;

  // diamond must cover the far side edge and the bottom corners
  const wEff = 2 * Math.max(view.ox, w - view.ox);
  N = Math.ceil((wEff + 4 * (h - y0)) / (2 * tw)) + 4;
  const cap = N * N;
  tx = new Int16Array(cap);
  ty = new Int16Array(cap);
  ph = new Float32Array(cap);
  fr = new Float32Array(cap);
  tint = new Uint8Array(cap);
  count = 0;

  const maxS = Math.ceil((2 * (h - y0)) / view.th) + 6; // cull diagonals past the bottom edge
  // cull tiles past the side edges: isoX = ox + (2x - s) * tw/2
  const spanL = (-view.ox - tw * 2) / (tw / 2);
  const spanR = (w - view.ox + tw * 2) / (tw / 2);
  for (let s = 0; s <= Math.min(2 * N - 2, maxS); s++) {
    for (let x = Math.max(0, s - N + 1); x <= Math.min(N - 1, s); x++) {
      const d = 2 * x - s;
      if (d < spanL || d > spanR) continue;
      const y = s - x;
      const r = hash(x, y);
      tx[count] = x;
      ty[count] = y;
      ph[count] = r * Math.PI * 2;
      fr[count] = 0.16 + hash(y, x) * 0.18;
      tint[count] = (r * 997) % 3 | 0;
      count++;
    }
  }
}

let lastT = 0;

function frame(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000 || 0.016);
  lastT = now;
  const t = now / 1000;
  hover.lift += ((hover.on ? 1 : 0) - hover.lift) * Math.min(1, dt * 8);

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, view.w, view.h);

  const bump = hover.lift > 0.01;
  for (let i = 0; i < count; i++) {
    const x = tx[i], y = ty[i];
    let z = 0.55 + 0.45 * Math.sin(t * 0.4 + (x + y) * 0.55) + 0.3 * Math.sin(t * fr[i] + ph[i]);
    if (bump) {
      const bx = x - hover.gx, by = y - hover.gy;
      const d2 = bx * bx + by * by;
      if (d2 < 36) z += 1.5 * Math.exp(-d2 / 7) * hover.lift;
    }
    if (z < ZMIN) z = ZMIN;
    const isHover = hover.on && x === hover.gx && y === hover.gy;
    prism(x + IN, y + IN, x + 1 - IN, y + 1 - IN, z, isHover ? HOVER_TOP : TOPS[tint[i]]);
  }
}

// run only while the tab is visible and the hero is on screen
let raf = 0;
let inView = true;

function loop(now) {
  raf = 0;
  if (document.hidden || !inView) return;
  frame(now);
  raf = requestAnimationFrame(loop);
}

function start() {
  if (!raf && !document.hidden && inView && !reduced) raf = requestAnimationFrame(loop);
}

function once() {
  if (!raf) raf = requestAnimationFrame(now => { raf = 0; frame(now); });
}

document.addEventListener('visibilitychange', start);

new IntersectionObserver(entries => {
  inView = entries[0].isIntersecting;
  start();
}).observe(canvas);

window.addEventListener('resize', () => {
  build();
  if (reduced) once(); else start();
});

if (fine) {
  hero.addEventListener('pointermove', e => {
    const rect = hero.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    // invert the projection at the field's mean height
    const a = (mx - view.ox) / (view.tw / 2);
    const b = (my - view.oy + 0.8 * view.th) / (view.th / 2);
    const gx = Math.floor((a + b) / 2);
    const gy = Math.floor((b - a) / 2);
    if (gx >= 0 && gx < N && gy >= 0 && gy < N) {
      hover.gx = gx;
      hover.gy = gy;
      hover.on = true;
      tip.textContent = 'plot ' + (gy * N + gx) + ' · ' + (3.1 + hash(gx, gy) * 2.7).toFixed(1) + '% apy';
      tip.style.left = mx + 16 + 'px';
      tip.style.top = my - 30 + 'px';
      tip.hidden = false;
    } else {
      hover.on = false;
      tip.hidden = true;
    }
    if (reduced) once();
  });
  hero.addEventListener('pointerleave', () => {
    hover.on = false;
    tip.hidden = true;
    if (reduced) once();
  });
}

build();
if (reduced) once(); else start();

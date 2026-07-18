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

// deterministic plot economics: summit plots (near grid origin, the diamond's
// top vertex) command a premium
function plotInfo(x, y) {
  const near = Math.exp(-(x * x + y * y) / 1200);
  const price = Math.round(((80 + hash(x + 101, y + 7) * 240) * (1 + 1.6 * near)) / 5) * 5;
  const apy = 3.1 + hash(x, y) * 2.7;
  return { price, apy };
}

function tipShow(e, l1, l2) {
  tip.innerHTML = '<b>' + l1 + '</b><i>' + l2 + '</i>';
  tip.style.left = (e.clientX > window.innerWidth - 220 ? e.clientX - 210 : e.clientX + 16) + 'px';
  tip.style.top = e.clientY - 44 + 'px';
  tip.hidden = false;
}

function tipHide() {
  tip.hidden = true;
}

function showTip(e, plot, info, owned) {
  const line1 = owned ? 'plot ' + plot + ' · owned' : 'plot ' + plot + ' · $' + info.price;
  const line2 = owned
    ? info.apy.toFixed(1) + '% apy · off the market'
    : info.apy.toFixed(1) + '% apy · pays ~$' + ((info.price * info.apy) / 100).toFixed(2) + '/yr';
  tipShow(e, line1, line2);
}

function isoX(v, x, y) {
  return v.ox + ((x - y) * v.tw) / 2;
}
function isoY(v, x, y, z) {
  return v.oy + ((x + y) * v.th) / 2 - z * v.th;
}

// extruded block: two shaded side faces dropping to Z0, flat top
function prism(c2, v, x0, y0, x1, y1, z, top) {
  const ax = isoX(v, x0, y0), ay = isoY(v, x0, y0, z);
  const bx = isoX(v, x1, y0), by = isoY(v, x1, y0, z);
  const cx = isoX(v, x1, y1), cy = isoY(v, x1, y1, z);
  const dx = isoX(v, x0, y1), dy = isoY(v, x0, y1, z);
  const drop = (z - Z0) * v.th;
  c2.fillStyle = FACE_L;
  c2.beginPath();
  c2.moveTo(dx, dy); c2.lineTo(cx, cy); c2.lineTo(cx, cy + drop); c2.lineTo(dx, dy + drop);
  c2.closePath(); c2.fill();
  c2.fillStyle = FACE_R;
  c2.beginPath();
  c2.moveTo(cx, cy); c2.lineTo(bx, by); c2.lineTo(bx, by + drop); c2.lineTo(cx, cy + drop);
  c2.closePath(); c2.fill();
  c2.fillStyle = top;
  c2.beginPath();
  c2.moveTo(ax, ay); c2.lineTo(bx, by); c2.lineTo(cx, cy); c2.lineTo(dx, dy);
  c2.closePath(); c2.fill();
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
    prism(ctx, view, x + IN, y + IN, x + 1 - IN, y + 1 - IN, z, isHover ? HOVER_TOP : TOPS[tint[i]]);
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
      showTip(e, gy * N + gx, plotInfo(gx, gy), false);
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

// the district: a sticky scene where scroll mints deeds into a skyline.
// height is a pure function of scroll progress, so it only redraws on scroll.

const CLAIMED_TOP = '#4d84c3';

const growSec = document.getElementById('build');
const growCanvas = document.getElementById('grow');
const gctx = growCanvas.getContext('2d');
const gview = { w: 0, h: 0, tw: 0, th: 0, ox: 0, oy: 0 };

let M = 0;
let gcount = 0;
let gxs, gys, gzT, grank, gclaim, gtint, gindex;

function gbuild() {
  const wrap = growCanvas.parentElement;
  const w = wrap.clientWidth, h = wrap.clientHeight;
  gview.w = w; gview.h = h;
  const dpr = Math.min(window.devicePixelRatio || 1, w < 700 ? 1.5 : 2);
  growCanvas.width = Math.round(w * dpr);
  growCanvas.height = Math.round(h * dpr);
  gctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const tw = Math.max(24, Math.min(40, w / 36));
  gview.tw = tw;
  gview.th = tw / 2;
  M = Math.max(16, Math.min(26, Math.round((w * 0.82) / tw)));
  gview.ox = w / 2;
  gview.oy = h * 0.3;

  gcount = M * M;
  gxs = new Int16Array(gcount);
  gys = new Int16Array(gcount);
  gzT = new Float32Array(gcount);
  gclaim = new Uint8Array(gcount);
  gtint = new Uint8Array(gcount);
  grank = new Uint16Array(gcount);
  gindex = new Uint16Array(gcount); // (y * M + x) -> tile index

  let i = 0;
  for (let s = 0; s <= 2 * M - 2; s++) {
    for (let x = Math.max(0, s - M + 1); x <= Math.min(M - 1, s); x++) {
      const y = s - x;
      gxs[i] = x;
      gys[i] = y;
      const tower = hash(x + 29, y + 43) > 0.9;
      gzT[i] = tower ? 1.6 + hash(x + 3, y + 11) * 1.8 : 0.35 + hash(x + 7, y + 13) * 0.85;
      gclaim[i] = hash(x + 61, y + 5) < 0.3 ? 1 : 0;
      gtint[i] = (hash(x, y) * 997) % 3 | 0;
      gindex[y * M + x] = i;
      i++;
    }
  }
  // mint order: a deterministic shuffle so the district fills in scattered
  const ord = Array.from({ length: gcount }, (_, k) => k);
  ord.sort((a, b) => hash(gxs[a] + 53, gys[a] + 91) - hash(gxs[b] + 53, gys[b] + 91));
  for (let k = 0; k < gcount; k++) grank[ord[k]] = k;
}

function growP() {
  const r = growSec.getBoundingClientRect();
  const total = r.height - window.innerHeight;
  if (total <= 0) return 1;
  return Math.min(1, Math.max(0, -r.top / total));
}

function easeOutBack(q) {
  const c1 = 1.70158, c3 = c1 + 1;
  const u = q - 1;
  return 1 + c3 * u * u * u + c1 * u * u;
}

const ghover = { gx: -1, gy: -1, on: false };

function grender() {
  gctx.fillStyle = BG;
  gctx.fillRect(0, 0, gview.w, gview.h);
  const reveal = growP() * (gcount + 40);
  for (let i = 0; i < gcount; i++) {
    const k = reveal - grank[i];
    let z = 0.08; // unminted plots sit as paving slabs
    let top = TOPS[gtint[i]];
    if (k > 0) {
      const q = k >= 30 ? 1 : k / 30;
      z = 0.08 + (gzT[i] - 0.08) * easeOutBack(q);
      if (gclaim[i] && q > 0.6) top = CLAIMED_TOP;
    }
    if (ghover.on && gxs[i] === ghover.gx && gys[i] === ghover.gy) top = HOVER_TOP;
    prism(gctx, gview, gxs[i] + IN, gys[i] + IN, gxs[i] + 1 - IN, gys[i] + 1 - IN, z, top);
  }
}

let graf = 0;
function gschedule() {
  if (!graf) graf = requestAnimationFrame(() => { graf = 0; grender(); });
}

window.addEventListener('scroll', () => {
  const r = growSec.getBoundingClientRect();
  if (r.top < window.innerHeight && r.bottom > 0) gschedule();
}, { passive: true });

window.addEventListener('resize', () => {
  gbuild();
  gschedule();
});

if (fine) {
  growCanvas.addEventListener('pointermove', e => {
    const rect = growCanvas.getBoundingClientRect();
    const a = (e.clientX - rect.left - gview.ox) / (gview.tw / 2);
    const b = (e.clientY - rect.top - gview.oy + 0.5 * gview.th) / (gview.th / 2);
    const gx = Math.floor((a + b) / 2);
    const gy = Math.floor((b - a) / 2);
    if (gx >= 0 && gx < M && gy >= 0 && gy < M) {
      ghover.gx = gx;
      ghover.gy = gy;
      ghover.on = true;
      const i = gindex[gy * M + gx];
      const minted = growP() * (gcount + 40) - grank[i] > 18; // matches q > 0.6
      showTip(e, gy * M + gx, plotInfo(gx, gy), minted && gclaim[i] === 1);
    } else {
      ghover.on = false;
      tip.hidden = true;
    }
    gschedule();
  });
  growCanvas.addEventListener('pointerleave', () => {
    ghover.on = false;
    tip.hidden = true;
    gschedule();
  });
}

gbuild();
grender();

// shared renderer pieces for chain.js (the live map)
window.utopia = { prism, hash, tipShow, tipHide, IN, BG, TOPS, HOVER_TOP, CLAIMED_TOP, fine, reduced };

// reveal text sections once they enter the viewport
document.documentElement.classList.add('js');
const fades = document.querySelectorAll('.fade');
if (reduced) {
  fades.forEach(el => el.classList.add('in'));
} else {
  const io = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (e.isIntersecting) {
        e.target.classList.add('in');
        io.unobserve(e.target);
      }
    }
  }, { threshold: 0.15 });
  fades.forEach(el => io.observe(el));
}

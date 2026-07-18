// shared isometric renderer pieces for module pages (the landing's art.js
// keeps its own classic-script copies)

export const BG = '#0c2340';
export const FACE_L = '#4d84c3';
export const FACE_R = '#33608f';
export const TOPS = ['#e9f2fb', '#e0edf9', '#d6e7f7'];
export const HOVER_TOP = '#ffffff';
export const CLAIMED_TOP = '#4d84c3';
export const IN = 0.06;
export const Z0 = -1.4;

export function hash(x, y) {
  let h = ((x * 374761393 + y * 668265263) ^ 88339) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function isoX(v, x, y) {
  return v.ox + ((x - y) * v.tw) / 2;
}
function isoY(v, x, y, z) {
  return v.oy + ((x + y) * v.th) / 2 - z * v.th;
}

export function prism(c2, v, x0, y0, x1, y1, z, top) {
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

export function makeTip(el) {
  return {
    show(e, l1, l2) {
      el.innerHTML = '<b>' + l1 + '</b><i>' + l2 + '</i>';
      el.style.left = (e.clientX > window.innerWidth - 220 ? e.clientX - 210 : e.clientX + 16) + 'px';
      el.style.top = e.clientY - 44 + 'px';
      el.hidden = false;
    },
    hide() {
      el.hidden = true;
    },
  };
}

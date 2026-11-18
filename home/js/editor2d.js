// 2D 平面編輯器（SVG）。單位：米。
import { polyArea, polyCentroid, polyBBox, pointInPoly, projectToSeg, dist, wallLen, snap, r3, uid, newRoom, newWall, newOpening, rectPoly, addWallsForRoom, nearestWall, coincidentRefs, setRefs, mergeSegments, FLOOR_MATS } from './model.js';
import { KINDS, kindInfo } from './furniture.js';
import { deviceVisual } from './devices.js';

const NS = 'http://www.w3.org/2000/svg';
const MAT_FILL = { wood: '#ead7bf', tile: '#e3e7ea', marble: '#eeedea', carpet: '#d9d6e6', concrete: '#dcdad5', deck: '#dcc6a8', grass: '#d4e8c4' };
const CAT_FILL = { 客廳: '#c9d6e8', 餐廳: '#e8d8c0', 廚房: '#d8e3d0', 睡房: '#e6d3df', 書房: '#d6dfe8', 浴室: '#cfe6ec', 戶外: '#cfe3c4', 其他: '#ddd' };

export class Editor2D {
  constructor(host, store, cb = {}) {
    this.host = host; this.store = store; this.cb = cb;
    this.svg = document.createElementNS(NS, 'svg'); this.svg.classList.add('ed-svg'); host.appendChild(this.svg);
    this.vb = { x: -1, y: -1, w: 12, h: 10 }; this.tool = 'select'; this.sel = null; this.floorId = null; this.autoWalls = true;
    this.pointers = new Map(); this.drag = null; this.wallChain = null; this.hover = null;
    this.svg.addEventListener('pointerdown', e => this.down(e));
    this.svg.addEventListener('pointermove', e => this.move(e));
    this.svg.addEventListener('pointerup', e => this.up(e));
    this.svg.addEventListener('pointercancel', e => this.up(e));
    this.svg.addEventListener('dblclick', e => { if (this.tool === 'wall') this.endChain(); });
    this.svg.addEventListener('wheel', e => { e.preventDefault(); const p = this.toWorld(e); this.zoomAt(p, Math.exp(e.deltaY * 0.0015)); }, { passive: false });
    this.svg.addEventListener('contextmenu', e => e.preventDefault());
    new ResizeObserver(() => { this.fixAspect(); this.render(); }).observe(host);
  }
  get floor() { return this.store.home.floors.find(f => f.id === this.floorId) || this.store.home.floors[0]; }
  setFloor(id) { this.floorId = id; this.sel = null; this.render(); }
  setTool(t, arg) { this.tool = t; this.toolArg = arg; this.wallChain = null; this.svg.dataset.tool = t; this.render(); }
  select(sel, notify = true) { this.sel = sel; this.render(); if (notify) this.cb.onSelect?.(sel); }

  // ------------------------------------------------------------ view
  fixAspect() {
    const W = this.host.clientWidth || 1, H = this.host.clientHeight || 1, cx = this.vb.x + this.vb.w / 2, cy = this.vb.y + this.vb.h / 2;
    const s = Math.max(this.vb.w / W, this.vb.h / H); this.vb.w = W * s; this.vb.h = H * s; this.vb.x = cx - this.vb.w / 2; this.vb.y = cy - this.vb.h / 2;
  }
  fit() {
    const f = this.floor; let pts = [];
    for (const r of f.rooms) pts.push(...r.poly); for (const w of f.walls) pts.push(w.a, w.b);
    if (f.underlay) pts.push([f.underlay.x, f.underlay.y], [f.underlay.x + f.underlay.w, f.underlay.y + f.underlay.h]);
    if (!pts.length) pts = [[0, 0], [8, 6]];
    const bb = polyBBox(pts), m = 1.2;
    this.vb = { x: bb.x0 - m, y: bb.y0 - m, w: bb.w + 2 * m, h: bb.h + 2 * m }; this.fixAspect(); this.render();
  }
  get scale() { return (this.host.clientWidth || 1) / this.vb.w; } // px per m
  toWorld(e) { const r = this.svg.getBoundingClientRect(); return [this.vb.x + (e.clientX - r.left) / r.width * this.vb.w, this.vb.y + (e.clientY - r.top) / r.height * this.vb.h]; }
  zoomAt(p, k) {
    const nw = Math.max(1.5, Math.min(300, this.vb.w * k)), kk = nw / this.vb.w;
    this.vb = { x: p[0] - (p[0] - this.vb.x) * kk, y: p[1] - (p[1] - this.vb.y) * kk, w: nw, h: this.vb.h * kk }; this.render();
  }
  center() { return [this.vb.x + this.vb.w / 2, this.vb.y + this.vb.h / 2]; }

  // ------------------------------------------------------------ render
  el(tag, attrs, parent) { const e = document.createElementNS(NS, tag); for (const k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]); (parent || this.svg).appendChild(e); return e; }
  text(x, y, s, size, parent, attrs = {}) {
    const cls = attrs.class || '', halo = /halo|ed-dim/.test(cls) ? 3 / this.scale : null;
    const t = this.el('text', { x, y, 'font-size': size / this.scale, 'text-anchor': 'middle', 'dominant-baseline': 'middle', class: 'ed-txt', 'stroke-width': halo, ...attrs }, parent); t.textContent = s; return t;
  }
  render() {
    const svg = this.svg, f = this.floor; if (!f) return;
    svg.setAttribute('viewBox', `${this.vb.x} ${this.vb.y} ${this.vb.w} ${this.vb.h}`);
    svg.innerHTML = '';
    const px = 1 / this.scale;
    // 格
    const defs = this.el('defs', {});
    const pat = this.el('pattern', { id: 'g1', width: 1, height: 1, patternUnits: 'userSpaceOnUse' }, defs);
    this.el('path', { d: 'M1 0H0V1', fill: 'none', stroke: 'var(--grid)', 'stroke-width': px }, pat);
    for (let i = 1; i < 4; i++) this.el('path', { d: `M${i / 4} 0V1M0 ${i / 4}H1`, fill: 'none', stroke: 'var(--grid2)', 'stroke-width': px * 0.6 }, pat);
    this.el('rect', { x: this.vb.x, y: this.vb.y, width: this.vb.w, height: this.vb.h, fill: 'url(#g1)', 'data-k': 'bg' });
    if (f.underlay?.src && f.underlay.show !== false) this.el('image', { href: f.underlay.src, x: f.underlay.x, y: f.underlay.y, width: f.underlay.w, height: f.underlay.h, opacity: f.underlay.opacity ?? 0.6, preserveAspectRatio: 'none', 'pointer-events': 'none' });
    // 房
    const gR = this.el('g', {});
    for (const r of f.rooms) {
      const on = this.sel?.kind === 'room' && this.sel.id === r.id;
      this.el('polygon', { points: r.poly.map(p => p.join(',')).join(' '), fill: MAT_FILL[r.floorMat] || '#eee', 'fill-opacity': r.noWalls ? 0.55 : 0.9, stroke: on ? 'var(--acc)' : r.checked === false ? '#e0a020' : 'none', 'stroke-width': (on ? 2.5 : 1.5) * px, 'stroke-dasharray': r.checked === false && !on ? `${6 * px} ${4 * px}` : null, 'data-k': 'room', 'data-id': r.id, class: 'ed-room' }, gR);
    }
    // 牆
    const gW = this.el('g', {});
    for (const w of f.walls) {
      const L = wallLen(w); if (L < 1e-3) continue;
      const ux = (w.b[0] - w.a[0]) / L, uy = (w.b[1] - w.a[1]) / L, nx = -uy, ny = ux, t = (w.t || 0.12) / 2;
      const on = this.sel?.kind === 'wall' && this.sel.id === w.id;
      const pts = [[w.a[0] - ux * t + nx * t, w.a[1] - uy * t + ny * t], [w.b[0] + ux * t + nx * t, w.b[1] + uy * t + ny * t], [w.b[0] + ux * t - nx * t, w.b[1] + uy * t - ny * t], [w.a[0] - ux * t - nx * t, w.a[1] - uy * t - ny * t]];
      this.el('polygon', { points: pts.map(p => p.join(',')).join(' '), fill: on ? 'var(--acc)' : 'var(--wall)', 'data-k': 'wall', 'data-id': w.id, class: 'ed-wall' }, gW);
      for (const o of w.openings) this.drawOpening(gW, w, o, ux, uy, nx, ny, px);
    }
    // 傢俬
    const gI = this.el('g', {});
    for (const it of f.items) {
      const k = kindInfo(it.kind), w = it.w || k.w, d = it.d || k.d, on = this.sel?.kind === 'item' && this.sel.id === it.id;
      const g = this.el('g', { transform: `translate(${it.x} ${it.y}) rotate(${it.rot || 0})`, 'data-k': 'item', 'data-id': it.id, class: 'ed-item' }, gI);
      this.el('rect', { x: -w / 2, y: -d / 2, width: w, height: d, rx: Math.min(w, d) * 0.06, fill: it.color || CAT_FILL[k.cat] || '#ddd', 'fill-opacity': it.kind === 'rug' ? 0.45 : 0.92, stroke: on ? 'var(--acc)' : '#6b6f76', 'stroke-width': (on ? 2.2 : 0.8) * px }, g);
      this.el('line', { x1: -w / 2 + 0.04, y1: d / 2 - 0.03, x2: w / 2 - 0.04, y2: d / 2 - 0.03, stroke: '#6b6f76', 'stroke-width': 1.6 * px, 'stroke-opacity': 0.6 }, g);
      if (Math.min(w, d) * this.scale > 22) this.text(0, 0, it.name || k.zh, 10, g, { transform: (((it.rot || 0) % 360) + 360) % 360 > 90 && (((it.rot || 0) % 360) + 360) % 360 <= 270 ? 'rotate(180)' : null, class: 'ed-txt ed-it' }).setAttribute('pointer-events', 'none');
      if (on) { const hy = -d / 2 - 22 * px; this.el('line', { x1: 0, y1: -d / 2, x2: 0, y2: hy, stroke: 'var(--acc)', 'stroke-width': px }, g); this.el('circle', { cx: 0, cy: hy, r: 6 * px, class: 'ed-h ed-rot', 'data-k': 'h-rot', 'data-id': it.id }, g); }
    }
    // 裝置
    const gD = this.el('g', {});
    for (const d of f.devices) {
      const on = this.sel?.kind === 'device' && this.sel.id === d.id, vis = deviceVisual(d, this.cb.stateOf?.(d.entity));
      const g = this.el('g', { transform: `translate(${d.x} ${d.y})`, 'data-k': 'device', 'data-id': d.id, class: 'ed-dev' }, gD);
      this.el('circle', { r: 11 * px, fill: vis.on ? '#ffb347' : 'var(--devbg)', stroke: on ? 'var(--acc)' : '#fff', 'stroke-width': (on ? 3 : 1.5) * px }, g);
      this.text(0, 0.5 * px, vis.icon, 11, g).setAttribute('pointer-events', 'none');
    }
    // 房名
    const gL = this.el('g', { 'pointer-events': 'none' });
    for (const r of f.rooms) {
      const c = polyCentroid(r.poly), bb = polyBBox(r.poly);
      if (bb.w * this.scale < 34) continue;
      this.text(c[0], c[1] - 7 * px, r.name, 13, gL, { class: 'ed-txt ed-rn halo' });
      this.text(c[0], c[1] + 8 * px, `${polyArea(r.poly).toFixed(1)} m²${r.area ? ' · HA' : ''}${r.checked === false ? ' · 待核對' : ''}`, 10.5, gL, { class: 'ed-txt ed-ra halo' });
    }
    // 選取把手
    const gH = this.el('g', {});
    const sel = this.sel;
    if (sel?.kind === 'room') {
      const r = f.rooms.find(r => r.id === sel.id);
      if (r) {
        r.poly.forEach((p, i) => {
          const q = r.poly[(i + 1) % r.poly.length], m = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], L = dist(p, q);
          if (L * this.scale > 40) { this.dim(gH, p, q, px); this.el('circle', { cx: m[0], cy: m[1], r: 6 * px, class: 'ed-h ed-mid', 'data-k': 'h-mid', 'data-i': i }, gH); this.text(m[0], m[1], '+', 11, gH, { 'pointer-events': 'none', class: 'ed-txt ed-plus' }); }
        });
        r.poly.forEach((p, i) => this.el('circle', { cx: p[0], cy: p[1], r: 7 * px, class: 'ed-h', 'data-k': 'h-v', 'data-i': i }, gH));
      }
    } else if (sel?.kind === 'wall') {
      const w = f.walls.find(w => w.id === sel.id);
      if (w) { this.dim(gH, w.a, w.b, px, (w.t || 0.12) / 2 + 14 * px); for (const k of ['a', 'b']) this.el('circle', { cx: w[k][0], cy: w[k][1], r: 7 * px, class: 'ed-h', 'data-k': 'h-w', 'data-end': k }, gH); }
    }
    // 工具預覽
    if (this.preview) this.preview(gH, px);
  }
  drawOpening(g, w, o, ux, uy, nx, ny, px) {
    const t = (w.t || 0.12) / 2 + 0.01, s = o.at - o.w / 2, e = o.at + o.w / 2;
    const P = (al, off) => [w.a[0] + ux * al + nx * off, w.a[1] + uy * al + ny * off];
    const on = this.sel?.kind === 'opening' && this.sel.id === o.id;
    const pts = [P(s, t), P(e, t), P(e, -t), P(s, -t)];
    const grp = this.el('g', { 'data-k': 'opening', 'data-id': o.id, 'data-wall': w.id, class: 'ed-op' }, g);
    this.el('polygon', { points: pts.map(p => p.join(',')).join(' '), fill: 'var(--bg2d)', stroke: on ? 'var(--acc)' : 'none', 'stroke-width': 2 * px }, grp);
    if (o.type === 'window') {
      for (const off of [-t * 0.45, 0, t * 0.45]) { const a = P(s, off), b = P(e, off); this.el('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: on ? 'var(--acc)' : '#3d7fb8', 'stroke-width': 1.2 * px }, grp); }
    } else if (o.type === 'door') {
      const sg = o.flip ? -1 : 1, right = o.hinge === 'r', hingeAl = right ? e : s, free = right ? s : e;
      const H = P(hingeAl, sg * t * 0.0), F = P(free, 0), open = P(hingeAl, sg * o.w);
      this.el('line', { x1: H[0], y1: H[1], x2: open[0], y2: open[1], stroke: on ? 'var(--acc)' : '#555', 'stroke-width': 2 * px }, grp);
      const sweep = (right ? 1 : 0) ^ (sg > 0 ? 0 : 1);
      this.el('path', { d: `M${F[0]} ${F[1]} A${o.w} ${o.w} 0 0 ${sweep} ${open[0]} ${open[1]}`, fill: 'none', stroke: on ? 'var(--acc)' : '#888', 'stroke-width': px, 'stroke-dasharray': `${4 * px} ${3 * px}` }, grp);
    } else {
      const a = P(s, 0), b = P(e, 0); this.el('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: '#999', 'stroke-width': px, 'stroke-dasharray': `${3 * px} ${3 * px}` }, grp);
    }
  }
  dim(g, a, b, px, off = 0) {
    const L = dist(a, b); if (L < 0.05) return;
    const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L, nx = -uy, ny = ux; off = off || 12 * px;
    const m = [(a[0] + b[0]) / 2 + nx * off, (a[1] + b[1]) / 2 + ny * off];
    let ang = Math.atan2(uy, ux) * 180 / Math.PI; if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
    const t = this.text(m[0], m[1], (L * 100).toFixed(0) + ' cm', 10.5, g, { transform: `rotate(${ang} ${m[0]} ${m[1]})`, class: 'ed-txt ed-dim', 'pointer-events': 'none' });
  }

  // ------------------------------------------------------------ snapping
  snapPt(p, exclude) {
    const f = this.floor, tol = 12 / this.scale; let best = null;
    const test = q => { if (exclude && exclude(q)) return; const d = dist(p, q); if (d < tol && (!best || d < best.d)) best = { q, d }; };
    for (const r of f.rooms) r.poly.forEach(test); for (const w of f.walls) { test(w.a); test(w.b); }
    if (best) return [...best.q];
    return [snap(p[0]), snap(p[1])];
  }
  // 牆工具：角度對正 0/45/90
  angleSnap(a, p) {
    const dx = p[0] - a[0], dy = p[1] - a[1], L = Math.hypot(dx, dy), ang = Math.atan2(dy, dx), st = Math.PI / 4, k = Math.round(ang / st) * st;
    if (Math.abs(ang - k) < 0.1) return [r3(a[0] + Math.cos(k) * L), r3(a[1] + Math.sin(k) * L)];
    return p;
  }

  // ------------------------------------------------------------ pointer
  hit(e) { const t = e.target.closest?.('[data-k]'); return t ? { k: t.dataset.k, id: t.dataset.id, i: t.dataset.i != null ? +t.dataset.i : null, end: t.dataset.end, wall: t.dataset.wall } : { k: 'bg' }; }
  down(e) {
    this.svg.setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (this.pointers.size === 2) { const [p, q] = [...this.pointers.values()]; this.drag = { type: 'pinch', d0: Math.hypot(p[0] - q[0], p[1] - q[1]), vb0: { ...this.vb }, c0: this.toWorld({ clientX: (p[0] + q[0]) / 2, clientY: (p[1] + q[1]) / 2 }) }; return; }
    const w = this.toWorld(e), h = this.hit(e), f = this.floor;
    if (e.button === 1 || e.button === 2) { this.drag = { type: 'pan', sx: e.clientX, sy: e.clientY, vb0: { ...this.vb } }; return; }
    if (this.tool === 'room') { const p = this.snapPt(w); this.drag = { type: 'newroom', a: p, b: p }; this.preview = (g, px) => this.previewRect(g, px); return; }
    if (this.tool === 'wall') { this.wallClick(w); return; }
    if (this.tool === 'door' || this.tool === 'window' || this.tool === 'opening') {
      const n = nearestWall(f, w, 0.6);
      if (!n) { this.cb.toast?.('撳喺牆上面先加到'); return; }
      const o = newOpening(this.tool, r3(n.pr.along)); const L = wallLen(n.w);
      o.at = r3(Math.min(Math.max(o.at, o.w / 2), L - o.w / 2)); n.w.openings.push(o);
      this.store.commit(); this.setTool('select'); this.cb.onTool?.('select'); this.select({ kind: 'opening', id: o.id, wallId: n.w.id }); return;
    }
    if (this.tool === 'pick') { this.cb.onPickPoint?.(this.snapPt(w)); return; }
    // select 工具
    const start = { x: e.clientX, y: e.clientY, w };
    if (h.k === 'h-v' || h.k === 'h-mid') {
      const r = f.rooms.find(r => r.id === this.sel.id);
      let i = h.i;
      if (h.k === 'h-mid') { const p = r.poly[i], q = r.poly[(i + 1) % r.poly.length]; r.poly.splice(i + 1, 0, [r3((p[0] + q[0]) / 2), r3((p[1] + q[1]) / 2)]); i = i + 1; }
      const refs = h.k === 'h-mid' ? [{ arr: r.poly, i }] : coincidentRefs(f, r.poly[i]);
      this.drag = { type: 'vertex', refs, start, orig: [...r.poly[i]], self: q => q === r.poly[i] }; return;
    }
    if (h.k === 'h-w') { const wl = f.walls.find(x => x.id === this.sel.id); this.drag = { type: 'vertex', refs: coincidentRefs(f, wl[h.end]), start, orig: [...wl[h.end]] }; return; }
    if (h.k === 'h-rot') { const it = f.items.find(i => i.id === h.id); this.drag = { type: 'rot', it, start }; return; }
    if (h.k === 'item') { const it = f.items.find(i => i.id === h.id); this.select({ kind: 'item', id: it.id }); this.drag = { type: 'move', objs: [{ o: it, x: it.x, y: it.y }], start }; return; }
    if (h.k === 'device') { const d = f.devices.find(i => i.id === h.id); this.select({ kind: 'device', id: d.id }); this.drag = { type: 'move', objs: [{ o: d, x: d.x, y: d.y }], start }; return; }
    if (h.k === 'opening') { const wl = f.walls.find(x => x.id === h.wall), o = wl.openings.find(o => o.id === h.id); this.select({ kind: 'opening', id: o.id, wallId: wl.id }); this.drag = { type: 'slide', wl, o, start }; return; }
    if (h.k === 'wall') { const wl = f.walls.find(x => x.id === h.id); this.select({ kind: 'wall', id: wl.id }); this.drag = { type: 'movewall', wl, a: [...wl.a], b: [...wl.b], refsA: coincidentRefs(f, wl.a).filter(r => r.obj !== wl), refsB: coincidentRefs(f, wl.b).filter(r => r.obj !== wl), start }; return; }
    if (h.k === 'room') {
      const r = f.rooms.find(r => r.id === h.id); this.select({ kind: 'room', id: r.id });
      const inside = q => pointInPoly([q.x, q.y], r.poly);
      const objs = [...f.items.filter(inside), ...f.devices.filter(inside)].map(o => ({ o, x: o.x, y: o.y }));
      const verts = r.poly.map(p => [...p]);
      const own = f.walls.filter(w => r.poly.some(p => dist(p, w.a) < 0.02) && r.poly.some(p => dist(p, w.b) < 0.02) && !f.rooms.some(o => o !== r && !o.noWalls && pointInPoly(midOff(w, 0.12), o.poly) || o !== r && !o.noWalls && pointInPoly(midOff(w, -0.12), o.poly)));
      this.drag = { type: 'moveroom', r, verts, objs, walls: own.map(w => ({ w, a: [...w.a], b: [...w.b] })), start }; return;
    }
    // 空白：取消選取 + 拖動畫面
    if (this.sel) this.select(null);
    this.drag = { type: 'pan', sx: e.clientX, sy: e.clientY, vb0: { ...this.vb } };
  }
  move(e) {
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, [e.clientX, e.clientY]);
    const d = this.drag, w = this.toWorld(e);
    if (this.tool === 'wall' && this.wallChain) { this.cursor = this.angleSnap(this.wallChain.last, this.snapPt(w)); this.render(); }
    if (!d) return;
    if (d.type === 'pinch') {
      if (this.pointers.size < 2) return; const [p, q] = [...this.pointers.values()]; const dd = Math.hypot(p[0] - q[0], p[1] - q[1]);
      const k = d.d0 / Math.max(dd, 1); const nw = Math.max(1.5, Math.min(300, d.vb0.w * k)), kk = nw / d.vb0.w;
      const r = this.svg.getBoundingClientRect(), mx = ((p[0] + q[0]) / 2 - r.left) / r.width, my = ((p[1] + q[1]) / 2 - r.top) / r.height;
      this.vb = { x: d.c0[0] - mx * nw, y: d.c0[1] - my * d.vb0.h * kk, w: nw, h: d.vb0.h * kk }; this.render(); return;
    }
    if (d.type === 'pan') { const r = this.svg.getBoundingClientRect(); this.vb.x = d.vb0.x - (e.clientX - d.sx) / r.width * d.vb0.w; this.vb.y = d.vb0.y - (e.clientY - d.sy) / r.height * d.vb0.h; this.render(); return; }
    if (d.start && !d.moved && Math.hypot(e.clientX - d.start.x, e.clientY - d.start.y) < 4) return;
    if (d.start) d.moved = true;
    const dx = snap(w[0] - (d.start?.w[0] ?? 0)), dy = snap(w[1] - (d.start?.w[1] ?? 0));
    if (d.type === 'newroom') { d.b = this.snapPt(w); this.render(); return; }
    if (d.type === 'vertex') { const refsSet = new Set(d.refs.map(r => r.arr ? r.arr[r.i] : r.obj[r.k])); const p = this.snapPt(w, q => refsSet.has(q)); setRefs(d.refs, p); }
    else if (d.type === 'move') for (const o of d.objs) { o.o.x = r3(o.x + dx); o.o.y = r3(o.y + dy); }
    else if (d.type === 'rot') { const a = Math.atan2(w[1] - d.it.y, w[0] - d.it.x) * 180 / Math.PI + 90; d.it.rot = ((Math.round(a / 15) * 15) % 360 + 360) % 360; }
    else if (d.type === 'slide') { const pr = projectToSeg(w, d.wl.a, d.wl.b), L = wallLen(d.wl); d.o.at = r3(Math.min(Math.max(snap(pr.along, 0.05), d.o.w / 2), L - d.o.w / 2)); }
    else if (d.type === 'movewall') {
      const L = wallLen(d.wl), nx = -(d.b[1] - d.a[1]) / L, ny = (d.b[0] - d.a[0]) / L, off = snap(dx * nx + dy * ny);
      d.wl.a = [r3(d.a[0] + nx * off), r3(d.a[1] + ny * off)]; d.wl.b = [r3(d.b[0] + nx * off), r3(d.b[1] + ny * off)];
      setRefs(d.refsA, d.wl.a); setRefs(d.refsB, d.wl.b);
    } else if (d.type === 'moveroom') {
      d.r.poly.forEach((p, i) => { p[0] = r3(d.verts[i][0] + dx); p[1] = r3(d.verts[i][1] + dy); });
      for (const o of d.objs) { o.o.x = r3(o.x + dx); o.o.y = r3(o.y + dy); }
      for (const o of d.walls) { o.w.a = [r3(o.a[0] + dx), r3(o.a[1] + dy)]; o.w.b = [r3(o.b[0] + dx), r3(o.b[1] + dy)]; }
    }
    this.render(); this.cb.onLive?.();
  }
  up(e) {
    this.pointers.delete(e.pointerId);
    const d = this.drag; if (!d) return;
    if (d.type === 'pinch') { if (this.pointers.size < 2) this.drag = null; return; }
    this.drag = null;
    if (d.type === 'newroom') {
      this.preview = null;
      const x = Math.min(d.a[0], d.b[0]), y = Math.min(d.a[1], d.b[1]), w = Math.abs(d.b[0] - d.a[0]), h = Math.abs(d.b[1] - d.a[1]);
      if (w < 0.3 || h < 0.3) { this.render(); return; }
      const f = this.floor, r = newRoom(`房間 ${f.rooms.length + 1}`, rectPoly(x, y, w, h));
      f.rooms.push(r); if (this.autoWalls) addWallsForRoom(f, r);
      this.store.commit(); this.setTool('select'); this.cb.onTool?.('select'); this.select({ kind: 'room', id: r.id }); return;
    }
    if (d.type === 'pan') return;
    if (d.moved) { if (d.type === 'vertex') this.cleanupWalls(); this.store.commit(); this.cb.onSelect?.(this.sel); }
  }
  cleanupWalls() { const f = this.floor; f.walls = f.walls.filter(w => wallLen(w) > 0.02); for (const r of f.rooms) r.poly = r.poly.filter((p, i) => dist(p, r.poly[(i + 1) % r.poly.length]) > 0.01); }
  previewRect(g, px) {
    const d = this.drag; if (!d) return; const x = Math.min(d.a[0], d.b[0]), y = Math.min(d.a[1], d.b[1]), w = Math.abs(d.b[0] - d.a[0]), h = Math.abs(d.b[1] - d.a[1]);
    this.el('rect', { x, y, width: w, height: h, fill: 'var(--acc)', 'fill-opacity': 0.15, stroke: 'var(--acc)', 'stroke-width': 2 * px }, g);
    this.text(x + w / 2, y + h / 2, `${(w * 100).toFixed(0)} × ${(h * 100).toFixed(0)} cm`, 12, g, { class: 'ed-txt ed-dim' });
  }
  wallClick(w) {
    const p = this.wallChain ? this.angleSnap(this.wallChain.last, this.snapPt(w)) : this.snapPt(w), f = this.floor;
    if (!this.wallChain) {
      this.wallChain = { first: p, last: p }; this.cursor = p;
      this.preview = (g, px) => { const c = this.wallChain; if (!c || !this.cursor) return; this.el('line', { x1: c.last[0], y1: c.last[1], x2: this.cursor[0], y2: this.cursor[1], stroke: 'var(--acc)', 'stroke-width': 0.12, 'stroke-opacity': 0.6 }, g); this.dim(g, c.last, this.cursor, px); this.el('circle', { cx: c.last[0], cy: c.last[1], r: 5 * px, fill: 'var(--acc)' }, g); };
      this.render(); return;
    }
    if (dist(p, this.wallChain.last) < 0.05) { this.endChain(); return; }
    f.walls.push(newWall(this.wallChain.last, p, 0.12)); this.store.commit();
    if (dist(p, this.wallChain.first) < 0.05) { this.endChain(); return; }
    this.wallChain.last = p; this.render();
  }
  endChain() { this.wallChain = null; this.preview = null; this.render(); }

  // ------------------------------------------------------------ keyboard / ops
  deleteSel() {
    const s = this.sel, f = this.floor; if (!s) return;
    if (s.kind === 'room') f.rooms = f.rooms.filter(r => r.id !== s.id);
    else if (s.kind === 'wall') f.walls = f.walls.filter(w => w.id !== s.id);
    else if (s.kind === 'item') f.items = f.items.filter(i => i.id !== s.id);
    else if (s.kind === 'device') f.devices = f.devices.filter(i => i.id !== s.id);
    else if (s.kind === 'opening') for (const w of f.walls) w.openings = w.openings.filter(o => o.id !== s.id);
    this.store.commit(); this.select(null);
  }
  duplicateSel() {
    const s = this.sel, f = this.floor; if (!s) return;
    const list = s.kind === 'item' ? f.items : s.kind === 'device' ? f.devices : null; if (!list) return;
    const o = list.find(i => i.id === s.id); const c = { ...structuredClone(o), id: uid(s.kind === 'item' ? 'i' : 'd'), x: r3(o.x + 0.3), y: r3(o.y + 0.3) };
    list.push(c); this.store.commit(); this.select({ kind: s.kind, id: c.id });
  }
  rotateSel(deg = 90) { const s = this.sel; if (s?.kind !== 'item') return; const it = this.floor.items.find(i => i.id === s.id); it.rot = (((it.rot || 0) + deg) % 360 + 360) % 360; this.store.commit(); this.render(); this.cb.onSelect?.(s); }
  addItem(kind) {
    const k = KINDS[kind], c = this.center(), f = this.floor;
    const it = { id: uid('i'), kind, name: k.zh, x: snap(c[0]), y: snap(c[1]), w: k.w, d: k.d, h: 0, rot: 0, elev: kind === 'tv' ? 0.5 : 0, color: '' };
    f.items.push(it); this.store.commit(); this.setTool('select'); this.cb.onTool?.('select'); this.select({ kind: 'item', id: it.id });
  }
  addDevice(entity, name, z = 2.3, at) {
    const c = at || this.center(), f = this.floor;
    const d = { id: uid('d'), entity, name: name || '', x: snap(c[0]), y: snap(c[1]), z, rot: 0 };
    f.devices.push(d); this.store.commit(); this.select({ kind: 'device', id: d.id }); return d;
  }
}
function midOff(w, off) { const L = wallLen(w) || 1; return [(w.a[0] + w.b[0]) / 2 - (w.b[1] - w.a[1]) / L * off, (w.a[1] + w.b[1]) / 2 + (w.b[0] - w.a[0]) / L * off]; }

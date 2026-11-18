// 資料模型：單位一律用「米」。平面座標 (x, y)：x 向右、y 向下；3D 入面 y 平面 → z。
export const uid = (p = 'id') => p + Math.random().toString(36).slice(2, 9);
export const GRID = 0.05;
export const snap = (v, g = GRID) => Math.round(v / g) * g;
export const r3 = v => Math.round(v * 1000) / 1000;

export const FLOOR_MATS = {
  wood: '木地板', tile: '瓷磚', marble: '雲石', carpet: '地氈', concrete: '水泥', deck: '戶外木台', grass: '草地',
};

// ---------------------------------------------------------------- geometry
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export function polyArea(p) {
  let s = 0;
  for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; }
  return Math.abs(s) / 2;
}
export function polyCentroid(p) {
  let x = 0, y = 0, A = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length], c = a[0] * b[1] - b[0] * a[1];
    A += c; x += (a[0] + b[0]) * c; y += (a[1] + b[1]) * c;
  }
  if (Math.abs(A) < 1e-9) { const n = p.length || 1; return [p.reduce((s, q) => s + q[0], 0) / n, p.reduce((s, q) => s + q[1], 0) / n]; }
  return [x / (3 * A), y / (3 * A)];
}
export function polyBBox(p) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of p) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}
export function pointInPoly([x, y], p) {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i], [xj, yj] = p[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
// 點投影去線段：回傳 {t (0..1), d (距離), along (米), p}
export function projectToSeg(pt, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1e-9;
  let t = ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / L2;
  t = Math.max(0, Math.min(1, t));
  const p = [a[0] + dx * t, a[1] + dy * t];
  return { t, d: dist(pt, p), along: t * Math.sqrt(L2), p };
}
export const wallLen = w => dist(w.a, w.b);

// ---------------------------------------------------------------- factories
export function newFloor(name = '地下', elev = 0) {
  return { id: uid('f'), name, elev, height: 2.6, rooms: [], walls: [], items: [], devices: [] };
}
export function newRoom(name, poly, extra = {}) {
  return { id: uid('r'), name, aliases: '', area: '', poly: poly.map(p => [r3(p[0]), r3(p[1])]), floorMat: 'wood', ...extra };
}
export function newWall(a, b, t = 0.12, extra = {}) {
  return { id: uid('w'), a: [r3(a[0]), r3(a[1])], b: [r3(b[0]), r3(b[1])], t, h: null, openings: [], ...extra };
}
export function newOpening(type, at, extra = {}) {
  const d = type === 'window' ? { w: 1.2, h: 1.2, sill: 0.9 } : type === 'door' ? { w: 0.9, h: 2.1, sill: 0 } : { w: 1.2, h: 2.2, sill: 0 };
  return { id: uid('o'), type, at, ...d, hinge: 'l', flip: false, entity: '', ...extra };
}
export const rectPoly = (x, y, w, d) => [[x, y], [x + w, y], [x + w, y + d], [x, y + d]];

// ---------------------------------------------------------------- walls from rooms
// 將房間邊轉成牆，再將同一直線、重疊嘅牆合併。
export function wallsFromRooms(rooms, tIn = 0.1, tOut = 0.2) {
  const segs = [];
  for (const r of rooms) {
    if (r.noWalls) continue;
    for (let i = 0; i < r.poly.length; i++) segs.push([r.poly[i], r.poly[(i + 1) % r.poly.length]]);
  }
  const merged = mergeSegments(segs);
  // 外牆 = 只有一邊有房（用中點兩側測試）
  return merged.map(([a, b]) => {
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, L = dist(a, b) || 1;
    const nx = -(b[1] - a[1]) / L * 0.15, ny = (b[0] - a[0]) / L * 0.15;
    const s1 = rooms.some(r => !r.noWalls && pointInPoly([mx + nx, my + ny], r.poly));
    const s2 = rooms.some(r => !r.noWalls && pointInPoly([mx - nx, my - ny], r.poly));
    return newWall(a, b, s1 && s2 ? tIn : tOut);
  });
}
// 合併共線重疊線段（任意角度）
export function mergeSegments(segs, tol = 0.02) {
  const groups = [];
  for (let [a, b] of segs) {
    const L = dist(a, b); if (L < 1e-3) continue;
    let ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
    if (ux < -1e-6 || (Math.abs(ux) < 1e-6 && uy < 0)) { ux = -ux; uy = -uy; [a, b] = [b, a]; }
    const off = -uy * a[0] + ux * a[1]; // 法向距離
    let g = groups.find(g => Math.abs(g.ux * uy - g.uy * ux) < 1e-3 && Math.abs(g.off - off) < tol);
    if (!g) { g = { ux, uy, off, iv: [] }; groups.push(g); }
    const s0 = a[0] * g.ux + a[1] * g.uy, s1 = b[0] * g.ux + b[1] * g.uy;
    g.iv.push([Math.min(s0, s1), Math.max(s0, s1)]);
  }
  const out = [];
  for (const g of groups) {
    g.iv.sort((p, q) => p[0] - q[0]);
    const m = [];
    for (const iv of g.iv) { const l = m[m.length - 1]; if (l && iv[0] <= l[1] + tol) l[1] = Math.max(l[1], iv[1]); else m.push([...iv]); }
    const px = -g.uy * g.off, py = g.ux * g.off;
    for (const [s0, s1] of m) out.push([[r3(px + g.ux * s0), r3(py + g.uy * s0)], [r3(px + g.ux * s1), r3(py + g.uy * s1)]]);
  }
  return out;
}
// 只加未有牆蓋住嘅房間邊
export function addWallsForRoom(floor, room, t = 0.1) {
  const segs = [];
  for (let i = 0; i < room.poly.length; i++) segs.push([room.poly[i], room.poly[(i + 1) % room.poly.length]]);
  let added = 0;
  for (const [a, b] of segs) {
    const covered = floor.walls.some(w => projectToSeg(a, w.a, w.b).d < 0.03 && projectToSeg(b, w.a, w.b).d < 0.03);
    if (!covered) { floor.walls.push(newWall(a, b, t)); added++; }
  }
  return added;
}
// 搵最近嘅牆，用嚟喺某點開門／窗
export function nearestWall(floor, pt, maxD = 0.4) {
  let best = null;
  for (const w of floor.walls) { const pr = projectToSeg(pt, w.a, w.b); if (pr.d < maxD && (!best || pr.d < best.pr.d)) best = { w, pr }; }
  return best;
}
export function addOpeningAt(floor, pt, type, extra = {}) {
  const n = nearestWall(floor, pt, 0.5); if (!n) return null;
  const o = newOpening(type, r3(n.pr.along), extra);
  n.w.openings.push(o); return o;
}
export function roomAt(floor, pt) { return floor.rooms.slice().reverse().find(r => pointInPoly(pt, r.poly)) || null; }

// ---------------------------------------------------------------- normalise (接受 AI 寫嘅簡化格式)
export function normaliseHome(h) {
  if (!h || !Array.isArray(h.floors)) throw new Error('唔係有效嘅 plan（冇 floors）');
  const out = { v: 1, name: h.name || '我的家', floors: [], settings: { ...defaultSettings(), ...(h.settings || {}) } };
  let elev = 0;
  for (const f0 of h.floors) {
    const f = newFloor(f0.name || `${out.floors.length + 1} 樓`, f0.elev ?? elev);
    if (f0.id) f.id = f0.id;
    f.height = +f0.height || 2.6;
    elev = f.elev + f.height + 0.3;
    for (const r of f0.rooms || []) {
      const poly = r.poly || (r.w != null ? rectPoly(+r.x || 0, +r.y || 0, +r.w, +(r.d ?? r.h)) : null);
      if (!poly || poly.length < 3) continue;
      const room = newRoom(r.name || '房間', poly, { aliases: r.aliases || '', area: r.area || '', floorMat: r.floorMat || r.floor || 'wood', checked: r.checked ?? true });
      if (r.id) room.id = r.id; if (r.noWalls) room.noWalls = true; if (r.ceil) room.ceil = r.ceil;
      f.rooms.push(room);
    }
    if (Array.isArray(f0.walls) && f0.walls.length) {
      for (const w of f0.walls) {
        const nw = newWall(w.a, w.b, +w.t || 0.12); if (w.id) nw.id = w.id; if (w.h) nw.h = w.h;
        nw.openings = (w.openings || []).map(o => ({ ...newOpening(o.type || 'door', +o.at || 0), ...o, id: o.id || uid('o') }));
        f.walls.push(nw);
      }
    } else f.walls = wallsFromRooms(f.rooms);
    // 簡化格式：doors/windows 用座標或者 between
    for (const d of f0.doors || []) {
      let pt = d.at;
      if (!pt && d.between) {
        const [ra, rb] = d.between.map(n => f.rooms.find(r => r.name === n || r.id === n));
        if (ra && rb) pt = sharedEdgeMid(ra.poly, rb.poly);
      }
      if (pt) addOpeningAt(f, pt, d.type || 'door', pick(d, ['w', 'h', 'sill', 'hinge', 'flip', 'entity']));
    }
    for (const w of f0.windows || []) if (w.at) addOpeningAt(f, w.at, 'window', pick(w, ['w', 'h', 'sill', 'entity']));
    for (const it of f0.items || f0.furniture || []) {
      f.items.push({ id: it.id || uid('i'), kind: it.kind || 'box', name: it.name || '', x: +it.x || 0, y: +it.y || 0, w: +it.w || 0.6, d: +it.d || 0.6, h: +it.h || 0, rot: +it.rot || 0, elev: +it.elev || 0, color: it.color || '' });
    }
    for (const d of f0.devices || []) f.devices.push({ id: d.id || uid('d'), entity: d.entity || '', name: d.name || '', x: +d.x || 0, y: +d.y || 0, z: d.z ?? 2.3, rot: +d.rot || 0 });
    if (f0.underlay) f.underlay = f0.underlay;
    out.floors.push(f);
  }
  if (!out.floors.length) out.floors.push(newFloor());
  return out;
}
const pick = (o, ks) => Object.fromEntries(ks.filter(k => o[k] != null).map(k => [k, o[k]]));
function sharedEdgeMid(pa, pb) {
  let best = null;
  for (let i = 0; i < pa.length; i++) {
    const a = pa[i], b = pa[(i + 1) % pa.length];
    for (let j = 0; j < pb.length; j++) {
      const c = pb[j], d = pb[(j + 1) % pb.length];
      const p1 = projectToSeg(c, a, b), p2 = projectToSeg(d, a, b);
      if (p1.d < 0.05 && p2.d < 0.05 || projectToSeg(a, c, d).d < 0.05 && projectToSeg(b, c, d).d < 0.05) {
        // 重疊段中點
        const L = dist(a, b), t0 = Math.max(0, Math.min(p1.t, p2.t)), t1 = Math.min(1, Math.max(p1.t, p2.t));
        const lo = projectToSeg(c, a, b).d < 0.05 || projectToSeg(d, a, b).d < 0.05 ? [t0, t1] : [0, 1];
        const tm = (lo[0] + lo[1]) / 2, ov = (lo[1] - lo[0]) * L;
        if (!best || ov > best.ov) best = { ov, p: [a[0] + (b[0] - a[0]) * tm, a[1] + (b[1] - a[1]) * tm] };
      }
    }
  }
  return best?.p || null;
}

export function defaultSettings() {
  return {
    theme: 'neon', autoTheme: false, dayTheme: 'homely', nightTheme: 'winter',
    lat: 22.3, lon: 114.17, north: 0, custom: {},
    energy: { consumption: '', grid: '', solar: '', battery: '', battery_soc: '', tariff: '' },
  };
}

// ---------------------------------------------------------------- sample home
export function sampleHome() {
  const g = newFloor('地下', 0);
  const R = (name, x, y, w, d, extra) => { const r = newRoom(name, rectPoly(x, y, w, d), extra); g.rooms.push(r); return r; };
  R('客廳', 0, 0, 6, 4.6, { area: 'living_room', aliases: '大廳, living room', floorMat: 'wood' });
  R('廚房', 6, 0, 4, 3.4, { area: 'kitchen', floorMat: 'tile' });
  R('走廊', 6, 3.4, 1.6, 4.6, { area: 'hallway', floorMat: 'tile' });
  R('浴室', 7.6, 3.4, 2.4, 2.2, { area: 'bathroom', floorMat: 'marble' });
  R('洗衣房', 7.6, 5.6, 2.4, 2.4, { area: 'laundry', floorMat: 'tile' });
  R('睡房', 0, 4.6, 3.8, 3.4, { area: 'bedroom', floorMat: 'carpet' });
  R('書房', 3.8, 4.6, 2.2, 3.4, { area: 'study', floorMat: 'wood' });
  R('花園', -0.2, -4.2, 10.4, 4.0, { area: 'garden', floorMat: 'grass', noWalls: true });
  g.walls = wallsFromRooms(g.rooms);
  const D = (x, y, extra) => addOpeningAt(g, [x, y], 'door', extra);
  const W = (x, y, extra) => addOpeningAt(g, [x, y], 'window', extra);
  D(6.8, 8, { w: 1.0, entity: 'binary_sensor.front_door', hinge: 'r' }); // 大門
  D(6, 4.0, {}); D(6, 2.0, { type: 'opening', w: 1.6, h: 2.2 }); g.walls.forEach(w => w.openings.forEach(o => { if (o.type === 'opening') o.sill = 0; }));
  D(7.6, 4.4, { w: 0.8 }); D(7.6, 6.6, { w: 0.8 }); D(2.8, 4.6, {}); D(5.0, 4.6, { w: 0.8, flip: true });
  W(1.6, 0, { w: 2.4, h: 2.2, sill: 0.1, entity: 'cover.living_blinds' }); W(4.4, 0, { w: 1.4 }); W(0, 2.3, { w: 1.8 });
  W(8.0, 0, { w: 1.6, sill: 1.05, h: 1.0 }); W(10, 1.7, { w: 1.2 }); W(10, 4.5, { w: 0.8, sill: 1.5, h: 0.6 });
  W(1.9, 8, { w: 1.6 }); W(0, 6.3, { w: 1.2 }); W(4.9, 8, { w: 1.0 }); W(10, 6.8, { w: 0.8, sill: 1.3, h: 0.8 });
  const I = (kind, name, x, y, w, d, rot = 0, extra = {}) => g.items.push({ id: uid('i'), kind, name, x, y, w, d, h: 0, rot, elev: 0, color: '', ...extra });
  I('sofaL', 'L 形梳化', 1.6, 2.9, 2.6, 1.7, 180); I('coffee', '茶几', 1.6, 2.0, 1.1, 0.6); I('rug', '地氈', 1.7, 2.3, 2.6, 1.9);
  I('tvstand', '電視櫃', 1.6, 0.3, 1.8, 0.45); I('tv', '電視', 1.6, 0.25, 1.4, 0.08, 0, { elev: 0.5 });
  I('dining', '餐枱', 4.4, 2.6, 1.6, 0.9, 90); I('chair', '椅', 3.85, 2.2, 0.45, 0.5, 90); I('chair', '椅', 3.85, 3.0, 0.45, 0.5, 90);
  I('chair', '椅', 4.95, 2.2, 0.45, 0.5, 270); I('chair', '椅', 4.95, 3.0, 0.45, 0.5, 270); I('plant', '盆栽', 5.6, 0.4, 0.5, 0.5); I('lamp', '落地燈', 0.35, 4.2, 0.4, 0.4);
  I('counter', '廚櫃', 7.9, 0.3, 3.8, 0.6); I('stove', '煮食爐', 8.6, 0.3, 0.6, 0.6); I('sinkunit', '星盆', 9.4, 0.3, 0.8, 0.6);
  I('counter', '廚櫃', 9.7, 1.9, 2.6, 0.6, 90); I('fridge', '雪櫃', 6.45, 0.45, 0.75, 0.75, 90); I('island', '中島', 7.9, 2.0, 1.6, 0.9);
  I('toilet', '座廁', 9.6, 3.8, 0.4, 0.65, 270); I('bathtub', '浴缸', 8.6, 5.15, 1.7, 0.75); I('basin', '洗手盆', 8.0, 3.65, 0.6, 0.45);
  I('washer', '洗衣機', 9.65, 7.6, 0.6, 0.6, 180); I('washer', '乾衣機', 9.0, 7.6, 0.6, 0.6, 180); I('shelf', '雜物架', 9.7, 6.4, 1.0, 0.4, 90);
  I('bed', '雙人床', 1.9, 6.85, 1.6, 2.05, 180); I('nightstand', '床頭櫃', 0.8, 7.7, 0.45, 0.4); I('nightstand', '床頭櫃', 3.0, 7.7, 0.45, 0.4);
  I('wardrobe', '衣櫃', 0.33, 5.7, 1.8, 0.6, 90);
  I('desk', '書枱', 4.9, 7.6, 1.4, 0.7, 180); I('officechair', '電腦椅', 4.9, 7.0, 0.6, 0.6); I('shelf', '書架', 5.8, 5.6, 1.6, 0.35, 270);
  I('tree', '樹', 1.0, -2.6, 1.6, 1.6); I('tree', '樹', 8.8, -3.0, 2.0, 2.0); I('outdoortable', '戶外枱', 4.6, -1.8, 1.4, 1.4);
  const Dv = (entity, name, x, y, z, extra = {}) => g.devices.push({ id: uid('d'), entity, name, x, y, z, rot: 0, ...extra });
  Dv('light.living_ceiling', '客廳主燈', 2.2, 2.3, 2.5); Dv('light.living_led', 'LED 燈帶', 3.2, 0.5, 2.4); Dv('light.dining', '餐枱吊燈', 4.4, 2.6, 2.2);
  Dv('cover.living_blinds', '客廳窗簾', 1.6, 0.25, 2.3); Dv('camera.living', '客廳鏡頭', 5.8, 4.4, 2.4, { rot: 225 });
  Dv('climate.living_ac', '客廳冷氣', 0.25, 1.2, 2.3); Dv('media_player.tv', '電視', 1.6, 0.4, 1.3); Dv('sensor.living_temp', '客廳溫度', 5.8, 2.0, 1.5);
  Dv('vacuum.robot', '掃地機', 2.6, 1.3, 0.05); Dv('light.kitchen', '廚房燈', 8.0, 1.7, 2.5); Dv('sensor.oven_power', '焗爐用電', 8.6, 0.4, 1.0);
  Dv('light.hallway', '走廊燈', 6.8, 5.6, 2.5); Dv('binary_sensor.front_door', '大門', 6.8, 7.9, 2.1); Dv('lock.front_door', '門鎖', 7.3, 7.9, 1.1);
  Dv('light.bathroom', '浴室燈', 8.8, 4.5, 2.5); Dv('sensor.bathroom_humidity', '浴室濕度', 7.8, 5.4, 1.6);
  Dv('sensor.washer_power', '洗衣機', 9.65, 7.6, 1.0); Dv('light.bedroom', '睡房燈', 1.9, 6.3, 2.5); Dv('climate.bedroom_ac', '睡房冷氣', 3.6, 6.3, 2.3);
  Dv('light.study', '書房燈', 4.9, 6.3, 2.5); Dv('switch.study_pc', '電腦', 4.5, 7.7, 0.9); Dv('light.garden', '花園燈', 4.6, -2.4, 2.2);

  const u = newFloor('一樓', 2.9);
  const R2 = (name, x, y, w, d, extra) => { const r = newRoom(name, rectPoly(x, y, w, d), extra); u.rooms.push(r); return r; };
  R2('主人房', 0, 0, 5, 4.6, { area: 'master_bedroom', floorMat: 'wood' });
  R2('主人浴室', 5, 0, 2.6, 3.0, { area: 'master_bath', floorMat: 'marble' });
  R2('樓梯位', 5, 3.0, 2.6, 1.6, { area: 'hallway_up', floorMat: 'wood' });
  R2('小朋友房', 0, 4.6, 3.8, 3.4, { area: 'kids_room', floorMat: 'carpet' });
  R2('遊戲室', 3.8, 4.6, 3.8, 3.4, { area: 'playroom', floorMat: 'wood' });
  R2('露台', 7.6, 0, 2.4, 8, { area: 'balcony', floorMat: 'deck', noWalls: true });
  u.walls = wallsFromRooms(u.rooms);
  const D2 = (x, y, e) => addOpeningAt(u, [x, y], 'door', e), W2 = (x, y, e) => addOpeningAt(u, [x, y], 'window', e);
  D2(5, 3.8, {}); D2(6.2, 3.0, { w: 0.8 }); D2(3.0, 4.6, {}); D2(4.6, 4.6, { flip: true }); D2(7.6, 1.5, { w: 1.8, h: 2.2, type: 'door', entity: 'binary_sensor.balcony_door' });
  W2(2.5, 0, { w: 2.4 }); W2(0, 2.3, { w: 1.6 }); W2(1.9, 8, { w: 1.6 }); W2(5.7, 8, { w: 1.6 }); W2(6.3, 0, { w: 0.9, sill: 1.4, h: 0.7 }); W2(7.6, 6.2, { w: 1.6 });
  const I2 = (kind, name, x, y, w, d, rot = 0, extra = {}) => u.items.push({ id: uid('i'), kind, name, x, y, w, d, h: 0, rot, elev: 0, color: '', ...extra });
  I2('bed', '大床', 2.5, 1.15, 1.8, 2.1); I2('nightstand', '床頭櫃', 1.3, 0.3, 0.45, 0.4); I2('nightstand', '床頭櫃', 3.7, 0.3, 0.45, 0.4);
  I2('wardrobe', '衣櫃', 2.5, 4.25, 2.4, 0.6, 180); I2('armchair', '單人梳化', 4.3, 3.2, 0.85, 0.85, 315);
  I2('bathtub', '浴缸', 6.3, 0.45, 1.7, 0.75); I2('toilet', '座廁', 7.25, 2.4, 0.4, 0.65, 270); I2('basin', '洗手盆', 5.4, 2.7, 0.6, 0.45, 180); I2('shower', '企缸', 5.5, 1.3, 0.9, 0.9);
  I2('stairs', '樓梯', 6.3, 3.8, 2.4, 1.0, 90);
  I2('bedsingle', '單人床', 1.0, 6.9, 1.0, 2.0, 180); I2('desk', '書枱', 3.0, 7.65, 1.2, 0.6, 180); I2('rug', '地氈', 2.2, 6.0, 1.6, 1.2); I2('shelf', '玩具櫃', 0.25, 5.4, 1.2, 0.4, 90);
  I2('sofa', '梳化', 5.7, 7.5, 2.0, 0.9, 180); I2('tvstand', '電視櫃', 5.7, 4.9, 1.6, 0.45); I2('tv', '電視', 5.7, 4.85, 1.2, 0.08, 0, { elev: 0.5 }); I2('coffee', '茶几', 5.7, 6.4, 1.0, 0.55);
  I2('outdoortable', '戶外枱', 8.8, 2.4, 1.0, 1.0); I2('plant', '盆栽', 9.6, 0.4, 0.5, 0.5); I2('plant', '盆栽', 9.6, 7.6, 0.5, 0.5); I2('lounger', '躺椅', 8.8, 5.6, 0.7, 1.9);
  const Dv2 = (entity, name, x, y, z, extra = {}) => u.devices.push({ id: uid('d'), entity, name, x, y, z, rot: 0, ...extra });
  Dv2('light.master', '主人房燈', 2.5, 2.4, 2.5); Dv2('climate.master_ac', '主人房冷氣', 0.25, 1.2, 2.3); Dv2('cover.master_blinds', '主人房窗簾', 2.5, 0.2, 2.3);
  Dv2('light.master_bath', '浴室燈', 6.3, 1.5, 2.5); Dv2('light.kids', '小朋友房燈', 1.9, 6.3, 2.5); Dv2('sensor.kids_temp', '小朋友房溫度', 3.6, 5.0, 1.5);
  Dv2('light.playroom', '遊戲室燈', 5.7, 6.3, 2.5); Dv2('media_player.playroom', '遊戲室喇叭', 7.2, 7.6, 1.0); Dv2('camera.balcony', '露台鏡頭', 9.8, 0.2, 2.4, { rot: 160 });
  Dv2('sensor.solar_power', '太陽能板', 8.8, 4.0, 2.6); Dv2('binary_sensor.balcony_door', '露台門', 7.6, 1.5, 2.1);
  return { v: 1, name: '示範屋', floors: [g, u], settings: defaultSettings() };
}

// ---------------------------------------------------------------- store (undo / persist)
const LS_KEY = 'home3d.home.v1';
export class Store {
  constructor() {
    this.listeners = new Set(); this.undoStack = []; this.redoStack = [];
    let h = null;
    try { const s = localStorage.getItem(LS_KEY); if (s) h = normaliseHome(JSON.parse(s)); } catch (e) { console.warn(e); }
    this.home = h || sampleHome();
    this.last = JSON.stringify(this.home);
  }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(kind = 'change') { for (const f of this.listeners) f(kind); }
  // 修改完之後叫：記低 undo、儲存
  commit(kind = 'change') {
    const s = JSON.stringify(this.home);
    if (s !== this.last) { this.undoStack.push(this.last); if (this.undoStack.length > 80) this.undoStack.shift(); this.redoStack = []; this.last = s; this.save(s); }
    this.emit(kind);
  }
  undo() { if (!this.undoStack.length) return false; this.redoStack.push(this.last); this.last = this.undoStack.pop(); this.home = JSON.parse(this.last); this.save(this.last); this.emit('replace'); return true; }
  redo() { if (!this.redoStack.length) return false; this.undoStack.push(this.last); this.last = this.redoStack.pop(); this.home = JSON.parse(this.last); this.save(this.last); this.emit('replace'); return true; }
  replace(home) { this.undoStack.push(this.last); this.home = home; this.last = JSON.stringify(home); this.save(this.last); this.emit('replace'); }
  save(s) {
    try { localStorage.setItem(LS_KEY, s); this.saveError = null; }
    catch (e) { this.saveError = e; this.emit('saveError'); }
  }
}

// 按房間重砌成層牆，舊門窗按位置搬去新牆
export function rebuildWalls(floor) {
  const ops = [];
  for (const w of floor.walls) {
    const L = wallLen(w) || 1;
    for (const o of w.openings) { const t = o.at / L; ops.push({ o, p: [w.a[0] + (w.b[0] - w.a[0]) * t, w.a[1] + (w.b[1] - w.a[1]) * t] }); }
  }
  floor.walls = wallsFromRooms(floor.rooms);
  let lost = 0;
  for (const { o, p } of ops) { const n = nearestWall(floor, p, 0.3); if (n) n.w.openings.push({ ...o, at: r3(n.pr.along) }); else lost++; }
  return lost;
}
// 搬一個點：所有重疊嘅房角、牆端一齊郁（保持接駁）
export function coincidentRefs(floor, pt, tol = 0.02) {
  const refs = [];
  for (const r of floor.rooms) r.poly.forEach((p, i) => { if (dist(p, pt) < tol) refs.push({ arr: r.poly, i }); });
  for (const w of floor.walls) { if (dist(w.a, pt) < tol) refs.push({ obj: w, k: 'a' }); if (dist(w.b, pt) < tol) refs.push({ obj: w, k: 'b' }); }
  return refs;
}
export function setRefs(refs, p) { for (const r of refs) { if (r.arr) r.arr[r.i] = [r3(p[0]), r3(p[1])]; else r.obj[r.k] = [r3(p[0]), r3(p[1])]; } }

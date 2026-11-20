// 匯入：Apple RoomPlan (.json)、CAD (.dxf)、Sweet Home 3D (.sh3d)、3D 模型 (.glb/.gltf/.obj/.stl)、
// Valetudo 掃地機地圖 (.json)、本 app / AI 寫嘅 plan (.json)。全部喺瀏覽器處理，唔會上傳。
import * as THREE from 'three';
import { newFloor, newRoom, newWall, newOpening, uid, r3, mergeSegments, nearestWall, wallsFromRooms, rectPoly, normaliseHome, projectToSeg, dist, pointInPoly } from './model.js';
import { topDownImage } from './view3d.js';

export async function importFile(file) {
  const name = file.name || 'file', ext = (name.split('.').pop() || '').toLowerCase();
  if (ext === 'dxf') return importDXF(await file.text(), name);
  if (ext === 'sh3d' || ext === 'zip') return importSH3D(await file.arrayBuffer(), name);
  if (['glb', 'gltf', 'obj', 'stl'].includes(ext)) return importMesh(file, ext, name);
  if (['usdz', 'usdc', 'usda', 'usd'].includes(ext)) return importUSD(await file.arrayBuffer(), name);
  if (ext === 'json' || ext === 'txt' || ext === 'fpjson' || !ext) {
    let j; try { j = JSON.parse(await file.text()); } catch (e) { throw new Error('JSON 讀唔到：' + e.message); }
    return importJSON(j, name);
  }
  throw new Error(`未支援 .${ext}`);
}

export function importJSON(j, name = 'plan.json') {
  if (j.__class === 'ValetudoMap' || (Array.isArray(j.layers) && j.pixelSize)) return importValetudo(j, name);
  if (looksRoomPlan(j)) return importRoomPlan(j, name);
  if (Array.isArray(j.floors)) {
    const home = normaliseHome(j);
    return { source: 'plan', home, floors: home.floors, report: report(home.floors), warnings: [] };
  }
  if (Array.isArray(j.rooms) && !j.rooms[0]?.walls) return importJSON({ name: j.name, floors: [{ name: j.floorName || '匯入', ...j }] }, name);
  if (j.floorplan || j.items?.[0]?.walls) throw new Error('似係 Floorplanner 格式：請喺 Floorplanner 匯出 DXF 再匯入');
  throw new Error('認唔到呢個 JSON 係咩格式');
}
const looksRoomPlan = j => (Array.isArray(j.walls) && j.walls[0] && (j.walls[0].transform || j.walls[0].dimensions)) || (Array.isArray(j.rooms) && j.rooms[0]?.walls);

function report(floors) {
  const c = k => floors.reduce((s, f) => s + (k === 'doors' ? f.walls.reduce((t, w) => t + w.openings.filter(o => o.type !== 'window').length, 0) : k === 'windows' ? f.walls.reduce((t, w) => t + w.openings.filter(o => o.type === 'window').length, 0) : f[k].length), 0);
  return { floors: floors.length, rooms: c('rooms'), walls: c('walls'), doors: c('doors'), windows: c('windows'), items: c('items') };
}

// ------------------------------------------------------------------ 共用：方向對正
// 計主要牆角度（mod 90°），成個平面轉返正，方便編輯。
function alignPlan(segs) {
  const bins = new Array(90).fill(0);
  for (const [a, b] of segs) { const L = dist(a, b); let ang = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI; ang = ((ang % 90) + 90) % 90; bins[Math.round(ang) % 90] += L; }
  let best = 0; for (let i = 0; i < 90; i++) { let s = 0; for (let k = -2; k <= 2; k++) s += bins[(i + k + 90) % 90]; if (s > (best.s || 0)) best = { i, s }; }
  let deg = best.i || 0;
  // 微調：用接近主角度嘅牆做長度加權平均
  let sw = 0, sa = 0;
  for (const [a, b] of segs) { const L = dist(a, b); let ang = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI; ang = ((ang % 90) + 90) % 90; let d = ang - deg; if (d > 45) d -= 90; if (d < -45) d += 90; if (Math.abs(d) < 3) { sw += L; sa += d * L; } }
  if (sw) deg += sa / sw; if (deg > 45) deg -= 90;
  return deg;
}
function rotFn(deg, cx = 0, cy = 0) { const t = -deg * Math.PI / 180, c = Math.cos(t), s = Math.sin(t); return ([x, y]) => [r3(c * (x - cx) - s * (y - cy) + cx), r3(s * (x - cx) + c * (y - cy) + cy)]; }
// 將樓層搬去 (0,0) 開始
function normaliseFloor(f) {
  let x0 = Infinity, y0 = Infinity;
  const pts = []; for (const r of f.rooms) pts.push(...r.poly); for (const w of f.walls) pts.push(w.a, w.b);
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); }
  if (!isFinite(x0)) return { dx: 0, dy: 0 };
  const dx = -x0, dy = -y0, T = p => [r3(p[0] + dx), r3(p[1] + dy)];
  for (const r of f.rooms) r.poly = r.poly.map(T);
  for (const w of f.walls) { w.a = T(w.a); w.b = T(w.b); }
  for (const i of f.items) { i.x = r3(i.x + dx); i.y = r3(i.y + dy); }
  for (const d of f.devices) { d.x = r3(d.x + dx); d.y = r3(d.y + dy); }
  if (f.underlay) { f.underlay.x += dx; f.underlay.y += dy; }
  return { dx, dy };
}
// 軸向差少少嘅牆拉正
function straighten(f, tolDeg = 2) {
  for (const w of f.walls) {
    const ang = Math.atan2(w.b[1] - w.a[1], w.b[0] - w.a[0]) * 180 / Math.PI, m = ((ang % 90) + 90) % 90;
    if (m < tolDeg || m > 90 - tolDeg) {
      const horiz = Math.abs(Math.cos(ang * Math.PI / 180)) > 0.5;
      if (horiz) { const y = r3((w.a[1] + w.b[1]) / 2); w.a[1] = y; w.b[1] = y; } else { const x = r3((w.a[0] + w.b[0]) / 2); w.a[0] = x; w.b[0] = x; }
    }
  }
}
function guessKind(name = '', w = 0.6, h = 0.6) {
  const n = name.toLowerCase();
  const rules = [
    [/sofa|couch|梳化|沙發|沙发/, w > 2.3 ? 'sofaL' : 'sofa'], [/armchair|單人/, 'armchair'], [/bed|床/, w < 1.25 ? 'bedsingle' : 'bed'],
    [/night|床頭/, 'nightstand'], [/wardrobe|closet|衣櫃|衣柜/, 'wardrobe'], [/fridge|refrigerator|雪櫃|冰箱/, 'fridge'],
    [/stove|cooktop|hob|oven|爐|炉/, 'stove'], [/sink|星盆|水槽/, 'sinkunit'], [/basin|washbasin|洗手/, 'basin'], [/toilet|wc|廁|厕|馬桶/, 'toilet'],
    [/bath|浴缸/, 'bathtub'], [/shower|淋浴|企缸/, 'shower'], [/wash|dryer|洗衣|乾衣/, 'washer'], [/desk|書枱|书桌/, 'desk'],
    [/coffee|茶几/, 'coffee'], [/dining|table|枱|桌/, h < 0.55 ? 'coffee' : 'dining'], [/office|swivel|電腦椅/, 'officechair'], [/chair|stool|椅|凳/, 'chair'],
    [/tv|television|電視|电视/, h > 0.6 && w > 0.9 ? 'tv' : 'tvstand'], [/shelf|book|書架|书架|bookcase/, 'shelf'], [/plant|花|植物/, 'plant'],
    [/lamp|light|燈|灯/, 'lamp'], [/stair|樓梯|楼梯/, 'stairs'], [/rug|carpet|地氈|地毯/, 'rug'], [/cabinet|storage|櫃|柜|dresser|chest/, h > 1.5 ? 'wardrobe' : 'box'],
    [/kitchen|counter|廚|厨/, 'counter'], [/car|車/, 'car'], [/tree|樹/, 'tree'],
  ];
  for (const [re, k] of rules) if (re.test(n)) return k;
  return 'box';
}

// ------------------------------------------------------------------ Apple RoomPlan
const flat = a => Array.isArray(a) ? a.flat(3) : [];
function rpXform(o) {
  const m = flat(o.transform); const d = flat(o.dimensions);
  if (m.length < 16) return null;
  return { ax: [m[0], m[1], m[2]], ay: [m[4], m[5], m[6]], az: [m[8], m[9], m[10]], p: [m[12], m[13], m[14]], w: d[0] || 0, h: d[1] || 0, d: d[2] || 0 };
}
const catOf = o => typeof o.category === 'string' ? o.category : Object.keys(o.category || {})[0] || '';
const RP_ROOM = { livingRoom: '客廳', bedroom: '睡房', bathroom: '浴室', kitchen: '廚房', diningRoom: '飯廳', unidentified: '房間' };
const RP_KIND = { storage: null, refrigerator: 'fridge', stove: 'stove', bed: null, sink: 'sinkunit', washerDryer: 'washer', toilet: 'toilet', bathtub: 'bathtub', oven: 'stove', dishwasher: 'counter', table: null, sofa: null, chair: 'chair', fireplace: 'box', television: 'tv', stairs: 'stairs' };
const RP_ZH = { storage: '儲物櫃', refrigerator: '雪櫃', stove: '煮食爐', bed: '床', sink: '星盆', washerDryer: '洗衣機', toilet: '座廁', bathtub: '浴缸', oven: '焗爐', dishwasher: '洗碗碟機', table: '枱', sofa: '梳化', chair: '椅', fireplace: '壁爐', television: '電視', stairs: '樓梯' };

export function importRoomPlan(j, name) {
  const warnings = [];
  // CapturedStructure（多間房）或者 CapturedRoom
  const rooms = Array.isArray(j.rooms) && j.rooms.length ? j.rooms : [j];
  const pick = k => (Array.isArray(j[k]) && j[k].length ? j[k] : rooms.flatMap(r => r[k] || []));
  const walls = pick('walls'), doors = pick('doors'), windows = pick('windows'), openings = pick('openings'), objects = pick('objects');
  const floorsRP = rooms.flatMap(r => r.floors || []).concat(j.floors && j.rooms ? [] : []);
  const sections = rooms.flatMap(r => r.sections || []).concat(j.sections && j.rooms ? j.sections : []);
  if (!walls.length) throw new Error('RoomPlan 檔入面冇牆');
  // 樓層 (story)
  const stories = [...new Set(walls.map(w => w.story ?? 0))].sort((a, b) => a - b);
  if (stories.length > 1) warnings.push(`有 ${stories.length} 層（story），已分開做唔同樓層`);
  const out = [];
  // 用全部牆計對正角度
  const segsAll = walls.map(rpXform).filter(Boolean).map(x => { const hx = x.ax[0] * x.w / 2, hz = x.ax[2] * x.w / 2; return [[x.p[0] - hx, x.p[2] - hz], [x.p[0] + hx, x.p[2] + hz]]; });
  const deg = alignPlan(segsAll), R = rotFn(deg);
  for (const story of stories) {
    const f = newFloor(stories.length > 1 ? `${story + 1} 樓` : '掃描樓層', 0);
    const ws = walls.filter(w => (w.story ?? 0) === story);
    let floorY = Infinity, maxH = 0;
    const idMap = new Map();
    for (const w of ws) {
      const x = rpXform(w); if (!x) continue;
      floorY = Math.min(floorY, x.p[1] - x.h / 2); maxH = Math.max(maxH, x.h);
      const hx = x.ax[0] * x.w / 2, hz = x.ax[2] * x.w / 2;
      const nw = newWall(R([x.p[0] - hx, x.p[2] - hz]), R([x.p[0] + hx, x.p[2] + hz]), x.d > 0.05 ? Math.min(0.4, x.d) : 0.12);
      nw.src = 'roomplan'; if (w.curve) warnings.push('有弧形牆，已當直牆處理');
      f.walls.push(nw); if (w.identifier) idMap.set(w.identifier, nw);
    }
    if (!isFinite(floorY)) floorY = 0;
    f.height = Math.round(Math.max(2.2, maxH) * 100) / 100;
    for (const w of f.walls) if (Math.abs((w.h || f.height) - f.height) < 0.05) w.h = null;
    // 門窗
    const addOp = (o, type) => {
      if ((o.story ?? story) !== story) return;
      const x = rpXform(o); if (!x) return;
      const c = R([x.p[0], x.p[2]]);
      let wall = o.parentIdentifier && idMap.get(o.parentIdentifier), pr;
      if (wall) pr = projectToSeg(c, wall.a, wall.b); else { const n = nearestWall(f, c, 0.6); if (!n) { warnings.push(`有${type === 'window' ? '窗' : '門'}搵唔到牆，略過`); return; } wall = n.w; pr = n.pr; }
      const cat = catOf(o);
      const op = newOpening(type, r3(pr.along), { w: r3(x.w), h: r3(x.h), sill: Math.max(0, r3(x.p[1] - x.h / 2 - floorY)) });
      if (type === 'door' && cat === 'door' && o.category?.door?.isOpen === false) op.closed = true;
      wall.openings.push(op);
    };
    doors.forEach(o => addOp(o, 'door')); windows.forEach(o => addOp(o, 'window')); openings.forEach(o => addOp(o, 'opening'));
    // 傢俬
    for (const o of objects) {
      if ((o.story ?? story) !== story) continue;
      const x = rpXform(o); if (!x) continue;
      const cat = catOf(o), c = R([x.p[0], x.p[2]]);
      let kind = RP_KIND[cat];
      if (kind === undefined || kind === null) kind = cat === 'bed' ? (x.w < 1.25 ? 'bedsingle' : 'bed') : cat === 'sofa' ? (x.w > 2.3 && x.d > 1.3 ? 'sofaL' : 'sofa') : cat === 'table' ? (x.h < 0.55 ? 'coffee' : x.w < 1.0 && x.d < 1.0 ? 'round' : 'dining') : cat === 'storage' ? (x.h > 1.5 ? 'wardrobe' : 'box') : 'box';
      const rot = Math.round(Math.atan2(x.ax[2], x.ax[0]) * 180 / Math.PI - deg);
      f.items.push({ id: uid('i'), kind, name: RP_ZH[cat] || cat, x: c[0], y: c[1], w: r3(x.w), d: r3(x.d), h: kind === 'box' || kind === 'wardrobe' || kind === 'counter' ? r3(x.h) : 0, rot: ((rot % 360) + 360) % 360, elev: Math.max(0, r3(x.p[1] - x.h / 2 - floorY)), color: '', src: 'roomplan' });
    }
    // 房間：iOS 17 有 floors (polygonCorners)；冇就由牆砌
    const fl = floorsRP.filter(o => (o.story ?? story) === story && Array.isArray(o.polygonCorners) && o.polygonCorners.length >= 3);
    for (const o of fl) {
      const m = flat(o.transform);
      const poly = o.polygonCorners.map(pc => { const [px, py, pz] = flat(pc); const wx = m[0] * px + m[4] * py + m[8] * pz + m[12], wz = m[2] * px + m[6] * py + m[10] * pz + m[14]; return R([wx, wz]); });
      f.rooms.push(newRoom('房間', poly, { checked: false, floorMat: 'wood' }));
    }
    if (!f.rooms.length) {
      const poly = chainWalls(f.walls);
      if (poly) f.rooms.push(newRoom('房間', poly, { checked: false }));
      else warnings.push('牆冇圍成一個封閉房，請喺編輯器用「房間」工具畫返');
    }
    // 房名：sections
    for (const s of sections) {
      if ((s.story ?? story) !== story) continue;
      const c = flat(s.center); if (c.length < 3) continue; const p = R([c[0], c[2]]);
      const r = f.rooms.find(r => pointInPoly(p, r.poly)) || (f.rooms.length === 1 ? f.rooms[0] : null);
      if (r && r.name === '房間') r.name = RP_ROOM[s.label] || s.label;
    }
    straighten(f); normaliseFloor(f);
    out.push(f);
  }
  if (Math.abs(deg) > 0.5) warnings.push(`已將平面轉正 ${deg.toFixed(1)}°`);
  warnings.push('掃描唔係施工圖：請逐間房核對牆厚、門口、窗位');
  return { source: 'Apple RoomPlan', floors: out, report: report(out), warnings };
}
// 將頭尾相接嘅牆串成多邊形
function chainWalls(walls, tol = 0.25) {
  if (walls.length < 3) return null;
  const segs = walls.map(w => [w.a, w.b]); const used = new Set([0]); const poly = [segs[0][0], segs[0][1]];
  let end = segs[0][1];
  for (let k = 1; k < segs.length; k++) {
    let best = null;
    segs.forEach((s, i) => { if (used.has(i)) return; for (const [p, q] of [[s[0], s[1]], [s[1], s[0]]]) { const d = dist(end, p); if (d < tol && (!best || d < best.d)) best = { i, d, q }; } });
    if (!best) break; used.add(best.i); poly.push(best.q); end = best.q;
  }
  if (dist(poly[0], poly[poly.length - 1]) < tol) poly.pop();
  if (used.size < Math.max(3, segs.length * 0.6) || poly.length < 3) {
    // 退而求其次：凸包
    return convexHull(walls.flatMap(w => [w.a, w.b]));
  }
  return poly.map(p => [r3(p[0]), r3(p[1])]);
}
function convexHull(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]); if (p.length < 3) return null;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.reverse()) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

// ------------------------------------------------------------------ DXF
function parseDXF(text) {
  const lines = text.split(/\r?\n/); const pairs = [];
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([parseInt(lines[i].trim(), 10), lines[i + 1].trim()]);
  const header = {}; const ents = []; let section = null, cur = null, block = null; const blocks = {};
  for (let i = 0; i < pairs.length; i++) {
    const [c, v] = pairs[i];
    if (c === 0 && v === 'SECTION') { section = pairs[i + 1]?.[1]; i++; continue; }
    if (c === 0 && v === 'ENDSEC') { section = null; cur = null; continue; }
    if (section === 'HEADER') { if (c === 9) { const k = v, nx = pairs[i + 1]; if (nx) header[k] = nx[1]; } continue; }
    if (section === 'BLOCKS') {
      if (c === 0 && v === 'BLOCK') { block = { name: '', ents: [] }; cur = null; continue; }
      if (c === 0 && v === 'ENDBLK') { if (block) blocks[block.name] = block; block = null; cur = null; continue; }
      if (block && c === 2 && !cur && !block.name) { block.name = v; continue; }
    }
    if (section !== 'ENTITIES' && section !== 'BLOCKS') continue;
    if (c === 0) {
      cur = { type: v, layer: '0', pts: [], x: [], y: [] };
      if (section === 'BLOCKS') { if (block) block.ents.push(cur); } else ents.push(cur);
      continue;
    }
    if (!cur) continue;
    if (c === 8) cur.layer = v;
    else if (c === 10) { cur.x.push(+v); }
    else if (c === 20) { cur.y.push(+v); }
    else if (c === 11) cur.x2 = +v; else if (c === 21) cur.y2 = +v;
    else if (c === 40) cur.r = +v; else if (c === 50) cur.a0 = +v; else if (c === 51) cur.a1 = +v;
    else if (c === 70) cur.flags = +v; else if (c === 1 || c === 3) cur.text = (cur.text || '') + v;
    else if (c === 2) cur.name = v; else if (c === 41) cur.sx = +v; else if (c === 42) cur.sy = +v;
  }
  // POLYLINE + VERTEX
  const out = [];
  for (let i = 0; i < ents.length; i++) {
    const e = ents[i];
    if (e.type === 'POLYLINE') { const p = { type: 'LWPOLYLINE', layer: e.layer, flags: e.flags, x: [], y: [] }; while (ents[i + 1]?.type === 'VERTEX') { i++; p.x.push(ents[i].x[0]); p.y.push(ents[i].y[0]); } out.push(p); }
    else if (e.type !== 'VERTEX' && e.type !== 'SEQEND') out.push(e);
  }
  return { header, ents: out, blocks };
}
export function importDXF(text, name) {
  const warnings = [];
  const { header, ents, blocks } = parseDXF(text);
  // 單位
  const U = { 1: 0.0254, 2: 0.3048, 4: 0.001, 5: 0.01, 6: 1 }[+header.$INSUNITS];
  const segsRaw = [], polys = [], texts = [], arcs = [], inserts = [];
  const pushEnt = (e, ox = 0, oy = 0, sx = 1, rot = 0) => {
    const tf = (x, y) => { const c = Math.cos(rot), s = Math.sin(rot); x *= sx; y *= sx; return [ox + c * x - s * y, oy + s * x + c * y]; };
    if (e.type === 'LINE') segsRaw.push({ a: tf(e.x[0], e.y[0]), b: tf(e.x2, e.y2), layer: e.layer });
    else if (e.type === 'LWPOLYLINE') {
      const pts = e.x.map((x, k) => tf(x, e.y[k])); const closed = (e.flags & 1) === 1 || (pts.length > 2 && dist(pts[0], pts[pts.length - 1]) < 1e-6);
      for (let k = 0; k + 1 < pts.length; k++) segsRaw.push({ a: pts[k], b: pts[k + 1], layer: e.layer });
      if (closed && pts.length > 2) { segsRaw.push({ a: pts[pts.length - 1], b: pts[0], layer: e.layer }); polys.push({ pts, layer: e.layer }); }
    } else if (e.type === 'TEXT' || e.type === 'MTEXT') texts.push({ p: tf(e.x[0], e.y[0]), text: (e.text || '').replace(/\\[A-Za-z][^;]*;|[{}]|\\P/g, ' ').trim(), layer: e.layer });
    else if (e.type === 'ARC') arcs.push({ c: tf(e.x[0], e.y[0]), r: e.r * sx, a0: (e.a0 || 0) + rot * 180 / Math.PI, a1: (e.a1 || 0) + rot * 180 / Math.PI, layer: e.layer });
  };
  for (const e of ents) {
    if (e.type === 'INSERT') {
      const b = blocks[e.name]; const ip = [e.x[0] || 0, e.y[0] || 0];
      inserts.push({ name: e.name || '', p: ip, sx: e.sx || 1, rot: (e.a0 || 0) * Math.PI / 180, layer: e.layer, block: b });
      if (b && !/door|門|门|window|窗/i.test(e.name || '')) for (const be of b.ents) pushEnt(be, ip[0], ip[1], e.sx || 1, (e.a0 || 0) * Math.PI / 180);
    } else pushEnt(e);
  }
  if (!segsRaw.length) throw new Error('DXF 入面搵唔到線');
  // 單位推斷
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of segsRaw) for (const [x, y] of [s.a, s.b]) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const span = Math.max(x1 - x0, y1 - y0);
  const scale = U || (span > 400 ? 0.001 : span > 40 ? 0.01 : 1);
  if (!U) warnings.push(`DXF 冇寫單位，估計係 ${scale === 0.001 ? '毫米' : scale === 0.01 ? '厘米' : '米'}`);
  // DXF y 向上 → 平面 y 向下
  const P = ([x, y]) => [r3((x - x0) * scale), r3((y1 - y) * scale)];
  const isWallLayer = l => /wall|牆|墙|^a-wall|墻/i.test(l);
  const isNoise = l => /dim|標注|标注|text|furn|傢|家具|axis|軸|轴|hatch|填充|grid|elec|電|电|plumb|水/i.test(l);
  let cand = segsRaw.filter(s => isWallLayer(s.layer));
  if (cand.length < 4) { cand = segsRaw.filter(s => !isNoise(s.layer)); warnings.push('冇「WALL / 牆」圖層，用晒所有線估牆'); }
  const segs = cand.map(s => [P(s.a), P(s.b)]).filter(([a, b]) => dist(a, b) > 0.05);
  // 雙線配對 → 牆中線 + 厚度
  const walls = pairWalls(segs, warnings);
  const f = newFloor('CAD 樓層', 0);
  // 對正
  const deg = alignPlan(walls.map(w => [w.a, w.b]));
  const R = Math.abs(deg) > 0.5 ? rotFn(deg) : (p => p);
  for (const w of walls) f.walls.push(newWall(R(w.a), R(w.b), w.t, { src: 'dxf' }));
  // 房間：閉合多段線（ROOM / AREA 圖層）
  const roomPolys = polys.filter(p => /room|area|space|房|空間|空间|區|区/i.test(p.layer));
  for (const p of roomPolys) f.rooms.push(newRoom('房間', p.pts.map(q => R(P(q))), { checked: false }));
  // 房名
  for (const t of texts) {
    if (!t.text || t.text.length > 20 || /^[\d.,\s]+$/.test(t.text)) continue;
    const p = R(P(t.p)); const r = f.rooms.find(r => pointInPoly(p, r.poly));
    if (r && r.name === '房間') r.name = t.text;
  }
  if (!f.rooms.length) {
    // 用牆外框做一間大房，房名留畀用戶
    const hull = convexHull(f.walls.flatMap(w => [w.a, w.b]));
    if (hull) f.rooms.push(newRoom('全屋', hull, { checked: false, noWalls: true }));
    warnings.push('CAD 冇房間多段線：已用外框整一間「全屋」，請用「房間」工具分返每間房');
  }
  // 門：INSERT（門圖塊）或者門弧
  let nd = 0, nw = 0;
  for (const ins of inserts) {
    const isDoor = /door|門|门|^dr/i.test(ins.name), isWin = /window|窗|^win/i.test(ins.name);
    if (!isDoor && !isWin) continue;
    let bw = 0.9; if (ins.block) { let bx0 = Infinity, bx1 = -Infinity; for (const be of ins.block.ents) for (const x of [...be.x, be.x2].filter(v => v != null)) { bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); } if (isFinite(bx0)) bw = (bx1 - bx0) * (ins.sx || 1) * scale; }
    const p = R(P(ins.p)); const n = nearestWall(f, p, 1.2); if (!n) continue;
    const width = Math.max(0.5, Math.min(3, bw || 0.9));
    let at = n.pr.along + (isDoor ? width / 2 : 0); at = Math.min(Math.max(at, width / 2), dist(n.w.a, n.w.b) - width / 2);
    n.w.openings.push(newOpening(isDoor ? 'door' : 'window', r3(at), { w: r3(width) })); isDoor ? nd++ : nw++;
  }
  for (const a of arcs) {
    const r = a.r * scale; if (r < 0.55 || r > 1.3) continue;
    const span = ((a.a1 - a.a0) % 360 + 360) % 360; if (span < 60 || span > 120) continue;
    const c = R(P(a.c));
    const ends = [a.a0, a.a1].map(deg2 => { const t = deg2 * Math.PI / 180; return R(P([a.c[0] + Math.cos(t) * a.r, a.c[1] + Math.sin(t) * a.r])); });
    let best = null; for (const e of ends) { const n = nearestWall(f, e, 0.25); const nc = nearestWall(f, c, 0.25); if (n && nc && n.w === nc.w && (!best || n.pr.d < best.n.pr.d)) best = { n, nc }; }
    if (!best) continue;
    const at = (best.n.pr.along + best.nc.pr.along) / 2;
    if (best.n.w.openings.some(o => Math.abs(o.at - at) < 0.4)) continue;
    best.n.w.openings.push(newOpening('door', r3(at), { w: r3(r) })); nd++;
  }
  if (!nd) warnings.push('搵唔到門（門圖塊或門弧），請自己加');
  straighten(f);
  // 用原本嘅線整底圖，方便核對
  f.underlay = dxfUnderlay(segsRaw.map(s => [R(P(s.a)), R(P(s.b))]));
  normaliseFloor(f);
  warnings.push('已將原本 CAD 線條放做底圖，可以對住核對');
  return { source: 'CAD (DXF)', floors: [f], report: report([f]), warnings };
}
function pairWalls(segs, warnings) {
  const S = segs.map(([a, b]) => { const L = dist(a, b), ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L; return { a, b, L, ux, uy }; });
  const out = []; const paired = new Set();
  const lim = Math.min(S.length, 4000);
  for (let i = 0; i < lim; i++) for (let k = i + 1; k < lim; k++) {
    const p = S[i], q = S[k];
    if (Math.abs(p.ux * q.uy - p.uy * q.ux) > 0.035) continue;
    const off = Math.abs(-p.uy * (q.a[0] - p.a[0]) + p.ux * (q.a[1] - p.a[1]));
    if (off < 0.05 || off > 0.45) continue;
    const s0 = 0, s1 = p.L, t0 = (q.a[0] - p.a[0]) * p.ux + (q.a[1] - p.a[1]) * p.uy, t1 = (q.b[0] - p.a[0]) * p.ux + (q.b[1] - p.a[1]) * p.uy;
    const lo = Math.max(s0, Math.min(t0, t1)), hi = Math.min(s1, Math.max(t0, t1));
    if (hi - lo < Math.max(0.2, 0.5 * Math.min(p.L, q.L))) continue;
    const nx = -p.uy, ny = p.ux, sgn = (-p.uy * (q.a[0] - p.a[0]) + p.ux * (q.a[1] - p.a[1])) > 0 ? 1 : -1;
    const A = [p.a[0] + p.ux * lo + nx * sgn * off / 2, p.a[1] + p.uy * lo + ny * sgn * off / 2];
    const B = [p.a[0] + p.ux * hi + nx * sgn * off / 2, p.a[1] + p.uy * hi + ny * sgn * off / 2];
    out.push({ a: A, b: B, t: r3(off) }); paired.add(i); paired.add(k);
  }
  if (out.length < 3) {
    warnings.push('CAD 似係單線圖，每條線當一幅 12cm 牆');
    return mergeSegments(segs).map(([a, b]) => ({ a, b, t: 0.12 }));
  }
  // 同厚度分組合併
  const byT = new Map(); for (const w of out) { const k = Math.round(w.t * 50) / 50; (byT.get(k) || byT.set(k, []).get(k)).push([w.a, w.b]); }
  const merged = []; for (const [t, ss] of byT) for (const [a, b] of mergeSegments(ss, 0.03)) merged.push({ a, b, t: Math.max(0.06, t) });
  const unp = S.length - paired.size; if (unp > S.length * 0.4) warnings.push(`${unp} 條線配唔到對，可能係傢俬或者標注，已略過`);
  return merged;
}
function dxfUnderlay(segs) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [a, b] of segs) for (const [x, y] of [a, b]) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const pad = 0.3; x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
  const d = segs.map(([a, b]) => `M${(a[0] - x0).toFixed(3)} ${(a[1] - y0).toFixed(3)}L${(b[0] - x0).toFixed(3)} ${(b[1] - y0).toFixed(3)}`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${(x1 - x0).toFixed(3)} ${(y1 - y0).toFixed(3)}"><path d="${d}" stroke="#d04a2a" stroke-width="0.02" fill="none"/></svg>`;
  return { src: 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg))), x: x0, y: y0, w: x1 - x0, h: y1 - y0, opacity: 0.7 };
}

// ------------------------------------------------------------------ Sweet Home 3D (.sh3d = zip)
async function unzip(buf) {
  const dv = new DataView(buf), u8 = new Uint8Array(buf); let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 70000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('唔係 zip 檔');
  const n = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true); const files = {};
  for (let k = 0; k < n; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), lho = dv.getUint32(p + 42, true);
    const fname = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nlen));
    files[fname] = async () => {
      const ln = dv.getUint16(lho + 26, true), lx = dv.getUint16(lho + 28, true), start = lho + 30 + ln + lx, data = u8.subarray(start, start + csize);
      if (method === 0) return data;
      if (method !== 8) throw new Error('zip 壓縮方式未支援');
      const ds = new DecompressionStream('deflate-raw'); const s = new Blob([data]).stream().pipeThrough(ds);
      return new Uint8Array(await new Response(s).arrayBuffer());
    };
    p += 46 + nlen + xlen + clen;
  }
  return files;
}
export async function importSH3D(buf, name) {
  const files = await unzip(buf);
  if (!files['Home.xml']) throw new Error('呢個 .sh3d 冇 Home.xml（請用 Sweet Home 3D 5.3 或以上另存）');
  const xml = new TextDecoder().decode(await files['Home.xml']());
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const warnings = []; const cm = v => r3((+v || 0) / 100);
  const levels = [...doc.querySelectorAll('level')];
  const floors = new Map();
  const getF = (lid) => {
    const key = lid || '_'; if (floors.has(key)) return floors.get(key);
    const L = levels.find(l => l.getAttribute('id') === lid);
    const f = newFloor(L?.getAttribute('name') || '樓層', L ? cm(L.getAttribute('elevation')) : 0);
    if (L?.getAttribute('height')) f.height = cm(L.getAttribute('height'));
    floors.set(key, f); return f;
  };
  for (const w of doc.querySelectorAll('wall')) {
    const f = getF(w.getAttribute('level'));
    f.walls.push(newWall([cm(w.getAttribute('xStart')), cm(w.getAttribute('yStart'))], [cm(w.getAttribute('xEnd')), cm(w.getAttribute('yEnd'))], cm(w.getAttribute('thickness')) || 0.1, { h: w.getAttribute('height') ? cm(w.getAttribute('height')) : null, src: 'sh3d' }));
    if (w.getAttribute('arcExtent')) warnings.push('有弧形牆，已當直牆');
  }
  for (const r of doc.querySelectorAll('room')) {
    const f = getF(r.getAttribute('level'));
    const poly = [...r.querySelectorAll('point')].map(p => [cm(p.getAttribute('x')), cm(p.getAttribute('y'))]);
    if (poly.length >= 3) f.rooms.push(newRoom(r.getAttribute('name') || '房間', poly, { checked: false }));
  }
  for (const p of doc.querySelectorAll('doorOrWindow, pieceOfFurniture')) {
    if (p.getAttribute('visible') === 'false') continue;
    const f = getF(p.getAttribute('level') || p.closest('furnitureGroup')?.getAttribute('level'));
    const nm = p.getAttribute('name') || '', x = cm(p.getAttribute('x')), y = cm(p.getAttribute('y'));
    const w = cm(p.getAttribute('width')), d = cm(p.getAttribute('depth')), h = cm(p.getAttribute('height')), el = cm(p.getAttribute('elevation'));
    const rot = Math.round((+p.getAttribute('angle') || 0) * 180 / Math.PI);
    if (p.tagName === 'doorOrWindow') {
      const isWin = /window|窗|fenêtre|fenster/i.test(nm) || el > 0.3;
      const n = nearestWall(f, [x, y], 0.6);
      if (n) n.w.openings.push(newOpening(isWin ? 'window' : 'door', r3(n.pr.along), { w, h, sill: el }));
      else warnings.push(`「${nm}」唔喺牆上，略過`);
    } else {
      const kind = guessKind(nm + ' ' + (p.getAttribute('catalogId') || ''), w, h);
      f.items.push({ id: uid('i'), kind, name: nm, x, y, w, d, h: ['box', 'wardrobe', 'counter', 'shelf'].includes(kind) ? h : 0, rot: ((rot % 360) + 360) % 360, elev: el, color: '', src: 'sh3d' });
    }
  }
  const out = [...floors.values()].sort((a, b) => a.elev - b.elev);
  if (!out.length) throw new Error('Home.xml 入面冇牆冇房');
  for (const f of out) if (!f.rooms.length && f.walls.length) { const poly = chainWalls(f.walls); if (poly) f.rooms.push(newRoom('房間', poly, { checked: false })); }
  // 統一位移（多層要一齊郁）
  let x0 = Infinity, y0 = Infinity; for (const f of out) { for (const r of f.rooms) for (const [x, y] of r.poly) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); } for (const w of f.walls) for (const [x, y] of [w.a, w.b]) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); } }
  for (const f of out) { const T = p => [r3(p[0] - x0), r3(p[1] - y0)]; f.rooms.forEach(r => r.poly = r.poly.map(T)); f.walls.forEach(w => { w.a = T(w.a); w.b = T(w.b); }); f.items.forEach(i => { i.x = r3(i.x - x0); i.y = r3(i.y - y0); }); }
  return { source: 'Sweet Home 3D', floors: out, report: report(out), warnings };
}

// ------------------------------------------------------------------ Valetudo（掃地機地圖）
export function importValetudo(j, name) {
  const warnings = []; const ps = (j.pixelSize || 5) / 100;
  const pix = l => { if (l.pixels?.length) return l.pixels; const c = l.compressedPixels || [], out = []; for (let i = 0; i + 2 < c.length; i += 3) for (let k = 0; k < c[i + 2]; k++) out.push(c[i] + k, c[i + 1]); return out; };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const layers = (j.layers || []).map(l => ({ l, p: pix(l) }));
  for (const { p } of layers) for (let i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]); y0 = Math.min(y0, p[i + 1]); x1 = Math.max(x1, p[i]); y1 = Math.max(y1, p[i + 1]); }
  if (!isFinite(x0)) throw new Error('地圖係空嘅');
  const f = newFloor('掃地機地圖', 0);
  for (const { l, p } of layers) {
    if (l.type !== 'segment' || p.length < 20) continue;
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; for (let i = 0; i < p.length; i += 2) { a = Math.min(a, p[i]); b = Math.min(b, p[i + 1]); c = Math.max(c, p[i]); d = Math.max(d, p[i + 1]); }
    f.rooms.push(newRoom(l.metaData?.name || `房間 ${l.metaData?.segmentId ?? f.rooms.length + 1}`, rectPoly(r3((a - x0) * ps), r3((b - y0) * ps), r3((c - a + 1) * ps), r3((d - b + 1) * ps)), { checked: false }));
  }
  // 底圖
  const W = x1 - x0 + 1, H = y1 - y0 + 1, cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  const col = { floor: '#cfe3f5', segment: '#bcd7ee', wall: '#333' };
  for (const { l, p } of layers) { g.fillStyle = col[l.type] || '#ddd'; for (let i = 0; i < p.length; i += 2) g.fillRect(p[i] - x0, p[i + 1] - y0, 1, 1); }
  f.underlay = { src: cv.toDataURL('image/png'), x: 0, y: 0, w: W * ps, h: H * ps, opacity: 0.6 };
  if (f.rooms.length) f.walls = wallsFromRooms(f.rooms);
  warnings.push('掃地機地圖只係概略：房間係外框長方形，牆位要對住底圖逐幅修正');
  return { source: 'Valetudo 掃地機地圖', floors: [f], report: report([f]), warnings };
}

// ------------------------------------------------------------------ 3D 模型
export async function importMesh(file, ext, name, preObj, preWarnings = []) {
  const warnings = [...preWarnings]; let obj = preObj;
  if (obj) { /* 已經砌好（例如 USDZ 冇結構嘅掃描網格） */ }
  else if (ext === 'glb' || ext === 'gltf') {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const loader = new GLTFLoader(); const data = ext === 'glb' ? await file.arrayBuffer() : await file.text();
    obj = await new Promise((res, rej) => loader.parse(data, '', g => res(g.scene), rej));
  } else if (ext === 'obj') {
    const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js'); obj = new OBJLoader().parse(await file.text());
  } else if (ext === 'stl') {
    const { STLLoader } = await import('three/addons/loaders/STLLoader.js'); const geo = new STLLoader().parse(await file.arrayBuffer());
    obj = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xcccccc }));
  }
  const holder = new THREE.Group(); holder.add(obj);
  let box = new THREE.Box3().setFromObject(holder), size = box.getSize(new THREE.Vector3());
  const maxD = Math.max(size.x, size.y, size.z);
  const s = maxD > 2000 ? 0.001 : maxD > 60 ? 0.01 : 1; if (s !== 1) { obj.scale.multiplyScalar(s); warnings.push(`模型好大，估計單位係${s === 0.001 ? '毫米' : '厘米'}，已縮細`); }
  box = new THREE.Box3().setFromObject(holder); size = box.getSize(new THREE.Vector3());
  // Z-up（STL / SketchUp 常見）→ Y-up
  if (!preObj && (ext === 'stl' || ext === 'obj') && size.z < 4.5 && size.y > size.z * 1.5 && size.y > 3) { obj.rotation.x = -Math.PI / 2; warnings.push('模型似係 Z 軸向上，已轉正'); }
  box = new THREE.Box3().setFromObject(holder);
  holder.position.set(-box.min.x, -box.min.y, -box.min.z);
  holder.updateMatrixWorld(true);
  const mat = new THREE.MeshStandardMaterial({ color: 0xb8c4cc, roughness: 0.8, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
  let tris = 0; holder.traverse(o => { if (o.isMesh) { o.material = mat; tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; } });
  const td = topDownImage(holder);
  const f = newFloor('3D 模型', 0);
  f.underlay = { src: await toJpeg(td.url), x: r3(td.x), y: r3(td.y), w: r3(td.w), h: r3(td.h), opacity: 0.7 };
  const fb = new THREE.Box3().setFromObject(holder), fs = fb.getSize(new THREE.Vector3());
  f.height = Math.max(2.2, Math.min(4, r3(fs.y)));
  warnings.push(`已載入 ${Math.round(tris).toLocaleString()} 個三角形做參考模型，同埋由頂影咗張底圖`);
  warnings.push('3D 模型冇「牆」「門」資料：請喺編輯器用「房間」工具對住底圖描一次（參考模型唔會儲存）');
  return { source: preObj ? 'USDZ 掃描網格' : '3D 模型', floors: [f], report: report([f]), warnings, object: holder };
}
async function toJpeg(url) {
  const img = new Image(); img.src = url; await img.decode();
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0);
  return c.toDataURL('image/jpeg', 0.85);
}

// ------------------------------------------------------------------ USDZ / USDC / USDA（iPhone RoomPlan 匯出）
// 用 three.js 0.187 嘅獨立 USD 解析器（唔依賴 three 本身），再自己計每件嘢喺世界座標嘅位置同大細。
const USD_PARSERS = 'https://cdn.jsdelivr.net/npm/three@0.187.0/examples/jsm/loaders/usd/';
const RP_ARCH = /^(wall|door|window|opening|floor)(\d+|_\d+)?$/i;
const RP_OBJ = /^(storage|refrigerator|stove|bed|sink|washerdryer|washer|dryer|toilet|bathtub|oven|dishwasher|table|sofa|chair|fireplace|television|tv|stairs)(\d+|_\d+)?$/i;
const RP_OBJ_KEY = { storage: 'storage', refrigerator: 'refrigerator', stove: 'stove', bed: 'bed', sink: 'sink', washerdryer: 'washerDryer', washer: 'washerDryer', dryer: 'washerDryer', toilet: 'toilet', bathtub: 'bathtub', oven: 'oven', dishwasher: 'dishwasher', table: 'table', sofa: 'sofa', chair: 'chair', fireplace: 'fireplace', television: 'television', tv: 'television', stairs: 'stairs' };

async function parseUSDLayer(bytes) {
  const head = new TextDecoder().decode(bytes.subarray(0, 8));
  if (head === 'PXR-USDC') {
    const { USDCParser } = await import(USD_PARSERS + 'USDCParser.js');
    return new USDCParser().parseData(bytes.slice().buffer).specsByPath;
  }
  const text = new TextDecoder().decode(bytes);
  if (!text.startsWith('#usda')) throw new Error('唔係有效嘅 USD 檔');
  const { USDAParser } = await import(USD_PARSERS + 'USDAParser.js');
  return new USDAParser().parseData(text).specsByPath;
}

export async function importUSD(buf, name) {
  const u8 = new Uint8Array(buf); let layer = u8;
  if (u8[0] === 0x50 && u8[1] === 0x4b) { // zip → 第一個 usd 檔就係主 layer
    const files = await unzip(buf);
    const main = Object.keys(files).find(n => /\.usd[ca]?$/i.test(n));
    if (!main) throw new Error('USDZ 入面搵唔到 .usdc / .usda');
    layer = await files[main]();
  }
  let specs;
  try { specs = await parseUSDLayer(layer); } catch (e) { throw new Error('USD 讀唔到：' + e.message); }
  const scene = buildUSDScene(specs);
  const semantic = collectSemantic(scene);
  if (semantic.walls.length >= 2) {
    const r = importRoomPlan(semantic.json, name);
    r.source = 'iPhone 掃描 (USDZ)';
    r.warnings.unshift(`由 USDZ 認到 ${semantic.walls.length} 幅牆、${semantic.json.doors.length + semantic.json.openings.length} 個門口、${semantic.json.windows.length} 個窗、${semantic.json.objects.length} 件傢俬`);
    return r;
  }
  // 冇牆 / 門窗結構（例如普通掃描網格）→ 當 3D 模型參考
  const obj = scene.meshObject();
  if (!obj) throw new Error('USDZ 入面冇網格');
  return importMesh(null, 'usdz', name, obj, ['呢個 USDZ 冇「牆／門／窗」結構（唔係 RoomPlan 參數模型），當普通 3D 模型處理']);
}

function buildUSDScene(specs) {
  const prims = new Map(), attrs = new Map();
  for (const [path, spec] of Object.entries(specs)) {
    if (path === '/') continue;
    const dot = path.lastIndexOf('.'), slash = path.lastIndexOf('/');
    if (dot > slash) { const p = path.slice(0, dot); if (!attrs.has(p)) attrs.set(p, {}); attrs.get(p)[path.slice(dot + 1)] = spec.fields?.default ?? firstSample(spec.fields?.timeSamples); }
    else prims.set(path, spec.fields || {});
  }
  const rootF = specs['/']?.fields || {};
  const zUp = String(rootF.upAxis || 'Y').toUpperCase() === 'Z', mpu = +rootF.metersPerUnit || 1;
  const A = p => attrs.get(p) || {};
  const local = path => {
    const f = prims.get(path) || {}, a = A(path);
    const order = f.xformOpOrder || a.xformOpOrder || [];
    const M = new THREE.Matrix4();
    for (let op of order) {
      let inv = false; if (op.startsWith('!invert!')) { inv = true; op = op.slice(8); }
      const v = a[op], kind = op.split(':')[1] || '', m = new THREE.Matrix4();
      if (v == null) continue;
      const n = Array.from(flatNum(v));
      if (kind === 'transform') m.fromArray(n);
      else if (kind === 'translate') m.makeTranslation(n[0] || 0, n[1] || 0, n[2] || 0);
      else if (kind === 'scale') m.makeScale(n[0] ?? 1, n[1] ?? n[0] ?? 1, n[2] ?? n[0] ?? 1);
      else if (kind === 'orient') m.makeRotationFromQuaternion(new THREE.Quaternion(n[0], n[1], n[2], n[3]));
      else if (/^rotate[XYZ]$/.test(kind)) { const ax = kind[6]; m['makeRotation' + ax](n[0] * Math.PI / 180); }
      else if (/^rotate[XYZ]{3}$/.test(kind)) { const ord = kind.slice(6); m.makeRotationFromEuler(new THREE.Euler(n[0] * Math.PI / 180, n[1] * Math.PI / 180, n[2] * Math.PI / 180, ord.split('').reverse().join(''))); }
      else continue;
      if (inv) m.invert();
      M.multiply(m);
    }
    return M;
  };
  const rootM = new THREE.Matrix4().makeScale(mpu, mpu, mpu);
  if (zUp) rootM.multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
  const worldCache = new Map();
  const world = path => {
    if (worldCache.has(path)) return worldCache.get(path);
    const i = path.lastIndexOf('/'), parent = i > 0 ? path.slice(0, i) : null;
    const W = (parent && prims.has(parent) ? world(parent) : rootM).clone().multiply(local(path));
    worldCache.set(path, W); return W;
  };
  const meshes = [...prims.keys()].filter(p => prims.get(p).typeName === 'Mesh' && A(p).points);
  const pointsOf = p => { const arr = flatNum(A(p).points), W = world(p), out = [], v = new THREE.Vector3(); for (let i = 0; i + 2 < arr.length; i += 3) out.push(v.set(arr[i], arr[i + 1], arr[i + 2]).applyMatrix4(W).clone()); return out; };
  return {
    prims, attrs: A, world, meshes, pointsOf,
    meshObject() {
      if (!meshes.length) return null;
      const g = new THREE.Group();
      for (const p of meshes) {
        const pts = pointsOf(p), counts = flatNum(A(p).faceVertexCounts || []), idx = flatNum(A(p).faceVertexIndices || []);
        const pos = []; let k = 0;
        for (const c of counts) { for (let j = 1; j + 1 < c; j++) for (const t of [idx[k], idx[k + j], idx[k + j + 1]]) { const q = pts[t]; if (q) pos.push(q.x, q.y, q.z); } k += c; }
        if (!pos.length) continue;
        const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.computeVertexNormals();
        g.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xcccccc })));
      }
      return g.children.length ? g : null;
    },
  };
}
const firstSample = ts => { if (!ts) return undefined; if (ts instanceof Map) return ts.values().next().value; const v = Object.values(ts); return v.length ? (v[0]?.value ?? v[0]) : undefined; };
function flatNum(v) {
  if (v == null) return [];
  if (ArrayBuffer.isView(v)) return v;
  if (Array.isArray(v)) return v.flat(3).map(Number);
  if (typeof v === 'object') return Object.values(v).flat(3).map(Number);
  return [Number(v)];
}

// 搵出 RoomPlan 參數模型入面嘅牆、門、窗、地台、傢俬，轉做 CapturedRoom JSON 格式
function collectSemantic(scene) {
  const leaf = p => p.slice(p.lastIndexOf('/') + 1);
  const hits = [];
  for (const path of scene.prims.keys()) {
    const n = leaf(path); if (/_grp$/i.test(n)) continue;
    let m = n.match(RP_ARCH), cls = null, cat = null;
    if (m) { cls = m[1].toLowerCase(); }
    else if ((m = n.match(RP_OBJ))) { cls = 'object'; cat = RP_OBJ_KEY[m[1].toLowerCase()]; }
    if (!cls) continue;
    // 祖先已經認咗同一類就跳過（例如 Wall0/Wall0 呢種重複命名）
    if (hits.some(h => path.startsWith(h.path + '/'))) continue;
    hits.push({ path, cls, cat });
  }
  const json = { walls: [], doors: [], windows: [], openings: [], objects: [], floors: [], sections: [] };
  const walls = [];
  for (const h of hits) {
    const pts = scene.meshes.filter(p => p === h.path || p.startsWith(h.path + '/')).flatMap(p => scene.pointsOf(p));
    if (pts.length < 3) continue;
    if (h.cls === 'floor') {
      const poly = floorOutline(scene, h.path) || convexHull(pts.map(p => [p.x, p.z]));
      if (poly && poly.length >= 3) { const y = pts.reduce((s, p) => s + p.y, 0) / pts.length; json.floors.push({ identifier: h.path, polygonCorners: poly.map(([x, z]) => [x, y, z]), transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], story: 0 }); }
      continue;
    }
    const box = orientedBox(pts, scene.world(h.path));
    const rec = { identifier: h.path, dimensions: [box.w, box.h, box.d], transform: [box.ax[0], 0, box.ax[1], 0, 0, 1, 0, 0, -box.ax[1], 0, box.ax[0], 0, box.c[0], box.cy, box.c[1], 1], story: 0 };
    if (h.cls === 'wall') { rec.category = { wall: {} }; json.walls.push(rec); walls.push(rec); }
    else if (h.cls === 'door') { rec.category = { door: { isOpen: true } }; json.doors.push(rec); }
    else if (h.cls === 'window') { rec.category = { window: {} }; json.windows.push(rec); }
    else if (h.cls === 'opening') { rec.category = { opening: {} }; json.openings.push(rec); }
    else { rec.category = { [h.cat]: {} }; json.objects.push(rec); }
  }
  // 門窗通常同牆放喺同一個 Wall_N_grp：用嚟搵 parentIdentifier
  for (const o of [...json.doors, ...json.windows, ...json.openings]) {
    const grp = o.identifier.slice(0, o.identifier.lastIndexOf('/'));
    const w = walls.find(w => w.identifier.slice(0, w.identifier.lastIndexOf('/')) === grp && /\/wall[^/]*$/i.test(w.identifier));
    if (w) o.parentIdentifier = w.identifier;
  }
  return { json, walls };
}
// 用件嘢自己嘅軸計長闊高；如果軸唔準（例如網格已經烘咗轉角），就用最細面積長方形
function orientedBox(pts, W) {
  const ax0 = new THREE.Vector3().setFromMatrixColumn(W, 0); let ax = [ax0.x, ax0.z]; let L = Math.hypot(ax[0], ax[1]);
  let y0 = Infinity, y1 = -Infinity; for (const p of pts) { y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  const fit = a => { let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity; for (const p of pts) { const u = p.x * a[0] + p.z * a[1], v = -p.x * a[1] + p.z * a[0]; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); } return { u0, u1, v0, v1, area: (u1 - u0) * (v1 - v0) }; };
  let best = null;
  if (L > 0.2) { ax = [ax[0] / L, ax[1] / L]; best = { a: ax, ...fit(ax) }; }
  const hull = convexHull(pts.map(p => [p.x, p.z])) || [];
  for (let i = 0; i < hull.length; i++) {
    const p = hull[i], q = hull[(i + 1) % hull.length], l = Math.hypot(q[0] - p[0], q[1] - p[1]); if (l < 1e-4) continue;
    const a = [(q[0] - p[0]) / l, (q[1] - p[1]) / l], f = fit(a);
    if (!best || f.area < best.area * 0.97 - 1e-4) best = { a, ...f };
  }
  const { a, u0, u1, v0, v1 } = best, cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
  return { ax: a, w: u1 - u0, d: v1 - v0, h: y1 - y0, cy: (y0 + y1) / 2, c: [cu * a[0] - cv * a[1], cu * a[1] + cv * a[0]] };
}
// 地台網格嘅外框：只出現一次嘅邊串起嚟
function floorOutline(scene, path) {
  const ms = scene.meshes.filter(p => p === path || p.startsWith(path + '/')); if (ms.length !== 1) return null;
  const A = scene.attrs(ms[0]), counts = flatNum(A.faceVertexCounts || []), idx = flatNum(A.faceVertexIndices || []), pts = scene.pointsOf(ms[0]);
  if (!counts.length) return null;
  const edges = new Map(); let k = 0;
  for (const c of counts) { for (let j = 0; j < c; j++) { const a = idx[k + j], b = idx[k + (j + 1) % c], key = a < b ? a + ',' + b : b + ',' + a; edges.set(key, (edges.get(key) || 0) + 1); } k += c; }
  const nb = new Map(); for (const [key, n] of edges) if (n === 1) { const [a, b] = key.split(',').map(Number); (nb.get(a) || nb.set(a, []).get(a)).push(b); (nb.get(b) || nb.set(b, []).get(b)).push(a); }
  if (nb.size < 3) return null;
  const start = nb.keys().next().value, loop = [start]; let prev = -1, cur = start;
  for (let i = 0; i < nb.size; i++) { const next = (nb.get(cur) || []).find(n => n !== prev); if (next == null || next === start) break; loop.push(next); prev = cur; cur = next; }
  if (loop.length < 3) return null;
  return loop.map(i => [pts[i].x, pts[i].z]);
}

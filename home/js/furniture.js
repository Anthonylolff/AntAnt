// 傢俬目錄 + 3D 造型（全部用簡單幾何體砌，冇外部模型）。
// 本地座標：x = 闊、z = 深（正面向 +z）、y 由地面向上。
import * as THREE from 'three';

export const KINDS = {
  sofa: { zh: '梳化', w: 2.0, d: 0.9, h: 0.8, cat: '客廳' },
  sofaL: { zh: 'L 形梳化', w: 2.6, d: 1.6, h: 0.8, cat: '客廳' },
  armchair: { zh: '單人梳化', w: 0.85, d: 0.85, h: 0.8, cat: '客廳' },
  coffee: { zh: '茶几', w: 1.1, d: 0.6, h: 0.42, cat: '客廳' },
  tvstand: { zh: '電視櫃', w: 1.8, d: 0.45, h: 0.5, cat: '客廳' },
  tv: { zh: '電視', w: 1.4, d: 0.08, h: 0.8, cat: '客廳' },
  rug: { zh: '地氈', w: 2.0, d: 1.4, h: 0.01, cat: '客廳' },
  lamp: { zh: '落地燈', w: 0.4, d: 0.4, h: 1.6, cat: '客廳' },
  plant: { zh: '盆栽', w: 0.5, d: 0.5, h: 1.2, cat: '客廳' },
  dining: { zh: '餐枱', w: 1.6, d: 0.9, h: 0.75, cat: '餐廳' },
  round: { zh: '圓枱', w: 1.0, d: 1.0, h: 0.75, cat: '餐廳' },
  chair: { zh: '餐椅', w: 0.45, d: 0.5, h: 0.9, cat: '餐廳' },
  counter: { zh: '廚櫃', w: 2.4, d: 0.6, h: 0.9, cat: '廚房' },
  island: { zh: '中島', w: 1.6, d: 0.9, h: 0.9, cat: '廚房' },
  stove: { zh: '煮食爐', w: 0.6, d: 0.6, h: 0.9, cat: '廚房' },
  sinkunit: { zh: '星盆', w: 0.8, d: 0.6, h: 0.9, cat: '廚房' },
  fridge: { zh: '雪櫃', w: 0.7, d: 0.7, h: 1.85, cat: '廚房' },
  bed: { zh: '雙人床', w: 1.6, d: 2.05, h: 0.5, cat: '睡房' },
  bedsingle: { zh: '單人床', w: 1.0, d: 2.0, h: 0.5, cat: '睡房' },
  nightstand: { zh: '床頭櫃', w: 0.45, d: 0.4, h: 0.5, cat: '睡房' },
  wardrobe: { zh: '衣櫃', w: 1.8, d: 0.6, h: 2.2, cat: '睡房' },
  desk: { zh: '書枱', w: 1.4, d: 0.7, h: 0.75, cat: '書房' },
  officechair: { zh: '電腦椅', w: 0.6, d: 0.6, h: 1.1, cat: '書房' },
  shelf: { zh: '書架', w: 0.9, d: 0.35, h: 1.9, cat: '書房' },
  toilet: { zh: '座廁', w: 0.4, d: 0.65, h: 0.75, cat: '浴室' },
  basin: { zh: '洗手盆', w: 0.6, d: 0.45, h: 0.85, cat: '浴室' },
  bathtub: { zh: '浴缸', w: 1.7, d: 0.75, h: 0.55, cat: '浴室' },
  shower: { zh: '企缸', w: 0.9, d: 0.9, h: 2.0, cat: '浴室' },
  washer: { zh: '洗衣機', w: 0.6, d: 0.6, h: 0.85, cat: '浴室' },
  stairs: { zh: '樓梯', w: 1.0, d: 3.0, h: 2.9, cat: '其他' },
  tree: { zh: '樹', w: 1.6, d: 1.6, h: 3.2, cat: '戶外' },
  outdoortable: { zh: '戶外枱', w: 1.2, d: 1.2, h: 0.72, cat: '戶外' },
  lounger: { zh: '躺椅', w: 0.7, d: 1.9, h: 0.4, cat: '戶外' },
  car: { zh: '車', w: 1.8, d: 4.5, h: 1.45, cat: '戶外' },
  box: { zh: '方塊', w: 0.6, d: 0.6, h: 0.6, cat: '其他' },
};
export const kindInfo = k => KINDS[k] || KINDS.box;
export const itemH = it => it.h || kindInfo(it.kind).h;

export function makeMats(theme) {
  const M = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: o.rough ?? 0.75, metalness: o.metal ?? 0, transparent: !!o.opacity && o.opacity < 1, opacity: o.opacity ?? 1, emissive: o.emissive || 0x000000, emissiveIntensity: o.ei ?? 1, side: o.side ?? THREE.FrontSide });
  const glow = theme.dark ? 0.12 : 0;
  return {
    fabric: M(theme.fabric, { rough: 0.95, emissive: theme.dark ? theme.fabric : 0, ei: glow }),
    wood: M(theme.wood, { rough: 0.7, emissive: theme.dark ? theme.wood : 0, ei: glow }),
    cabinet: M(theme.cabinet, { rough: 0.6, emissive: theme.dark ? theme.cabinet : 0, ei: glow }),
    metal: M(theme.metal, { rough: 0.35, metal: 0.6 }),
    white: M(theme.white, { rough: 0.3 }),
    dark: M(theme.dark, { rough: 0.6 }),
    accent: M(theme.accent, { rough: 0.8 }),
    bedding: M(theme.bedding, { rough: 1, emissive: theme.dark ? theme.bedding : 0, ei: glow }),
    plant: M(theme.plant, { rough: 0.9, emissive: theme.dark ? theme.plant : 0, ei: theme.dark ? 0.25 : 0 }),
    screen: M(theme.screen, { rough: 0.15, metal: 0.2 }),
    glass: M(theme.glass.color, { rough: 0.05, opacity: Math.max(0.15, theme.glass.opacity), side: THREE.DoubleSide }),
    water: M('#7fc8e8', { rough: 0.1, opacity: 0.7 }),
    lampOn: new THREE.MeshBasicMaterial({ color: theme.lamp }),
  };
}

const geoCache = new Map();
const boxGeo = () => geoCache.get('box') || (geoCache.set('box', new THREE.BoxGeometry(1, 1, 1)), geoCache.get('box'));
const cylGeo = () => geoCache.get('cyl') || (geoCache.set('cyl', new THREE.CylinderGeometry(0.5, 0.5, 1, 24)), geoCache.get('cyl'));
const sphGeo = () => geoCache.get('sph') || (geoCache.set('sph', new THREE.SphereGeometry(0.5, 20, 14)), geoCache.get('sph'));

// x0..x1 / y0..y1 / z0..z1 嘅盒
function B(g, mat, x0, x1, y0, y1, z0, z1) {
  const m = new THREE.Mesh(boxGeo(), mat);
  m.scale.set(Math.max(1e-3, x1 - x0), Math.max(1e-3, y1 - y0), Math.max(1e-3, z1 - z0));
  m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  g.add(m); return m;
}
function C(g, mat, x, z, r, y0, y1) { const m = new THREE.Mesh(cylGeo(), mat); m.scale.set(r * 2, y1 - y0, r * 2); m.position.set(x, (y0 + y1) / 2, z); g.add(m); return m; }
function S(g, mat, x, y, z, rx, ry = rx, rz = rx) { const m = new THREE.Mesh(sphGeo(), mat); m.scale.set(rx * 2, ry * 2, rz * 2); m.position.set(x, y, z); g.add(m); return m; }

const legs = (g, mat, w, d, h, inset = 0.05, r = 0.025) => { for (const sx of [-1, 1]) for (const sz of [-1, 1]) C(g, mat, sx * (w / 2 - inset), sz * (d / 2 - inset), r, 0, h); };

const BUILD = {
  sofa(g, m, w, d, h) {
    B(g, m.dark, -w / 2 + 0.05, w / 2 - 0.05, 0, 0.1, -d / 2 + 0.05, d / 2 - 0.05);
    B(g, m.fabric, -w / 2, w / 2, 0.1, 0.42, -d / 2, d / 2);
    B(g, m.fabric, -w / 2, w / 2, 0.42, h, -d / 2, -d / 2 + 0.2);
    B(g, m.fabric, -w / 2, -w / 2 + 0.18, 0.42, 0.62, -d / 2, d / 2); B(g, m.fabric, w / 2 - 0.18, w / 2, 0.42, 0.62, -d / 2, d / 2);
    const n = Math.max(1, Math.round((w - 0.36) / 0.7)), cw = (w - 0.36) / n;
    for (let i = 0; i < n; i++) B(g, m.bedding, -w / 2 + 0.18 + i * cw + 0.02, -w / 2 + 0.18 + (i + 1) * cw - 0.02, 0.42, 0.5, -d / 2 + 0.22, d / 2 - 0.04);
  },
  sofaL(g, m, w, d, h) {
    const sd = 0.9;
    BUILD.sofa(g, m, w, sd, h); g.children.forEach(c => c.position.z += -d / 2 + sd / 2);
    B(g, m.fabric, w / 2 - 0.95, w / 2, 0.1, 0.42, -d / 2 + sd, d / 2);
    B(g, m.bedding, w / 2 - 0.93, w / 2 - 0.2, 0.42, 0.5, -d / 2 + sd, d / 2 - 0.04);
    B(g, m.fabric, w / 2 - 0.18, w / 2, 0.42, 0.62, -d / 2 + sd, d / 2);
  },
  armchair(g, m, w, d, h) { BUILD.sofa(g, m, w, d, h); },
  coffee(g, m, w, d, h) { B(g, m.wood, -w / 2, w / 2, h - 0.04, h, -d / 2, d / 2); B(g, m.wood, -w / 2 + 0.05, w / 2 - 0.05, 0.08, 0.11, -d / 2 + 0.05, d / 2 - 0.05); legs(g, m.metal, w, d, h - 0.04, 0.04, 0.015); },
  tvstand(g, m, w, d, h) { B(g, m.cabinet, -w / 2, w / 2, 0.08, h, -d / 2, d / 2); B(g, m.dark, -w / 2 + 0.05, w / 2 - 0.05, 0, 0.08, -d / 2 + 0.05, d / 2 - 0.05); B(g, m.wood, -w / 2, w / 2, h - 0.02, h, -d / 2, d / 2); },
  tv(g, m, w, d, h) { B(g, m.dark, -w / 2, w / 2, 0.1, h, -0.03, 0.03); const s = B(g, m.screen, -w / 2 + 0.02, w / 2 - 0.02, 0.12, h - 0.02, 0.03, 0.035); s.userData.screen = true; B(g, m.dark, -0.15, 0.15, 0, 0.02, -0.12, 0.12); B(g, m.dark, -0.03, 0.03, 0.02, 0.12, -0.02, 0.02); },
  rug(g, m, w, d) { B(g, m.accent, -w / 2, w / 2, 0, 0.012, -d / 2, d / 2); },
  lamp(g, m, w, d, h) { C(g, m.dark, 0, 0, w * 0.4, 0, 0.03); C(g, m.metal, 0, 0, 0.012, 0.03, h - 0.3); const sh = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.3, w * 0.5, 0.32, 24, 1, true), m.bedding); sh.position.y = h - 0.16; g.add(sh); S(g, m.lampOn, 0, h - 0.2, 0, 0.05).userData.bulb = true; },
  plant(g, m, w, d, h) { C(g, m.cabinet, 0, 0, w * 0.32, 0, 0.35); for (let i = 0; i < 5; i++) { const a = i * 1.3; S(g, m.plant, Math.cos(a) * w * 0.15, 0.55 + i * (h - 0.7) / 5, Math.sin(a) * w * 0.15, w * 0.35, w * 0.32, w * 0.35); } },
  dining(g, m, w, d, h) { B(g, m.wood, -w / 2, w / 2, h - 0.04, h, -d / 2, d / 2); legs(g, m.wood, w, d, h - 0.04, 0.06, 0.03); },
  round(g, m, w, d, h) { C(g, m.wood, 0, 0, w / 2, h - 0.04, h); C(g, m.wood, 0, 0, 0.05, 0.03, h - 0.04); C(g, m.wood, 0, 0, w * 0.22, 0, 0.03); },
  chair(g, m, w, d, h) { B(g, m.wood, -w / 2, w / 2, 0.42, 0.46, -d / 2, d / 2); B(g, m.wood, -w / 2, w / 2, 0.46, h, -d / 2, -d / 2 + 0.04); legs(g, m.wood, w, d, 0.42, 0.03, 0.015); },
  counter(g, m, w, d, h) { B(g, m.dark, -w / 2 + 0.02, w / 2 - 0.02, 0, 0.1, -d / 2, d / 2 - 0.06); B(g, m.cabinet, -w / 2, w / 2, 0.1, h - 0.04, -d / 2, d / 2 - 0.02); B(g, m.white, -w / 2, w / 2, h - 0.04, h, -d / 2, d / 2); const n = Math.max(1, Math.round(w / 0.6)); for (let i = 1; i < n; i++) B(g, m.dark, -w / 2 + i * w / n - 0.003, -w / 2 + i * w / n + 0.003, 0.12, h - 0.06, d / 2 - 0.02, d / 2 - 0.015); },
  island(g, m, w, d, h) { BUILD.counter(g, m, w, d, h); for (const sx of [-0.4, 0.4]) { C(g, m.metal, sx * w / 2, d / 2 + 0.3, 0.02, 0, 0.62); C(g, m.dark, sx * w / 2, d / 2 + 0.3, 0.18, 0.62, 0.66); } },
  stove(g, m, w, d, h) { BUILD.counter(g, m, w, d, h); B(g, m.screen, -w / 2 + 0.04, w / 2 - 0.04, h, h + 0.01, -d / 2 + 0.05, d / 2 - 0.05); for (const [x, z] of [[-0.14, -0.12], [0.14, -0.12], [-0.14, 0.12], [0.14, 0.12]]) C(g, m.metal, x * w / 0.6, z, 0.07, h + 0.01, h + 0.015); },
  sinkunit(g, m, w, d, h) { BUILD.counter(g, m, w, d, h); B(g, m.metal, -w / 2 + 0.08, w / 2 - 0.08, h - 0.15, h + 0.002, -d / 2 + 0.1, d / 2 - 0.08); C(g, m.metal, 0, -d / 2 + 0.06, 0.015, h, h + 0.3); },
  fridge(g, m, w, d, h) { B(g, m.white, -w / 2, w / 2, 0, h, -d / 2, d / 2); B(g, m.dark, -w / 2 + 0.01, w / 2 - 0.01, h * 0.62, h * 0.62 + 0.01, d / 2, d / 2 + 0.003); C(g, m.metal, w / 2 - 0.06, d / 2 + 0.03, 0.012, h * 0.65, h * 0.85); C(g, m.metal, w / 2 - 0.06, d / 2 + 0.03, 0.012, h * 0.3, h * 0.55); },
  bed(g, m, w, d, h) {
    B(g, m.wood, -w / 2, w / 2, 0.08, 0.3, -d / 2, d / 2); B(g, m.bedding, -w / 2 + 0.03, w / 2 - 0.03, 0.3, h, -d / 2 + 0.03, d / 2 - 0.03);
    B(g, m.wood, -w / 2 - 0.02, w / 2 + 0.02, 0, 1.0, -d / 2 - 0.06, -d / 2);
    B(g, m.fabric, -w / 2 + 0.02, w / 2 - 0.02, h, h + 0.04, -d / 2 + 0.6, d / 2 - 0.02);
    const pw = Math.min(0.6, (w - 0.15) / 2); const np = w > 1.3 ? 2 : 1;
    for (let i = 0; i < np; i++) { const cx = np === 1 ? 0 : (i ? 1 : -1) * (pw / 2 + 0.04); B(g, m.white, cx - pw / 2, cx + pw / 2, h, h + 0.12, -d / 2 + 0.1, -d / 2 + 0.5); }
  },
  bedsingle(g, m, w, d, h) { BUILD.bed(g, m, w, d, h); },
  nightstand(g, m, w, d, h) { B(g, m.wood, -w / 2, w / 2, 0.05, h, -d / 2, d / 2); B(g, m.dark, -w / 2 + 0.03, w / 2 - 0.03, h * 0.5, h * 0.5 + 0.01, d / 2, d / 2 + 0.003); },
  wardrobe(g, m, w, d, h) { B(g, m.cabinet, -w / 2, w / 2, 0, h, -d / 2, d / 2); const n = Math.max(2, Math.round(w / 0.5)); for (let i = 1; i < n; i++) B(g, m.dark, -w / 2 + i * w / n - 0.003, -w / 2 + i * w / n + 0.003, 0.02, h - 0.02, d / 2, d / 2 + 0.004); for (let i = 0; i < n; i++) C(g, m.metal, -w / 2 + (i + (i % 2 ? 0.15 : 0.85)) * w / n, d / 2 + 0.02, 0.008, h * 0.45, h * 0.6); },
  desk(g, m, w, d, h) { B(g, m.wood, -w / 2, w / 2, h - 0.03, h, -d / 2, d / 2); B(g, m.cabinet, w / 2 - 0.45, w / 2 - 0.02, 0, h - 0.03, -d / 2 + 0.02, d / 2 - 0.02); B(g, m.metal, -w / 2 + 0.02, -w / 2 + 0.06, 0, h - 0.03, -d / 2 + 0.05, d / 2 - 0.05); B(g, m.dark, -0.3, 0.3, h + 0.08, h + 0.42, -d / 2 + 0.12, -d / 2 + 0.14); B(g, m.dark, -0.03, 0.03, h, h + 0.1, -d / 2 + 0.1, -d / 2 + 0.13); },
  officechair(g, m, w, d, h) { C(g, m.dark, 0, 0, w * 0.4, 0, 0.05); C(g, m.metal, 0, 0, 0.025, 0.05, 0.45); B(g, m.fabric, -w / 2 + 0.05, w / 2 - 0.05, 0.45, 0.53, -d / 2 + 0.05, d / 2 - 0.05); B(g, m.fabric, -w / 2 + 0.08, w / 2 - 0.08, 0.55, h, -d / 2 + 0.03, -d / 2 + 0.1); },
  shelf(g, m, w, d, h) { B(g, m.wood, -w / 2, -w / 2 + 0.02, 0, h, -d / 2, d / 2); B(g, m.wood, w / 2 - 0.02, w / 2, 0, h, -d / 2, d / 2); B(g, m.wood, -w / 2, w / 2, 0, h, -d / 2, -d / 2 + 0.01); const n = Math.max(3, Math.round(h / 0.38)); for (let i = 0; i <= n; i++) { const y = i * (h - 0.02) / n; B(g, m.wood, -w / 2, w / 2, y, y + 0.02, -d / 2, d / 2); if (i < n) for (let k = 0; k < 4; k++) { const bx = -w / 2 + 0.06 + k * (w - 0.12) / 4; B(g, k % 2 ? m.accent : m.fabric, bx, bx + 0.05 + (k % 3) * 0.02, y + 0.02, y + 0.02 + Math.min(0.3, (h / n) * 0.75), -d / 2 + 0.03, d / 2 - 0.05); } } },
  toilet(g, m, w, d, h) { B(g, m.white, -w / 2, w / 2, 0.4, h, -d / 2, -d / 2 + 0.18); const b = S(g, m.white, 0, 0.3, 0.05, w / 2, 0.15, d * 0.4); b.position.y = 0.28; C(g, m.white, 0, 0.0, 0.12, 0, 0.25).position.z = 0; B(g, m.white, -w / 2 + 0.02, w / 2 - 0.02, 0.4, 0.42, -d / 2 + 0.18, d / 2 - 0.02); },
  basin(g, m, w, d, h) { B(g, m.cabinet, -w / 2, w / 2, 0.3, h - 0.05, -d / 2, d / 2); B(g, m.white, -w / 2, w / 2, h - 0.05, h, -d / 2, d / 2); B(g, m.water, -w / 2 + 0.08, w / 2 - 0.08, h - 0.04, h + 0.001, -d / 2 + 0.1, d / 2 - 0.06); C(g, m.metal, 0, -d / 2 + 0.05, 0.012, h, h + 0.22); B(g, m.glass, -w / 2, w / 2, h + 0.3, h + 1.0, -d / 2, -d / 2 + 0.02); },
  bathtub(g, m, w, d, h) { B(g, m.white, -w / 2, w / 2, 0, h, -d / 2, -d / 2 + 0.08); B(g, m.white, -w / 2, w / 2, 0, h, d / 2 - 0.08, d / 2); B(g, m.white, -w / 2, -w / 2 + 0.1, 0, h, -d / 2, d / 2); B(g, m.white, w / 2 - 0.1, w / 2, 0, h, -d / 2, d / 2); B(g, m.white, -w / 2, w / 2, 0, 0.12, -d / 2, d / 2); B(g, m.water, -w / 2 + 0.1, w / 2 - 0.1, 0.12, h - 0.12, -d / 2 + 0.08, d / 2 - 0.08); },
  shower(g, m, w, d, h) { B(g, m.white, -w / 2, w / 2, 0, 0.05, -d / 2, d / 2); B(g, m.glass, -w / 2, w / 2, 0.05, h, d / 2 - 0.01, d / 2); B(g, m.glass, w / 2 - 0.01, w / 2, 0.05, h, -d / 2, d / 2); C(g, m.metal, -w / 2 + 0.15, -d / 2 + 0.1, 0.012, 1.0, h); C(g, m.metal, -w / 2 + 0.15, -d / 2 + 0.2, 0.1, h - 0.02, h); },
  washer(g, m, w, d, h) { B(g, m.white, -w / 2, w / 2, 0, h, -d / 2, d / 2); const door = new THREE.Mesh(new THREE.TorusGeometry(w * 0.27, 0.025, 10, 28), m.metal); door.position.set(0, h * 0.45, d / 2 + 0.01); g.add(door); const gl = C(g, m.screen, 0, d / 2, w * 0.25, 0, 0.01); gl.rotation.x = Math.PI / 2; gl.position.set(0, h * 0.45, d / 2 + 0.005); B(g, m.dark, -w / 2 + 0.04, w / 2 - 0.04, h - 0.12, h - 0.04, d / 2, d / 2 + 0.005); },
  stairs(g, m, w, d, h) { const n = Math.max(8, Math.round(h / 0.18)); const run = d / n; for (let i = 0; i < n; i++) B(g, m.wood, -w / 2, w / 2, 0, (i + 1) * h / n, d / 2 - (i + 1) * run, d / 2 - i * run); C(g, m.metal, w / 2 - 0.03, 0, 0.015, 0, 0.1).visible = false; },
  tree(g, m, w, d, h) { C(g, m.wood, 0, 0, Math.max(0.06, w * 0.06), 0, h * 0.5); S(g, m.plant, 0, h * 0.62, 0, w / 2, h * 0.3, d / 2); S(g, m.plant, w * 0.15, h * 0.85, -d * 0.1, w * 0.35, h * 0.2, d * 0.35); },
  outdoortable(g, m, w, d, h) { BUILD.round(g, m, w, d, h); for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2, r = w / 2 + 0.25; const ch = new THREE.Group(); BUILD.chair(ch, m, 0.45, 0.5, 0.9); ch.position.set(Math.cos(a) * r, 0, Math.sin(a) * r); ch.rotation.y = -a - Math.PI / 2; g.add(ch); } C(g, m.metal, 0, 0, 0.02, h, h + 1.4); const um = new THREE.Mesh(new THREE.ConeGeometry(w * 1.0, 0.35, 8, 1, true), m.accent); um.position.y = h + 1.55; g.add(um); },
  lounger(g, m, w, d, h) { B(g, m.wood, -w / 2, w / 2, 0.2, 0.3, -d / 2 + 0.6, d / 2); const back = B(g, m.wood, -w / 2, w / 2, 0, 0.08, 0, 0.7); back.rotation.x = -0.6; back.position.set(0, 0.45, -d / 2 + 0.35); B(g, m.bedding, -w / 2 + 0.03, w / 2 - 0.03, 0.3, 0.36, -d / 2 + 0.62, d / 2 - 0.03); legs(g, m.wood, w, d, 0.2, 0.04, 0.02); },
  car(g, m, w, d, h) { B(g, m.accent, -w / 2, w / 2, 0.3, 0.85, -d / 2, d / 2); B(g, m.glass, -w / 2 + 0.08, w / 2 - 0.08, 0.85, h, -d / 2 + 1.1, d / 2 - 1.2); for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const t = C(g, m.dark, sx * (w / 2 - 0.1), sz * (d / 2 - 0.75), 0.33, -0.1, 0.1); t.rotation.z = Math.PI / 2; t.position.y = 0.33; } },
  box(g, m, w, d, h) { B(g, m.cabinet, -w / 2, w / 2, 0, h, -d / 2, d / 2); },
};

export function buildItem(it, mats, theme) {
  const k = kindInfo(it.kind), w = it.w || k.w, d = it.d || k.d, h = itemH(it);
  const g = new THREE.Group();
  let m = mats;
  if (it.color) { // 自訂顏色 → 主料換色
    const c = new THREE.Color(it.color);
    m = { ...mats }; for (const key of ['fabric', 'wood', 'cabinet', 'accent']) { m[key] = mats[key].clone(); m[key].color = c; if (theme.dark) m[key].emissive = c; }
  }
  (BUILD[it.kind] || BUILD.box)(g, m, w, d, h);
  g.traverse(o => { if (o.isMesh) { o.castShadow = it.kind !== 'rug'; o.receiveShadow = true; } });
  if (theme.furnEdges) {
    const lm = new THREE.LineBasicMaterial({ color: theme.furnEdges.color, transparent: true, opacity: theme.furnEdges.opacity });
    const lines = [];
    g.traverse(o => { if (o.isMesh && o.material !== mats.lampOn) lines.push(o); });
    for (const o of lines) { const e = new THREE.LineSegments(edgesGeo(o.geometry), lm); e.position.copy(o.position); e.scale.copy(o.scale); e.rotation.copy(o.rotation); o.parent.add(e); }
  }
  g.position.y = it.elev || 0;
  return g;
}
const edgeCache = new WeakMap();
function edgesGeo(geo) { let e = edgeCache.get(geo); if (!e) { e = new THREE.EdgesGeometry(geo, 30); edgeCache.set(geo, e); } return e; }

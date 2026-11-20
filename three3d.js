// 3D 效果：由平面圖狀態即時生成（現代輕奢風格：雲石地、木飾面牆、深色天花燈槽、吊燈）
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const H = 2.6;           // 樓底 (m)
const M = v => v / 100;  // cm → m
const $ = id => document.getElementById(id);

let renderer, scene, camera, controls, built = false, raf = 0, ceilingGroup;
let BEDS = [], BED_OPEN = false;
function applyBed() { for (const b of BEDS) { b.lift.rotation.z = BED_OPEN ? 0.85 : 0; for (const dr of b.drawers) dr.position.x = dr.userData.x0 + (BED_OPEN ? 0.32 : 0); for (const st of b.struts) st.visible = BED_OPEN; } }
let LIGHTS_ON = true, NIGHT = false, HEMI = null, SUN = null, SKY = null, NIGHT_BG = new THREE.Color(0x0d1424);
function applyLights() { // 開燈／閂燈：室內燈、燈帶、筒燈；窗外日光保留
  scene.traverse(o => { if (o.isPointLight || o.isSpotLight) { if (o.userData.i0 === undefined) o.userData.i0 = o.intensity; o.intensity = LIGHTS_ON ? o.userData.i0 : 0; } });
  MAT.led.emissiveIntensity = LIGHTS_ON ? 2.4 : 0; MAT.led.color.set(LIGHTS_ON ? 0xfff1d6 : 0xd8d8d8);
  // 日／夜
  if (HEMI) HEMI.intensity = NIGHT ? 0.05 : 0.45;
  if (SUN) SUN.intensity = NIGHT ? 0.04 : 1.7;
  if (SKY === null && scene.background && !scene.background.isColor) SKY = scene.background;
  scene.background = NIGHT ? NIGHT_BG : (SKY || scene.background);
  if (scene.environment && !scene.userData.env) scene.userData.env = scene.environment;
  const env = scene.userData.env;
  // r160 冇 environmentIntensity，用環境貼圖開關模擬：日頭閂燈保留天光反射；夜晚閂燈就幾乎全黑
  scene.environment = NIGHT ? (LIGHTS_ON ? env : null) : env;
  scene.traverse(o => { const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []; for (const m of ms) if ('envMapIntensity' in m) { if (m.userData.e0 === undefined) m.userData.e0 = m.envMapIntensity; m.envMapIntensity = m.userData.e0 * (NIGHT ? 0.35 : (LIGHTS_ON ? 1 : 0.55)); } });
}
let XRAY = false;
function applyXray() { // X 光：牆變半透明，睇穿入房
  const seen = new Set();
  for (const c of CUTS) { const m = c.mesh.material; if (seen.has(m)) continue; seen.add(m);
    m.transparent = XRAY; m.opacity = XRAY ? 0.15 : 1; m.depthWrite = !XRAY; m.needsUpdate = true; }
  for (const c of CUTS) c.mesh.castShadow = !XRAY;
}
let DOORS = [], DOORS_OPEN = false, CUT = false, CUTS = [];
const CUT_H = 1.2;

// ---------------------------------------------------------------- textures
function canvasTex(size, draw, repeatW = 1, repeatH = 1, srgb = true) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'); draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeatW, repeatH);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8; return t;
}
function rand(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

function marbleTex() { // 1 tile = 120cm, texture covers 2.4m
  return canvasTex(1024, (g, S) => {
    const r = rand(7);
    g.fillStyle = '#d9d8d6'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(${150 + r() * 60},${150 + r() * 60},${155 + r() * 60},${r() * 0.05})`; g.beginPath(); g.arc(r() * S, r() * S, r() * 40, 0, 7); g.fill(); }
    for (let i = 0; i < 26; i++) {
      g.strokeStyle = `rgba(95,98,106,${0.18 + r() * 0.4})`; g.lineWidth = 0.8 + r() * 2.6;
      g.beginPath(); let x = r() * S, y = r() * S; g.moveTo(x, y);
      for (let k = 0; k < 8; k++) { const nx = x + (r() - 0.3) * 260, ny = y + (r() - 0.5) * 180; g.quadraticCurveTo(x + (r() - 0.5) * 120, y + (r() - 0.5) * 120, nx, ny); x = nx; y = ny; }
      g.stroke();
    }
    g.strokeStyle = 'rgba(160,160,160,0.55)'; g.lineWidth = 1.5;
    for (const v of [0, S / 2]) { g.beginPath(); g.moveTo(v, 0); g.lineTo(v, S); g.stroke(); g.beginPath(); g.moveTo(0, v); g.lineTo(S, v); g.stroke(); }
  });
}
function smallTileTex(base = '#ecebe8', grout = '#c9c7c2', n = 8) {
  return canvasTex(512, (g, S) => {
    g.fillStyle = grout; g.fillRect(0, 0, S, S); const s = S / n, r = rand(3);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const v = (r() * 10 - 5) | 0; g.fillStyle = shade(base, v); g.fillRect(i * s + 1.5, j * s + 1.5, s - 3, s - 3); }
  });
}
function shade(hex, v) { const n = parseInt(hex.slice(1), 16); const c = k => Math.max(0, Math.min(255, k + v)); return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`; }
function panelTex(base = '#7b6a58') { // 牆身木飾面：60cm 一條坑
  return canvasTex(512, (g, S) => {
    const r = rand(11); g.fillStyle = base; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 1400; i++) { g.fillStyle = `rgba(80,60,40,${r() * 0.03})`; g.fillRect(r() * S, r() * S, 1 + r() * 3, 20 + r() * 80); }
    g.fillStyle = 'rgba(60,45,30,0.45)'; g.fillRect(0, 0, 3, S);
    g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(3, 0, 2, S);
  });
}
function woodTex(base = '#9c7f62') {
  return canvasTex(512, (g, S) => {
    const r = rand(19); g.fillStyle = base; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 220; i++) { g.strokeStyle = `rgba(${r() < .5 ? '60,40,25' : '230,210,180'},${0.04 + r() * 0.08})`; g.lineWidth = 1 + r() * 3; g.beginPath(); const x = r() * S; g.moveTo(x, 0); g.bezierCurveTo(x + (r() - .5) * 30, S / 3, x + (r() - .5) * 30, S * 2 / 3, x + (r() - .5) * 20, S); g.stroke(); }
  });
}
function fabricTex(base = '#d6d2ca') {
  return canvasTex(256, (g, S) => {
    const r = rand(5); g.fillStyle = base; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 9000; i++) { g.fillStyle = `rgba(${r() < .5 ? '0,0,0' : '255,255,255'},${r() * 0.05})`; g.fillRect(r() * S, r() * S, 1, 1); }
  }, 3, 3);
}
function rugTex() {
  return canvasTex(1024, (g, S) => {
    const r = rand(23); g.fillStyle = '#3b3e44'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 70; i++) {
      g.strokeStyle = `rgba(220,222,226,${0.15 + r() * 0.35})`; g.lineWidth = 1 + r() * 3; g.beginPath();
      const cx = r() * S, cy = r() * S, rr = 40 + r() * 220; g.ellipse(cx, cy, rr, rr * (0.3 + r() * 0.7), r() * 3, 0, Math.PI * (0.6 + r() * 1.3)); g.stroke();
    }
    g.strokeStyle = 'rgba(20,20,22,.8)'; g.lineWidth = 18; g.strokeRect(9, 9, S - 18, S - 18);
  });
}
function oakPlankTex() { // DE·HOME DH9979：淺暖橡木 SPC，板 1530×230（貼圖 = 1.53m × 1.38m，6 條板）
  return canvasTex(1024, (g, S) => {
    const r = rand(31), rows = 6, rh = S / rows;
    for (let i = 0; i < rows; i++) {
      const off = (i % 3) * S / 3 + r() * 60;
      for (const sx of [-S + off, off]) {
        const base = [226 + (r() * 10 - 5) | 0, 205 + (r() * 10 - 5) | 0, 166 + (r() * 10 - 5) | 0];
        g.fillStyle = `rgb(${base})`; g.fillRect(sx, i * rh, S, rh);
        for (let k = 0; k < 60; k++) { g.strokeStyle = `rgba(${r() < .6 ? '150,115,70' : '255,240,215'},${0.05 + r() * 0.12})`; g.lineWidth = 0.6 + r() * 1.8;
          const y = i * rh + r() * rh; g.beginPath(); g.moveTo(sx, y); g.bezierCurveTo(sx + S * 0.3, y + (r() - .5) * 8, sx + S * 0.6, y + (r() - .5) * 8, sx + S, y + (r() - .5) * 6); g.stroke(); }
        for (let k = 0; k < 3; k++) { g.fillStyle = 'rgba(140,100,60,0.12)'; g.beginPath(); g.ellipse(sx + r() * S, i * rh + rh / 2, 10 + r() * 18, 3 + r() * 4, 0, 0, 7); g.fill(); }
        g.fillStyle = 'rgba(120,90,55,0.35)'; g.fillRect(sx + S - 1, i * rh, 2, rh);
      }
      g.fillStyle = 'rgba(120,90,55,0.4)'; g.fillRect(0, i * rh, S, 1.5);
    }
  });
}
function stoneTileTex(base, vein, tiles = 2, streak = false, gloss = false) { // 600×600 磚，tiles 塊 / 貼圖
  return canvasTex(1024, (g, S) => {
    const r = rand(base.length * 97 + tiles); g.fillStyle = base; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 9000; i++) { g.fillStyle = `rgba(${r() < .5 ? '90,85,78' : '255,255,250'},${r() * 0.06})`; const sz = 1 + r() * 2.5; g.fillRect(r() * S, r() * S, sz, sz); }
    if (streak) for (let i = 0; i < 90; i++) { g.strokeStyle = `rgba(${vein},${0.04 + r() * 0.1})`; g.lineWidth = 1 + r() * 4; const y = r() * S; g.beginPath(); g.moveTo(0, y); g.lineTo(S, y + (r() - .5) * 20); g.stroke(); }
    else for (let i = 0; i < 14; i++) { g.strokeStyle = `rgba(${vein},${0.06 + r() * 0.12})`; g.lineWidth = 0.6 + r() * 1.6; g.beginPath(); let x = r() * S, y = r() * S; g.moveTo(x, y); for (let k = 0; k < 5; k++) { x += (r() - .4) * 200; y += (r() - .5) * 160; g.lineTo(x, y); } g.stroke(); }
    g.strokeStyle = 'rgba(150,145,138,0.7)'; g.lineWidth = 2; const s = S / tiles;
    for (let i = 0; i <= tiles; i++) { g.beginPath(); g.moveTo(i * s, 0); g.lineTo(i * s, S); g.stroke(); g.beginPath(); g.moveTo(0, i * s); g.lineTo(S, i * s); g.stroke(); }
  });
}
function speckleTex() { // 白色石英石枱面（細麻點）
  return canvasTex(512, (g, S) => { const r = rand(77); g.fillStyle = '#f0eee9'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 2600; i++) { g.fillStyle = r() < .7 ? `rgba(120,118,112,${0.3 + r() * 0.4})` : `rgba(60,58,55,${0.4 + r() * 0.4})`; const sz = 0.8 + r() * 2.2; g.fillRect(r() * S, r() * S, sz, sz); } });
}
function gradTex(stops, vertical = true) { const c = document.createElement('canvas'); c.width = 8; c.height = 256; const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 256); stops.forEach(([o, col]) => gr.addColorStop(o, col)); g.fillStyle = gr; g.fillRect(0, 0, 8, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; }
function pegTex() { // 洞洞板（原木色）
  return canvasTex(512, (g, S) => { g.fillStyle = '#d9b48a'; g.fillRect(0, 0, S, S);
    const r = rand(5); for (let k = 0; k < 40; k++) { g.strokeStyle = `rgba(150,105,60,${0.05 + r() * 0.08})`; g.lineWidth = 1 + r() * 2; const y = r() * S; g.beginPath(); g.moveTo(0, y); g.lineTo(S, y + (r() - .5) * 10); g.stroke(); }
    g.fillStyle = 'rgba(90,60,30,0.75)'; const step = S / 16; for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) { g.beginPath(); g.arc(step * (i + 0.5), step * (j + 0.5), 3.2, 0, 7); g.fill(); } });
}
function skyTex() {
  const c = document.createElement('canvas'); c.width = 4; c.height = 256; const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, '#9ec3e6'); gr.addColorStop(0.55, '#dfe9f1'); gr.addColorStop(1, '#f4efe6');
  g.fillStyle = gr; g.fillRect(0, 0, 4, 256); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// ---------------------------------------------------------------- materials
let MAT;
function makeMaterials() {
  const marble = marbleTex();
  MAT = {
    marble: new THREE.MeshPhysicalMaterial({ map: marble, roughness: 0.12, clearcoat: 0.6, clearcoatRoughness: 0.08 }),
    oakFloor: new THREE.MeshStandardMaterial({ map: oakPlankTex(), roughness: 0.6 }),                          // DH9979
    bathTile: new THREE.MeshStandardMaterial({ map: stoneTileTex('#d2cec6', '140,134,126', 2), roughness: 0.55 }),   // SM6002G
    bathWall: new THREE.MeshPhysicalMaterial({ map: stoneTileTex('#d2cec6', '140,134,126', 2), roughness: 0.18, clearcoat: 0.5 }),
    kitFloor: new THREE.MeshStandardMaterial({ map: stoneTileTex('#c9c0b0', '120,108,92', 2, true), roughness: 0.6 }),  // ROG66022
    kitWall: new THREE.MeshPhysicalMaterial({ map: stoneTileTex('#d9cfbd', '150,135,112', 2), roughness: 0.2, clearcoat: 0.5 }), // MS6002GM
    ivory: new THREE.MeshStandardMaterial({ color: 0xeee6d3, roughness: 0.92 }),
    creamW: new THREE.MeshStandardMaterial({ map: woodTex('#b08f70'), roughness: 0.6 }),                        // 同其他衣櫃一樣木紋
    peg: new THREE.MeshStandardMaterial({ map: pegTex(), roughness: 0.6 }),
    lightOak: new THREE.MeshStandardMaterial({ map: woodTex('#d6b48c'), roughness: 0.55 }),
    tintGlass: new THREE.MeshPhysicalMaterial({ color: 0x9aa0a6, roughness: 0.05, transparent: true, opacity: 0.28 }),                                // 象牙白 SF1902M
    ceilWhite: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, side: THREE.DoubleSide }),    // 純白 SF0000M
    doorWood: new THREE.MeshStandardMaterial({ map: woodTex('#cdb5a2'), roughness: 0.6 }),                       // 薩斯木
    doorFrame: new THREE.MeshStandardMaterial({ color: 0xd3cbbe, roughness: 0.7 }),                              // 奶油灰
    kitDoor: new THREE.MeshStandardMaterial({ map: woodTex('#b4a693'), roughness: 0.6 }),                        // 櫃門 #24 灰米木紋
    quartzW: new THREE.MeshPhysicalMaterial({ map: speckleTex(), roughness: 0.2, clearcoat: 0.4 }),
    blackGlass: new THREE.MeshPhysicalMaterial({ color: 0x0c0c0e, roughness: 0.06, metalness: 0.2, clearcoat: 1 }),
    castIron: new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.75, metalness: 0.4 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.12, metalness: 1 }),
    greyRing: new THREE.MeshStandardMaterial({ color: 0x8c9096, roughness: 0.35, metalness: 0.5 }),
    wetFloor: new THREE.MeshStandardMaterial({ map: smallTileTex('#9a9a98', '#7d7d7b', 6), roughness: 0.35 }),
    wall: new THREE.MeshStandardMaterial({ map: panelTex(), roughness: 0.7 }),
    partWall: new THREE.MeshStandardMaterial({ map: panelTex('#8a7863'), roughness: 0.7 }),
    ceil: new THREE.MeshStandardMaterial({ color: 0x2a2826, roughness: 0.9, side: THREE.DoubleSide }),
    ceilLight: new THREE.MeshStandardMaterial({ color: 0xe9e4dc, roughness: 0.9, side: THREE.DoubleSide }),
    led: new THREE.MeshStandardMaterial({ color: 0xfff1d6, emissive: 0xffe4b8, emissiveIntensity: 2.4 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0xdfeef7, roughness: 0.02, transmission: 0.9, transparent: true, opacity: 0.25, thickness: 0.01, side: THREE.DoubleSide }),
    showerGlass: new THREE.MeshPhysicalMaterial({ color: 0xeaf4fa, roughness: 0.03, transparent: true, opacity: 0.22, side: THREE.DoubleSide }),
    frame: new THREE.MeshStandardMaterial({ color: 0x2b2b2d, roughness: 0.4, metalness: 0.6 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xb08d57, roughness: 0.3, metalness: 1 }),
    black: new THREE.MeshStandardMaterial({ color: 0x18181a, roughness: 0.35, metalness: 0.2 }),
    walnut: new THREE.MeshStandardMaterial({ map: woodTex('#5a4232'), roughness: 0.5 }),
    oak: new THREE.MeshStandardMaterial({ map: woodTex('#a88c6c'), roughness: 0.55 }),
    cabinet: new THREE.MeshStandardMaterial({ map: woodTex('#b08f70'), roughness: 0.6 }),
    cream: new THREE.MeshStandardMaterial({ map: woodTex('#d9c6b4'), roughness: 0.6 }),
    creamDark: new THREE.MeshStandardMaterial({ color: 0xa48d78, roughness: 0.7 }),
    grey: new THREE.MeshStandardMaterial({ color: 0x8e9196, roughness: 0.55 }),
    inner: new THREE.MeshStandardMaterial({ color: 0x5b5e63, roughness: 0.7 }),
    matte: new THREE.MeshStandardMaterial({ color: 0xe6e2dc, roughness: 0.75 }),
    walnutDark: new THREE.MeshStandardMaterial({ map: woodTex('#5b4334'), roughness: 0.55 }),
    innerLight: new THREE.MeshStandardMaterial({ color: 0xa9acb1, roughness: 0.6 }),
    white: new THREE.MeshStandardMaterial({ color: 0xf2f1ee, roughness: 0.45 }),
    ceramic: new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.15, clearcoat: 1 }),
    quartz: new THREE.MeshPhysicalMaterial({ map: marble, roughness: 0.15, clearcoat: 0.5 }),
    steel: new THREE.MeshStandardMaterial({ color: 0xbfc3c7, roughness: 0.25, metalness: 0.9 }),
    mirror: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.02, metalness: 1 }),
    fabric: new THREE.MeshStandardMaterial({ map: fabricTex('#c9c5bd'), roughness: 0.95 }),
    fabricDark: new THREE.MeshStandardMaterial({ map: fabricTex('#4a4c52'), roughness: 0.95 }),
    fabricGrey: new THREE.MeshStandardMaterial({ map: fabricTex('#9d9fa3'), roughness: 0.95 }),
    linen: new THREE.MeshStandardMaterial({ map: fabricTex('#f1efea'), roughness: 0.9 }),
    duvet: new THREE.MeshStandardMaterial({ map: fabricTex('#8f949b'), roughness: 0.95 }),
    rug: new THREE.MeshStandardMaterial({ map: rugTex(), roughness: 1 }),
    tvScreen: new THREE.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.08, metalness: 0.5 }),
    globe: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2dc, emissiveIntensity: 1.6, roughness: 0.4 }),
    pipe: new THREE.MeshStandardMaterial({ color: 0x8d8f92, roughness: 0.6 }),
  };
}

// ---------------------------------------------------------------- helpers
function box(w, h, d, mat, x, y, z, parent, cast = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.castShadow = cast; m.receiveShadow = true; parent.add(m); return m;
}
function rbox(w, h, d, r, mat, x, y, z, parent) { // rounded cushion
  const shape = new THREE.Shape(); const hw = w / 2, hd = d / 2; r = Math.min(r, hw, hd);
  shape.moveTo(-hw + r, -hd); shape.lineTo(hw - r, -hd); shape.quadraticCurveTo(hw, -hd, hw, -hd + r); shape.lineTo(hw, hd - r);
  shape.quadraticCurveTo(hw, hd, hw - r, hd); shape.lineTo(-hw + r, hd); shape.quadraticCurveTo(-hw, hd, -hw, hd - r); shape.lineTo(-hw, -hd + r); shape.quadraticCurveTo(-hw, -hd, -hw + r, -hd);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.001, h - 0.04), bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 3, curveSegments: 6 });
  geo.rotateX(-Math.PI / 2); geo.translate(0, -h / 2 + 0.02, 0);
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; parent.add(m); return m;
}
function cyl(rt, rb, h, mat, x, y, z, parent, seg = 32) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; parent.add(m); return m;
}

// 衣櫃（可開門，內有掛通、層板、褲架）
function drawerStack(g, x0, x1, y0, y1, zFront, rows, cols, mat) { // 櫃桶面＋拉手
  const w = (x1 - x0) / cols, h = (y1 - y0) / rows;
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const cx = x0 + w * (i + 0.5), cy = y0 + h * (j + 0.5);
    box(w - 0.004, h - 0.004, 0.018, mat, cx, cy, zFront - 0.009, g);
    box(Math.min(0.16, w * 0.45), 0.012, 0.016, MAT.brass, cx, cy + h / 2 - 0.05, zFront + 0.006, g);
  }
}
function flipStack(g, x0, x1, y0, y1, zBack, zFront, rows, cols, mat) { // 上翻門（拉手喺門底），最下一層留空做開放格
  const w = (x1 - x0) / cols, h = (y1 - y0) / rows, t = 0.018, dep = zFront - zBack, cx0 = (x0 + x1) / 2;
  // 開放層
  box(x1 - x0, h, t, MAT.lightOak, cx0, y0 + h / 2, zBack + t / 2, g);
  box(x1 - x0, t, dep, MAT.lightOak, cx0, y0 + t / 2, (zBack + zFront) / 2, g);
  for (let i = 0; i <= cols; i++) box(t, h, dep, mat, x0 + t / 2 + (x1 - x0 - t) * i / cols, y0 + h / 2, (zBack + zFront) / 2, g);
  box(x1 - x0 - 0.04, 0.006, 0.012, MAT.led, cx0, y0 + h - 0.012, zFront - 0.04, g, false);
  // 上面幾層：櫃身＋上翻門
  box(x1 - x0, y1 - y0 - h, dep - t, mat, cx0, y0 + h + (y1 - y0 - h) / 2, zBack + (dep - t) / 2, g);
  for (let i = 0; i < cols; i++) for (let j = 1; j < rows; j++) {
    const cx = x0 + w * (i + 0.5), cy = y0 + h * (j + 0.5);
    box(w - 0.004, h - 0.004, t, mat, cx, cy, zFront - t / 2, g);
    box(Math.min(0.3, w * 0.6), 0.012, 0.016, MAT.brass, cx, cy - h / 2 + 0.03, zFront + 0.006, g);   // 門底橫拉手
  }
}
function wardrobeBody(g, cx, w, d, ht, skin, dbl) {
  const SK = skin || MAT.cabinet;
  const t = 0.018;
  box(w, ht, t, MAT.inner, cx, ht / 2, -d / 2 + t / 2, g);                       // 背板
  box(t, ht, d, SK, cx - w / 2 + t / 2, ht / 2, 0, g); box(t, ht, d, SK, cx + w / 2 - t / 2, ht / 2, 0, g);
  box(w, t, d, SK, cx, ht - t / 2, 0, g); box(w, 0.08, d - 0.04, MAT.black, cx, 0.04, -0.02, g); box(w - 2 * t, t, d - t, MAT.innerLight, cx, 0.08 + t / 2, 0, g);
  const n = Math.max(1, Math.round(w / 0.45)), sw = w / n;
  for (let i = 0; i < n; i++) {
    const x = cx - w / 2 + sw * (i + 0.5), iw = sw - t;
    if (i > 0) box(t, ht - 0.1, d - t, MAT.inner, cx - w / 2 + sw * i, ht / 2 + 0.04, 0.005, g);
    if (dbl) {                       // 上下雙層掛衫
      box(iw, t, d - t, MAT.innerLight, x, ht - 0.38, 0, g);
      const r1 = cyl(0.012, 0.012, iw - 0.02, MAT.steel, x, ht - 0.46, 0.02, g, 12); r1.rotation.z = Math.PI / 2;
      box(iw, t, d - t, MAT.innerLight, x, 1.3, 0, g);
      const r2 = cyl(0.012, 0.012, iw - 0.02, MAT.steel, x, 1.22, 0.02, g, 12); r2.rotation.z = Math.PI / 2;
      box(iw - 0.04, 0.01, 0.015, MAT.led, x, ht - 0.395, 0.08, g, false); box(iw - 0.04, 0.01, 0.015, MAT.led, x, 1.285, 0.08, g, false);
      // 衫
      const cols = [0xe8e4dc, 0x9aa5b1, 0x34404d, 0xc9b79c, 0x6b7d6a, 0xf3f1ec];
      for (const [ry, len] of [[ht - 0.46, 0.7], [1.22, 0.85]]) for (let k = 0; k < Math.floor((iw - 0.06) / 0.045); k++) box(0.012, len, d - 0.12, new THREE.MeshStandardMaterial({ color: cols[(k + (ry > 1.5 ? 0 : 3)) % cols.length], roughness: 0.9 }), x - iw / 2 + 0.05 + k * 0.045, ry - len / 2 - 0.02, 0.02, g, false);
    } else if (i % 2 === 0 || n === 1) {   // 掛衣格
      box(iw, t, d - t, MAT.innerLight, x, ht - 0.38, 0, g);
      const rail = cyl(0.012, 0.012, iw - 0.02, MAT.steel, x, ht - 0.46, 0.02, g, 12); rail.rotation.z = Math.PI / 2;
      box(iw - 0.04, 0.01, 0.015, MAT.led, x, ht - 0.395, 0.08, g, false);
      if (ht > 2) { box(iw, t, d - t, MAT.innerLight, x, 0.62, 0, g); for (let k = 0; k < 6; k++) { const r2 = cyl(0.006, 0.006, d - 0.12, MAT.steel, x - iw / 2 + 0.04 + k * (iw - 0.08) / 5, 0.66, 0, g, 8); r2.rotation.x = Math.PI / 2; } }
    } else {                         // 層板格
      for (const y of [0.45, 0.85, 1.25, 1.65, ht - 0.38]) box(iw, t, d - t, MAT.innerLight, x, y, 0, g);
    }
    // 門
    const dw = sw - 0.004, hingeLeft = (i % 2 === 0);
    const piv = new THREE.Group(); piv.position.set(hingeLeft ? cx - w / 2 + sw * i + 0.002 : cx - w / 2 + sw * (i + 1) - 0.002, 0, d / 2); g.add(piv);
    const door = box(dw, ht - 0.1, t, SK, (hingeLeft ? 1 : -1) * dw / 2, 0.08 + (ht - 0.1) / 2, t / 2, piv);
    if (skin) box(0.012, 0.35, 0.006, MAT.inner, (hingeLeft ? 1 : -1) * (dw - 0.012), 1.05, t + 0.001, piv, false);   // 隱形坑手
    else box(0.012, 0.45, 0.02, MAT.brass, (hingeLeft ? 1 : -1) * (dw - 0.04), 1.05, t + 0.01, piv);
    DOORS.push({ piv, sign: hingeLeft ? -1 : 1 });
  }
}
function applyCut() {
  for (const c of CUTS) {
    const m = c.mesh; const h = c.y1 - c.y0;
    if (!CUT || c.y1 <= CUT_H + 0.001) { m.visible = true; m.scale.y = 1; m.position.y = (c.y0 + c.y1) / 2; continue; }
    if (c.y0 >= CUT_H) { m.visible = false; continue; }
    const nh = CUT_H - c.y0; m.visible = true; m.scale.y = nh / h; m.position.y = c.y0 + nh / 2;
  }
  const btn = document.getElementById('v3cut'); if (btn) { btn.classList.toggle('on', CUT); btn.textContent = CUT ? '全高牆' : '半高牆'; }
}
function applyDoors() { for (const { piv, sign } of DOORS) piv.rotation.y = DOORS_OPEN ? sign * 1.75 : 0; }

// ---------------------------------------------------------------- furniture (local: x = 闊, z = 深, -z = 背／貼牆)
function makeItem(it) {
  const g = new THREE.Group(); const w = M(it.w), d = M(it.d); const k = it.k;
  switch (k) {
    case 'sofa': {
      box(w, 0.12, d - 0.04, MAT.walnut, 0, 0.06, 0, g);
      rbox(w - 0.04, 0.2, d - 0.06, 0.05, MAT.fabric, 0, 0.24, 0.01, g);
      const arm = 0.14;
      rbox(arm, 0.42, d - 0.04, 0.05, MAT.fabric, -w / 2 + arm / 2, 0.37, 0, g);
      rbox(arm, 0.42, d - 0.04, 0.05, MAT.fabric, w / 2 - arm / 2, 0.37, 0, g);
      rbox(w - 0.04, 0.5, 0.2, 0.06, MAT.fabric, 0, 0.55, -d / 2 + 0.12, g);
      const n = w > 1.8 ? 3 : 2, sw = (w - 2 * arm - 0.04) / n;
      for (let i = 0; i < n; i++) {
        const x = -w / 2 + arm + 0.02 + sw * (i + 0.5);
        rbox(sw - 0.02, 0.14, d - 0.34, 0.06, MAT.fabric, x, 0.41, 0.09, g);
        rbox(sw - 0.06, 0.38, 0.16, 0.08, MAT.fabric, x, 0.66, -d / 2 + 0.28, g);
      }
      rbox(0.42, 0.38, 0.12, 0.08, MAT.fabricDark, -w / 2 + arm + 0.3, 0.7, -d / 2 + 0.38, g).rotation.z = 0.12;
      rbox(0.42, 0.38, 0.12, 0.08, MAT.fabricGrey, w / 2 - arm - 0.3, 0.7, -d / 2 + 0.38, g).rotation.z = -0.12;
      break;
    }
    case 'bed': {
      if (it.boxH) { // 訂造床箱：走廊嗰邊兩個並排櫃桶（深約 40、有封頂板），靠窗嗰邊空心；成塊床板用氣壓撐、鉸喺窗邊揭起
        const bh = it.boxH / 100, mh = (it.mattH || 25) / 100, hb = 0.05, t = 0.018, L = d - hb, zc = hb / 2, z0 = -d / 2 + hb, kick = 0.06, dd = 0.4;
        const SK = MAT.creamW;
        // 箱身（板）
        const xd = w / 2 - dd;                                                                     // 櫃桶間隔板
        box(dd, t, L, MAT.innerLight, w / 2 - dd / 2, kick + t / 2, zc, g);                       // 底板（淨係櫃桶嗰邊）
        box(dd - 0.02, kick, L - 0.04, MAT.black, w / 2 - dd / 2, kick / 2, zc, g, false);       // 地腳
        box(t, bh, L, SK, -w / 2 + t / 2, bh / 2, zc, g);                                         // 靠窗側板（落到地）
        for (const ez of [z0 + t / 2, d / 2 - t / 2]) box(w, bh, t, SK, 0, bh / 2, ez, g);
        box(t, bh, L - 2 * t, MAT.innerLight, xd, bh / 2, zc, g);
        box(xd - (-w / 2 + t) - 0.01, 0.006, L - 2 * t - 0.01, new THREE.MeshStandardMaterial({ color: 0x8d8a85, roughness: 1 }), (xd + (-w / 2 + t)) / 2, 0.003, zc, g, false);   // 空心位唔做底板：地台鋪毛氈
        box(dd, t, L - 2 * t, SK, w / 2 - dd / 2, bh - 0.03, zc, g);                              // 櫃桶封頂板
        box(t, bh - kick, L, SK, w / 2 - t / 2, kick + (bh - kick) / 2, zc, g, false).visible = false;
        // 櫃桶 ×2
        const drawers = []; const dl = (L - 2 * t) / 2;
        for (let i = 0; i < 2; i++) {
          const dz = z0 + t + dl * (i + 0.5), dr = new THREE.Group(); dr.userData.x0 = 0; dr.position.set(0, 0, 0); g.add(dr);
          const fh = bh - kick - 0.04, fy = kick + 0.01 + fh / 2;
          box(0.02, fh, dl - 0.006, SK, w / 2 - 0.01, fy, dz, dr);                                // 櫃桶面
          box(0.008, 0.02, Math.min(0.3, dl * 0.5), MAT.inner, w / 2 + 0.001, kick + fh - 0.03, dz, dr, false);   // 坑手
          const ih = fh - 0.06, ix = w / 2 - dd / 2 - 0.01;
          box(dd - 0.04, 0.012, dl - 0.04, MAT.lightOak, ix, kick + 0.03, dz, dr);
          for (const sz of [-1, 1]) box(dd - 0.04, ih, 0.012, MAT.lightOak, ix, kick + 0.03 + ih / 2, dz + sz * (dl / 2 - 0.03), dr);
          box(0.012, ih, dl - 0.04, MAT.lightOak, w / 2 - dd + 0.02, kick + 0.03 + ih / 2, dz, dr);
          const cols = [0xe8e4dc, 0x9aa5b1, 0x34404d, 0xc9b79c, 0x6b7d6a];
          for (let k = 0; k < 4; k++) box(0.28, 0.07 + (k % 2) * 0.03, 0.16, new THREE.MeshStandardMaterial({ color: cols[(k + i) % cols.length], roughness: 0.9 }), ix, kick + 0.08 + (k % 2) * 0.015, dz - dl / 2 + 0.12 + k * (dl - 0.2) / 3.2, dr, false);
          drawers.push(dr);
        }
        // 空心位入面：喼、收納箱、被
        const hx = (-w / 2 + t + xd) / 2, hwid = xd - (-w / 2 + t);
        const alu = new THREE.MeshStandardMaterial({ color: 0xc9ccd0, roughness: 0.3, metalness: 0.85 });
        const hx0w = -w / 2 + t + 0.02;
        rbox(0.37, 0.435, 0.805, 0.03, alu, 0, 0, 0, g).visible = false;
        { const tp = rbox(0.435, 0.37, 0.805, 0.03, alu, hx0w + 0.435 / 2, 0.007 + 0.185, z0 + t + 0.03 + 0.805 / 2, g);        // Rimowa Trunk Plus（瞓低）
          for (let k = 0; k < 9; k++) box(0.435, 0.004, 0.008, alu, hx0w + 0.435 / 2, 0.007 + 0.37 + 0.001, z0 + t + 0.08 + k * 0.09, g, false); }
        { const zc2 = z0 + t + 0.03 + 0.805 + 0.05 + 0.79 / 2; rbox(0.515, 0.275, 0.79, 0.03, alu, hx0w + 0.515 / 2, 0.007 + 0.1375, zc2, g);   // Rimowa Check-In L（瞓低）
          for (let k = 0; k < 9; k++) box(0.515, 0.004, 0.008, alu, hx0w + 0.515 / 2, 0.007 + 0.276, zc2 - 0.36 + k * 0.09, g, false); }
        rbox(Math.max(0.2, xd - (-w / 2 + t) - 0.55), 0.14, 0.5, 0.06, MAT.duvet, xd - 0.15, 0.08, z0 + t + 0.3, g);          // 被鋪
        // 揭起部分：床板＋床褥＋被＋枕頭，鉸喺窗邊
        const lift = new THREE.Group(); lift.position.set(-w / 2 + 0.01, bh, 0); g.add(lift);
        const lx = (x) => x - (-w / 2 + 0.01);
        box(w - 0.02, t, L - 0.02, SK, lx(0), -t / 2, zc, lift);
        for (let k = 0; k < 4; k++) box(0.03, 0.004, 0.25, MAT.inner, lx(-0.3 + k * 0.2), -t - 0.001, zc, lift, false);   // 透氣孔
        rbox(w - 0.03, mh, L - 0.02, 0.05, MAT.linen, lx(0), mh / 2, zc, lift);
        rbox(w, 0.06, L * 0.6, 0.03, MAT.duvet, lx(0), mh + 0.02, d * 0.18, lift);
        const n = w > 1.1 ? 2 : 1, pw = Math.min(0.6, (w - 0.16) / n);
        for (let i = 0; i < n; i++) rbox(pw, 0.13, 0.36, 0.06, MAT.linen, lx(-((n - 1) * (pw + 0.06)) / 2 + i * (pw + 0.06)), mh + 0.06, z0 + 0.25, lift);
        // 氣壓撐
        const struts = [];
        for (const sz of [z0 + 0.35, d / 2 - 0.35]) { const st = cyl(0.012, 0.012, 0.42, MAT.steel, xd - 0.05, bh - 0.05, sz, g, 10); st.rotation.z = -0.9; st.visible = false; struts.push(st); }
        rbox(w, 1.05, hb, 0.02, MAT.fabricGrey, 0, 0.525, -d / 2 + hb / 2, g);                       // 軟包床頭板
        BEDS.push({ lift, drawers, struts });
        break;
      }
      box(w, 0.28, d, MAT.walnut, 0, 0.14, 0, g);
      rbox(w - 0.04, 0.22, d - 0.06, 0.04, MAT.linen, 0, 0.39, 0.02, g);
      rbox(w - 0.0, 0.07, d * 0.62, 0.03, MAT.duvet, 0, 0.53, d * 0.18, g);
      rbox(w + 0.02, 0.09, 0.32, 0.03, MAT.duvet, 0, 0.55, -d * 0.12, g);
      const n = w > 1.1 ? 2 : 1, pw = Math.min(0.6, (w - 0.16) / n);
      for (let i = 0; i < n; i++) rbox(pw, 0.13, 0.36, 0.06, MAT.linen, -((n - 1) * (pw + 0.06)) / 2 + i * (pw + 0.06), 0.57, -d / 2 + 0.3, g);
      rbox(w, 1.05, 0.08, 0.04, MAT.fabricGrey, 0, 0.53, -d / 2 + 0.04, g); // 床頭板喺床嘅範圍之內
      break;
    }
    case 'ward': wardrobeBody(g, 0, w, d, H - 0.01); break;
    case 'ward2': {
      const ht = H - 0.01, ow = Math.min(w - 0.4, M(it.openW || 0)), t = 0.018;
      if (ow > 0.05) { // 打通嘅開放格：喺書枱嗰邊拎嘢
        const bx = -w / 2 + ow / 2;
        box(ow, ht, t, MAT.lightOak, bx, ht / 2, -d / 2 + t / 2, g);
        box(t, ht, d, MAT.cabinet, -w / 2 + t / 2, ht / 2, 0, g); box(ow, t, d, MAT.cabinet, bx, ht - t / 2, 0, g); box(ow, 0.08, d - 0.04, MAT.black, bx, 0.04, -0.02, g);
        for (const y of [0.08, 0.78, 1.12, 1.46, 1.8, 2.14]) { box(ow - t, t, d - t, MAT.lightOak, bx + t / 2, y + t / 2, 0, g); if (y > 0.5) box(ow - 0.06, 0.006, 0.012, MAT.led, bx, y + ht * 0 + 0.33, d / 2 - 0.05, g, false); }
        const ol = new THREE.PointLight(0xffd9a8, 0.4, 1.3, 2); ol.position.set(bx, 1.5, d / 2 - 0.05); g.add(ol);
        const cl = [0x7a2e26, 0x2c4a6b, 0xd9c7a4, 0x3d6b4f, 0xc8582f, 0x5a4a3c];
        for (const [y, n0] of [[1.12, 0], [1.8, 3]]) for (let k = 0; k < 7; k++) box(0.03, 0.22, 0.2, new THREE.MeshStandardMaterial({ color: cl[(k + n0) % cl.length], roughness: 0.7 }), -w / 2 + t + 0.04 + k * 0.034, y + 0.13, 0, g);
        cyl(0.05, 0.06, 0.14, new THREE.MeshStandardMaterial({ color: 0xc8582f, roughness: 0.5 }), bx, 1.55, 0, g);
        box(0.18, 0.12, 0.14, MAT.white, bx, 0.86, 0, g);
      }
      wardrobeBody(g, -w / 2 + ow + (w - ow) / 2, w - ow, d, ht, null, true); break;
    }
    case 'wardarch': { // 衣櫃（奶油白平板門＋坑手）＋近門口嗰邊弧形開放展示位
      const ht = H - 0.01, nw = Math.min(0.3, w * 0.25), ww = w - nw, t = 0.018;
      wardrobeBody(g, -w / 2 + ww / 2, ww, d, ht, MAT.creamW);
      const nx = w / 2 - nw / 2, nd = 0.32, y0 = 0.55, y1 = 2.05, r = (nw - 0.08) / 2;
      box(t, ht, d, MAT.creamW, w / 2 - t / 2, ht / 2, 0, g);
      box(nw, ht, d - nd, MAT.creamW, nx, ht / 2, -nd / 2, g);                       // 後面實心
      // 前面板開膠囊形孔
      const sh = new THREE.Shape(); sh.moveTo(-nw / 2, 0); sh.lineTo(nw / 2, 0); sh.lineTo(nw / 2, ht); sh.lineTo(-nw / 2, ht); sh.lineTo(-nw / 2, 0);
      const hole = new THREE.Path(); hole.moveTo(-r, y0 + r); hole.absarc(0, y0 + r, r, Math.PI, 0, false); hole.lineTo(r, y1 - r); hole.absarc(0, y1 - r, r, 0, Math.PI, false); hole.lineTo(-r, y0 + r);
      sh.holes.push(hole);
      const fg = new THREE.ExtrudeGeometry(sh, { depth: t, bevelEnabled: false, curveSegments: 24 }); const fm = new THREE.Mesh(fg, MAT.creamW); fm.position.set(nx, 0, d / 2 - t); fm.castShadow = true; g.add(fm);
      // 內膽：原木色、層板、燈
      const iz = d / 2 - nd / 2 - t;
      box(nw - 0.04, y1 - y0, 0.012, MAT.lightOak, nx, (y0 + y1) / 2, d / 2 - nd - t + 0.006, g);
      for (const sx of [-1, 1]) box(0.012, y1 - y0, nd, MAT.lightOak, nx + sx * (nw / 2 - 0.026), (y0 + y1) / 2, iz, g);
      box(nw - 0.04, 0.012, nd, MAT.lightOak, nx, y0 + 0.006, iz, g); box(nw - 0.04, 0.012, nd, MAT.lightOak, nx, y1 - 0.006, iz, g);
      for (const y of [0.95, 1.4]) { box(nw - 0.05, 0.018, nd, MAT.lightOak, nx, y, iz, g); box(nw - 0.08, 0.006, 0.01, MAT.led, nx, y - 0.012, d / 2 - t - 0.04, g, false); }
      box(nw - 0.08, 0.006, 0.01, MAT.led, nx, y1 - 0.02, d / 2 - t - 0.04, g, false);
      const nl = new THREE.PointLight(0xffd9a8, 0.45, 1.2, 2); nl.position.set(nx, 1.6, d / 2 - 0.1); g.add(nl);
      // 擺設
      cyl(0.04, 0.05, 0.16, new THREE.MeshStandardMaterial({ color: 0xc8582f, roughness: 0.5 }), nx, 1.04, iz, g);
      box(0.08, 0.2, 0.15, new THREE.MeshStandardMaterial({ color: 0x8c2f24, roughness: 0.6 }), nx, 1.51, iz, g);
      box(0.05, 0.22, 0.16, MAT.walnut, nx - 0.04, 0.67, iz, g); box(0.04, 0.2, 0.16, new THREE.MeshStandardMaterial({ color: 0xd9a441 }), nx + 0.02, 0.66, iz, g);
      break;
    }
    case 'deskwall': { // 書枱牆身櫃：原木枱面、洞洞板、燈帶層板、玻璃門書櫃、頂櫃到天花＋椅
      const t = 0.018, ht = H - 0.01, top = 0.75, pb1 = 1.42, gl0 = 1.62, gl1 = 2.22;
      if (!it.noSides) for (const sx of [-1, 1]) box(t, ht, d, MAT.creamW, sx * (w / 2 - t / 2), ht / 2, 0, g);
      box(w - 2 * t, 0.012, 0.012, MAT.creamW, 0, 0.006, d / 2 - 0.006, g, false);
      // 枱面（前角圓）＋ 櫃桶
      rbox(w - 2 * t, 0.03, d, 0.03, MAT.lightOak, 0, top, 0, g);
      box(w - 2 * t - 0.02, 0.12, d - 0.06, MAT.creamW, 0, top - 0.08, -0.02, g);
      box(0.08, 0.008, 0.006, MAT.inner, 0, top - 0.08, d / 2 - 0.05 + 0.004, g, false);
      // 洞洞板
      box(w - 2 * t, pb1 - top, 0.015, MAT.peg, 0, (top + pb1) / 2, -d / 2 + 0.008, g);
      // 燈帶層板（兩層）
      for (const [y, dep] of [[pb1, 0.24], [1.6, 0.24]]) { box(w - 2 * t, 0.022, dep, MAT.lightOak, 0, y, -d / 2 + dep / 2, g); box(w - 2 * t - 0.03, 0.006, 0.012, MAT.led, 0, y - 0.014, -d / 2 + dep - 0.03, g, false); }
      box(w - 2 * t, 1.6 - pb1, 0.015, MAT.lightOak, 0, (pb1 + 1.6) / 2, -d / 2 + 0.008, g);
      const bd = 0.32;
      if (it.plainTop) { // 玻璃書櫃移咗去轉角，呢度做到頂木門櫃
        box(w - 2 * t, ht - gl0, bd, MAT.creamW, 0, (gl0 + ht) / 2, -d / 2 + bd / 2, g);
        box(0.004, ht - gl0 - 0.02, 0.004, MAT.inner, 0, (gl0 + ht) / 2, -d / 2 + bd + 0.002, g, false);
        for (const sx of [-1, 1]) box(0.012, 0.3, 0.015, MAT.brass, sx * 0.04, gl0 + 0.2, -d / 2 + bd + 0.008, g);
        box(w - 2 * t - 0.03, 0.006, 0.012, MAT.led, 0, gl0 - 0.008, -d / 2 + bd - 0.04, g, false);
        const ll2 = new THREE.PointLight(0xffd9a8, 0.45, 1.3, 2); ll2.position.set(0, 1.3, -d / 2 + 0.3); g.add(ll2);
        box(0.3, 0.012, 0.21, MAT.steel, 0.02, top + 0.021, 0.0, g); const lid2 = box(0.3, 0.2, 0.008, MAT.black, 0.02, top + 0.12, -0.105, g); lid2.rotation.x = -0.25;
        const ch2 = new THREE.Group(); ch2.position.set(0.12, 0, d / 2 + 0.22); ch2.rotation.y = -0.6; g.add(ch2);
        cyl(0.22, 0.22, 0.06, MAT.white, 0, 0.47, 0, ch2, 28);
        for (const [ax, az] of [[-0.15, -0.15], [0.15, -0.15], [-0.15, 0.15], [0.15, 0.15]]) cyl(0.015, 0.015, 0.45, MAT.white, ax, 0.22, az, ch2, 10);
        rbox(0.4, 0.38, 0.05, 0.06, MAT.white, 0, 0.72, 0.18, ch2);
        break;
      }
      if (it.drawTop) { flipStack(g, -w / 2 + t, w / 2 - t, gl0, gl1, -d / 2, -d / 2 + bd, 2, 1, MAT.creamW);
        for (let k = 0; k < 9; k++) box(0.03, 0.2, 0.2, new THREE.MeshStandardMaterial({ color: [0x7a2e26, 0x2c4a6b, 0xd9c7a4, 0x3d6b4f, 0xc8582f][k % 5], roughness: 0.7 }), -w / 2 + t + 0.04 + k * 0.034, gl0 + 0.12, -d / 2 + 0.13, g); }
      else {
      // 玻璃門書櫃（黑框）
      box(w - 2 * t, gl1 - gl0, 0.015, MAT.lightOak, 0, (gl0 + gl1) / 2, -d / 2 + 0.008, g);
      box(w - 2 * t, 0.018, bd, MAT.creamW, 0, gl0 + 0.009, -d / 2 + bd / 2, g); box(w - 2 * t, 0.018, bd, MAT.creamW, 0, gl1 - 0.009, -d / 2 + bd / 2, g);
      const bookC = [0x7a2e26, 0x2c4a6b, 0xd9c7a4, 0x3d6b4f, 0xc8582f, 0xe9e3d6, 0x5a4a3c, 0xb88a3e];
      for (const sy of [gl0 + 0.018, 1.92]) { if (sy > gl0 + 0.1) box(w - 2 * t, 0.018, bd - 0.02, MAT.lightOak, 0, sy, -d / 2 + bd / 2, g); let x = -w / 2 + t + 0.03, i = 0;
        while (x < w / 2 - t - 0.05) { const bw = 0.022 + (i * 7 % 5) * 0.006, bh = 0.18 + (i * 3 % 4) * 0.025; box(bw, bh, 0.2, new THREE.MeshStandardMaterial({ color: bookC[i % bookC.length], roughness: 0.7 }), x + bw / 2, sy + 0.01 + bh / 2, -d / 2 + 0.13, g); x += bw + 0.003; i++; } }
      box(w - 2 * t - 0.03, 0.006, 0.012, MAT.led, 0, gl1 - 0.025, -d / 2 + bd - 0.04, g, false);
      const bl = new THREE.PointLight(0xffd9a8, 0.5, 1.4, 2); bl.position.set(0, 1.95, -d / 2 + 0.35); g.add(bl);
      const gw = (w - 2 * t) / (w > 0.7 ? 2 : 1), gn = w > 0.7 ? 2 : 1;
      for (let i = 0; i < gn; i++) { const cx = -w / 2 + t + gw * (i + 0.5), gz = -d / 2 + bd + 0.005, gh = gl1 - gl0 - 0.04, gy = (gl0 + gl1) / 2;
        box(gw - 0.006, gh, 0.008, MAT.tintGlass, cx, gy, gz, g, false);
        for (const sx of [-1, 1]) box(0.014, gh, 0.016, MAT.black, cx + sx * (gw / 2 - 0.01), gy, gz, g, false);
        for (const sy of [-1, 1]) box(gw - 0.006, 0.014, 0.016, MAT.black, cx, gy + sy * (gh / 2 - 0.007), gz, g, false); }
      }
      // 頂櫃到天花
      box(w - 2 * t, ht - gl1, bd, MAT.creamW, 0, (gl1 + ht) / 2, -d / 2 + bd / 2, g);
      box(0.004, ht - gl1 - 0.02, 0.004, MAT.inner, 0, (gl1 + ht) / 2, -d / 2 + bd + 0.002, g, false);
      const ll = new THREE.PointLight(0xffd9a8, 0.45, 1.3, 2); ll.position.set(0, 1.3, -d / 2 + 0.3); g.add(ll);
      // 枱面擺設：手提電腦、枱燈
      box(0.3, 0.012, 0.21, MAT.steel, 0.02, top + 0.021, 0.0, g); const lid = box(0.3, 0.2, 0.008, MAT.black, 0.02, top + 0.12, -0.105, g); lid.rotation.x = -0.25;
      // 白色圓背椅
      const ch = new THREE.Group(); ch.position.set(0, 0, d / 2 + 0.22); g.add(ch);
      cyl(0.22, 0.22, 0.06, MAT.white, 0, 0.47, 0, ch, 28);
      for (const [ax, az] of [[-0.15, -0.15], [0.15, -0.15], [-0.15, 0.15], [0.15, 0.15]]) cyl(0.015, 0.015, 0.45, MAT.white, ax, 0.22, az, ch, 10);
      const bk = rbox(0.4, 0.38, 0.05, 0.06, MAT.white, 0, 0.72, 0.18, ch); 
      break;
    }
    case 'deskcorner': { // L 形書枱轉角段：櫃桶櫃、洞洞板、燈帶層板、玻璃門書櫃、頂櫃
      const t = 0.018, ht = H - 0.01, top = 0.75, pb1 = 1.42, gl0 = 1.62, gl1 = 2.22, bd = 0.32;
      box(w, 0.66, d - 0.02, MAT.creamW, 0, 0.08 + 0.33, -0.01, g); box(w, 0.08, d - 0.06, MAT.black, 0, 0.04, -0.03, g);
      drawerStack(g, -w / 2, w / 2, 0.08, 0.735, d / 2, 3, 1, MAT.creamW);
      // 枱面：近門口嗰角做圓角
      const sh = new THREE.Shape(), r = 0.12, hw = w / 2, hd = d / 2;
      sh.moveTo(-hw, -hd); sh.lineTo(hw, -hd); sh.lineTo(hw, hd - r); sh.absarc(hw - r, hd - r, r, 0, Math.PI / 2, false); sh.lineTo(-hw, hd); sh.lineTo(-hw, -hd);
      const tg = new THREE.ExtrudeGeometry(sh, { depth: 0.03, bevelEnabled: false, curveSegments: 16 }); tg.rotateX(Math.PI / 2); tg.scale(1, 1, -1);
      const tm = new THREE.Mesh(tg, MAT.lightOak); tm.position.set(0, top + 0.015, 0); tm.castShadow = tm.receiveShadow = true; g.add(tm);
      box(w, pb1 - top, 0.015, MAT.peg, 0, (top + pb1) / 2, -d / 2 + 0.008, g);
      for (const [y, dep] of [[pb1, 0.24], [1.6, 0.24]]) { box(w, 0.022, dep, MAT.lightOak, 0, y, -d / 2 + dep / 2, g); box(w - 0.03, 0.006, 0.012, MAT.led, 0, y - 0.014, -d / 2 + dep - 0.03, g, false); }
      box(w, 1.6 - pb1, 0.015, MAT.lightOak, 0, (pb1 + 1.6) / 2, -d / 2 + 0.008, g);
      box(w, gl1 - gl0, 0.015, MAT.lightOak, 0, (gl0 + gl1) / 2, -d / 2 + 0.008, g);
      box(w, 0.018, bd, MAT.creamW, 0, gl0 + 0.009, -d / 2 + bd / 2, g); box(w, 0.018, bd, MAT.creamW, 0, gl1 - 0.009, -d / 2 + bd / 2, g);
      const bookC = [0x7a2e26, 0x2c4a6b, 0xd9c7a4, 0x3d6b4f, 0xc8582f, 0xe9e3d6, 0x5a4a3c, 0xb88a3e];
      for (const sy of [gl0 + 0.018, 1.92]) { if (sy > gl0 + 0.1) box(w, 0.018, bd - 0.02, MAT.lightOak, 0, sy, -d / 2 + bd / 2, g); let x = -w / 2 + 0.03, i = 0;
        while (x < w / 2 - 0.05) { const bw = 0.022 + (i * 7 % 5) * 0.006, bh = 0.18 + (i * 3 % 4) * 0.025; box(bw, bh, 0.2, new THREE.MeshStandardMaterial({ color: bookC[i % bookC.length], roughness: 0.7 }), x + bw / 2, sy + 0.01 + bh / 2, -d / 2 + 0.13, g); x += bw + 0.003; i++; } }
      box(w - 0.03, 0.006, 0.012, MAT.led, 0, gl1 - 0.025, -d / 2 + bd - 0.04, g, false);
      const gz = -d / 2 + bd + 0.005, gh = gl1 - gl0 - 0.04, gy = (gl0 + gl1) / 2;
      box(w - 0.006, gh, 0.008, MAT.tintGlass, 0, gy, gz, g, false);
      for (const sx of [-1, 1]) box(0.014, gh, 0.016, MAT.black, sx * (w / 2 - 0.01), gy, gz, g, false);
      for (const sy of [-1, 1]) box(w - 0.006, 0.014, 0.016, MAT.black, 0, gy + sy * (gh / 2 - 0.007), gz, g, false);
      box(w, ht - gl1, bd, MAT.creamW, 0, (gl1 + ht) / 2, -d / 2 + bd / 2, g);
      box(0.012, 0.22, 0.015, MAT.brass, w / 2 - 0.05, gl1 + 0.15, -d / 2 + bd + 0.008, g);
      const bl = new THREE.PointLight(0xffd9a8, 0.5, 1.4, 2); bl.position.set(0, 1.95, -d / 2 + 0.4); g.add(bl);
      const ll = new THREE.PointLight(0xffd9a8, 0.45, 1.3, 2); ll.position.set(0, 1.2, -d / 2 + 0.3); g.add(ll);
      // 枱面擺設：枱燈、文件
      cyl(0.06, 0.07, 0.02, MAT.white, -0.12, top + 0.04, -0.1, g); cyl(0.008, 0.008, 0.32, MAT.white, -0.12, top + 0.2, -0.1, g); cyl(0.07, 0.05, 0.08, MAT.white, -0.12, top + 0.38, -0.06, g);
      box(0.22, 0.01, 0.3, MAT.white, 0.08, top + 0.035, 0.02, g);
      break;
    }
    case 'tallcab': { // 吊櫃：頂到天花、唔落地（底離地 it.lift cm，預設 130）
      const top = H - 0.01, y0 = (it.lift || 175) / 100, ht = top - y0, n = Math.max(1, Math.round(w / 0.45));
      box(w, ht, d, MAT.creamW, 0, y0 + ht / 2, 0, g);
      for (let i = 1; i < n; i++) box(0.004, ht - 0.02, 0.004, MAT.inner, -w / 2 + (w * i) / n, y0 + ht / 2, d / 2 + 0.002, g, false);
      for (let i = 0; i < n; i++) box(0.012, 0.22, 0.015, MAT.brass, -w / 2 + (w * (i + 0.5)) / n + (i % 2 ? -1 : 1) * (w / n / 2 - 0.04), y0 + 0.16, d / 2 + 0.008, g);
      box(w - 0.04, 0.008, 0.015, MAT.led, 0, y0 - 0.005, d / 2 - 0.05, g, false);
      const ll = new THREE.PointLight(0xffe8c8, 0.35, 1.6, 2); ll.position.set(0, y0 - 0.15, d / 2); g.add(ll);
      // 床頭位：吊櫃下面做開放格仔，由地腳到櫃底
      // 下面一截（床頭板後面）做實心底櫃，格仔由床頭板頂開始，唔會撞床頭
      const base = (it.cubbyFrom || 110) / 100, t = 0.018, kick = base, cols = Math.max(1, Math.round(w / 0.4)), rows = it.rows || Math.max(1, Math.round((y0 - base) / 0.32));
      box(w, base, d, MAT.creamW, 0, base / 2, 0, g);
      if (it.drawers) { flipStack(g, -w / 2, w / 2, base, y0, -d / 2, d / 2, rows, Math.max(1, Math.round(w / 0.6)), MAT.creamW); break; }
      box(w, y0 - kick, t, MAT.lightOak, 0, kick + (y0 - kick) / 2, -d / 2 + t / 2, g);                    // 背板
      for (let i = 0; i <= cols; i++) box(t, y0 - kick, d - t, MAT.creamW, -w / 2 + t / 2 + (w - t) * i / cols, kick + (y0 - kick) / 2, t / 2, g);
      for (let j = 0; j < rows; j++) box(w, t, d - t, MAT.lightOak, 0, kick + t / 2 + (y0 - kick) * j / rows, t / 2, g);
      break;
    }
    case 'shoe': {
      const ht = H - 0.02;
      box(w, ht, d, MAT.cabinet, 0, ht / 2, 0, g);
      const n = Math.max(1, Math.round(w / 0.5));
      for (let i = 1; i < n; i++) box(0.004, ht - 0.12, 0.004, MAT.walnut, -w / 2 + (w * i) / n, ht / 2, d / 2 + 0.002, g, false);
      for (let i = 0; i < n; i++) box(0.012, 0.5, 0.02, MAT.brass, -w / 2 + (w * (i + 0.5)) / n + (i % 2 ? -1 : 1) * (w / n / 2 - 0.05), 1.05, d / 2 + 0.012, g);
      box(w, 0.06, d - 0.04, MAT.black, 0, 0.03, -0.02, g);
      break;
    }
    case 'shoecab': { // 入門鞋櫃：底部吊空鞋位燈、櫃桶、開放枱面位、上櫃到頂、圓角
      const ht = H - 0.02, top0 = 1.32, nicheB = 0.88;
      box(w, 0.04, d, MAT.cream, 0, 0.17, 0, g);                          // 鞋位頂板
      box(w - 0.02, 0.01, 0.02, MAT.led, 0, 0.145, d / 2 - 0.03, g, false);
      box(0.02, 0.17, d, MAT.cream, -w / 2 + 0.01, 0.085, 0, g); box(0.02, 0.17, d, MAT.cream, w / 2 - 0.01, 0.085, 0, g);
      // drawers
      const dh = (nicheB - 0.19) / 3;
      for (let i = 0; i < 3; i++) {
        const y = 0.19 + dh * (i + 0.5);
        box(w - 0.01, dh - 0.008, d, MAT.cream, 0, y, 0, g);
        if (i === 2) for (let k2 = 0; k2 < Math.floor(w / 0.025); k2++) box(0.004, dh - 0.03, 0.004, MAT.creamDark, -w / 2 + 0.0125 + k2 * 0.025, y, d / 2 + 0.002, g, false);
      }
      box(w + 0.01, 0.03, d + 0.02, MAT.quartz, 0, nicheB + 0.015, 0.01, g);  // 枱面
      box(w - 0.02, top0 - nicheB - 0.03, 0.015, MAT.quartz, 0, (nicheB + top0) / 2 + 0.01, -d / 2 + 0.008, g); // 石背板
      box(0.02, top0 - nicheB, d, MAT.cream, -w / 2 + 0.01, (nicheB + top0) / 2, 0, g);
      box(w - 0.04, 0.01, 0.02, MAT.led, 0, top0 - 0.012, d / 2 - 0.05, g, false);
      const up = ht - top0; box(w, up, d, MAT.cream, 0, top0 + up / 2, 0, g);
      box(0.004, up - 0.04, 0.004, MAT.creamDark, 0, top0 + up / 2, d / 2 + 0.002, g, false);
      // 圓角
      // 圓角只做喺櫃桶同上櫃，開放枱面位唔要柱
      for (const [y0, y1] of [[0.17, nicheB], [top0, ht]]) cyl(0.06, 0.06, y1 - y0, MAT.cream, w / 2 - 0.06, (y0 + y1) / 2, d / 2 - 0.06, g);
      const nl = new THREE.PointLight(0xfff0d0, 0.35, 1.2, 2); nl.position.set(0, top0 - 0.05, 0.05); g.add(nl);
      break;
    }
    case 'warddesk': { // 衣櫃書枱組合：白色平板門衣櫃 + 胡桃木書枱 + 上櫃／開放層架 + 門頂櫃
      const ht = H - 0.01, dw = M(it.deskW || 60), ww = w - dw, x0 = -w / 2, dd = Math.min(d, 0.5);
      wardrobeBody(g, x0 + dw + ww / 2, ww, d, ht, MAT.matte);
      box(ww, 0.12, 0.004, MAT.inner, x0 + dw + ww / 2, 0.26, d / 2 + 0.019, g, false);       // 底櫃桶坑
      // 書枱
      const dz = -d / 2 + dd / 2;
      box(dw, 0.035, dd, MAT.walnutDark, x0 + dw / 2, 0.745, dz, g);
      box(dw - 0.06, 0.1, dd - 0.06, MAT.matte, x0 + dw / 2 + 0.02, 0.675, dz - 0.02, g);     // 懸空櫃桶
      box(0.018, 0.73, dd, MAT.walnutDark, x0 + 0.009, 0.365, dz, g);
      // 書枱上：開放層 + 燈帶 + 上櫃
      box(dw, 0.018, 0.32, MAT.walnutDark, x0 + dw / 2, 1.45, -d / 2 + 0.16, g);
      box(dw - 0.04, 0.01, 0.015, MAT.led, x0 + dw / 2, 1.437, -d / 2 + 0.28, g, false);
      const upW = dw * 0.6, opW = dw - upW;
      box(upW, ht - 1.46, 0.35, MAT.matte, x0 + upW / 2, 1.46 + (ht - 1.46) / 2, -d / 2 + 0.175, g);
      box(0.004, ht - 1.5, 0.004, MAT.inner, x0 + upW / 2, 1.46 + (ht - 1.46) / 2, -d / 2 + 0.352, g, false);
      // 胡桃木開放格
      const ox = x0 + upW + opW / 2;
      box(opW, 0.018, 0.33, MAT.walnutDark, ox, ht - 0.009, -d / 2 + 0.165, g);
      box(0.018, ht - 1.46, 0.33, MAT.walnutDark, x0 + dw - 0.009, 1.46 + (ht - 1.46) / 2, -d / 2 + 0.165, g);
      box(opW, ht - 1.46, 0.012, MAT.walnutDark, ox, 1.46 + (ht - 1.46) / 2, -d / 2 + 0.006, g);
      for (const yy of [1.75, 2.05]) { box(opW - 0.02, 0.018, 0.31, MAT.walnutDark, ox, yy, -d / 2 + 0.165, g); box(opW - 0.05, 0.008, 0.012, MAT.led, ox, yy - 0.014, -d / 2 + 0.27, g, false); }
      box(0.004, 0.5, 0.014, MAT.led, x0 + dw - 0.025, 1.6, -d / 2 + 0.3, g, false);
      const dl = new THREE.PointLight(0xffe7c2, 0.45, 1.4, 2); dl.position.set(x0 + dw / 2, 1.3, -d / 2 + 0.3); g.add(dl);
      // 門頂櫃
      const bw = M(it.bridgeW || 0);
      if (bw > 0.05) { box(bw, ht - 2.1, Math.min(d, 0.4), MAT.matte, x0 + w + bw / 2, 2.1 + (ht - 2.1) / 2, -d / 2 + Math.min(d, 0.4) / 2, g);
        box(0.004, ht - 2.14, 0.004, MAT.inner, x0 + w + bw / 2, 2.1 + (ht - 2.1) / 2, -d / 2 + Math.min(d, 0.4) + 0.002, g, false); }
      break;
    }
    case 'wardvan': { // 衣櫃梳妝台一體
      const ht = H - 0.01, vw = Math.max(0.5, Math.min(1.0, w * 0.42)), ww = w - vw, x0 = -w / 2;
      // 衣櫃部分
      wardrobeBody(g, x0 + vw + ww / 2, ww, d, ht);
      // 梳妝位：下櫃、灰色弧形枱面、開放層架、上櫃、LED 圓鏡
      box(vw, 0.72, d - 0.1, MAT.cabinet, x0 + vw / 2, 0.36, -0.05, g);
      rbox(vw + 0.05, 0.04, d, 0.12, MAT.grey, x0 + vw / 2 - 0.025, 0.76, 0, g);
      box(vw * 0.55, 0.02, d - 0.1, MAT.grey, x0 + vw * 0.725, 1.12, -0.05, g); box(vw, 0.02, d - 0.1, MAT.grey, x0 + vw / 2, 1.36, -0.05, g);
      box(vw, 0.78, 0.02, MAT.grey, x0 + vw / 2, 1.17, -d / 2 + 0.01, g);
      box(vw, ht - 1.56, d, MAT.cabinet, x0 + vw / 2, 1.56 + (ht - 1.56) / 2, 0, g);
      box(vw - 0.04, 0.01, 0.02, MAT.led, x0 + vw / 2, 1.545, d / 2 - 0.04, g, false);
      const vanL = M(it.vanL || 0), vanD = M(it.vanD || 40);
      if (vanL > 0.05) { // 轉角 L 形梳妝枱：沿左牆伸出
        rbox(vanD, 0.04, vanL + 0.1, 0.12, MAT.grey, x0 + vanD / 2, 0.76, d / 2 + vanL / 2 - 0.05, g);
        box(vanD - 0.04, 0.1, vanL - 0.06, MAT.grey, x0 + vanD / 2, 0.68, d / 2 + vanL / 2, g);          // 懸空小櫃桶
        box(0.02, 0.5, vanL + 0.1, MAT.grey, x0 + 0.01, 1.03, d / 2 + vanL / 2 - 0.05, g);             // 側背板
        box(0.012, 0.01, vanL, MAT.led, x0 + 0.03, 1.27, d / 2 + vanL / 2, g, false);
        const ringL = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.011, 12, 48), MAT.led); ringL.scale.set(0.8, 1, 1);
        ringL.rotation.y = Math.PI / 2; ringL.position.set(x0 + 0.08, 1.03, d / 2 + vanL / 2); g.add(ringL);
        const mirL = new THREE.Mesh(new THREE.CircleGeometry(0.16, 48), MAT.mirror); mirL.scale.set(0.8, 1, 1);
        mirL.rotation.y = Math.PI / 2; mirL.position.set(x0 + 0.079, 1.03, d / 2 + vanL / 2); g.add(mirL);
        cyl(0.01, 0.01, 0.1, MAT.brass, x0 + 0.08, 0.83, d / 2 + vanL / 2, g); cyl(0.06, 0.06, 0.01, MAT.brass, x0 + 0.08, 0.785, d / 2 + vanL / 2, g);
        const vl2 = new THREE.PointLight(0xffe7c2, 0.5, 1.5, 2); vl2.position.set(x0 + 0.3, 1.1, d / 2 + vanL / 2); g.add(vl2);
      }
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.011, 12, 48), MAT.led);
      ring.scale.set(0.8, 1, 1); ring.position.set(x0 + 0.2, 1.02, -d / 2 + 0.14); if (!(vanL > 0.05)) g.add(ring);
      const mir = new THREE.Mesh(new THREE.CircleGeometry(0.16, 48), MAT.mirror); mir.scale.set(0.8, 1, 1); mir.position.set(x0 + 0.2, 1.02, -d / 2 + 0.139); if (!(vanL > 0.05)) g.add(mir);
      if (!(vanL > 0.05)) { cyl(0.01, 0.01, 0.1, MAT.brass, x0 + 0.2, 0.83, -d / 2 + 0.14, g); cyl(0.06, 0.06, 0.01, MAT.brass, x0 + 0.2, 0.785, -d / 2 + 0.14, g); }
      const vl = new THREE.PointLight(0xffe7c2, 0.5, 1.5, 2); vl.position.set(x0 + 0.25, 1.1, -d / 2 + 0.3); g.add(vl);
      break;
    }
    case 'tv': case 'tvlong': {
      const ht = k === 'tvlong' ? 0.42 : 0.45;
      box(w, ht - 0.08, d, MAT.walnut, 0, 0.08 + (ht - 0.08) / 2, 0, g);
      box(w - 0.06, 0.08, d - 0.04, MAT.black, 0, 0.04, 0, g, false);
      for (let i = 1; i < 3; i++) box(0.004, ht - 0.12, 0.004, MAT.black, -w / 2 + (w * i) / 3, 0.08 + (ht - 0.08) / 2, d / 2 + 0.002, g, false);
      const tw = Math.min(w * 0.85, 1.45), th = tw * 0.56;
      box(tw, th, 0.03, MAT.tvScreen, 0, ht + 0.12 + th / 2, -d / 2 + 0.06, g);
      box(0.2, 0.12, 0.08, MAT.black, 0, ht + 0.06, -d / 2 + 0.08, g);
      if (k === 'tvlong') { box(w, 0.04, 0.3, MAT.walnut, 0, 1.75, -d / 2 + 0.15, g); }
      break;
    }
    case 'table': {
      box(w, 0.035, d, MAT.quartz, 0, 0.74, 0, g);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.035, 0.72, 0.035, MAT.black, sx * (w / 2 - 0.08), 0.36, sz * (d / 2 - 0.08), g);
      const nc = Math.max(1, Math.floor(w / 0.6));
      for (let i = 0; i < nc; i++) for (const sz of [-1, 1]) { const x = -w / 2 + w * (i + 0.5) / nc; chair(g, x, sz * (d / 2 + 0.18), sz > 0 ? Math.PI : 0); }
      break;
    }
    case 'round': case 'coffee': {
      if (k === 'coffee') {
        const r = Math.min(w, d) / 2;
        cyl(r, r, 0.03, MAT.black, -w * 0.15, 0.4, 0, g); cyl(0.02, 0.02, 0.38, MAT.black, -w * 0.15, 0.2, 0, g); cyl(0.12, 0.14, 0.02, MAT.black, -w * 0.15, 0.01, 0, g);
        cyl(r * 0.7, r * 0.7, 0.03, MAT.quartz, w * 0.25, 0.32, d * 0.1, g); cyl(0.02, 0.02, 0.3, MAT.black, w * 0.25, 0.16, d * 0.1, g);
      } else {
        const r = Math.min(w, d) / 2;
        cyl(r, r, 0.035, MAT.quartz, 0, 0.74, 0, g); cyl(0.04, 0.05, 0.72, MAT.black, 0, 0.36, 0, g); cyl(0.22, 0.24, 0.03, MAT.black, 0, 0.015, 0, g);
        for (let i = 0; i < 3; i++) { const a = i * 2.1 + 0.3; chair(g, Math.cos(a) * (r + 0.2), Math.sin(a) * (r + 0.2), -a - Math.PI / 2); }
      }
      break;
    }
    case 'night': box(w, 0.5, d, MAT.walnut, 0, 0.25, 0, g); box(w - 0.04, 0.004, 0.004, MAT.brass, 0, 0.36, d / 2 + 0.002, g, false);
      cyl(0.07, 0.09, 0.3, MAT.linen, 0, 0.68, -0.03, g); cyl(0.02, 0.06, 0.18, MAT.brass, 0, 0.59, -0.03, g); break;
    case 'dress': box(w, 0.04, d, MAT.walnut, 0, 0.75, 0, g); box(w, 0.18, d - 0.02, MAT.walnut, 0, 0.64, 0, g);
      for (const sx of [-1, 1]) box(0.03, 0.55, 0.03, MAT.brass, sx * (w / 2 - 0.03), 0.28, 0, g);
      box(Math.min(w * 0.6, 0.6), 0.8, 0.02, MAT.mirror, 0, 1.3, -d / 2 + 0.02, g); break;
    case 'desk': box(w, 0.035, d, MAT.oak, 0, 0.74, 0, g); for (const sx of [-1, 1]) box(0.035, 0.72, d - 0.06, MAT.black, sx * (w / 2 - 0.04), 0.36, 0, g); chair(g, 0, d / 2 + 0.15, Math.PI); break;
    case 'chair': chair(g, 0, 0, Math.PI, true); break;
    case 'fridge': { // 日立 R-G420YH X 晶鑽鏡面：600×664×1798，五門，上淺下深漸變
      const ht = 1.798, fz = d / 2, gap = 0.004;
      box(w - 0.01, ht - 0.04, d - 0.03, new THREE.MeshStandardMaterial({ color: 0x3a3b3e, roughness: 0.4, metalness: 0.6 }), 0, 0.04 + (ht - 0.04) / 2, -0.015, g);
      box(w, 0.04, d - 0.06, MAT.black, 0, 0.02, -0.03, g, false);
      const mirror = (col) => new THREE.MeshStandardMaterial({ color: col, roughness: 0.04, metalness: 1 });
      const panels = [ // [y0, y1, x0, x1, colour]
        [1.0, ht, -w / 2, w / 2, 0xe2e3e5],      // 冷藏室（左右揭單門）
        [0.82, 1.0 - gap, -w / 2, -gap / 2, 0x9fa1a5], [0.82, 1.0 - gap, gap / 2, w / 2, 0x9fa1a5], // 製冰／切換室
        [0.5, 0.82 - gap, -w / 2, w / 2, 0x5d5f63], // 蔬果室
        [0.06, 0.5 - gap, -w / 2, w / 2, 0x2b2c2f], // 冷凍室
      ];
      for (const [y0, y1, x0, x1, col] of panels) box(x1 - x0, y1 - y0, 0.03, mirror(col), (x0 + x1) / 2, (y0 + y1) / 2, fz - 0.015, g);
      box(0.06, 0.02, 0.004, MAT.led, w / 2 - 0.08, 1.55, fz + 0.001, g, false);           // 觸控面板
      box(0.004, 0.5, 0.012, MAT.chrome, -w / 2 + 0.02, 1.4, fz + 0.002, g, false);        // 門邊
      break;
    }
    case 'wash': { // 樂聲 NA-148MR1：595×475×850，白機身、頂部黑控制板、黑玻璃大門
      const ht = 0.85, fz = d / 2;
      rbox(w, ht - 0.02, d, 0.02, MAT.white, 0, ht / 2, 0, g);
      box(w - 0.004, 0.115, 0.012, MAT.blackGlass, 0, ht - 0.075, fz + 0.002, g, false);   // 控制面板
      const dial = cyl(0.032, 0.032, 0.02, MAT.chrome, -w / 2 + 0.1, ht - 0.075, fz + 0.012, g); dial.rotation.x = Math.PI / 2;
      box(0.13, 0.03, 0.006, MAT.led, w * 0.12, ht - 0.075, fz + 0.009, g, false);
      box(0.16, 0.06, 0.006, MAT.white, -w / 2 + 0.11, ht - 0.165, fz + 0.004, g, false);  // 洗衣粉格
      const cy = 0.42;
      const ring = cyl(0.205, 0.205, 0.03, MAT.greyRing, 0, cy, fz + 0.015, g); ring.rotation.x = Math.PI / 2;
      const glass = cyl(0.165, 0.165, 0.035, MAT.blackGlass, 0, cy, fz + 0.02, g); glass.rotation.x = Math.PI / 2;
      const inner = cyl(0.12, 0.12, 0.005, new THREE.MeshStandardMaterial({ color: 0x3c3f44, roughness: 0.3, metalness: 0.8 }), 0, cy, fz + 0.039, g); inner.rotation.x = Math.PI / 2;
      box(0.012, 0.06, 0.012, MAT.chrome, 0.19, cy, fz + 0.035, g, false);
      box(0.12, 0.09, 0.004, new THREE.MeshStandardMaterial({ color: 0xe9e9e9, roughness: 0.5 }), w / 2 - 0.1, 0.09, fz + 0.002, g, false); // 過濾器蓋
      break;
    }
    case 'tvwall': { // 到頂電視組合櫃：兩邊高櫃、懸浮地櫃、木坑背板、頂櫃；55" LG QNED80
      const ht = H - 0.02, side = it.hollow ? 0.018 : Math.max(0.25, Math.min(0.45, (w - 1.4) / 2)), cw = w - 2 * side, x0 = -w / 2;
      if (it.hollow) for (const sx of [x0 + side / 2, -x0 - side / 2]) box(side, ht, d, MAT.cream, sx, ht / 2, 0, g);   // 中空：兩邊得側板
      else for (const sx of [x0 + side / 2, -x0 - side / 2]) {
        box(side, ht, d, MAT.cream, sx, ht / 2, 0, g);
        box(0.004, ht - 0.06, 0.004, MAT.creamDark, sx, ht / 2, d / 2 + 0.002, g, false);
        box(0.01, 0.3, 0.015, MAT.brass, sx + (sx < 0 ? side / 2 - 0.03 : -side / 2 + 0.03), 1.05, d / 2 + 0.008, g, false);
      }
      // 懸浮地櫃
      box(cw, 0.3, d, MAT.cream, 0, 0.2 + 0.15, 0, g);
      for (let i = 1; i < 3; i++) box(0.004, 0.27, 0.004, MAT.creamDark, -cw / 2 + cw * i / 3, 0.35, d / 2 + 0.002, g, false);
      box(cw - 0.04, 0.008, 0.015, MAT.led, 0, 0.196, d / 2 - 0.05, g, false);
      // 木坑背板
      const bh = 1.95 - 0.5; box(cw, bh, 0.02, MAT.oak, 0, 0.5 + bh / 2, -d / 2 + 0.01, g);
      for (let k = 0; k < Math.floor(cw / 0.03); k++) box(0.006, bh, 0.006, MAT.walnut, -cw / 2 + 0.015 + k * 0.03, 0.5 + bh / 2, -d / 2 + 0.022, g, false);
      // 頂櫃 + 燈帶
      box(cw, ht - 1.95, d, MAT.cream, 0, 1.95 + (ht - 1.95) / 2, 0, g);
      box(0.004, ht - 2.0, 0.004, MAT.creamDark, 0, 1.95 + (ht - 1.95) / 2, d / 2 + 0.002, g, false);
      box(cw - 0.04, 0.008, 0.015, MAT.led, 0, 1.944, -d / 2 + 0.1, g, false);
      const tl = new THREE.PointLight(0xffe8c8, 0.5, 1.8, 2); tl.position.set(0, 1.85, -d / 2 + 0.2); g.add(tl);
      // 55" LG QNED80（1236×715，薄身掛背板）
      const tw = 1.236, th = 0.715, ty = 1.12;
      box(tw, th, 0.03, MAT.tvScreen, 0, ty, -d / 2 + 0.04, g);
      box(tw - 0.012, th - 0.012, 0.002, new THREE.MeshStandardMaterial({ color: 0x0d1016, roughness: 0.15, metalness: 0.3, emissive: 0x05070a }), 0, ty, -d / 2 + 0.056, g, false);
      box(0.22, 0.12, 0.08, MAT.black, 0, 0.56, -d / 2 + 0.12, g); // 機頂盒／Soundbar
      break;
    }
    case 'tvmount': { // 掛牆電視：48" LG OLED B6（1071×616），中心離地約 1.24m
      const tw = M(it.w), th = tw * 0.575, cy = (it.cy || 124) / 100;
      box(tw, th, 0.045, MAT.tvScreen, 0, cy, -d / 2 + 0.03, g);
      box(tw - 0.008, th - 0.008, 0.002, new THREE.MeshStandardMaterial({ color: 0x08090c, roughness: 0.1, metalness: 0.3 }), 0, cy, -d / 2 + 0.054, g, false);
      box(0.3, 0.2, 0.02, MAT.black, 0, cy, -d / 2 + 0.006, g, false);
      box(0.04, 0.012, 0.004, MAT.led, 0, cy - th / 2 + 0.01, -d / 2 + 0.056, g, false);
      break;
    }
    case 'toilet': { // Bellini BL-9099SV 自由咀分體座廁：590 深 × 365 闊 × 800 高，方水箱、包身圓廁盤
      const tankD = 0.17, tankW = Math.min(w, 0.36), ht = 0.8;
      rbox(tankW, 0.4, tankD, 0.015, MAT.ceramic, 0, ht - 0.2, -d / 2 + tankD / 2, g);              // 水箱
      rbox(tankW + 0.01, 0.02, tankD + 0.01, 0.008, MAT.ceramic, 0, ht - 0.005, -d / 2 + tankD / 2, g);  // 水箱蓋
      cyl(0.02, 0.02, 0.008, MAT.chrome, 0, ht + 0.009, -d / 2 + tankD / 2, g, 16);                    // 雙掣沖水按鈕
      const bl = d - 0.05, base = cyl(w / 2, w / 2.4, 0.4, MAT.ceramic, 0, 0.2, -d / 2 + 0.05 + bl / 2, g, 32); base.scale.z = bl / w;   // 包身廁盤
      box(w * 0.75, 0.4, 0.2, MAT.ceramic, 0, 0.2, -d / 2 + 0.13, g);
      const seat = cyl(w / 2 + 0.005, w / 2 + 0.005, 0.025, MAT.ceramic, 0, 0.415, -d / 2 + tankD + (d - tankD) / 2, g, 32); seat.scale.z = (d - tankD) / w;   // 緩降廁板
      break;
    }
    case 'basin': {
      box(w, 0.45, d, MAT.walnut, 0, 0.35 + 0.225, 0, g);
      box(w + 0.02, 0.03, d + 0.02, MAT.quartz, 0, 0.815, 0, g);
      const b = cyl(Math.min(w, d) * 0.32, Math.min(w, d) * 0.26, 0.14, MAT.ceramic, 0, 0.9, 0.02, g); b.scale.x = 1.35;
      cyl(0.012, 0.012, 0.18, MAT.brass, 0, 0.92, -d / 2 + 0.06, g);
      box(w, 0.7, 0.13, MAT.walnut, 0, 1.55, -d / 2 + 0.065, g); box(w - 0.03, 0.66, 0.01, MAT.mirror, 0, 1.55, -d / 2 + 0.135, g);
      box(w - 0.1, 0.02, 0.06, MAT.led, 0, 1.18, -d / 2 + 0.06, g, false);
      break;
    }
    case 'shower': {
      const ch = Math.min(w, d) * 0.42;
      box(w, 0.04, d, MAT.white, 0, 0.02, 0, g);
      const pts = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2 - ch], [w / 2 - ch, d / 2], [-w / 2, d / 2]];
      // 玻璃：右邊、斜面、前面
      for (const [a, b] of [[1, 2], [2, 3], [3, 4]]) {
        const [x1, z1] = pts[a], [x2, z2] = pts[b]; const L = Math.hypot(x2 - x1, z2 - z1);
        const p = box(L, 1.95, 0.01, MAT.showerGlass, (x1 + x2) / 2, 1.0, (z1 + z2) / 2, g, false); p.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
        const f = box(L, 0.02, 0.025, MAT.frame, (x1 + x2) / 2, 1.97, (z1 + z2) / 2, g, false); f.rotation.y = p.rotation.y;
      }
      cyl(0.11, 0.11, 0.01, MAT.steel, -w / 2 + 0.25, 2.1, -d / 2 + 0.25, g);
      cyl(0.01, 0.01, 0.25, MAT.steel, -w / 2 + 0.25, 2.2, -d / 2 + 0.25, g);
      break;
    }
    case 'pipe': cyl(Math.min(w, d) / 2, Math.min(w, d) / 2, H, MAT.pipe, 0, H / 2, 0, g); break;
    default: box(w, 0.6, d, MAT.oak, 0, 0.3, 0, g);
  }
  return g;
}
function chair(g, x, z, rotY, solo) {
  const c = new THREE.Group(); c.position.set(x, 0, z); c.rotation.y = rotY;
  rbox(0.44, 0.06, 0.44, 0.05, MAT.fabricGrey, 0, 0.46, 0, c);
  rbox(0.44, 0.4, 0.05, 0.03, MAT.fabricGrey, 0, 0.7, -0.2, c);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.02, 0.44, 0.02, MAT.black, sx * 0.19, 0.22, sz * 0.19, c);
  g.add(c);
}

// ---------------------------------------------------------------- build scene
function build() {
  const P = window.__plan; const S = P.state(); DOORS = []; CUTS = []; BEDS = [];
  scene = new THREE.Scene();
  scene.background = skyTex();
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(renderer), 0.04).texture;
  scene.environmentIntensity = 0.3;

  const world = new THREE.Group(); scene.add(world);

  // floors
  let minX = 1e9, minZ = 1e9, maxX = -1e9, maxZ = -1e9;
  P.FLOORS.forEach((f, fi) => {
    const kind = fi <= 2 ? 'oak' : (fi === 3 ? 'bath' : 'kit');
    const geo = new THREE.PlaneGeometry(M(f.w), M(f.h)); geo.rotateX(-Math.PI / 2);
    const mat = (kind === 'oak' ? MAT.oakFloor : kind === 'bath' ? MAT.bathTile : MAT.kitFloor).clone();
    const tw = kind === 'oak' ? 1.53 : 1.2, th = kind === 'oak' ? 1.38 : 1.2;
    mat.map = mat.map.clone(); mat.map.needsUpdate = true;
    mat.map.repeat.set(M(f.w) / tw, M(f.h) / th);
    mat.map.offset.set(M(f.x) / tw, M(f.y) / th);
    const m = new THREE.Mesh(geo, mat); m.position.set(M(f.x + f.w / 2), 0, M(f.y + f.h / 2)); m.receiveShadow = true; world.add(m);
    minX = Math.min(minX, f.x); minZ = Math.min(minZ, f.y); maxX = Math.max(maxX, f.x + f.w); maxZ = Math.max(maxZ, f.y + f.h);
  });
  const regionAt = (x, y) => { for (let i = 3; i < P.FLOORS.length; i++) { const f = P.FLOORS[i]; if (x > f.x && x < f.x + f.w && y > f.y && y < f.y + f.h) return i === 3 ? 'bath' : 'kit'; } return null; };
  // floor slab under walls
  box(M(maxX - minX) + 0.6, 0.05, M(maxZ - minZ) + 0.6, new THREE.MeshStandardMaterial({ color: 0x7a7672 }), M((minX + maxX) / 2), -0.026, M((minZ + maxZ) / 2), world, false);

  // walls
  for (const { w, ops, part } of P.walls()) {
    const horiz = P.isH(w), L = P.wlen(w);
    const mat = MAT.ivory;
    const rect = (s, e) => horiz ? { x: w.a[0] + s, y: w.a[1] - w.t / 2, w: e - s, h: w.t } : { x: w.a[0] - w.t / 2, y: w.a[1] + s, w: w.t, h: e - s };
    const seg = (r, y0, y1, m = mat) => {
      if (r.w <= 0.1 || r.h <= 0.1 || y1 - y0 <= 0.001) return;
      const b = box(M(r.w), y1 - y0, M(r.h), m.clone ? m : m, M(r.x + r.w / 2), (y0 + y1) / 2, M(r.y + r.h / 2), world);
      CUTS.push({ mesh: b, y0, y1 });
      // 廚房／浴室一面鋪磚
      const hz = r.w >= r.h, sides = hz ? [[r.x + r.w / 2, r.y - 3, -1], [r.x + r.w / 2, r.y + r.h + 3, 1]] : [[r.x - 3, r.y + r.h / 2, -1], [r.x + r.w + 3, r.y + r.h / 2, 1]];
      for (const [sx, sy, sg] of sides) { const reg = regionAt(sx, sy); if (!reg) continue;
        const tm = (reg === 'bath' ? MAT.bathWall : MAT.kitWall).clone(); tm.map = tm.map.clone(); tm.map.needsUpdate = true;
        const lenM = M(hz ? r.w : r.h); tm.map.repeat.set(lenM / 1.2, (y1 - y0) / 1.2); tm.map.offset.set(M(hz ? r.x : r.y) / 1.2, y0 / 1.2);
        const sk = box(hz ? M(r.w) : 0.008, y1 - y0, hz ? 0.008 : M(r.h), tm, hz ? M(r.x + r.w / 2) : (sg < 0 ? M(r.x) - 0.004 : M(r.x + r.w) + 0.004), (y0 + y1) / 2, hz ? (sg < 0 ? M(r.y) - 0.004 : M(r.y + r.h) + 0.004) : M(r.y + r.h / 2), world, false);
        if (hz) sk.geometry = new THREE.BoxGeometry(M(r.w), y1 - y0, 0.008); else sk.geometry = new THREE.BoxGeometry(0.008, y1 - y0, M(r.h));
        CUTS.push({ mesh: sk, y0, y1 });
        // UV 修正：BoxGeometry 嘅 UV 0–1，用 repeat 已經對應尺寸
      }
    };
    const parts = P.wallParts(w, ops);
    for (const r of parts.solid) seg(r, 0, H);
    for (const o of ops) {
      const r = rect(o.s, o.e);
      const before = world.children.length;
      if (o.type === 'win') {
        const big = o.e - o.s > 120, sill = big ? 0.95 : (part ? 1.0 : 0.95), head = 2.25;
        seg(r, 0, sill); seg(r, head, H);
        const cx = M(r.x + r.w / 2), cz = M(r.y + r.h / 2), len = M(o.e - o.s), hgt = head - sill;
        const gl = box(horiz ? len : 0.008, hgt, horiz ? 0.008 : len, MAT.glass, cx, sill + hgt / 2, cz, world, false);
        const n = Math.max(1, Math.round(len / 0.6));
        for (let i = 0; i <= n; i++) { const off = -len / 2 + (len * i) / n; box(horiz ? 0.04 : 0.05, hgt, horiz ? 0.05 : 0.04, MAT.frame, horiz ? cx + off : cx, sill + hgt / 2, horiz ? cz : cz + off, world, false); }
        box(horiz ? len : 0.05, 0.04, horiz ? 0.05 : len, MAT.frame, cx, sill + 0.02, cz, world, false);
        box(horiz ? len : 0.05, 0.04, horiz ? 0.05 : len, MAT.frame, cx, head - 0.02, cz, world, false);
        box(horiz ? len + 0.06 : M(w.t) + 0.06, 0.03, horiz ? M(w.t) + 0.06 : len + 0.06, MAT.quartz, cx, sill - 0.015, cz, world, false);
        if (big) { // 照相：上面一列細窗＋中間橫框；靠兩房中間嗰頭有窗口冷氣機位
          const tr = 1.82;
          box(horiz ? len : 0.06, 0.06, horiz ? 0.06 : len, MAT.white, cx, tr, cz, world, false);
          const ac = 0.62, acH = 0.4, acD = 0.32, wt = M(w.t);
          const along = horiz ? cx : cz, mid = 2.15, sgn = (horiz ? (mid > cx ? 1 : -1) : 1);
          const ax = horiz ? cx + sgn * (len / 2 - ac / 2 - 0.02) : cx, az = horiz ? cz : cz + (len / 2 - ac / 2 - 0.02);
          const inward = (horiz ? (cz > 3 ? -1 : 1) : (cx > 3 ? -1 : 1));
          const fx = horiz ? ax : ax + inward * (wt / 2), fz = horiz ? az + inward * (wt / 2) : az;
          box(horiz ? ac + 0.08 : wt + 0.06, acH + 0.08, horiz ? wt + 0.06 : ac + 0.08, MAT.white, ax, tr + 0.03 + acH / 2 + 0.04, az, world, false);            // 冷氣機位框
          const acb = new THREE.MeshStandardMaterial({ color: 0xecebe7, roughness: 0.5 });
          const ox = horiz ? 0 : inward * 0.1, oz = horiz ? inward * 0.1 : 0;
          box(horiz ? ac : acD, acH, horiz ? acD : ac, acb, ax + ox, tr + 0.03 + acH / 2 + 0.04, az + oz, world);                                             // 窗口機
          for (let k = 0; k < 8; k++) box(horiz ? ac - 0.08 : 0.004, 0.006, horiz ? 0.004 : ac - 0.08, MAT.inner, ax + ox + (horiz ? 0 : inward * (acD / 2 + 0.002)), tr + 0.12 + k * 0.035, az + oz + (horiz ? inward * (acD / 2 + 0.002) : 0), world, false);
          box(horiz ? 0.08 : 0.004, 0.02, horiz ? 0.004 : 0.08, MAT.led, ax + ox + (horiz ? ac / 2 - 0.08 : inward * (acD / 2 + 0.003)), tr + acH, az + oz + (horiz ? inward * (acD / 2 + 0.003) : ac / 2 - 0.08), world, false);
        }
      } else if (o.type === 'door' || o.type === 'gap') {
        seg(r, 2.1, H);
        if (o.type === 'door') { addDoorLeaf(world, w, o, horiz);
          const tW = M(w.t) + 0.02, fw = 0.05;
          if (horiz) { box(fw, 2.12, tW, MAT.doorFrame, M(r.x) + fw / 2, 1.06, M(r.y + r.h / 2), world, false); box(fw, 2.12, tW, MAT.doorFrame, M(r.x + r.w) - fw / 2, 1.06, M(r.y + r.h / 2), world, false); box(M(r.w), fw, tW, MAT.doorFrame, M(r.x + r.w / 2), 2.1 - fw / 2 + 0.02, M(r.y + r.h / 2), world, false); }
          else { box(tW, 2.12, fw, MAT.doorFrame, M(r.x + r.w / 2), 1.06, M(r.y) + fw / 2, world, false); box(tW, 2.12, fw, MAT.doorFrame, M(r.x + r.w / 2), 1.06, M(r.y + r.h) - fw / 2, world, false); box(tW, fw, M(r.h), MAT.doorFrame, M(r.x + r.w / 2), 2.1 - fw / 2 + 0.02, M(r.y + r.h / 2), world, false); }
          if (o.lock) { // 舊式鐵閘（墨綠色），關埋喺門口外邊
            const green = new THREE.MeshStandardMaterial({ color: 0x1f3a2c, roughness: 0.5, metalness: 0.6 }), L2 = horiz ? M(r.w) : M(r.h), n2 = Math.max(4, Math.round(L2 / 0.1));
            const gx = M(r.x + r.w / 2), gz = M(r.y + r.h / 2), off2 = M(w.t) / 2 + 0.02;
            for (let k = 0; k <= n2; k++) { const t2 = -L2 / 2 + L2 * k / n2; box(horiz ? 0.012 : 0.012, 2.05, 0.012, green, horiz ? gx + t2 : gx - off2, 1.025, horiz ? gz - off2 : gz + t2, world, false); }
            for (const yy of [0.05, 1.0, 2.05]) box(horiz ? L2 : 0.02, 0.025, horiz ? 0.02 : L2, green, horiz ? gx : gx - off2, yy, horiz ? gz - off2 : gz, world, false);
            for (let k = 0; k < n2; k++) for (const yy of [0.5, 1.5]) { const d2 = box(0.008, 0.5, 0.008, green, horiz ? gx - L2 / 2 + L2 * (k + 0.5) / n2 : gx - off2, yy, horiz ? gz - off2 : gz - L2 / 2 + L2 * (k + 0.5) / n2, world, false); if (horiz) d2.rotation.z = k % 2 ? 0.2 : -0.2; else d2.rotation.x = k % 2 ? 0.2 : -0.2; }
          }
          if (o.pd) { // PD 門關埋（實心薩斯木）
            const pdT = 0.04; if (horiz) box(M(r.w) - 0.1, 2.03, pdT, MAT.doorWood, M(r.x + r.w / 2), 1.025, M(r.y + r.h / 2), world); else box(pdT, 2.03, M(r.h) - 0.1, MAT.doorWood, M(r.x + r.w / 2), 1.025, M(r.y + r.h / 2), world); }
        }
      }
      for (let i = before; i < world.children.length; i++) { const m = world.children[i]; if (!CUTS.some(c => c.mesh === m)) CUTS.push({ mesh: m, y0: m.position.y - (m.geometry.parameters?.height || 0) / 2, y1: m.position.y + (m.geometry.parameters?.height || 0) / 2 }); }
    }
  }

  // 大門外走廊（避免望到天空）
  const corridor = new THREE.Group(); world.add(corridor);
  for (const { w, ops } of P.walls()) for (const o of ops) if (o.lock) {
    const horiz = P.isH(w);
    if (horiz) box(M(o.e - o.s) + 1.2, H, 0.05, new THREE.MeshStandardMaterial({ color: 0x6f6a64, roughness: 0.9 }), M(w.a[0] + (o.s + o.e) / 2), H / 2, M(w.a[1]) - 1.3, corridor, false);
  }
  // kitchen built-ins
  const KX = P.KX, KY = P.KY, RUN = P.RUN, RET = P.RET, DEP = P.DEP;
  const kit = new THREE.Group(); world.add(kit);
  let hobZ = null;
  for (const b of P.BUILTINS) {
    const cx = M(b.x + b.w / 2), cz = M(b.y + b.h / 2);
    if (!b.open) {
      box(M(b.w) - 0.004, 0.76, M(b.h) - 0.004, MAT.white, cx, 0.1 + 0.38, cz, kit);
      // 櫃門（#24 灰米木紋）：長邊門面向 -x，轉角門面向 -z
      const alongZ = b.h > b.w, frontLen = alongZ ? M(b.h) : M(b.w), n = Math.max(1, Math.round(frontLen / 0.45));
      for (let i = 0; i < n; i++) {
        const seg = frontLen / n, off = -frontLen / 2 + seg * (i + 0.5);
        if (alongZ) box(0.018, 0.74, seg - 0.004, MAT.kitDoor, M(b.x) - 0.009, 0.49, cz + off, kit, false);
        else box(seg - 0.004, 0.74, 0.018, MAT.kitDoor, cx + off, 0.49, M(b.y) - 0.009, kit, false);
      }
      box(M(b.w) - 0.02, 0.1, M(b.h) - 0.06, MAT.black, cx - (b.sink ? 0 : 0.03), 0.05, cz, kit, false);
    }
    if (b.hob) hobZ = cz;
  }
  // 石英石枱面 (L)
  box(M(DEP) + 0.02, 0.04, M(RUN), MAT.quartzW, M(KX - DEP / 2) - 0.01, 0.88, M(KY - RUN / 2), kit);
  box(M(RET - DEP), 0.04, M(DEP) + 0.02, MAT.quartzW, M(KX - RET + (RET - DEP) / 2), 0.88, M(KY - DEP / 2) - 0.01, kit);
  { const sx = M(KX - RET + 38), sz = M(KY - DEP / 2); box(0.46, 0.005, 0.36, MAT.steel, sx, 0.902, sz, kit, false);
    const sp = cyl(0.014, 0.016, 0.34, MAT.chrome, sx, 1.07, sz + 0.2, kit); const arm = cyl(0.012, 0.012, 0.18, MAT.chrome, sx, 1.23, sz + 0.12, kit); arm.rotation.x = Math.PI / 2; }
  // 煮食爐：氣霸 HY-2266-TG（750×450，黑玻璃，雙頭 6kW）
  const hobX = M(KX - DEP / 2) - 0.02;
  if (hobZ !== null) {
    box(0.45, 0.01, 0.75, MAT.blackGlass, hobX, 0.905, hobZ, kit);
    for (const dz of [-0.19, 0.19]) {
      const bz = hobZ + dz, bx = hobX + 0.02;
      cyl(0.11, 0.11, 0.008, MAT.castIron, bx, 0.914, bz, kit); cyl(0.075, 0.075, 0.02, MAT.castIron, bx, 0.925, bz, kit); cyl(0.045, 0.045, 0.026, MAT.brass, bx, 0.93, bz, kit); cyl(0.02, 0.02, 0.03, MAT.castIron, bx, 0.942, bz, kit);
      for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + Math.PI / 4; const bar = box(0.13, 0.018, 0.014, MAT.castIron, bx + Math.cos(a) * 0.08, 0.945, bz + Math.sin(a) * 0.08, kit, false); bar.rotation.y = -a; }
      const kn = cyl(0.022, 0.022, 0.03, MAT.steel, hobX - 0.17, 0.925, hobZ + dz * 0.45, kit); 
    }
  }
  // 抽油煙機：德國寶 GPR-S722 傾斜式（699 闊 × 656 高 × 381 深）：頂深底窄，黑玻璃面向下斜向煮食爐；底部入風格柵＋兩盞燈；機底離爐面約 70cm
  if (hobZ !== null) {
    const hx0 = M(KX), hb = 0.9 + 0.03 + 0.70, hh = 0.656, hd = 0.381, hw = 0.699, bd = 0.15, base = 0.075;
    const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.lineTo(-bd, 0); sh.lineTo(-bd, base); sh.lineTo(-hd, hh - 0.025); sh.lineTo(-hd, hh); sh.lineTo(0, hh); sh.lineTo(0, 0);
    const geo = new THREE.ExtrudeGeometry(sh, { depth: hw - 0.006, bevelEnabled: false }); geo.translate(0, 0, -(hw - 0.006) / 2);
    const body = new THREE.Mesh(geo, MAT.black); body.position.set(hx0, hb, hobZ); body.castShadow = true; kit.add(body);
    // 斜面黑玻璃（略闊過機身）
    const L = Math.hypot(hd - bd, hh - 0.025 - base), ang = Math.atan2(hd - bd, hh - 0.025 - base);
    const gl = box(0.008, L, hw, MAT.blackGlass, hx0 - (hd + bd) / 2 - 0.004, hb + (base + hh - 0.025) / 2, hobZ, kit); gl.rotation.z = ang;
    const ctl = box(0.004, 0.03, 0.17, MAT.led, hx0 - (hd + bd) / 2 - 0.006 - 0.04 * Math.sin(ang), hb + (base + hh) / 2 + 0.06, hobZ, kit, false); ctl.rotation.z = ang;   // 觸控面板
    // 底部：入風格柵＋兩盞燈
    for (let k = 0; k < 30; k++) box(0.004, base - 0.02, 0.004, MAT.steel, hx0 - bd - 0.002, hb + base / 2, hobZ - hw / 2 + 0.12 + k * (hw - 0.24) / 29, kit, false);
    for (const dz of [-1, 1]) box(0.004, 0.035, 0.03, MAT.led, hx0 - bd - 0.003, hb + base / 2, hobZ + dz * (hw / 2 - 0.07), kit, false);
    box(bd - 0.02, 0.004, hw - 0.04, MAT.steel, hx0 - bd / 2, hb - 0.001, hobZ, kit, false);
    const hl = new THREE.SpotLight(0xfff2dd, 1.2, 1.4, 0.9, 0.6); hl.position.set(hx0 - 0.12, hb, hobZ); hl.target.position.set(hx0 - 0.25, 0.9, hobZ); kit.add(hl); kit.add(hl.target);
    // 吊櫃：爐頂嗰段拆走，機頂做矮櫃包喉
    const wc = P.WALLCAB, z0 = M(wc.y) + (P.DRYER && !S.dryerUnder ? 0.025 : 0), z1 = M(wc.y + wc.h), gap0 = hobZ - hw / 2 - 0.01, gap1 = hobZ + hw / 2 + 0.01, wx = M(wc.x + wc.w / 2), ww = M(wc.w);
    const wcab = (za, zb, y0, y1) => { if (zb - za < 0.05) return; box(ww, y1 - y0, zb - za, MAT.white, wx, (y0 + y1) / 2, (za + zb) / 2, kit);
      const n = Math.max(1, Math.round((zb - za) / 0.45)); for (let i = 0; i < n; i++) { const sg = (zb - za) / n; box(0.018, y1 - y0 - 0.004, sg - 0.004, MAT.kitDoor, M(wc.x) - 0.009, (y0 + y1) / 2, za + sg * (i + 0.5), kit, false); } };
    wcab(z0, Math.max(z0, gap0), 1.5, H - 0.01); wcab(Math.min(z1, gap1), z1, 1.5, H - 0.01); wcab(Math.max(z0, gap0), Math.min(z1, gap1), hb + hh + 0.02, H - 0.01);
    box(0.02, 0.02, Math.max(0, gap0 - z0) - 0.04, MAT.led, M(wc.x) + 0.02, 1.49, (z0 + gap0) / 2, kit, false);
  } else { const wc = P.WALLCAB; box(M(wc.w), 0.7, M(wc.h), MAT.white, M(wc.x + wc.w / 2), 1.85, M(wc.y + wc.h / 2), kit); }
  // 舊陽台位（照相估）：窗邊角落兩條直落去水喉、天花橫喉、煤氣錶同煤氣喉
  {
    const pvc = new THREE.MeshStandardMaterial({ color: 0xe9e6dc, roughness: 0.6 }), gi = new THREE.MeshStandardMaterial({ color: 0x9da1a5, roughness: 0.4, metalness: 0.7 });
    const zW = M(KY - RUN) - 0.06, xL = M(438 + 6) + 0.06, xR = M(KX);
    for (const dx of [0, 0.13]) cyl(0.055, 0.055, H, pvc, xL + dx, H / 2, zW + 0.02, kit, 16);                                 // 直落去水喉
    const hp = cyl(0.035, 0.035, xR - xL, pvc, (xL + xR) / 2, H - 0.12, zW + 0.12, kit, 12); hp.rotation.z = Math.PI / 2;     // 天花橫喉
    const gp = cyl(0.012, 0.012, xR - xL, gi, (xL + xR) / 2, H - 0.2, zW + 0.05, kit, 8); gp.rotation.z = Math.PI / 2;        // 煤氣喉
    box(0.13, 0.2, 0.17, new THREE.MeshStandardMaterial({ color: 0xbfc3c4, roughness: 0.5, metalness: 0.3 }), xR - 0.08, 2.05, zW + 0.12, kit);  // 煤氣錶
    box(0.004, 0.04, 0.06, MAT.led, xR - 0.146, 2.08, zW + 0.12, kit, false);
    const gv = cyl(0.012, 0.012, 0.5, gi, xR - 0.08, 2.35, zW + 0.12, kit, 8);
  }
  // 乾衣機：Miele TED645WP 9kg（850 高 × 596 闊 × 636 深，53kg），吊喺櫃桶櫃上面，承托層板＋兩邊側板，頂部矮櫃到天花
  if (P.DRYER) {
    const under = !!S.dryerUnder, dr = P.DRYER, dz = M(dr.y + dr.h / 2), bx = M(KX), dd = 0.636, dw = 0.596, dh = 0.85, y0 = under ? 0.0 : 1.47, t = 0.025;
    const lotus = new THREE.MeshStandardMaterial({ color: 0xf4f2ee, roughness: 0.35 }), graphite = new THREE.MeshPhysicalMaterial({ color: 0x4a4c50, roughness: 0.25, metalness: 0.5, clearcoat: 0.6 });
    // 狗臂架：兩支黑色鋼 L 架鎖入石屎牆＋承托板＋防震腳墊；周圍唔做吊櫃（枱底模式就唔要）
    if (!under) {
    const steel = new THREE.MeshStandardMaterial({ color: 0x222326, roughness: 0.5, metalness: 0.7 });
    box(dd + 0.02, 0.018, dw + 0.02, MAT.kitDoor, bx - (dd + 0.02) / 2, y0 - 0.009, dz, kit);                          // 承托板
    for (const sz of [-1, 1]) { const zz = dz + sz * (dw / 2 - 0.08);
      box(dd, 0.04, 0.035, steel, bx - dd / 2, y0 - 0.038, zz, kit);                                                   // 橫臂
      box(0.035, 0.32, 0.035, steel, bx - 0.018, y0 - 0.058 - 0.16, zz, kit);                                          // 貼牆直臂
      const br = box(0.03, Math.hypot(dd * 0.7, 0.3), 0.03, steel, bx - dd * 0.35, y0 - 0.058 - 0.15, zz, kit); br.rotation.z = Math.atan2(dd * 0.7, 0.3);   // 斜撐
    }
    for (const [ax, az] of [[-0.08, -1], [-0.08, 1], [-dd + 0.08, -1], [-dd + 0.08, 1]]) cyl(0.025, 0.025, 0.012, MAT.black, bx + ax, y0 + 0.006, dz + az * (dw / 2 - 0.06), kit, 16);   // 防震腳墊
    }
    // 機身
    rbox(dd - 0.01, dh, dw, 0.015, lotus, bx - dd / 2 - 0.005, y0 + 0.012 + dh / 2, dz, kit);
    const fx = bx - dd;
    box(0.012, 0.12, dw - 0.01, lotus, fx - 0.004, y0 + dh - 0.07, dz, kit);                                              // 直式控制面板
    const knob = cyl(0.032, 0.032, 0.025, lotus, fx - 0.018, y0 + dh - 0.07, dz + dw / 2 - 0.09, kit, 24); knob.rotation.z = Math.PI / 2;
    box(0.004, 0.035, 0.2, MAT.black, fx - 0.011, y0 + dh - 0.07, dz - 0.02, kit, false);                                 // 顯示屏
    box(0.003, 0.012, 0.06, MAT.white, fx - 0.0135, y0 + dh - 0.07, dz - 0.02, kit, false);
    const cy2 = y0 + 0.4;
    const ring = cyl(0.215, 0.215, 0.035, graphite, fx - 0.02, cy2, dz, kit, 40); ring.rotation.z = Math.PI / 2;           // 石墨灰門
    const gl2 = cyl(0.16, 0.16, 0.04, MAT.blackGlass, fx - 0.024, cy2, dz, kit, 40); gl2.rotation.z = Math.PI / 2;
    box(0.012, 0.09, 0.02, graphite, fx - 0.04, cy2, dz + 0.2, kit, false);
    box(0.004, 0.05, 0.12, new THREE.MeshStandardMaterial({ color: 0xe8e6e1 }), fx - 0.004, y0 + 0.07, dz - dw / 2 + 0.1, kit, false);   // 冷凝水盒
  }

  // furniture
  const items = S.items;
  for (const it of items) {
    if (it.k === 'wardL') { for (const r of P.rectsOf(it)) { const g = makeItem({ ...it, k: 'ward', w: r.w, d: r.h }); g.position.set(M(r.x + r.w / 2), 0, M(r.y + r.h / 2)); world.add(g); } continue; }
    const b = P.bbox(it); const g = makeItem(it);
    const plat = it.k === 'wash' ? 0.08 : 0;   // 照相估：洗衣機地台約 8cm
    if (plat) box(M(b.w) + 0.04, plat, M(b.h) + 0.06, new THREE.MeshStandardMaterial({ color: 0x9a9890, roughness: 0.9 }), M(b.x + b.w / 2), plat / 2, M(b.y + b.h / 2) , world);
    g.position.set(M(b.x + b.w / 2), plat, M(b.y + b.h / 2)); g.rotation.y = -it.rot * Math.PI / 180; world.add(g);
  }
  // 客廳地氈：梳化前面
  const sofa = items.find(i => i.k === 'sofa');
  if (sofa) {
    const b = P.bbox(sofa); const rot = sofa.rot % 360; const fw = rot % 180 ? b.h : b.w;
    const rw = M(fw) + 0.5, rd = 1.6; const g = new THREE.Group(); const geo = new THREE.PlaneGeometry(rw, rd); geo.rotateX(-Math.PI / 2);
    const rug = new THREE.Mesh(geo, MAT.rug); rug.receiveShadow = true; rug.position.set(0, 0.006, M(sofa.d) / 2 + rd / 2 - 0.25); g.add(rug);
    g.position.set(M(b.x + b.w / 2), 0, M(b.y + b.h / 2)); g.rotation.y = -sofa.rot * Math.PI / 180; world.add(g);
  }

  // 天花：純白 SF0000M + 筒燈
  ceilingGroup = new THREE.Group(); world.add(ceilingGroup); ceilingGroup.add(corridor); ceilingGroup.visible = false;   // 永遠唔封頂
  for (const f of P.FLOORS) {
    const geo = new THREE.PlaneGeometry(M(f.w) + 0.2, M(f.h) + 0.2); geo.rotateX(Math.PI / 2);
    const m = new THREE.Mesh(geo, MAT.ceilWhite); m.position.set(M(f.x + f.w / 2), H, M(f.y + f.h / 2)); ceilingGroup.add(m);
  }
  const liv = P.FLOORS[0];
  const lx0 = M(liv.x), lz0 = M(liv.y), lw = M(liv.w), ld = Math.min(M(liv.h), 3.95);
  const dl = (x, z) => { cyl(0.05, 0.05, 0.008, MAT.led, x, H - 0.004, z, ceilingGroup, 20); const ring = cyl(0.062, 0.062, 0.004, MAT.white, x, H - 0.002, z, ceilingGroup, 20); };
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) dl(lx0 + lw * (i + 0.5) / 3, lz0 + ld * (j + 0.5) / 2);
  for (const f of P.FLOORS.slice(3)) dl(M(f.x + f.w / 2), M(f.y + f.h / 2));
  dl(M(105), M(520)); dl(M(320), M(520));

  // lights
  HEMI = new THREE.HemisphereLight(0xfffaf2, 0x8a8070, 0.45); scene.add(HEMI);
  const sun = new THREE.DirectionalLight(0xfff1dc, 1.7); SUN = sun;
  sun.position.set(M((minX + maxX) / 2) - 3, 7, M(maxZ) + 6);
  sun.target.position.set(M((minX + maxX) / 2), 0, M((minZ + maxZ) / 2));
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
  Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 0.5, far: 25 });
  scene.add(sun, sun.target);
  const warm = (x, z, i = 1.6, dist = 4.5) => { const l = new THREE.PointLight(0xfff3e2, i, dist, 2); l.position.set(x, H - 0.3, z); scene.add(l); return l; };
  // living cove + room lights
  warm(lx0 + lw * 0.3, lz0 + ld * 0.35, 2.2); warm(lx0 + lw * 0.7, lz0 + ld * 0.7, 2.2);
  for (const f of P.FLOORS.slice(1)) warm(M(f.x + f.w / 2), M(f.y + f.h / 2), 1.0, 3);
  // bedrooms (window side)
  warm(M(110), M(520), 1.4, 3.5); warm(M(320), M(520), 1.4, 3.5);

  return { minX: M(minX), maxX: M(maxX), minZ: M(minZ), maxZ: M(maxZ), items };
}

function addDoorLeaf(world, w, o, horiz) {
  if (o.pd) return; // PD 門藏入牆
  const len = o.e - o.s; let hx, hz, px, pz;
  if (horiz) { const y = w.a[1], xs = w.a[0] + o.s, xe = w.a[0] + o.e; hx = o.hinge === 's' ? xs : xe; hz = y; px = hx; pz = y + len * o.side; }
  else { const x = w.a[0], ys = w.a[1] + o.s, ye = w.a[1] + o.e; hz = o.hinge === 's' ? ys : ye; hx = x; px = x + len * o.side; pz = hz; }
  // 開 80°：由 hinge 指向 open 方向少少向關門方向收
  const cx = M((hx + px) / 2), cz = M((hz + pz) / 2), L = M(len) - 0.02;
  const leaf = box(Math.abs(px - hx) > 0.1 ? L : 0.04, 2.05, Math.abs(pz - hz) > 0.1 ? L : 0.04, MAT.doorWood, cx, 1.025, cz, world);
  const kb = box(0.02, 0.02, 0.14, MAT.brass, cx, 1.0, cz, world, false); if (Math.abs(pz - hz) > 0.1) kb.rotation.y = Math.PI / 2;
}

// ---------------------------------------------------------------- views
let bounds;
const VIEWS = {
  living: () => ({ p: [0.35, 1.55, 3.3], t: [1.7, 0.75, 0.5] }),
  living2: () => ({ p: [1.3, 1.25, 0.75], t: [1.05, 1.05, 3.9] }),
  bed1: () => ({ p: [2.0, 1.65, 4.3], t: [0.5, 0.5, 5.9] }),
  ward1: () => ({ p: [1.0, 1.6, 6.25], t: [0.85, 1.2, 4.1] }),
  bed2: () => ({ p: [2.4, 1.75, 6.25], t: [3.8, 0.9, 4.5] }),
  kitchen: () => ({ p: [4.0, 1.6, 4.2], t: [5.25, 0.85, 1.7] }),
  bath: () => ({ p: [3.05, 1.65, 2.78], t: [3.9, 0.8, 1.35] }),
  doll: () => ({ p: [(bounds.minX + bounds.maxX) / 2 - 3.6, 8.2, bounds.maxZ + 4.2], t: [(bounds.minX + bounds.maxX) / 2, 0, (bounds.minZ + bounds.maxZ) / 2] }),
};
let anim = null;
function go(name) {
  const v = VIEWS[name]();
  ceilingGroup.visible = false;
  CUT = name === 'doll'; applyCut();
  controls.minDistance = name === 'doll' ? 2 : 0.05;
  controls.maxPolarAngle = name === 'doll' ? Math.PI * 0.48 : Math.PI * 0.95;
  anim = { p0: camera.position.clone(), t0: controls.target.clone(), p1: new THREE.Vector3(...v.p), t1: new THREE.Vector3(...v.t), s: performance.now(), d: 900 };
  document.querySelectorAll('#v3dbar .v3b[data-v]').forEach(b => b.classList.toggle('on', b.dataset.v === name));
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.fov = w < h ? 68 : 55; camera.updateProjectionMatrix();
}
function loop(now) {
  if (anim) { const k = Math.min(1, (now - anim.s) / anim.d), e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    camera.position.lerpVectors(anim.p0, anim.p1, e); controls.target.lerpVectors(anim.t0, anim.t1, e); if (k >= 1) anim = null; }
  controls.update(); renderer.render(scene, camera); raf = requestAnimationFrame(loop);
}

function open3D() {
  if (!window.__plan) return;
  $('v3d').hidden = false; $('v3load').style.display = 'flex';
  setTimeout(() => {
    if (!renderer) {
      renderer = new THREE.WebGLRenderer({ canvas: $('c3d'), antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.85;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      makeMaterials();
      camera = new THREE.PerspectiveCamera(55, 1, 0.03, 100);
      controls = new OrbitControls(camera, $('c3d')); controls.enableDamping = true; controls.dampingFactor = 0.08;
      window.addEventListener('resize', () => { if (!$('v3d').hidden) resize(); });
    }
    if (scene) scene.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    bounds = build(); applyDoors(); applyBed(); applyCut(); applyXray(); applyLights(); resize();
    const v = VIEWS.living(); camera.position.set(...v.p); controls.target.set(...v.t); go('living');
    $('v3load').style.display = 'none';
    cancelAnimationFrame(raf); raf = requestAnimationFrame(loop);
  }, 30);
}
function close3D() { $('v3d').hidden = true; cancelAnimationFrame(raf); }

$('b3d').onclick = open3D;
$('v3close').onclick = close3D;
$('v3cut').onclick = () => { CUT = !CUT; applyCut(); ceilingGroup.visible = false; };
$('v3doors').onclick = () => { DOORS_OPEN = !DOORS_OPEN; applyDoors(); $('v3doors').classList.toggle('on', DOORS_OPEN); $('v3doors').textContent = DOORS_OPEN ? '關櫃門' : '開櫃門'; };
document.querySelectorAll('#v3dbar .v3b[data-v]').forEach(b => b.onclick = () => go(b.dataset.v));
window.__open3D = open3D;
function rebuild3D() { const cp = camera.position.clone(), ct = controls.target.clone(); scene.traverse(o => { if (o.geometry) o.geometry.dispose(); });
  bounds = build(); applyDoors(); applyBed(); applyCut(); applyXray(); applyLights(); camera.position.copy(cp); controls.target.copy(ct); }
function syncDryerBtn() { const st = window.__plan && window.__plan.state(); if ($('v3dryer')) { $('v3dryer').textContent = st && st.dryerUnder ? '乾衣機：枱底' : '乾衣機：吊高'; $('v3dryer').classList.toggle('on', !!(st && st.dryerUnder)); } }
if ($('v3dryer')) $('v3dryer').onclick = () => { const st = window.__plan.state(); window.__setDryerUnder(!st.dryerUnder); rebuild3D(); syncDryerBtn(); };
$('b3d').addEventListener('click', () => setTimeout(syncDryerBtn, 50));
if ($('v3night')) $('v3night').onclick = () => { NIGHT = !NIGHT; applyLights(); $('v3night').textContent = NIGHT ? '☀️ 日頭' : '🌙 夜晚'; $('v3night').classList.toggle('on', NIGHT); };
if ($('v3light')) $('v3light').onclick = () => { LIGHTS_ON = !LIGHTS_ON; applyLights(); $('v3light').textContent = LIGHTS_ON ? '💡 閂燈' : '💡 開燈'; $('v3light').classList.toggle('on', !LIGHTS_ON); };
if ($('v3xray')) $('v3xray').onclick = () => { XRAY = !XRAY; applyXray(); $('v3xray').classList.toggle('on', XRAY); };
if ($('v3bed')) $('v3bed').onclick = () => { BED_OPEN = !BED_OPEN; applyBed(); $('v3bed').classList.toggle('on', BED_OPEN); $('v3bed').textContent = BED_OPEN ? '收返床' : '睇床底'; };
window.__v3cam = (px, py, pz, tx, ty, tz) => { anim = null; camera.position.set(px, py, pz); controls.target.set(tx, ty, tz); ceilingGroup.visible = false; };

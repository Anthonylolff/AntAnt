// 風格：同一份平面圖，換唔同材質、燈光、背景。
// 每個風格可以再用 settings.custom 覆蓋牆色、木色、布料色、櫃色。
const base = {
  dark: false, bg: '#eef0f3', bg2: '#d9dde4', ground: '#e4e6ea', grid: null,
  ambient: 0.55, hemi: [0xffffff, 0xbfc6d0, 0.6], sun: { color: 0xfff3e0, int: 2.4 }, shadows: true,
  wall: { color: '#f4f2ee', opacity: 1, rough: 0.9 }, edges: null, furnEdges: null,
  floors: { wood: '#c49a6c', tile: '#dfe1e3', marble: '#ecebe8', carpet: '#9aa3a8', concrete: '#b9b7b2', deck: '#a77b52', grass: '#7fae5d' },
  fabric: '#7c8794', wood: '#b88a5d', cabinet: '#efece6', metal: '#9aa0a6', white: '#f6f6f4', dark: '#2c2f33', accent: '#d08b4c',
  bedding: '#f1efe9', plant: '#4f8f4a', screen: '#111317', glass: { color: '#bfe3f2', opacity: 0.28 },
  lamp: 0xffd9a0, lampInt: 1, label: 'light', ui: { acc: '#1f7a5a' },
};
export const THEMES = {
  neon: {
    name: 'Neon', zh: '霓虹', dark: true, bg: '#0b1020', bg2: '#05070f', ground: '#0d1426', grid: '#1b2a4a',
    ambient: 0.35, hemi: [0x6b8cff, 0x0b1020, 0.5], sun: { color: 0x9fc4ff, int: 0.9 }, shadows: false,
    wall: { color: '#1a2850', opacity: 0.32, rough: 0.4, emissive: '#0a1a40' }, edges: { color: '#4fe3ff', opacity: 0.95 }, furnEdges: { color: '#4fe3ff', opacity: 0.35 },
    floors: { wood: '#1d2a4d', tile: '#1a2546', marble: '#1e2b52', carpet: '#24204a', concrete: '#1a2140', deck: '#16243e', grass: '#0f2b2a' },
    fabric: '#283766', wood: '#2a3a68', cabinet: '#22305a', metal: '#3b4d80', white: '#30406e', dark: '#141b33', accent: '#ff9f43',
    bedding: '#344a85', plant: '#1fa37a', screen: '#0a0d18', glass: { color: '#5fd7ff', opacity: 0.18 },
    lamp: 0xffb347, lampInt: 1.6, label: 'dark', ui: { acc: '#22d3ee' },
  },
  synthwave: {
    name: 'Synthwave', zh: '合成波', dark: true, bg: '#2a0e45', bg2: '#12051f', ground: '#1c0830', grid: '#ff3fb4',
    ambient: 0.4, hemi: [0xff6ad5, 0x2a0e45, 0.55], sun: { color: 0xff9a5a, int: 1.0 }, shadows: false,
    wall: { color: '#5a2a8a', opacity: 0.5, rough: 0.5, emissive: '#2a0a45' }, edges: { color: '#ff5bd1', opacity: 0.9 }, furnEdges: { color: '#7af7ff', opacity: 0.35 },
    floors: { wood: '#4a2275', tile: '#3d1d63', marble: '#4b2a78', carpet: '#5b1f6e', concrete: '#371a58', deck: '#3d1a5a', grass: '#20304f' },
    fabric: '#7a3aa8', wood: '#6a2f95', cabinet: '#5a2a85', metal: '#8a5ac0', white: '#7e55b0', dark: '#24103d', accent: '#ffb86b',
    bedding: '#9b59c9', plant: '#3be8b0', screen: '#130722', glass: { color: '#ff7ad9', opacity: 0.2 },
    lamp: 0xff8ad8, lampInt: 1.5, label: 'dark', ui: { acc: '#ff5bd1' },
  },
  homely: {
    name: 'Homely', zh: '溫馨', bg: '#f3ece2', bg2: '#e3d6c4', ground: '#d8ccb8',
    wall: { color: '#f5efe6', opacity: 1, rough: 0.95 },
    floors: { wood: '#c08a55', tile: '#e6dfd3', marble: '#efe9e0', carpet: '#b9a58c', concrete: '#c7beb0', deck: '#9d7047', grass: '#86b35c' },
    fabric: '#9a8572', wood: '#a8774a', cabinet: '#f1ebe1', accent: '#d2814a', bedding: '#f4efe6', ui: { acc: '#b0652e' },
  },
  architect: {
    name: "Architect's model", zh: '建築模型', bg: '#f7f7f5', bg2: '#e9e9e6', ground: '#efefec',
    ambient: 0.75, hemi: [0xffffff, 0xd8d8d8, 0.7], sun: { color: 0xffffff, int: 2.0 },
    wall: { color: '#ffffff', opacity: 1, rough: 1 }, edges: { color: '#c8c8c4', opacity: 0.7 },
    floors: { wood: '#efeee9', tile: '#f2f2ef', marble: '#f5f5f2', carpet: '#ebeae6', concrete: '#e8e7e3', deck: '#e6e4de', grass: '#e2e6dc' },
    fabric: '#f0f0ed', wood: '#eae6dc', cabinet: '#f6f6f3', metal: '#dedede', white: '#ffffff', dark: '#d6d6d2', accent: '#e9e3d6',
    bedding: '#fbfbf9', plant: '#d9e0d0', screen: '#cfcfcb', glass: { color: '#dfe9ee', opacity: 0.35 }, ui: { acc: '#5d6b6e' },
  },
  winter: {
    name: 'Winter evening', zh: '冬夜', dark: true, bg: '#1b2433', bg2: '#0c1119', ground: '#dfe6ee',
    ambient: 0.25, hemi: [0x8aa4c8, 0x1b2433, 0.35], sun: { color: 0x9db4d8, int: 0.5 }, shadows: true,
    wall: { color: '#e8e2d8', opacity: 1, rough: 0.9 },
    floors: { wood: '#8a5d38', tile: '#cfc8bd', marble: '#ddd6cb', carpet: '#7d6a59', concrete: '#9a958d', deck: '#6b5440', grass: '#e7eef5' },
    fabric: '#5b4a3e', wood: '#7a5233', cabinet: '#d9d0c2', metal: '#8c8f94', dark: '#22252a', accent: '#e0a060',
    bedding: '#eee5d6', plant: '#2f5d3a', lamp: 0xffb067, lampInt: 2.2, label: 'dark', ui: { acc: '#e0a060' },
  },
  daylight: {
    name: 'Daylight', zh: '日光', bg: '#dff1ff', bg2: '#bfe0f7', ground: '#cfe3c0', ambient: 0.6, sun: { color: 0xffffff, int: 3.0 },
    floors: { wood: '#d3ad80', tile: '#eef0f2', marble: '#f3f3f1', carpet: '#a8b6bf', concrete: '#c8c8c4', deck: '#b48a5e', grass: '#8cc063' },
    ui: { acc: '#1b78c9' },
  },
  blueprint: {
    name: 'Blueprint', zh: '藍圖', dark: true, bg: '#123a78', bg2: '#0a2652', ground: '#11356d', grid: '#3d6bb3',
    ambient: 0.9, hemi: [0xffffff, 0x123a78, 0.4], sun: { color: 0xffffff, int: 0.4 }, shadows: false,
    wall: { color: '#2a5aa5', opacity: 0.25, rough: 1 }, edges: { color: '#ffffff', opacity: 0.9 }, furnEdges: { color: '#cfe1ff', opacity: 0.55 },
    floors: { wood: '#1a4890', tile: '#1a4890', marble: '#1a4890', carpet: '#1a4890', concrete: '#1a4890', deck: '#174283', grass: '#174283' },
    fabric: '#1d4f9a', wood: '#1d4f9a', cabinet: '#1d4f9a', metal: '#2a62b5', white: '#2a62b5', dark: '#143e7e', accent: '#2a62b5',
    bedding: '#2a62b5', plant: '#2a62b5', screen: '#143e7e', glass: { color: '#ffffff', opacity: 0.1 }, label: 'dark', ui: { acc: '#7fb2ff' },
  },
  japandi: {
    name: 'Japandi', zh: '日式原木', bg: '#efe9df', bg2: '#ddd3c3', ground: '#d6cdbd',
    wall: { color: '#ece6dc', opacity: 1, rough: 1 },
    floors: { wood: '#d8b88f', tile: '#d9d2c6', marble: '#e3ddd2', carpet: '#cbbfae', concrete: '#bdb6aa', deck: '#b8916a', grass: '#93ad73' },
    fabric: '#c9bba6', wood: '#caa478', cabinet: '#e4d6c0', metal: '#5a5550', dark: '#3a3530', accent: '#6f7f5a', bedding: '#efe8dc', ui: { acc: '#6f7f5a' },
  },
  noir: {
    name: 'Noir', zh: '黑金', dark: true, bg: '#151515', bg2: '#050505', ground: '#1c1c1c',
    ambient: 0.3, hemi: [0xffffff, 0x111111, 0.35], sun: { color: 0xffe2b0, int: 1.4 },
    wall: { color: '#2b2b2b', opacity: 1, rough: 0.6 }, edges: { color: '#c9a45c', opacity: 0.6 },
    floors: { wood: '#3a2c20', tile: '#2c2c2c', marble: '#3a3a38', carpet: '#262626', concrete: '#333', deck: '#2e241b', grass: '#1f2a1c' },
    fabric: '#2d2d2d', wood: '#4a3626', cabinet: '#252525', metal: '#c9a45c', white: '#3a3a3a', dark: '#111', accent: '#c9a45c',
    bedding: '#3c3c3c', plant: '#2d4a2a', screen: '#000', glass: { color: '#c9a45c', opacity: 0.15 }, lamp: 0xffc870, lampInt: 1.8, label: 'dark', ui: { acc: '#c9a45c' },
  },
};
export function getTheme(id, custom = {}) {
  const t = THEMES[id] || THEMES.neon;
  const out = { ...base, ...t, id: THEMES[id] ? id : 'neon', wall: { ...base.wall, ...t.wall }, floors: { ...base.floors, ...t.floors }, glass: { ...base.glass, ...t.glass } };
  if (custom.wall) out.wall = { ...out.wall, color: custom.wall };
  if (custom.wood) { out.floors = { ...out.floors, wood: custom.wood }; out.wood = custom.wood; }
  if (custom.fabric) out.fabric = custom.fabric;
  if (custom.cabinet) out.cabinet = custom.cabinet;
  return out;
}

// ---------------------------------------------------------------- 太陽位置（NOAA 近似公式）
// 回傳 { az: 方位角 (由北順時針, 度), el: 仰角 (度) }
export function sunPosition(date, lat, lon) {
  const rad = Math.PI / 180;
  const jd = date.getTime() / 86400000 + 2440587.5, n = jd - 2451545.0;
  const L = (280.46 + 0.9856474 * n) % 360, g = ((357.528 + 0.9856003 * n) % 360) * rad;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad;
  const eps = (23.439 - 0.0000004 * n) * rad;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const gmst = (18.697374558 + 24.06570982441908 * n) % 24;
  const lst = (gmst * 15 + lon) * rad;
  const H = lst - ra, phi = lat * rad;
  const el = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const az = Math.atan2(-Math.sin(H), Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(H));
  return { az: ((az / rad) + 360) % 360, el: el / rad };
}

// 3D 視圖：由 home 資料即時砌出牆、地台、門窗、傢俬、裝置。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildItem, makeMats, kindInfo } from './furniture.js';
import { polyCentroid, polyBBox, wallLen } from './model.js';
import { deviceVisual } from './devices.js';

const LIGHT_POOL = 10;

export class View3D {
  constructor(host, cb = {}) {
    this.host = host; this.cb = cb;
    this.canvas = document.createElement('canvas'); this.canvas.className = 'v3-canvas';
    this.overlay = document.createElement('div'); this.overlay.className = 'v3-overlay';
    host.append(this.canvas, this.overlay);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.05, 400);
    this.camera.position.set(14, 16, 22);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.09; this.controls.maxPolarAngle = Math.PI * 0.495; this.controls.screenSpacePanning = true;
    this.controls.addEventListener('change', () => this.dirty = true);
    // 燈
    this.amb = new THREE.AmbientLight(0xffffff, 0.5); this.hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 0.5);
    this.sun = new THREE.DirectionalLight(0xffffff, 2); this.sun.castShadow = true; this.sun.shadow.mapSize.set(2048, 2048); this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.amb, this.hemi, this.sun, this.sun.target);
    this.pool = []; for (let i = 0; i < LIGHT_POOL; i++) { const l = new THREE.PointLight(0xffd9a0, 0, 7, 2); l.castShadow = false; this.pool.push(l); this.scene.add(l); }
    this.root = new THREE.Group(); this.scene.add(this.root);
    this.fx = new THREE.Group(); this.scene.add(this.fx);
    this.refGroup = new THREE.Group(); this.scene.add(this.refGroup);
    this.labels = []; this.floorGroups = new Map(); this.pickables = []; this.floorFilter = 'all'; this.cut = false; this.sunPos = null;
    this.stateOf = () => null; this.highlightKey = null; this.pulses = [];
    this.ray = new THREE.Raycaster(); this.ndc = new THREE.Vector2();
    this._bindPick();
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    const loop = (t) => { this.raf = requestAnimationFrame(loop); this.tick(t); };
    this.raf = requestAnimationFrame(loop);
  }
  resize() {
    const w = this.host.clientWidth || 1, h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); this.dirty = true;
  }
  // ------------------------------------------------------------ public api
  setHome(home) { this.home = home; this.needBuild = true; }
  setTheme(theme) { this.theme = theme; this.needBuild = true; }
  setFloor(id) { this.floorFilter = id; this.applyVisibility(); }
  setCut(on) { this.cut = on; this.needBuild = true; }
  setSun(pos) { this.sunPos = pos; this.applyLights(); this.dirty = true; }
  refreshStates() { this.needStates = true; }
  highlight(key) { this.highlightKey = key; this.needBuild = true; }

  tick(t) {
    if (this.needBuild && this.home && this.theme) { this.needBuild = false; this.build(); this.needStates = true; }
    if (this.needStates) { this.needStates = false; this.applyStates(); }
    if (this.anim) {
      const k = Math.min(1, (t - this.anim.t0) / this.anim.dur), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      this.camera.position.lerpVectors(this.anim.p0, this.anim.p1, e); this.controls.target.lerpVectors(this.anim.q0, this.anim.q1, e);
      this.dirty = true; if (k >= 1) this.anim = null;
    }
    if (this.controls.update()) this.dirty = true;
    if (this.pulses.length) {
      for (const p of this.pulses) { const k = ((t - p.t0) % 1400) / 1400; p.mesh.scale.setScalar(0.3 + k * 1.4); p.mesh.material.opacity = 0.9 * (1 - k); }
      this.pulses = this.pulses.filter(p => t - p.t0 < p.life || (p.mesh.removeFromParent(), false));
      this.dirty = true;
    }
    if (!this.dirty) return;
    this.dirty = false;
    this.renderer.render(this.scene, this.camera);
    this.placeLabels();
  }

  // ------------------------------------------------------------ build
  clear() {
    this.root.traverse(o => { if (o.geometry && !o.geometry.userData?.shared) o.geometry.dispose?.(); });
    this.root.clear(); this.pickables = []; this.floorGroups.clear();
    for (const l of this.labels) l.el.remove(); this.labels = [];
  }
  build() {
    const T = this.theme, home = this.home;
    this.clear();
    this.renderer.setClearColor(new THREE.Color(T.bg), 1);
    this.host.style.background = `radial-gradient(ellipse at 50% 30%, ${T.bg} 0%, ${T.bg2} 100%)`;
    this.renderer.setClearAlpha(0); this.scene.background = null;
    this.renderer.shadowMap.enabled = !!T.shadows;
    this.mats = makeMats(T);
    const wallMat = new THREE.MeshStandardMaterial({ color: T.wall.color, roughness: T.wall.rough, transparent: T.wall.opacity < 1, opacity: T.wall.opacity, emissive: T.wall.emissive || 0, depthWrite: T.wall.opacity >= 1, side: T.wall.opacity < 1 ? THREE.DoubleSide : THREE.FrontSide });
    const edgeMat = T.edges ? new THREE.LineBasicMaterial({ color: T.edges.color, transparent: true, opacity: T.edges.opacity }) : null;
    const floorMats = {}; for (const k in T.floors) floorMats[k] = new THREE.MeshStandardMaterial({ color: T.floors[k], roughness: k === 'marble' || k === 'tile' ? 0.35 : 0.85, emissive: T.dark ? T.floors[k] : 0, emissiveIntensity: T.dark ? 0.15 : 0 });
    this.floorMats = floorMats;
    // 地面
    const bb = this.homeBBox();
    const gsize = Math.max(bb.w, bb.h) * 3 + 40;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(gsize, gsize), new THREE.MeshStandardMaterial({ color: T.ground, roughness: 1, transparent: T.dark, opacity: T.dark ? 0.9 : 1 }));
    ground.rotation.x = -Math.PI / 2; ground.position.set(bb.cx, -0.09, bb.cy); ground.receiveShadow = true; this.root.add(ground);
    if (T.grid) { const gh = new THREE.GridHelper(gsize, Math.round(gsize), T.grid, T.grid); gh.material.transparent = true; gh.material.opacity = 0.35; gh.position.set(bb.cx, -0.085, bb.cy); this.root.add(gh); }

    for (const f of home.floors) {
      const fg = new THREE.Group(); fg.userData.floor = f; this.root.add(fg); this.floorGroups.set(f.id, fg);
      const H = this.cut ? 1.05 : f.height;
      // 地台
      for (const r of f.rooms) {
        const sh = new THREE.Shape(r.poly.map(([x, y]) => new THREE.Vector2(x, -y)));
        const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.06, bevelEnabled: false });
        geo.rotateX(-Math.PI / 2); geo.translate(0, f.elev - 0.06, 0);
        const m = new THREE.Mesh(geo, floorMats[r.floorMat] || floorMats.wood);
        m.receiveShadow = true; m.userData = { kind: 'room', id: r.id, floorId: f.id };
        fg.add(m); this.pickables.push(m);
        if (this.highlightKey === 'room:' + r.id) {
          const hg = new THREE.ShapeGeometry(sh); hg.rotateX(-Math.PI / 2); hg.translate(0, f.elev + 0.004, 0);
          const hm = new THREE.Mesh(hg, new THREE.MeshBasicMaterial({ color: T.ui.acc, transparent: true, opacity: 0.22, depthWrite: false }));
          fg.add(hm);
        }
        const c = polyCentroid(r.poly);
        this.addLabel({ cls: 'v3-room' + (this.highlightKey === 'room:' + r.id ? ' on' : ''), html: esc(r.name), pos: new THREE.Vector3(c[0], f.elev + Math.min(H, 1.9) + 0.1, c[1]), floorId: f.id, onClick: () => this.cb.onPickRoom?.(f, r) });
      }
      // 牆
      const geos = [], egeos = [];
      for (const w of f.walls) this.wallGeometry(w, f, H, geos, egeos, fg);
      if (geos.length) {
        const mg = mergeGeometries(geos); const wm = new THREE.Mesh(mg, wallMat); wm.castShadow = true; wm.receiveShadow = true; fg.add(wm);
        if (edgeMat) fg.add(new THREE.LineSegments(mergeGeometries(egeos), edgeMat));
        geos.forEach(g => g.dispose());
      }
      // 傢俬
      for (const it of f.items) {
        const g = buildItem(it, this.mats, T);
        const outer = new THREE.Group(); outer.add(g);
        outer.position.set(it.x, f.elev, it.y); outer.rotation.y = -(it.rot || 0) * Math.PI / 180;
        outer.userData = { kind: 'item', id: it.id, floorId: f.id };
        outer.traverse(o => { if (o.isMesh) { o.userData.pick = outer; this.pickables.push(o); } });
        if (this.highlightKey === 'item:' + it.id) { const bh = new THREE.BoxHelper(outer, T.ui.acc); outer.updateMatrixWorld(true); bh.update(); fg.add(bh); }
        fg.add(outer);
      }
      // 裝置
      for (const d of f.devices) this.buildDevice(d, f, fg);
    }
    this.applyLights(); this.applyVisibility();
    if (!this.framed) { this.framed = true; this.frameAll(false); }
    this.dirty = true;
  }

  wallGeometry(w, f, Hfloor, geos, egeos, fg) {
    const L = wallLen(w); if (L < 0.01) return;
    const H = this.cut ? Math.min(Hfloor, w.h || Hfloor) : (w.h || Hfloor), t = w.t || 0.12;
    const dx = w.b[0] - w.a[0], dy = w.b[1] - w.a[1];
    const phi = Math.atan2(-dy, dx);
    const M = new THREE.Matrix4().compose(new THREE.Vector3(w.a[0], f.elev, w.a[1]), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), phi), new THREE.Vector3(1, 1, 1));
    const ops = (w.openings || []).map(o => ({ o, s: Math.max(0, o.at - o.w / 2), e: Math.min(L, o.at + o.w / 2), y0: o.sill || 0, y1: (o.sill || 0) + o.h })).filter(o => o.e > o.s).sort((p, q) => p.s - q.s);
    const pieces = []; let cur = 0;
    for (const o of ops) {
      if (o.s > cur) pieces.push([cur, o.s, 0, H]);
      if (o.y0 > 0) pieces.push([Math.max(o.s, cur), o.e, 0, Math.min(o.y0, H)]);
      if (o.y1 < H) pieces.push([Math.max(o.s, cur), o.e, o.y1, H]);
      cur = Math.max(cur, o.e);
    }
    if (cur < L) pieces.push([cur, L, 0, H]);
    for (let [s, e, y0, y1] of pieces) {
      if (y1 - y0 < 0.005 || e - s < 0.002) continue;
      if (s <= 0.001) s = -t / 2; if (e >= L - 0.001) e = L + t / 2;
      const g = new THREE.BoxGeometry(e - s, y1 - y0, t); g.translate((s + e) / 2, (y0 + y1) / 2, 0); g.applyMatrix4(M);
      geos.push(g); egeos.push(new THREE.EdgesGeometry(g, 20));
    }
    // 門窗
    for (const { o, s, e, y0, y1 } of ops) {
      if (y0 >= H) continue;
      const og = new THREE.Group(); og.applyMatrix4(M);
      og.userData = { kind: 'opening', id: o.id, wallId: w.id };
      if (o.type === 'window') {
        const top = Math.min(y1, H);
        const glass = new THREE.Mesh(new THREE.BoxGeometry(e - s, top - y0, 0.02), this.mats.glass); glass.position.set((s + e) / 2, (y0 + top) / 2, 0); og.add(glass);
        const fm = this.mats.cabinet;
        const fr = (x0, x1, a, b) => { const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, b - a, t * 0.5), fm); m.position.set((x0 + x1) / 2, (a + b) / 2, 0); og.add(m); };
        fr(s, e, y0 - 0.03, y0 + 0.02); if (y1 <= H) fr(s, e, y1 - 0.03, y1);
        fr(s, s + 0.04, y0, top); fr(e - 0.04, e, y0, top); if (e - s > 1.2) fr((s + e) / 2 - 0.02, (s + e) / 2 + 0.02, y0, top);
        const st = this.stateOf(o.entity); // 窗簾
        if (st && o.entity.startsWith('cover.')) {
          const pos = st.attributes?.current_position ?? (st.state === 'open' ? 100 : 0);
          const ch = (top - y0) * (1 - pos / 100);
          if (ch > 0.01) { const bl = new THREE.Mesh(new THREE.BoxGeometry(e - s, ch, 0.03), this.mats.fabric); bl.position.set((s + e) / 2, top - ch / 2, -t / 2 - 0.03); og.add(bl); }
        }
      } else if (o.type === 'door') {
        const st = this.stateOf(o.entity);
        const open = o.entity ? (st && (st.state === 'on' || st.state === 'open' || st.state === 'unlocked')) : true;
        const ang = open ? (o.entity ? 1.4 : 1.1) : 0;
        const sgn = o.flip ? -1 : 1, right = o.hinge === 'r';
        const pivot = new THREE.Group(); pivot.position.set(right ? e : s, 0, sgn * t / 2);
        const dw = e - s - 0.02, dh = Math.min(y1, H) - 0.01;
        const leaf = new THREE.Mesh(new THREE.BoxGeometry(dw, dh, 0.04), o.entity ? this.mats.accent : this.mats.wood);
        leaf.position.set(right ? -dw / 2 - 0.01 : dw / 2 + 0.01, dh / 2, 0.02 * sgn); leaf.castShadow = true;
        pivot.add(leaf); pivot.rotation.y = (right ? 1 : -1) * ang * sgn;
        og.add(pivot);
        if (this.theme.furnEdges) { const le = new THREE.LineSegments(new THREE.EdgesGeometry(leaf.geometry), new THREE.LineBasicMaterial({ color: this.theme.furnEdges.color, transparent: true, opacity: 0.6 })); le.position.copy(leaf.position); pivot.add(le); }
      }
      fg.add(og);
    }
  }

  buildDevice(d, f, fg) {
    const T = this.theme, vis = deviceVisual(d, this.stateOf(d.entity));
    const p = new THREE.Vector3(d.x, f.elev + (d.z ?? 2.3), d.y);
    const g = new THREE.Group(); g.position.copy(p); g.userData = { kind: 'device', id: d.id, floorId: f.id, device: d };
    if (vis.domain === 'light') {
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 10), vis.on ? new THREE.MeshBasicMaterial({ color: vis.color || T.lamp }) : this.mats.white);
      g.add(bulb); g.userData.bulb = bulb;
    } else if (vis.domain === 'camera') {
      const a = (d.rot || 0) * Math.PI / 180, dir = new THREE.Vector3(-Math.sin(a), -0.35, Math.cos(a)).normalize();
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.9, 2.2, 4, 1, true), new THREE.MeshBasicMaterial({ color: T.ui.acc, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
      cone.geometry.translate(0, -1.1, 0); cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir); cone.geometry.rotateY(Math.PI / 4);
      g.add(cone); g.add(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.08), this.mats.dark));
    } else if (vis.domain === 'vacuum') {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.09, 28), this.mats.dark); m.position.y = 0.045; g.add(m);
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 16), new THREE.MeshBasicMaterial({ color: vis.on ? '#3ddc84' : T.ui.acc })); top.position.y = 0.1; g.add(top);
    } else if (vis.domain === 'climate') {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.26, 0.2), this.mats.white); g.add(m);
    }
    fg.add(g);
    this.addLabel({ cls: 'v3-dev' + (vis.on ? ' on' : '') + (this.highlightKey === 'device:' + d.id ? ' sel' : ''), html: `<i>${vis.icon}</i>${vis.text ? `<b>${esc(vis.text)}</b>` : ''}`, title: d.name || d.entity, pos: p.clone().add(new THREE.Vector3(0, 0.22, 0)), floorId: f.id, dev: d, onClick: () => this.cb.onPickDevice?.(f, d) });
  }

  addLabel({ cls, html, pos, floorId, onClick, title, dev }) {
    const el = document.createElement('button'); el.className = 'v3-label ' + cls; el.innerHTML = html; if (title) el.title = title;
    el.addEventListener('click', e => { e.stopPropagation(); onClick?.(); });
    this.overlay.appendChild(el); this.labels.push({ el, pos, floorId, dev });
  }
  placeLabels() {
    const w = this.host.clientWidth, h = this.host.clientHeight, v = new THREE.Vector3();
    for (const l of this.labels) {
      const fg = this.floorGroups.get(l.floorId);
      if (!fg?.visible || (l.dev && this.hideDevices)) { l.el.style.display = 'none'; continue; }
      v.copy(l.pos).project(this.camera);
      if (v.z > 1 || v.x < -1.2 || v.x > 1.2 || v.y < -1.2 || v.y > 1.2) { l.el.style.display = 'none'; continue; }
      l.el.style.display = '';
      l.el.style.transform = `translate(${((v.x + 1) / 2 * w).toFixed(1)}px,${((1 - v.y) / 2 * h).toFixed(1)}px) translate(-50%,-50%)`;
      l.el.style.zIndex = String(1000 - Math.round(v.z * 1000));
    }
  }

  applyVisibility() {
    const sel = this.home?.floors.find(f => f.id === this.floorFilter);
    for (const [id, g] of this.floorGroups) { const f = g.userData.floor; g.visible = !sel || (this.soloFloor ? f === sel : f.elev <= sel.elev + 1e-6); }
    this.dirty = true;
  }

  // 燈：太陽 + 燈池
  applyLights() {
    const T = this.theme; if (!T) return;
    const bb = this.homeBBox(), c = new THREE.Vector3(bb.cx, 0, bb.cy);
    let az = 135, el = 50, day = 1;
    if (this.sunPos) { az = this.sunPos.az; el = this.sunPos.el; day = Math.max(0, Math.min(1, (el + 3) / 12)); }
    const north = (this.home?.settings?.north || 0) * Math.PI / 180, a = az * Math.PI / 180, e = Math.max(el, 4) * Math.PI / 180;
    const hx = Math.sin(north) * Math.cos(a) + Math.cos(north) * Math.sin(a), hy = -Math.cos(north) * Math.cos(a) + Math.sin(north) * Math.sin(a);
    const R = Math.max(bb.w, bb.h) + 20;
    this.sun.position.set(c.x + hx * Math.cos(e) * R, Math.sin(e) * R, c.z + hy * Math.cos(e) * R); this.sun.target.position.copy(c);
    const sc = this.sun.shadow.camera, half = Math.max(bb.w, bb.h) * 0.75 + 3; sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half; sc.near = 1; sc.far = R * 2.5; sc.updateProjectionMatrix();
    this.sun.color.set(T.sun.color); this.sun.intensity = T.sun.int * (this.sunPos ? day * Math.min(1, Math.sin(Math.max(el, 0) * Math.PI / 180) * 2.2 + 0.15) : 1);
    if (this.sunPos && el < 8 && el > -4 && !T.dark) this.sun.color.lerp(new THREE.Color(0xff9a50), 1 - Math.max(0, el) / 8);
    const night = this.sunPos ? 1 - day : 0;
    this.amb.intensity = T.ambient * (1 - night * 0.6); this.hemi.color.set(T.hemi[0]); this.hemi.groundColor.set(T.hemi[1]); this.hemi.intensity = T.hemi[2] * (1 - night * 0.7);
    this.renderer.toneMappingExposure = 1 - night * 0.25;
    this.dirty = true;
  }

  // 燈池 + 門 + 窗簾等要重砌嘅狀態
  applyStates() {
    if (!this.home) return;
    // 燈泡 / 文字：重砌標籤比較簡單，數量少
    for (const l of this.labels) if (l.dev) {
      const vis = deviceVisual(l.dev, this.stateOf(l.dev.entity));
      l.el.classList.toggle('on', !!vis.on); l.el.innerHTML = `<i>${vis.icon}</i>${vis.text ? `<b>${esc(vis.text)}</b>` : ''}`;
    }
    const lights = [];
    for (const f of this.home.floors) {
      const fg = this.floorGroups.get(f.id);
      for (const d of f.devices) {
        const st = this.stateOf(d.entity), vis = deviceVisual(d, st);
        if (vis.domain === 'light' && vis.on && fg?.visible !== false) lights.push({ d, f, vis });
      }
    }
    // 更新燈泡材質
    this.root.traverse(o => {
      const d = o.userData?.device; if (!d || !o.userData.bulb) return;
      const vis = deviceVisual(d, this.stateOf(d.entity));
      o.userData.bulb.material = vis.on ? new THREE.MeshBasicMaterial({ color: vis.color || this.theme.lamp }) : this.mats.white;
    });
    const cam = this.controls.target;
    lights.sort((p, q) => Math.hypot(p.d.x - cam.x, p.d.y - cam.z) - Math.hypot(q.d.x - cam.x, q.d.y - cam.z));
    this.pool.forEach((l, i) => {
      const L = lights[i];
      if (!L) { l.intensity = 0; return; }
      l.position.set(L.d.x, L.f.elev + (L.d.z ?? 2.3) - 0.15, L.d.y);
      l.color.set(L.vis.color || this.theme.lamp);
      l.intensity = 9 * this.theme.lampInt * (L.vis.level ?? 1);
    });
    this.dirty = true;
  }

  // ------------------------------------------------------------ camera
  homeBBox(only) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, top = 3;
    for (const f of only ? [only] : this.home?.floors || []) {
      for (const r of f.rooms) for (const [x, y] of r.poly) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      for (const w of f.walls) for (const [x, y] of [w.a, w.b]) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      top = Math.max(top, f.elev + f.height);
    }
    if (!isFinite(x0)) { x0 = 0; y0 = 0; x1 = 8; y1 = 8; }
    return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, top };
  }
  frameAll(anim = true) {
    const sel = this.home?.floors.find(f => f.id === this.floorFilter), bb = this.homeBBox(this.soloFloor ? sel : null);
    const y = sel ? sel.elev : 0, s = Math.max(bb.w, bb.h, 6) * Math.max(1, 1 / this.camera.aspect) ** 0.8;
    const tgt = new THREE.Vector3(bb.cx, y + 0.5, bb.cy), pos = new THREE.Vector3(bb.cx + s * 0.55, y + s * 1.05, bb.cy + s * 1.15);
    this.flyTo(pos, tgt, anim);
  }
  flyTo(pos, tgt, anim = true) {
    if (!anim) { this.camera.position.copy(pos); this.controls.target.copy(tgt); this.controls.update(); this.dirty = true; return; }
    this.anim = { p0: this.camera.position.clone(), p1: pos, q0: this.controls.target.clone(), q1: tgt, t0: performance.now(), dur: 750 };
  }
  focusRoom(f, r) {
    const bb = polyBBox(r.poly), c = polyCentroid(r.poly), s = Math.max(bb.w, bb.h, 2.5);
    const dir = this.camera.position.clone().sub(this.controls.target).setY(0).normalize();
    if (!isFinite(dir.x)) dir.set(0.4, 0, 1).normalize();
    const tgt = new THREE.Vector3(c[0], f.elev + 0.6, c[1]);
    // 右邊有面板：目標向右移少少，等房間落喺畫面左邊
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize().multiplyScalar(-(this.sideOffset || 0) * s);
    tgt.add(right);
    this.flyTo(tgt.clone().add(dir.multiplyScalar(s * 1.3)).add(new THREE.Vector3(0, s * 1.6, 0)), tgt);
  }
  focusPoint(f, x, y, z = 1) {
    const dir = this.camera.position.clone().sub(this.controls.target).setY(0).normalize(); if (!isFinite(dir.x)) dir.set(0.4, 0, 1).normalize();
    const tgt = new THREE.Vector3(x, f.elev + z, y);
    this.flyTo(tgt.clone().add(dir.multiplyScalar(3.2)).add(new THREE.Vector3(0, 3.4, 0)), tgt);
    this.pulse(new THREE.Vector3(x, f.elev + 0.03, y));
  }
  pulse(p) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.6, 40), new THREE.MeshBasicMaterial({ color: this.theme?.ui.acc || '#2bd', transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2; m.position.copy(p); this.fx.add(m); this.pulses.push({ mesh: m, t0: performance.now(), life: 4200 });
  }
  view(name) { // 預設視角
    const bb = this.homeBBox(), s = Math.max(bb.w, bb.h, 6), sel = this.home?.floors.find(f => f.id === this.floorFilter), y = sel ? sel.elev : 0;
    const tgt = new THREE.Vector3(bb.cx, y, bb.cy);
    if (name === 'top') this.flyTo(new THREE.Vector3(bb.cx, y + s * 1.6, bb.cy + 0.01), tgt);
    else if (name === 'front') this.flyTo(new THREE.Vector3(bb.cx, y + s * 0.45, bb.cy + s * 1.4), tgt);
    else this.frameAll();
  }

  // ------------------------------------------------------------ picking
  _bindPick() {
    let down = null;
    this.canvas.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
    this.canvas.addEventListener('pointerup', e => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return; down = null;
      const r = this.canvas.getBoundingClientRect();
      this.ndc.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
      this.ray.setFromCamera(this.ndc, this.camera);
      const hits = this.ray.intersectObjects(this.pickables.filter(o => isVisible(o)), false);
      const h = hits[0]; if (!h) { this.cb.onPickEmpty?.(); return; }
      const ud = h.object.userData.pick ? h.object.userData.pick.userData : h.object.userData;
      const f = this.home.floors.find(f => f.id === ud.floorId);
      if (ud.kind === 'room') this.cb.onPickRoom?.(f, f.rooms.find(r => r.id === ud.id));
      else if (ud.kind === 'item') this.cb.onPickItem?.(f, f.items.find(i => i.id === ud.id));
    });
  }

  // ------------------------------------------------------------ reference mesh (匯入嘅 3D 模型)
  setReference(obj) {
    this.refGroup.clear(); if (obj) this.refGroup.add(obj); this.dirty = true;
  }
  screenshot() { this.renderer.render(this.scene, this.camera); return this.canvas.toDataURL('image/png'); }
}

function isVisible(o) { while (o) { if (!o.visible) return false; o = o.parent; } return true; }
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// 由上而下影一張圖（用嚟將 3D 模型變成 2D 底圖）
export function topDownImage(object, px = 1400) {
  const box = new THREE.Box3().setFromObject(object), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const w = Math.max(size.x, 0.1), h = Math.max(size.z, 0.1), scale = px / Math.max(w, h);
  const W = Math.round(w * scale), H = Math.round(h * scale);
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }); r.setSize(W, H, false);
  const sc = new THREE.Scene(); sc.add(new THREE.AmbientLight(0xffffff, 1.2)); const dl = new THREE.DirectionalLight(0xffffff, 1.5); dl.position.set(3, 10, 4); sc.add(dl);
  const clone = object.clone(true); sc.add(clone);
  const cam = new THREE.OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, 0.01, size.y + 20);
  cam.position.set(c.x, box.max.y + 5, c.z); cam.up.set(0, 0, -1); cam.lookAt(c.x, box.min.y, c.z);
  r.render(sc, cam);
  const url = r.domElement.toDataURL('image/png'); r.dispose();
  return { url, x: box.min.x, y: box.min.z, w, h };
}

// 主程式：接駁資料、2D 編輯、3D、Home Assistant、匯入、設定。
import { Store, sampleHome, newFloor, normaliseHome, polyArea, polyCentroid, pointInPoly, rebuildWalls, addWallsForRoom, wallLen, r3, FLOOR_MATS, uid, defaultSettings } from './model.js';
import { THEMES, getTheme, sunPosition } from './themes.js';
import { View3D } from './view3d.js';
import { Editor2D } from './editor2d.js';
import { KINDS, kindInfo } from './furniture.js';
import { HAConnection, DemoHA } from './ha.js';
import { controlHTML, bindControls, deviceVisual, domainOf, fmtNum } from './devices.js';
import { importFile } from './importers.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const store = new Store();
const H = () => store.home;
const S = () => { H().settings = { ...defaultSettings(), ...(H().settings || {}) }; return H().settings; };

// ---------------------------------------------------------------- UI state
const ui = { page: 'p3d', floor: 'all', room: null, show3dInEdit: innerWidth > 900, timeOverride: null, ref: null };
let ha = null;

function toast(msg, err = false) { const t = $('toast'); t.textContent = msg; t.className = 'toast show' + (err ? ' err' : ''); clearTimeout(toast.t); toast.t = setTimeout(() => t.className = 'toast', 2600); }

// ---------------------------------------------------------------- views
const v3host = document.createElement('div'); v3host.className = 'v3host';
$('slot3d').appendChild(v3host);
const view = new View3D(v3host, {
  onPickRoom: (f, r) => openRoom(f, r),
  onPickItem: (f, it) => { if (ui.page === 'pedit') { editor.setFloor(f.id); editor.select({ kind: 'item', id: it.id }); } else openRoom(f, f.rooms.find(r => pointInPoly([it.x, it.y], r.poly)) || null, it); },
  onPickDevice: (f, d) => { if (ui.page === 'pedit') { editor.select({ kind: 'device', id: d.id }); } else openDevice(f, d); },
  onPickEmpty: () => { if (ui.page === 'p3d') closeSide(); },
});
view.stateOf = e => (e && ha ? ha.states.get(e) : null) || null;
const editor = new Editor2D($('edhost'), store, {
  onSelect: sel => { renderInspector(); view.highlight(sel ? `${sel.kind}:${sel.id}` : null); },
  onLive: () => view.setHome(H()),
  toast, stateOf: e => view.stateOf(e),
  onTool: t => setToolUI(t),
  onPickPoint: p => { ui.pickCb?.(p); ui.pickCb = null; editor.setTool('select'); setToolUI('select'); },
});

function applyTheme() {
  const s = S(); const id = s.autoTheme ? (currentSun().el > -2 ? s.dayTheme : s.nightTheme) : s.theme;
  const T = getTheme(id, s.custom || {});
  if (view.theme?.id === T.id && JSON.stringify(view.themeCustom) === JSON.stringify(s.custom || {})) return;
  view.themeCustom = s.custom || {};
  view.setTheme(T);
  document.documentElement.style.setProperty('--acc', T.ui.acc);
  document.documentElement.style.setProperty('--accink', T.dark ? '#04121a' : '#ffffff');
  document.body.classList.toggle('light-ui', !T.dark);
  renderStylePop();
}

// ---------------------------------------------------------------- sun / time
function currentDate() {
  if (ui.timeOverride == null) return new Date();
  return new Date(ui.timeOverride);
}
function currentSun() {
  const s = S();
  if (ui.timeOverride == null && ha && !ha.demo) {
    const st = ha.states.get('sun.sun'); if (st?.attributes?.azimuth != null) return { az: st.attributes.azimuth, el: st.attributes.elevation };
  }
  return sunPosition(currentDate(), s.lat, s.lon);
}
function updateSun() {
  const sp = currentSun(); view.setSun(sp); applyTheme();
  const d = currentDate();
  $('tlabel').textContent = ui.timeOverride == null ? `而家 ${d.toLocaleTimeString('zh-HK', { hour: '2-digit', minute: '2-digit' })}` : d.toLocaleString('zh-HK', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  $('tsun').textContent = `太陽 ${sp.el > 0 ? '仰角 ' + sp.el.toFixed(0) + '°' : '已落山'} · 方位 ${sp.az.toFixed(0)}°`;
  $('tslider').value = d.getHours() * 60 + d.getMinutes();
  $('tdate').value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  $('btime').classList.toggle('on', ui.timeOverride != null);
}
setInterval(() => { if (ui.timeOverride == null) updateSun(); }, 60000);
$('tslider').addEventListener('input', e => { const d = currentDate(); d.setHours(0, +e.target.value, 0, 0); ui.timeOverride = d.getTime(); updateSun(); });
$('tdate').addEventListener('change', e => { const [y, m, dd] = e.target.value.split('-').map(Number); const d = currentDate(); d.setFullYear(y, m - 1, dd); ui.timeOverride = d.getTime(); updateSun(); });
$('tnow').onclick = () => { ui.timeOverride = null; stopPlay(); updateSun(); };
$('tauto').onchange = e => { S().autoTheme = e.target.checked; store.commit('settings'); applyTheme(); };
function stopPlay() { clearInterval(ui.play); ui.play = null; $('tplay').textContent = '▶ 播一日'; }
$('tplay').onclick = () => {
  if (ui.play) return stopPlay();
  const d = currentDate(); d.setHours(5, 0, 0, 0); ui.timeOverride = d.getTime(); $('tplay').textContent = '⏸ 停';
  ui.play = setInterval(() => { ui.timeOverride += 6 * 60000; if (new Date(ui.timeOverride).getHours() >= 22) stopPlay(); updateSun(); }, 60);
};

// ---------------------------------------------------------------- pages
function showPage(p) {
  ui.page = p;
  for (const b of $('tabs').children) b.classList.toggle('on', b.dataset.p === p);
  for (const id of ['p3d', 'pedit', 'pimport', 'pset']) $(id).hidden = id !== p;
  $('chipbar').style.display = p === 'p3d' || p === 'pedit' ? '' : 'none';
  view.soloFloor = p === 'pedit';
  if (p === 'p3d') { $('slot3d').appendChild(v3host); view.hideDevices = ui.hideDevices; view.highlight(ui.room ? 'room:' + ui.room : null); }
  if (p === 'pedit') {
    if (ui.floor === 'all') setFloor(H().floors[0].id, false);
    $('edside3d').appendChild(v3host); view.setFloor(ui.floor); view.frameAll(); editor.setFloor(ui.floor); requestAnimationFrame(() => editor.fit()); renderInspector(); closeSide();
  }
  if (p === 'pset') renderSettings();
  renderChips(); view.resize();
}
$('tabs').addEventListener('click', e => { const b = e.target.closest('.tab'); if (b) showPage(b.dataset.p); });

// ---------------------------------------------------------------- chips (floors / rooms)
function setFloor(id, fly = true) {
  ui.floor = id; view.setFloor(id);
  if (ui.page === 'pedit') { editor.setFloor(id); editor.fit(); renderInspector(); view.frameAll(); }
  else if (fly) view.frameAll();
  renderChips();
}
function renderChips() {
  const fc = $('floorchips'); fc.innerHTML = '';
  const mk = (txt, on, fn, title) => { const b = document.createElement('button'); b.className = 'chip' + (on ? ' on' : ''); b.textContent = txt; if (title) b.title = title; b.onclick = fn; return b; };
  if (ui.page !== 'pedit') fc.appendChild(mk('全部樓層', ui.floor === 'all', () => setFloor('all')));
  for (const f of H().floors) fc.appendChild(mk(f.name, ui.floor === f.id, () => setFloor(f.id)));
  if (ui.page === 'pedit') fc.appendChild(mk('＋ 樓層', false, addFloor, '加一層'));
  const rc = $('roomchips'); rc.innerHTML = '';
  const floors = ui.floor === 'all' ? H().floors : H().floors.filter(f => f.id === ui.floor);
  for (const f of floors) for (const r of f.rooms) rc.appendChild(mk(r.name, ui.room === r.id, () => {
    if (ui.page === 'pedit') { editor.select({ kind: 'room', id: r.id }); } else openRoom(f, r);
  }));
}
function addFloor() {
  const fs = H().floors, top = fs[fs.length - 1];
  const f = newFloor(`${fs.length} 樓`, top ? r3(top.elev + top.height + 0.3) : 0);
  fs.push(f); store.commit(); setFloor(f.id); toast('加咗新樓層，用「房間」工具開始畫');
}

// ---------------------------------------------------------------- 3D overlays
$('viewbtns').addEventListener('click', e => { const b = e.target.closest('[data-view]'); if (b) { closeSide(); ui.room = null; view.highlight(null); renderChips(); view.view(b.dataset.view); } });
$('bcut').onclick = () => { const on = !view.cut; view.setCut(on); $('bcut').classList.toggle('on', on); };
$('bdev').classList.add('on');
$('bdev').onclick = () => { ui.hideDevices = !ui.hideDevices; view.hideDevices = ui.hideDevices; view.dirty = true; $('bdev').classList.toggle('on', !ui.hideDevices); };
$('bstyle').onclick = () => { $('timepop').hidden = true; $('stylepop').hidden = !$('stylepop').hidden; };
$('btime').onclick = () => { $('stylepop').hidden = true; $('timepop').hidden = !$('timepop').hidden; updateSun(); };
$('bshot').onclick = () => { const a = document.createElement('a'); a.href = view.screenshot(); a.download = `${H().name || 'home'}-3d.png`; a.click(); };
function renderStylePop() {
  const s = S(), cur = view.theme?.id;
  $('stylepop').innerHTML = `<div class="themes">${Object.entries(THEMES).map(([id, t]) => `<button class="thm ${id === cur ? 'on' : ''}" data-t="${id}"><span style="background:linear-gradient(135deg,${t.bg} 0%,${t.bg2 || t.bg} 55%,${(t.edges || t.wall || {}).color || '#ccc'} 100%)"></span><b>${t.zh}</b><small>${t.name}</small></button>`).join('')}</div>
  <div class="mut" style="margin-top:10px">${s.autoTheme ? `日夜自動：日頭「${THEMES[s.dayTheme]?.zh}」、夜晚「${THEMES[s.nightTheme]?.zh}」（去「設定」改）` : '想自己調牆色、木色：去「設定 → 風格」'}</div>`;
  $('tauto').checked = !!s.autoTheme;
}
$('stylepop').addEventListener('click', e => {
  const b = e.target.closest('[data-t]'); if (!b) return;
  const s = S(); s.theme = b.dataset.t; s.autoTheme = false; store.commit('settings'); applyTheme();
});

// 能源
function renderEnergy() {
  const s = S(); let en = { ...s.energy };
  if (ha?.demo && !Object.values(en).some(Boolean)) en = { consumption: 'sensor.house_power', grid: 'sensor.grid_power', solar: 'sensor.solar_power', battery: 'sensor.battery_power', battery_soc: 'sensor.battery_soc', tariff: 'sensor.electricity_price' };
  const val = e => { const st = e && ha?.states.get(e); return st ? fmtNum(st.state, st.attributes.unit_of_measurement) : null; };
  const items = [['consumption', '用電', ''], ['grid', '電網', 'grid'], ['solar', '太陽能', 'solar']];
  let html = '';
  for (const [k, label, cls] of items) { const v = val(en[k]); if (v != null) html += `<div class="pill ${cls}"><small>${label}</small><b>${esc(v)}</b></div>`; }
  const b = val(en.battery), soc = val(en.battery_soc); if (b != null || soc != null) html += `<div class="pill batt"><small>電池</small><b>${esc([b, soc].filter(Boolean).join(' · '))}</b></div>`;
  const t = val(en.tariff); if (t != null) html += `<div class="pill"><small>電價</small><b>${esc(t)}</b></div>`;
  $('energy').innerHTML = html;
}

// ---------------------------------------------------------------- side panel: room / device
function entitiesForRoom(f, r) {
  const ids = new Set();
  if (r?.area && ha) for (const [e, a] of ha.entityArea) if (a === r.area) ids.add(e);
  if (r) for (const d of f.devices) if (d.entity && pointInPoly([d.x, d.y], r.poly)) ids.add(d.entity);
  const order = ['light', 'cover', 'climate', 'camera', 'media_player', 'vacuum', 'switch', 'fan', 'lock', 'binary_sensor', 'sensor'];
  return [...ids].filter(e => order.includes(domainOf(e))).sort((a, b) => order.indexOf(domainOf(a)) - order.indexOf(domainOf(b)) || a.localeCompare(b));
}
function openRoom(f, r, item) {
  if (!r) { if (item) { toast(item.name || kindInfo(item.kind).zh); view.focusPoint(f, item.x, item.y, 0.5); } return; }
  ui.room = r.id; ui.side = { type: 'room', f, r }; renderChips();
  if (ui.floor !== 'all' && ui.floor !== f.id) setFloor(f.id, false);
  view.highlight('room:' + r.id); view.sideOffset = innerWidth > 640 ? 0.35 : 0; view.focusRoom(f, r); renderSide();
}
function openDevice(f, d) { ui.side = { type: 'device', f, d }; view.highlight('device:' + d.id); view.focusPoint(f, d.x, d.y, d.z ?? 1); renderSide(); }
function closeSide() { $('side').hidden = true; ui.side = null; clearInterval(ui.camTimer); if (ui.page === 'p3d' && ui.room) { ui.room = null; view.highlight(null); renderChips(); } }
$('sidex').onclick = closeSide;
function renderSide() {
  const s = ui.side; if (!s || ui.page !== 'p3d') return;
  $('side').hidden = false; let html = '';
  if (s.type === 'room') {
    const r = s.r, ents = entitiesForRoom(s.f, r);
    $('sidet').textContent = r.name;
    const area = ha?.areas.find(a => a.id === r.area);
    const lights = ents.filter(e => domainOf(e) === 'light'), anyOn = lights.some(e => ha?.states.get(e)?.state === 'on');
    html += `<div class="hint" style="margin-bottom:8px">${polyArea(r.poly).toFixed(1)} m² · ${esc(s.f.name)}${area ? ' · HA 區域「' + esc(area.name) + '」' : r.area ? ' · 區域 ' + esc(r.area) : ''}</div>`;
    if (lights.length) html += `<div class="btns" style="margin:0 0 10px"><button class="btn ${anyOn ? '' : 'pri'}" data-act="light.${anyOn ? 'turn_off' : 'turn_on'}" data-e="${lights.join(',')}">${anyOn ? '全部熄燈' : '全部開燈'}</button></div>`;
    if (!ents.length) html += `<div class="hint">呢間房未綁 Home Assistant 裝置。<br>去「編輯」揀呢間房 → 「HA 區域」揀返對應區域，或者自己加裝置。</div>`;
    for (const e of ents) { const dv = s.f.devices.find(d => d.entity === e); html += controlHTML(e, ha?.states.get(e), dv?.name); }
    const items = s.f.items.filter(i => pointInPoly([i.x, i.y], r.poly));
    if (items.length) html += `<h4 class="mut" style="margin:14px 0 6px;font-size:11px">傢俬</h4><div class="hint">${items.map(i => esc(i.name || kindInfo(i.kind).zh)).join('、')}</div>`;
  } else {
    const d = s.d; $('sidet').textContent = d.name || ha?.states.get(d.entity)?.attributes.friendly_name || d.entity;
    html += controlHTML(d.entity, ha?.states.get(d.entity), d.name);
    html += `<div class="hint">${esc(d.entity)}</div>`;
  }
  $('sideb').innerHTML = html; loadCams();
}
function loadCams() {
  clearInterval(ui.camTimer);
  const load = () => document.querySelectorAll('.ctl-cam').forEach(c => { const u = ha?.cameraUrl(c.dataset.cam); if (u) c.querySelector('img').src = u; else c.querySelector('span').textContent = '冇畫面（未連 HA）'; });
  if (document.querySelector('.ctl-cam')) { load(); ui.camTimer = setInterval(load, 2500); }
}
// 一個掣控制多個燈（data-e 用逗號分隔）
const haProxy = { callService: (d, s, data, target) => { const ids = String(target.entity_id).split(','); return ha?.callService(d, s, data, { entity_id: ids.length > 1 ? ids : ids[0] }); } };
bindControls($('sideb'), haProxy);

// ---------------------------------------------------------------- HA connection
function haCfg() { try { return JSON.parse(localStorage.getItem('home3d.ha') || '{}'); } catch { return {}; } }
function saveHaCfg(c) { try { localStorage.setItem('home3d.ha', JSON.stringify(c)); } catch { } }
let stateQueued = false;
function onHaState(id) {
  if (stateQueued) return; stateQueued = true;
  requestAnimationFrame(() => {
    stateQueued = false; view.refreshStates();
    // 門 / 窗簾會改到幾何
    if (H().floors.some(f => f.walls.some(w => w.openings.some(o => o.entity)))) view.needBuild = true;
    renderEnergy(); if (ui.side) { const focus = document.activeElement; if (!focus || focus.tagName !== 'INPUT' || !$('sideb').contains(focus)) renderSide(); }
    if (ui.page === 'pedit') editor.render();
  });
}
function setHaStatus(s, msg) {
  const el = $('hastat'); el.className = 'hastat ' + (s === 'connected' ? 'ok' : s === 'demo' ? 'demo' : s === 'error' ? 'err' : '');
  el.querySelector('span').textContent = { connected: 'HA 已連線', demo: '示範模式', connecting: '連線中…', reconnecting: '重新連線…', error: 'HA 連唔到', idle: '未連 HA' }[s] || s;
  el.title = msg || '';
  if (ui.page === 'pset') renderSettings();
}
async function startHA() {
  ha?.close?.(); const c = haCfg();
  if (c.mode === 'ha' && c.url && c.token) ha = new HAConnection(c.url, c.token);
  else if (c.mode === 'off') ha = null;
  else ha = new DemoHA(sampleHome());
  if (!ha) { setHaStatus('idle'); onHaState(); renderEnergy(); return; }
  ha.on((type, ...a) => { if (type === 'state') onHaState(a[0]); else if (type === 'states') { onHaState(); updateSun(); } else if (type === 'status') setHaStatus(...a); else if (type === 'error') toast(a[0], true); });
  try { await ha.connect(); } catch (e) { toast('Home Assistant 連唔到：' + e.message, true); }
  renderEnergy();
}
$('hastat').onclick = () => showPage('pset');

// ---------------------------------------------------------------- search (含語音)
const results = document.createElement('div'); results.className = 'sres'; results.hidden = true; document.body.appendChild(results);
function search(q) {
  q = q.trim().toLowerCase(); if (!q) { results.hidden = true; return; }
  const out = [];
  for (const f of H().floors) {
    for (const r of f.rooms) if ((r.name + ',' + (r.aliases || '')).toLowerCase().includes(q)) out.push({ icon: '▭', label: r.name, sub: f.name, go: () => openRoom(f, r) });
    for (const it of f.items) if (((it.name || '') + kindInfo(it.kind).zh + it.kind).toLowerCase().includes(q)) { const r = f.rooms.find(r => pointInPoly([it.x, it.y], r.poly)); out.push({ icon: '🛋', label: it.name || kindInfo(it.kind).zh, sub: `${f.name}${r ? ' · ' + r.name : ''}`, go: () => { setFloor(f.id, false); view.focusPoint(f, it.x, it.y, 0.6); toast(`${it.name || kindInfo(it.kind).zh} 喺${r ? '「' + r.name + '」' : f.name}`); } }); }
    for (const d of f.devices) { const fn = ha?.states.get(d.entity)?.attributes.friendly_name || ''; if ((d.name + d.entity + fn).toLowerCase().includes(q)) { const r = f.rooms.find(r => pointInPoly([d.x, d.y], r.poly)); out.push({ icon: deviceVisual(d, null).icon, label: d.name || fn || d.entity, sub: `${f.name}${r ? ' · ' + r.name : ''}`, go: () => { setFloor(f.id, false); openDevice(f, d); } }); } }
  }
  results.innerHTML = out.length ? '' : '<div class="mut" style="padding:10px 12px">搵唔到</div>';
  out.slice(0, 30).forEach((o, i) => { const b = document.createElement('button'); if (!i) b.className = 'on'; b.innerHTML = `<span>${o.icon}</span>${esc(o.label)}<small>${esc(o.sub)}</small>`; b.onclick = () => { results.hidden = true; $('q').blur(); if (ui.page !== 'p3d') showPage('p3d'); o.go(); }; results.appendChild(b); });
  const r = $('q').getBoundingClientRect(); results.style.top = r.bottom + 6 + 'px'; results.style.left = Math.max(8, Math.min(r.left, innerWidth - 260)) + 'px'; results.hidden = false;
  results._first = out[0];
}
$('q').addEventListener('input', e => search(e.target.value));
$('q').addEventListener('keydown', e => { if (e.key === 'Enter' && results._first) { results.hidden = true; $('q').blur(); if (ui.page !== 'p3d') showPage('p3d'); results._first.go(); } if (e.key === 'Escape') { results.hidden = true; $('q').blur(); } });
document.addEventListener('pointerdown', e => { if (!results.contains(e.target) && e.target !== $('q')) results.hidden = true; for (const p of ['stylepop', 'timepop']) if (!$(p).hidden && !$(p).contains(e.target) && !e.target.closest('#bstyle,#btime')) $(p).hidden = true; });
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
if (!SR) $('mic').hidden = true;
$('mic').onclick = () => {
  const rec = new SR(); rec.lang = 'zh-HK'; rec.interimResults = false; $('mic').textContent = '⏺';
  rec.onresult = e => { let t = e.results[0][0].transcript.replace(/[。？?！!]/g, '').replace(/^(我嘅|我的|我)?(.*?)(喺|在)?(邊度|边度|哪裡|哪里|邊|边)?$/, '$2'); $('q').value = t; search(t); if (results._first) { results.hidden = true; results._first.go(); } };
  rec.onend = () => $('mic').textContent = '🎙'; rec.onerror = () => toast('聽唔到，再試一次', true); rec.start();
};

// ---------------------------------------------------------------- editor toolbar
function setToolUI(t) { for (const b of $('toolbar').querySelectorAll('[data-tool]')) b.classList.toggle('on', b.dataset.tool === t); }
$('toolbar').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.tool) { editor.setTool(b.dataset.tool); setToolUI(b.dataset.tool); const hint = { select: '撳揀嘢 · 拖角改形 · 「+」加角 · 拖空白位移動畫面', room: '拖一個長方形畫房（會自動起牆）', wall: '逐點撳畫牆 · 雙擊或撳返起點完成 · Esc 取消', door: '撳牆上面加門', window: '撳牆上面加窗', opening: '撳牆上面加冇門嘅開口' }[b.dataset.tool]; $('edhint').textContent = hint; }
  if (b.dataset.x === 'furn') { editor.select(null, false); ui.insp = 'furn'; renderInspector(); }
  if (b.dataset.x === 'dev') { editor.select(null, false); ui.insp = 'dev'; renderInspector(); }
});
$('undo').onclick = () => store.undo() || toast('冇得再復原');
$('redo').onclick = () => store.redo() || toast('冇得再重做');
$('fit').onclick = () => editor.fit();
$('autow').onchange = e => editor.autoWalls = e.target.checked;
function apply3dToggle() { $('edbody').classList.toggle('with3d', ui.show3dInEdit); $('edside3d').style.display = ui.show3dInEdit ? '' : 'none'; $('tog3d').classList.toggle('on', ui.show3dInEdit); }
apply3dToggle();
$('tog3d').onclick = () => { ui.show3dInEdit = !ui.show3dInEdit; $('edbody').classList.toggle('with3d', ui.show3dInEdit); $('edside3d').style.display = ui.show3dInEdit ? '' : 'none'; $('tog3d').classList.toggle('on', ui.show3dInEdit); };
document.addEventListener('keydown', e => {
  if (e.target.closest('input,textarea,select')) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? store.redo() : store.undo(); return; }
  if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); store.redo(); return; }
  if (ui.page !== 'pedit') return;
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); editor.deleteSel(); }
  else if (e.key === 'Escape') { editor.endChain(); editor.setTool('select'); setToolUI('select'); editor.select(null); }
  else if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); editor.duplicateSel(); }
  else if (e.key.toLowerCase() === 'r') editor.rotateSel(e.shiftKey ? -90 : 90);
});

// ---------------------------------------------------------------- inspector
function fld(label, input) { return `<label class="fld"><span>${label}</span>${input}</label>`; }
const num = (key, val, step = 0.05, extra = '') => `<input type="number" data-f="${key}" value="${val ?? ''}" step="${step}" ${extra}>`;
const txt = (key, val, extra = '') => `<input data-f="${key}" value="${esc(val ?? '')}" ${extra}>`;
function areaOptions(cur) { return `<datalist id="dl-areas">${(ha?.areas || []).map(a => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('')}</datalist>`; }
function entityOptions() { return `<datalist id="dl-ents">${[...(ha?.states.values() || [])].map(s => `<option value="${esc(s.entity_id)}">${esc(s.attributes.friendly_name || '')}</option>`).join('')}</datalist>`; }

function renderInspector() {
  const el = $('insp'); if (ui.page !== 'pedit') return;
  const f = editor.floor, sel = editor.sel; let html = '';
  let target = null;
  if (sel) ui.insp = null;
  if (sel?.kind === 'room' && (target = f.rooms.find(r => r.id === sel.id))) {
    const r = target, bb = bbox(r.poly);
    html += `<div class="ttl">▭ 房間</div>
      ${fld('名', txt('name', r.name))}
      ${fld('語音別名（逗號分隔）', txt('aliases', r.aliases, 'placeholder="例如：大廳, living room"'))}
      ${fld('HA 區域', txt('area', r.area, 'list="dl-areas" placeholder="area_id"'))}${areaOptions()}
      ${fld('地台', `<select data-f="floorMat">${Object.entries(FLOOR_MATS).map(([k, v]) => `<option value="${k}" ${k === r.floorMat ? 'selected' : ''}>${v}</option>`).join('')}</select>`)}
      <div class="fld2">${fld('X (m)', num('bx', r3(bb.x0)))}${fld('Y (m)', num('by', r3(bb.y0)))}${fld('闊 (m)', num('bw', r3(bb.w), 0.05, 'min="0.3"'))}${fld('深 (m)', num('bd', r3(bb.h), 0.05, 'min="0.3"'))}</div>
      <div class="hint">面積 ${polyArea(r.poly).toFixed(2)} m² · ${r.poly.length} 隻角</div>
      <label class="fld" style="flex-direction:row;align-items:center;gap:8px;margin-top:10px"><input type="checkbox" data-f="checked" ${r.checked !== false ? 'checked' : ''}> <span style="font-size:13px;color:var(--ink)">已核對尺寸（牆厚、門口、窗位）</span></label>
      <label class="fld" style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" data-f="noWalls" ${r.noWalls ? 'checked' : ''}> <span style="font-size:13px;color:var(--ink)">戶外 / 冇牆（花園、露台）</span></label>
      <div class="btns"><button class="btn" data-a="walls">沿房邊起牆</button><button class="btn" data-a="autodev" ${r.area && ha ? '' : 'disabled'}>由 HA 區域放裝置</button><button class="btn danger" data-a="del">刪除</button></div>`;
  } else if (sel?.kind === 'wall' && (target = f.walls.find(w => w.id === sel.id))) {
    const w = target;
    html += `<div class="ttl">╱ 牆</div>
      <div class="fld2">${fld('長 (m)', num('len', r3(wallLen(w))))}${fld('厚 (cm)', num('tcm', Math.round((w.t || 0.12) * 100), 1, 'min="3"'))}</div>
      ${fld('高 (m)，留空跟樓層', num('h', w.h ?? '', 0.05, `placeholder="${f.height}"`))}
      <div class="hint">${w.openings.length} 個門窗 · 拖牆身平移，拖兩頭圓點改長度（會帶埋相連嘅牆同房角）</div>
      <div class="btns"><button class="btn" data-a="adddoor">加門</button><button class="btn" data-a="addwin">加窗</button><button class="btn danger" data-a="del">刪除</button></div>`;
  } else if (sel?.kind === 'opening') {
    const w = f.walls.find(w => w.openings.some(o => o.id === sel.id)); const o = target = w?.openings.find(o => o.id === sel.id);
    if (o) html += `<div class="ttl">${o.type === 'window' ? '🪟 窗' : o.type === 'door' ? '🚪 門' : '⬚ 開口'}</div>
      ${fld('類型', `<select data-f="type"><option value="door" ${o.type === 'door' ? 'selected' : ''}>門</option><option value="window" ${o.type === 'window' ? 'selected' : ''}>窗</option><option value="opening" ${o.type === 'opening' ? 'selected' : ''}>開口（冇門）</option></select>`)}
      <div class="fld2">${fld('闊 (m)', num('w', o.w))}${fld('高 (m)', num('h', o.h))}${fld('離地 (m)', num('sill', o.sill))}${fld('位置 (m)', num('at', r3(o.at)))}</div>
      ${o.type === 'door' ? `<div class="btns"><button class="btn" data-a="flip">換開門方向</button><button class="btn" data-a="hinge">門鉸換邊</button></div>` : ''}
      ${fld(o.type === 'window' ? '綁窗簾 / 窗磁（HA 實體）' : '綁門磁 / 門鎖（HA 實體）', txt('entity', o.entity, 'list="dl-ents" placeholder="binary_sensor.front_door"'))}${entityOptions()}
      <div class="hint">綁咗之後，3D 入面門會跟門磁開合；窗會跟窗簾位置。</div>
      <div class="btns"><button class="btn danger" data-a="del">刪除</button></div>`;
  } else if (sel?.kind === 'item' && (target = f.items.find(i => i.id === sel.id))) {
    const it = target, k = kindInfo(it.kind);
    html += `<div class="ttl">🛋 ${esc(it.name || k.zh)}</div>
      ${fld('名', txt('name', it.name))}
      ${fld('款', `<select data-f="kind">${Object.entries(KINDS).map(([id, v]) => `<option value="${id}" ${id === it.kind ? 'selected' : ''}>${v.cat} · ${v.zh}</option>`).join('')}</select>`)}
      <div class="fld2">${fld('闊 (m)', num('w', it.w || k.w))}${fld('深 (m)', num('d', it.d || k.d))}${fld('高 (m)', num('h', it.h || k.h))}${fld('離地 (m)', num('elev', it.elev || 0))}${fld('轉角 (°)', num('rot', it.rot || 0, 15))}${fld('顏色', `<input type="color" data-f="color" value="${it.color || '#8899aa'}">`)}</div>
      <div class="btns"><button class="btn" data-a="rot">轉 90°（R）</button><button class="btn" data-a="dup">複製</button><button class="btn" data-a="nocolor">跟風格顏色</button><button class="btn danger" data-a="del">刪除</button></div>`;
  } else if (sel?.kind === 'device' && (target = f.devices.find(d => d.id === sel.id))) {
    const d = target, st = ha?.states.get(d.entity);
    html += `<div class="ttl">${deviceVisual(d, st).icon} 裝置</div>
      ${fld('HA 實體', txt('entity', d.entity, 'list="dl-ents" placeholder="light.living_room"'))}${entityOptions()}
      ${fld('顯示名', txt('name', d.name, `placeholder="${esc(st?.attributes.friendly_name || '')}"`))}
      <div class="fld2">${fld('離地 (m)', num('z', d.z ?? 2.3))}${fld('方向 (°)', num('rot', d.rot || 0, 15))}</div>
      <div class="hint">${st ? `而家：${esc(st.state)}${st.attributes.unit_of_measurement ? ' ' + esc(st.attributes.unit_of_measurement) : ''}` : ha ? '搵唔到呢個實體' : '未連 Home Assistant'}${domainOf(d.entity) === 'camera' ? ' · 方向決定 3D 入面鏡頭視角' : ''}</div>
      <div class="btns"><button class="btn" data-a="dup">複製</button><button class="btn danger" data-a="del">刪除</button></div>`;
  } else if (ui.insp === 'furn') {
    const cats = {}; for (const [id, k] of Object.entries(KINDS)) (cats[k.cat] ||= []).push([id, k]);
    html += `<div class="ttl">🛋 加傢俬</div><div class="hint">撳一下會放喺畫面中間，再拖去位。</div><div class="palette">${Object.entries(cats).map(([c, ks]) => `<h5>${c}</h5>` + ks.map(([id, k]) => `<button data-add="${id}">${k.zh}</button>`).join('')).join('')}</div>`;
  } else if (ui.insp === 'dev') {
    const placed = new Set(H().floors.flatMap(f => f.devices.map(d => d.entity)));
    const avail = [...(ha?.states.values() || [])].filter(s => ['light', 'switch', 'cover', 'climate', 'camera', 'media_player', 'vacuum', 'fan', 'sensor', 'binary_sensor', 'lock'].includes(domainOf(s.entity_id)) && !placed.has(s.entity_id));
    html += `<div class="ttl">💡 加裝置</div>
      ${fld('HA 實體', `<input id="newent" list="dl-ents" placeholder="light.xxx">`)}${entityOptions()}
      <div class="btns"><button class="btn pri" data-a="adddev">放喺畫面中間</button><button class="btn" data-a="pickdev">撳平面圖揀位</button></div>
      <h4>未放嘅實體（${avail.length}）</h4>${avail.slice(0, 80).map(s => `<button class="chk" data-ent="${esc(s.entity_id)}"><i>${deviceVisual({ entity: s.entity_id }, s).icon}</i>${esc(s.attributes.friendly_name || s.entity_id)}<small>${esc(ha?.areas.find(a => a.id === ha.entityArea.get(s.entity_id))?.name || '')}</small></button>`).join('') || '<div class="hint">' + (ha ? '全部都放咗' : '未連 Home Assistant') + '</div>'}`;
  } else {
    const done = f.rooms.filter(r => r.checked !== false).length;
    html += `<div class="ttl">樓層</div>
      ${fld('名', `<input data-ff="name" value="${esc(f.name)}">`)}
      <div class="fld2">${fld('樓面高度 (m)', `<input type="number" step="0.05" data-ff="elev" value="${f.elev}">`)}${fld('樓底 (m)', `<input type="number" step="0.05" data-ff="height" value="${f.height}">`)}</div>
      <h4>核對清單 · ${done}/${f.rooms.length}</h4><div class="prog"><span style="width:${f.rooms.length ? done / f.rooms.length * 100 : 0}%"></span></div>
      ${f.rooms.map(r => `<button class="chk" data-room="${r.id}"><i>${r.checked !== false ? '✅' : '⬜'}</i>${esc(r.name)}<small>${polyArea(r.poly).toFixed(1)} m²</small></button>`).join('') || '<div class="hint">未有房間：撳上面「▭ 房間」拖一個長方形</div>'}
      <h4>底圖</h4>
      ${f.underlay ? `${fld('透明度', `<input type="range" min="0.05" max="1" step="0.05" data-ul="opacity" value="${f.underlay.opacity ?? 0.6}">`)}<div class="fld2">${fld('X', `<input type="number" step="0.05" data-ul="x" value="${r3(f.underlay.x)}">`)}${fld('Y', `<input type="number" step="0.05" data-ul="y" value="${r3(f.underlay.y)}">`)}${fld('闊 (m)', `<input type="number" step="0.05" data-ul="w" value="${r3(f.underlay.w)}">`)}</div>
        <div class="btns"><button class="btn" data-a="ultoggle">${f.underlay.show === false ? '顯示' : '隱藏'}</button><button class="btn danger" data-a="uldel">移除底圖</button></div>` : `<div class="hint">可以放一張平面圖相做底圖，再用「房間」工具描。</div>`}
      <div class="btns"><label class="btn">上傳底圖相<input type="file" accept="image/*" id="ulfile" hidden></label></div>
      <h4>工具</h4>
      <div class="btns"><button class="btn" data-a="rebuild">按房間重砌成層牆</button><button class="btn danger" data-a="delfloor" ${H().floors.length > 1 ? '' : 'disabled'}>刪除呢層</button></div>
      <div class="hint" style="margin-top:12px">快捷鍵：Delete 刪除 · R 轉 90° · Ctrl+D 複製 · Ctrl+Z 復原 · Esc 取消</div>`;
  }
  el.innerHTML = html;
  el.dataset.kind = sel?.kind || ui.insp || 'floor';
  el._target = target;
}
function bbox(p) { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const [x, y] of p) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } return { x0, y0, w: x1 - x0, h: y1 - y0 }; }
$('insp').addEventListener('change', e => {
  const el = e.target, f = editor.floor, sel = editor.sel, t = $('insp')._target;
  if (el.id === 'ulfile') return loadUnderlay(el.files[0]);
  if (el.dataset.ff) { const k = el.dataset.ff; f[k] = k === 'name' ? el.value : +el.value; store.commit(); renderChips(); return; }
  if (el.dataset.ul) { f.underlay[el.dataset.ul] = +el.value; if (el.dataset.ul === 'w' && f.underlay.aspect) f.underlay.h = f.underlay.w / f.underlay.aspect; store.commit(); return; }
  const k = el.dataset.f; if (!k || !t) return;
  const v = el.type === 'checkbox' ? el.checked : el.type === 'number' ? (el.value === '' ? null : +el.value) : el.value;
  if (sel.kind === 'room') {
    if (['bx', 'by', 'bw', 'bd'].includes(k)) {
      const bb = bbox(t.poly), nx = k === 'bx' ? v : bb.x0, ny = k === 'by' ? v : bb.y0, nw = k === 'bw' ? Math.max(0.3, v) : bb.w, nh = k === 'bd' ? Math.max(0.3, v) : bb.h;
      t.poly = t.poly.map(([x, y]) => [r3(nx + (x - bb.x0) * nw / (bb.w || 1)), r3(ny + (y - bb.y0) * nh / (bb.h || 1))]);
    } else t[k] = v;
  } else if (sel.kind === 'wall') {
    if (k === 'len') { const L = wallLen(t) || 1; t.b = [r3(t.a[0] + (t.b[0] - t.a[0]) / L * v), r3(t.a[1] + (t.b[1] - t.a[1]) / L * v)]; }
    else if (k === 'tcm') t.t = v / 100; else t[k] = v || null;
  } else if (sel.kind === 'item') { t[k] = k === 'h' && v === kindInfo(t.kind).h ? 0 : v; if (k === 'kind') { const kk = KINDS[v]; t.w = kk.w; t.d = kk.d; t.h = 0; if (!t.name || Object.values(KINDS).some(x => x.zh === t.name)) t.name = kk.zh; } }
  else t[k] = v;
  store.commit(); editor.render();
  if (['kind', 'type', 'name'].includes(k) || sel.kind === 'room') renderInspector();
  if (sel.kind === 'room') renderChips();
});
$('insp').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  const f = editor.floor, sel = editor.sel, t = $('insp')._target, a = b.dataset.a;
  if (b.dataset.add) return editor.addItem(b.dataset.add);
  if (b.dataset.room) return editor.select({ kind: 'room', id: b.dataset.room });
  if (b.dataset.ent) { const st = ha?.states.get(b.dataset.ent); const r = f.rooms.find(r => r.area && r.area === ha?.entityArea.get(b.dataset.ent)); const c = r ? polyCentroid(r.poly) : null; editor.addDevice(b.dataset.ent, '', defaultZ(b.dataset.ent), c); return; }
  if (!a) return;
  if (a === 'del') return editor.deleteSel();
  if (a === 'dup') return editor.duplicateSel();
  if (a === 'rot') return editor.rotateSel(90);
  if (a === 'nocolor') { t.color = ''; store.commit(); renderInspector(); return; }
  if (a === 'flip') t.flip = !t.flip;
  if (a === 'hinge') t.hinge = t.hinge === 'r' ? 'l' : 'r';
  if (a === 'walls') { const n = addWallsForRoom(f, t); toast(n ? `加咗 ${n} 幅牆` : '房邊已經有牆'); }
  if (a === 'adddoor' || a === 'addwin') { const L = wallLen(t); t.openings.push({ id: uid('o'), type: a === 'adddoor' ? 'door' : 'window', at: r3(L / 2), w: a === 'adddoor' ? 0.9 : 1.2, h: a === 'adddoor' ? 2.1 : 1.2, sill: a === 'adddoor' ? 0 : 0.9, hinge: 'l', flip: false, entity: '' }); }
  if (a === 'autodev') { const n = autoPlace(f, t); toast(n ? `放咗 ${n} 個裝置` : '呢個區域冇新裝置'); }
  if (a === 'adddev') { const v = $('newent').value.trim(); if (!v) return toast('打個實體 ID 先'); editor.addDevice(v, '', defaultZ(v)); return; }
  if (a === 'pickdev') { const v = $('newent').value.trim(); if (!v) return toast('打個實體 ID 先'); ui.pickCb = p => editor.addDevice(v, '', defaultZ(v), p); editor.setTool('pick'); $('edhint').textContent = '撳平面圖揀裝置位置'; return; }
  if (a === 'rebuild') { if (!confirm('會按房間外框重新砌晒呢層嘅牆（門窗會盡量保留），繼續？')) return; const lost = rebuildWalls(f); toast(lost ? `有 ${lost} 個門窗搵唔到新牆` : '重砌好'); }
  if (a === 'ultoggle') f.underlay.show = f.underlay.show === false;
  if (a === 'uldel') delete f.underlay;
  if (a === 'delfloor') { if (!confirm(`刪除「${f.name}」？`)) return; H().floors = H().floors.filter(x => x !== f); store.commit(); setFloor(H().floors[0].id); return; }
  store.commit(); editor.render(); renderInspector();
});
function defaultZ(e) { return { light: 2.4, camera: 2.3, climate: 2.2, vacuum: 0.05, cover: 2.3, binary_sensor: 2.0, lock: 1.1, media_player: 1.0 }[domainOf(e)] ?? 1.4; }
function autoPlace(f, r) {
  const placed = new Set(H().floors.flatMap(f => f.devices.map(d => d.entity)));
  const ents = [...ha.entityArea].filter(([e, a]) => a === r.area && !placed.has(e) && ['light', 'switch', 'cover', 'climate', 'camera', 'media_player', 'vacuum', 'fan', 'sensor', 'binary_sensor', 'lock'].includes(domainOf(e))).map(([e]) => e);
  const bb = bbox(r.poly), n = ents.length, cols = Math.ceil(Math.sqrt(n || 1)), rows = Math.ceil(n / cols);
  ents.forEach((e, i) => {
    const cx = bb.x0 + bb.w * ((i % cols) + 0.5) / cols, cy = bb.y0 + bb.h * (Math.floor(i / cols) + 0.5) / rows;
    f.devices.push({ id: uid('d'), entity: e, name: '', x: r3(cx), y: r3(cy), z: defaultZ(e), rot: 0 });
  });
  return n;
}
async function loadUnderlay(file) {
  if (!file) return; const f = editor.floor;
  const url = await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file); });
  const img = new Image(); img.src = url; await img.decode();
  // 縮細存起
  const s = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = img.width * s; c.height = img.height * s;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
  const wm = +prompt('呢張圖實際有幾闊（米）？之後都可以喺「底圖」再改', '10') || 10;
  f.underlay = { src: c.toDataURL('image/jpeg', 0.82), x: 0, y: 0, w: wm, h: wm * img.height / img.width, aspect: img.width / img.height, opacity: 0.6 };
  store.commit(); editor.fit(); renderInspector();
}

// ---------------------------------------------------------------- import page
const drop = $('drop');
['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => e.dataTransfer.files[0] && doImport(e.dataTransfer.files[0]));
$('file').addEventListener('change', e => { e.target.files[0] && doImport(e.target.files[0]); e.target.value = ''; });
let pending = null;
async function doImport(file) {
  const res = $('result'); res.innerHTML = `<div class="card">讀緊 ${esc(file.name)}…</div>`;
  try {
    pending = await importFile(file);
    const r = pending.report;
    res.innerHTML = `<div class="card"><small>${esc(pending.source)}</small><b>${esc(file.name)}</b>
      <div class="stats"><div><b>${r.floors}</b>樓層</div><div><b>${r.rooms}</b>房間</div><div><b>${r.walls}</b>牆</div><div><b>${r.doors}</b>門</div><div><b>${r.windows}</b>窗</div><div><b>${r.items}</b>傢俬</div></div>
      <ul class="warns">${pending.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>
      <div class="btns"><button class="btn pri" data-imp="new">加做新樓層</button><button class="btn" data-imp="replace">取代「${esc(currentFloor().name)}」</button>${pending.home ? '<button class="btn" data-imp="home">取代成間屋</button>' : ''}<button class="btn" data-imp="cancel">取消</button></div></div>`;
  } catch (e) { console.error(e); res.innerHTML = `<div class="card" style="border-color:var(--bad)"><b>匯入唔到</b><p>${esc(e.message)}</p></div>`; pending = null; }
}
function currentFloor() { return H().floors.find(f => f.id === ui.floor) || H().floors[0]; }
$('result').addEventListener('click', e => {
  const b = e.target.closest('[data-imp]'); if (!b || !pending) return;
  const mode = b.dataset.imp; if (mode === 'cancel') { $('result').innerHTML = ''; pending = null; return; }
  const fs = pending.floors; let first;
  if (mode === 'home') { store.replace(pending.home); first = pending.home.floors[0]; }
  else if (mode === 'replace') {
    const cur = currentFloor(), idx = H().floors.indexOf(cur);
    const nf = fs.map((f, i) => ({ ...f, elev: i ? f.elev : cur.elev, name: i ? f.name : cur.name }));
    H().floors.splice(idx, 1, ...nf); first = nf[0]; store.commit();
  } else {
    const top = H().floors.reduce((m, f) => Math.max(m, f.elev + f.height + 0.3), 0);
    let el = top; for (const f of fs) { f.elev = r3(el); el += f.height + 0.3; H().floors.push(f); } first = fs[0]; store.commit();
  }
  if (pending.object) { view.setReference(pending.object); pending.object.position.y += first.elev; toast('參考模型只係今次顯示，唔會儲存'); }
  pending = null; $('result').innerHTML = '';
  ui.floor = first.id; showPage('pedit'); setFloor(first.id); editor.select(null);
  toast('匯入咗：請逐間房核對（右邊有核對清單）');
});
$('aispec').textContent = JSON.stringify({
  name: '我屋企',
  floors: [{
    name: '地下', height: 2.7,
    rooms: [
      { name: '客廳', x: 0, y: 0, w: 5.2, d: 4.0, floorMat: 'wood', area: 'living_room' },
      { name: '睡房', x: 0, y: 4.0, w: 3.4, d: 3.0, floorMat: 'carpet' },
      { name: '廚房', poly: [[5.2, 0], [7.6, 0], [7.6, 3.0], [5.2, 3.0]], floorMat: 'tile' },
    ],
    doors: [{ between: ['客廳', '睡房'] }, { at: [6.4, 3.0], w: 0.8 }],
    windows: [{ at: [2.6, 0], w: 2.0 }, { at: [0, 5.5], w: 1.2, sill: 0.9 }],
    furniture: [{ kind: 'sofa', x: 2.6, y: 3.2, w: 2.0, d: 0.9, rot: 180 }, { kind: 'bed', x: 1.7, y: 5.8, rot: 180 }],
    devices: [{ entity: 'light.living_room', x: 2.6, y: 2.0, z: 2.5 }],
  }],
  _說明: '單位米；x 向右、y 向下；rot 係順時針角度；冇寫 walls 會由房間自動起牆。傢俬 kind：' + Object.keys(KINDS).join(', '),
}, null, 2);

// ---------------------------------------------------------------- settings page
function renderSettings() {
  const s = S(), c = haCfg(), mixed = location.protocol === 'https:' && /^http:/i.test(c.url || '');
  const ent = k => `<input data-en="${k}" list="dl-ents" value="${esc(s.energy?.[k] || '')}" placeholder="sensor.xxx">`;
  $('setwrap').innerHTML = `
    <h2>設定</h2><p class="lead">全部設定同平面圖都存喺呢部機嘅瀏覽器。換機用「匯出 / 匯入」。</p>
    <h3>Home Assistant</h3>
    <div class="card">
      <div class="row" style="margin-bottom:8px"><label><input type="radio" name="ham" value="demo" ${(c.mode || 'demo') === 'demo' ? 'checked' : ''}> 示範模式（假裝置，試玩用）</label><label><input type="radio" name="ham" value="ha" ${c.mode === 'ha' ? 'checked' : ''}> 連我嘅 HA</label><label><input type="radio" name="ham" value="off" ${c.mode === 'off' ? 'checked' : ''}> 唔連</label></div>
      ${fld('HA 網址', `<input id="haurl" value="${esc(c.url || '')}" placeholder="http://homeassistant.local:8123">`)}
      ${fld('長期存取權杖（Long-lived access token）', `<input id="hatok" type="password" value="${esc(c.token || '')}" placeholder="HA → 個人資料 → 安全 → 建立權杖">`)}
      <div class="btns"><button class="btn pri" id="hasave">儲存並連線</button><span class="mut" style="align-self:center">狀態：${esc($('hastat').textContent)}${ha?.haVersion ? ' · HA ' + esc(ha.haVersion) : ''} ${esc(ha?.statusMsg || '')}</span></div>
      ${mixed ? `<p class="hint" style="color:var(--warn)">⚠️ 呢頁係 https，而 HA 係 http：瀏覽器會擋。請將 <code>home/</code> 資料夾放入 HA 嘅 <code>/config/www/home3d/</code>，再開 <code>${esc((c.url || 'http://ha:8123').replace(/\/$/, ''))}/local/home3d/index.html</code>；或者 HA 用 https（例如 Nabu Casa）。</p>` : ''}
      <p class="hint">權杖只存喺呢部機。想喺 HA 側欄直接用：設定 → 儀表板 → 新增 → 「網頁」，網址填上面 /local/home3d/index.html。牆上平板開呢頁就係全屋中控。</p>
    </div>
    <h3>能源列</h3>
    <div class="card"><div class="fld2">${fld('全屋用電', ent('consumption'))}${fld('電網', ent('grid'))}${fld('太陽能', ent('solar'))}${fld('電池功率', ent('battery'))}${fld('電池 %', ent('battery_soc'))}${fld('電價', ent('tariff'))}</div>${entityOptions()}<p class="hint">留空就唔顯示。</p></div>
    <h3>風格</h3>
    <div class="card">
      <div class="fld2">${fld('而家用', `<select data-s="theme">${Object.entries(THEMES).map(([id, t]) => `<option value="${id}" ${id === s.theme ? 'selected' : ''}>${t.zh} · ${t.name}</option>`).join('')}</select>`)}
      <label class="fld"><span>跟太陽日夜自動換</span><input type="checkbox" data-s="autoTheme" ${s.autoTheme ? 'checked' : ''}></label>
      ${fld('日頭', `<select data-s="dayTheme">${Object.entries(THEMES).map(([id, t]) => `<option value="${id}" ${id === s.dayTheme ? 'selected' : ''}>${t.zh}</option>`).join('')}</select>`)}
      ${fld('夜晚', `<select data-s="nightTheme">${Object.entries(THEMES).map(([id, t]) => `<option value="${id}" ${id === s.nightTheme ? 'selected' : ''}>${t.zh}</option>`).join('')}</select>`)}</div>
      <h4 class="mut" style="margin:12px 0 4px;font-size:12px">自己調（留空跟風格）</h4>
      <div class="fld2">${['wall:牆色', 'wood:木色', 'fabric:布料', 'cabinet:櫃色'].map(x => { const [k, l] = x.split(':'); return fld(l, `<div class="row" style="flex-wrap:nowrap"><input type="color" data-c="${k}" value="${s.custom?.[k] || '#cccccc'}" style="flex:1"><button class="btn" data-cx="${k}" ${s.custom?.[k] ? '' : 'disabled'}>✕</button></div>`); }).join('')}</div>
    </div>
    <h3>位置（計太陽）</h3>
    <div class="card"><div class="fld2">${fld('緯度', `<input type="number" step="0.01" data-s="lat" value="${s.lat}">`)}${fld('經度', `<input type="number" step="0.01" data-s="lon" value="${s.lon}">`)}${fld('北方（平面圖向上轉幾多度）', `<input type="number" step="5" data-s="north" value="${s.north}">`)}</div>
      <div class="btns"><button class="btn" id="geo">用我而家位置</button></div><p class="hint">有連 HA 嘅話，「而家」會直接用 sun.sun 嘅太陽位置。</p></div>
    <h3>資料</h3>
    <div class="card">${fld('屋名', `<input data-s="__name" value="${esc(H().name)}">`)}
      <div class="btns"><button class="btn" id="exp">匯出 plan (.json)</button><button class="btn" id="sample">載入示範屋</button><button class="btn danger" id="blank">清空，重新畫</button></div>
      ${store.saveError ? '<p class="hint" style="color:var(--bad)">⚠️ 瀏覽器儲存位唔夠（底圖太大？），最新改動未存到，請匯出備份。</p>' : ''}</div>`;
}
$('setwrap').addEventListener('change', e => {
  const el = e.target, s = S();
  if (el.name === 'ham') { const c = haCfg(); c.mode = el.value; saveHaCfg(c); startHA(); return; }
  if (el.dataset.en) { s.energy = { ...s.energy, [el.dataset.en]: el.value.trim() }; store.commit('settings'); renderEnergy(); return; }
  if (el.dataset.c) { s.custom = { ...(s.custom || {}), [el.dataset.c]: el.value }; store.commit('settings'); applyTheme(); renderSettings(); return; }
  if (el.dataset.s) {
    const k = el.dataset.s; if (k === '__name') { H().name = el.value; store.commit(); return; }
    s[k] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? +el.value : el.value; store.commit('settings');
    if (['lat', 'lon', 'north'].includes(k)) { view.needBuild = true; updateSun(); } else applyTheme();
  }
});
$('setwrap').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return; const s = S();
  if (b.id === 'hasave') { const c = haCfg(); c.url = $('haurl').value.trim(); c.token = $('hatok').value.trim(); c.mode = c.url && c.token ? 'ha' : (c.mode || 'demo'); if (c.mode === 'ha' && !(c.url && c.token)) return toast('要填網址同權杖', true); saveHaCfg(c); startHA(); toast('儲存咗，連線中…'); }
  if (b.dataset.cx) { const c = { ...(s.custom || {}) }; delete c[b.dataset.cx]; s.custom = c; store.commit('settings'); applyTheme(); renderSettings(); }
  if (b.id === 'geo') navigator.geolocation?.getCurrentPosition(p => { s.lat = +p.coords.latitude.toFixed(3); s.lon = +p.coords.longitude.toFixed(3); store.commit('settings'); renderSettings(); updateSun(); toast('已更新位置'); }, () => toast('攞唔到位置', true));
  if (b.id === 'exp') { const blob = new Blob([JSON.stringify(H(), null, 1)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${H().name || 'home'}.home3d.json`; a.click(); }
  if (b.id === 'sample') { if (confirm('用示範屋取代而家嘅平面圖？（可以 Ctrl+Z 復原）')) { store.replace(sampleHome()); setFloor('all'); view.framed = false; toast('載入咗示範屋'); } }
  if (b.id === 'blank') { if (confirm('清空晒所有樓層？（可以 Ctrl+Z 復原）')) { const h = { v: 1, name: '我的家', floors: [newFloor('地下', 0)], settings: S() }; store.replace(h); showPage('pedit'); editor.setTool('room'); setToolUI('room'); toast('用「房間」工具開始畫'); } }
});

// ---------------------------------------------------------------- store events
store.on(kind => {
  if (kind === 'saveError') { toast('瀏覽器儲存位唔夠，請匯出備份', true); return; }
  view.setHome(H());
  if (kind === 'replace') {
    if (!H().floors.some(f => f.id === ui.floor) && ui.floor !== 'all') ui.floor = H().floors[0].id;
    if (ui.page === 'pedit') { editor.setFloor(ui.floor); renderInspector(); }
    view.setFloor(ui.floor); applyTheme();
  } else if (ui.page === 'pedit') editor.render();
  renderChips();
});

// ---------------------------------------------------------------- boot
ui.floor = H().floors[0].id; view.setFloor(ui.floor);
view.setHome(H()); applyTheme(); updateSun(); renderChips(); renderEnergy();
startHA();
const hash = location.hash.slice(1); if (['p3d', 'pedit', 'pimport', 'pset'].includes(hash)) showPage(hash);
window.home3d = { store, view, editor, get ha() { return ha; } }; // 方便除錯

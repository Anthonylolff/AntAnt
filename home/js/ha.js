// Home Assistant 連線（WebSocket API）+ 冇 HA 時用嘅示範模式。
// 兩個 class 介面一樣：states (Map)、areas、entityArea、on(fn)、callService()、cameraUrl()。

class Emitter {
  constructor() { this.fns = new Set(); }
  on(fn) { this.fns.add(fn); return () => this.fns.delete(fn); }
  emit(...a) { for (const f of this.fns) try { f(...a); } catch (e) { console.error(e); } }
}

export class HAConnection extends Emitter {
  constructor(url, token) {
    super();
    this.base = url.replace(/\/+$/, ''); this.token = token;
    this.states = new Map(); this.areas = []; this.entityArea = new Map(); this.status = 'idle';
    this.id = 1; this.pending = new Map(); this.closed = false; this.retry = 0;
  }
  get demo() { return false; }
  wsUrl() { return this.base.replace(/^http/, 'ws') + '/api/websocket'; }
  connect() {
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (err) => { if (settled) return; settled = true; err ? reject(err) : resolve(); };
      this.setStatus('connecting');
      let ws;
      try { ws = new WebSocket(this.wsUrl()); } catch (e) { this.setStatus('error', e.message); return done(e); }
      this.ws = ws;
      ws.onmessage = ev => {
        const m = JSON.parse(ev.data);
        if (m.type === 'auth_required') ws.send(JSON.stringify({ type: 'auth', access_token: this.token }));
        else if (m.type === 'auth_invalid') { this.closed = true; this.setStatus('error', 'Token 唔啱（auth_invalid）'); ws.close(); done(new Error('auth_invalid')); }
        else if (m.type === 'auth_ok') { this.retry = 0; this.haVersion = m.ha_version; this.afterAuth().then(() => done(), done); }
        else if (m.type === 'result' || m.type === 'event') {
          const p = this.pending.get(m.id);
          if (m.type === 'event' && m.event?.event_type === 'state_changed') this.onStateChanged(m.event.data);
          else if (p) { this.pending.delete(m.id); m.success ? p.res(m.result) : p.rej(new Error(m.error?.message || 'HA error')); }
        } else if (m.type === 'pong') { /* keepalive */ }
      };
      ws.onerror = () => { this.setStatus('error', '連唔到 ' + this.wsUrl()); done(new Error('ws error')); };
      ws.onclose = () => {
        clearInterval(this.ping);
        for (const p of this.pending.values()) p.rej(new Error('closed')); this.pending.clear();
        if (this.closed) return;
        this.setStatus('reconnecting');
        const wait = Math.min(30000, 1000 * 2 ** this.retry++);
        setTimeout(() => !this.closed && this.connect().catch(() => { }), wait);
      };
    });
  }
  send(msg) {
    return new Promise((res, rej) => {
      if (this.ws?.readyState !== 1) return rej(new Error('未連線'));
      const id = this.id++; this.pending.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, ...msg }));
    });
  }
  async afterAuth() {
    const [states, areas, ents, devs] = await Promise.all([
      this.send({ type: 'get_states' }),
      this.send({ type: 'config/area_registry/list' }).catch(() => []),
      this.send({ type: 'config/entity_registry/list' }).catch(() => []),
      this.send({ type: 'config/device_registry/list' }).catch(() => []),
    ]);
    this.states = new Map(states.map(s => [s.entity_id, s]));
    this.areas = areas.map(a => ({ id: a.area_id, name: a.name, aliases: a.aliases || [] }));
    const devArea = new Map(devs.map(d => [d.id, d.area_id]));
    this.entityArea = new Map();
    for (const e of ents) { const a = e.area_id || devArea.get(e.device_id); if (a) this.entityArea.set(e.entity_id, a); }
    const sub = this.id; await this.send({ type: 'subscribe_events', event_type: 'state_changed' });
    this.pending.set(sub, { res() { }, rej() { } });
    this.ping = setInterval(() => this.ws?.readyState === 1 && this.ws.send(JSON.stringify({ id: this.id++, type: 'ping' })), 30000);
    this.setStatus('connected');
    this.emit('states');
  }
  onStateChanged(d) {
    if (d.new_state) this.states.set(d.entity_id, d.new_state); else this.states.delete(d.entity_id);
    this.emit('state', d.entity_id);
  }
  setStatus(s, msg = '') { this.status = s; this.statusMsg = msg; this.emit('status', s, msg); }
  callService(domain, service, data = {}, target) {
    return this.send({ type: 'call_service', domain, service, service_data: data, ...(target ? { target } : {}) }).catch(e => this.emit('error', e.message));
  }
  cameraUrl(eid) {
    const st = this.states.get(eid); const tok = st?.attributes?.access_token;
    return tok ? `${this.base}/api/camera_proxy/${eid}?token=${tok}&t=${Date.now()}` : null;
  }
  close() { this.closed = true; clearInterval(this.ping); this.ws?.close(); this.setStatus('idle'); }
}

// ------------------------------------------------------------------ 示範模式
export class DemoHA extends Emitter {
  constructor(home) {
    super();
    this.status = 'demo'; this.states = new Map(); this.entityArea = new Map(); this.areas = [];
    const names = {};
    for (const f of home.floors) for (const r of f.rooms) if (r.area) { this.areas.push({ id: r.area, name: r.name, aliases: [] }); names[r.area] = r.name; }
    const S = (id, state, attributes = {}, area) => { this.states.set(id, { entity_id: id, state: String(state), attributes: { friendly_name: attributes.friendly_name || id, ...attributes }, last_changed: new Date().toISOString() }); if (area) this.entityArea.set(id, area); };
    const L = (id, n, area, on, extra = {}) => S(id, on ? 'on' : 'off', { friendly_name: n, brightness: on ? 200 : null, color_temp_kelvin: 2900, min_color_temp_kelvin: 2200, max_color_temp_kelvin: 6500, supported_color_modes: ['color_temp', 'rgb'], ...extra }, area);
    L('light.living_ceiling', '客廳主燈', 'living_room', true); L('light.living_led', 'LED 燈帶', 'living_room', true, { rgb_color: [90, 200, 255], brightness: 170 }); L('light.dining', '餐枱吊燈', 'living_room', true, { brightness: 140 });
    L('light.kitchen', '廚房燈', 'kitchen', true); L('light.hallway', '走廊燈', 'hallway', false); L('light.bathroom', '浴室燈', 'bathroom', false);
    L('light.bedroom', '睡房燈', 'bedroom', false); L('light.study', '書房燈', 'study', true, { brightness: 230, color_temp_kelvin: 4500 }); L('light.garden', '花園燈', 'garden', false);
    L('light.master', '主人房燈', 'master_bedroom', false); L('light.master_bath', '主人浴室燈', 'master_bath', false); L('light.kids', '小朋友房燈', 'kids_room', true, { rgb_color: [255, 120, 200], brightness: 120 }); L('light.playroom', '遊戲室燈', 'playroom', false);
    S('cover.living_blinds', 'open', { friendly_name: '客廳窗簾', current_position: 70 }, 'living_room'); S('cover.master_blinds', 'closed', { friendly_name: '主人房窗簾', current_position: 0 }, 'master_bedroom');
    const C = (id, n, area, st, cur, t) => S(id, st, { friendly_name: n, current_temperature: cur, temperature: t, hvac_modes: ['off', 'cool', 'dry', 'fan_only', 'heat', 'auto'] }, area);
    C('climate.living_ac', '客廳冷氣', 'living_room', 'cool', 24.5, 24); C('climate.bedroom_ac', '睡房冷氣', 'bedroom', 'off', 26.1, 25); C('climate.master_ac', '主人房冷氣', 'master_bedroom', 'off', 25.4, 24);
    S('camera.living', 'idle', { friendly_name: '客廳鏡頭' }, 'living_room'); S('camera.balcony', 'idle', { friendly_name: '露台鏡頭' }, 'balcony');
    S('media_player.tv', 'playing', { friendly_name: '電視', media_title: '晚間新聞', volume_level: 0.3 }, 'living_room'); S('media_player.playroom', 'off', { friendly_name: '遊戲室喇叭', volume_level: 0.4 }, 'playroom');
    S('switch.tv', 'on', { friendly_name: '電視插座' }, 'living_room'); S('switch.study_pc', 'on', { friendly_name: '電腦' }, 'study');
    S('vacuum.robot', 'docked', { friendly_name: '掃地機', battery_level: 96 }, 'living_room');
    const P = (id, n, area, v, dc = 'power', unit = 'W') => S(id, v, { friendly_name: n, device_class: dc, unit_of_measurement: unit, state_class: 'measurement' }, area);
    P('sensor.living_temp', '客廳溫度', 'living_room', 24.6, 'temperature', '°C'); P('sensor.kids_temp', '小朋友房溫度', 'kids_room', 25.3, 'temperature', '°C');
    P('sensor.bathroom_humidity', '浴室濕度', 'bathroom', 68, 'humidity', '%');
    P('sensor.oven_power', '焗爐用電', 'kitchen', 900); P('sensor.washer_power', '洗衣機用電', 'laundry', 420); P('sensor.solar_power', '太陽能發電', 'balcony', 1500);
    P('sensor.house_power', '全屋用電', null, 1700); P('sensor.grid_power', '電網輸入', null, 420); P('sensor.battery_power', '電池', null, 300); P('sensor.battery_soc', '電池電量', null, 64, 'battery', '%');
    S('sensor.electricity_price', '1.38', { friendly_name: '電價', unit_of_measurement: 'HK$/kWh' });
    S('binary_sensor.front_door', 'off', { friendly_name: '大門', device_class: 'door' }, 'hallway'); S('binary_sensor.balcony_door', 'on', { friendly_name: '露台門', device_class: 'door' }, 'balcony');
    S('lock.front_door', 'locked', { friendly_name: '門鎖' }, 'hallway');
    S('sun.sun', 'above_horizon', { friendly_name: '太陽' });
    // 示範：用電數字每幾秒浮動
    this.timer = setInterval(() => {
      for (const id of ['sensor.oven_power', 'sensor.washer_power', 'sensor.house_power', 'sensor.grid_power', 'sensor.solar_power']) {
        const st = this.states.get(id); const v = +st.state; if (!v) continue;
        this.set(id, Math.max(0, Math.round(v * (0.94 + Math.random() * 0.12))));
      }
    }, 4000);
  }
  get demo() { return true; }
  connect() { this.emit('status', 'demo'); this.emit('states'); return Promise.resolve(); }
  set(id, state, attrs) {
    const st = this.states.get(id); if (!st) return;
    this.states.set(id, { ...st, state: String(state), attributes: { ...st.attributes, ...(attrs || {}) }, last_changed: new Date().toISOString() });
    this.emit('state', id);
  }
  callService(domain, service, data = {}, target = {}) {
    const ids = [].concat(target.entity_id || data.entity_id || []);
    for (const id of ids) {
      const st = this.states.get(id); if (!st) continue; const a = st.attributes;
      const on = st.state === 'on';
      if (service === 'toggle') this.set(id, on ? 'off' : 'on', domain === 'light' && !on ? { brightness: a.brightness || 200 } : {});
      else if (service === 'turn_on') {
        if (domain === 'climate') this.set(id, 'cool');
        else if (domain === 'media_player') this.set(id, 'playing');
        else {
          const x = {}; if (data.brightness_pct != null) x.brightness = Math.round(data.brightness_pct * 2.55); else if (!a.brightness) x.brightness = 200;
          if (data.color_temp_kelvin) { x.color_temp_kelvin = data.color_temp_kelvin; x.rgb_color = null; } if (data.rgb_color) x.rgb_color = data.rgb_color;
          this.set(id, 'on', x);
        }
      } else if (service === 'turn_off') this.set(id, 'off');
      else if (service === 'open_cover') this.set(id, 'open', { current_position: 100 });
      else if (service === 'close_cover') this.set(id, 'closed', { current_position: 0 });
      else if (service === 'stop_cover') this.set(id, st.state);
      else if (service === 'set_cover_position') this.set(id, data.position > 0 ? 'open' : 'closed', { current_position: data.position });
      else if (service === 'set_temperature') this.set(id, st.state === 'off' ? 'cool' : st.state, { temperature: data.temperature });
      else if (service === 'set_hvac_mode') this.set(id, data.hvac_mode);
      else if (service === 'start') this.set(id, 'cleaning');
      else if (service === 'pause') this.set(id, 'paused');
      else if (service === 'return_to_base') this.set(id, 'returning'), setTimeout(() => this.set(id, 'docked'), 3000);
      else if (service === 'lock') this.set(id, 'locked');
      else if (service === 'unlock') this.set(id, 'unlocked');
      else if (service === 'media_play_pause') this.set(id, st.state === 'playing' ? 'paused' : 'playing');
      else if (service === 'volume_set') this.set(id, st.state, { volume_level: data.volume_level });
    }
    return Promise.resolve();
  }
  cameraUrl(eid) {
    const c = document.createElement('canvas'); c.width = 640; c.height = 360; const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, 360); gr.addColorStop(0, '#2b3445'); gr.addColorStop(1, '#151a24'); g.fillStyle = gr; g.fillRect(0, 0, 640, 360);
    g.fillStyle = '#3b4558'; g.fillRect(60, 210, 300, 90); g.fillRect(80, 170, 260, 50); g.fillStyle = '#222a37'; g.fillRect(420, 120, 160, 110);
    g.fillStyle = 'rgba(255,200,120,.12)'; g.beginPath(); g.arc(500, 60, 90, 0, 7); g.fill();
    g.fillStyle = '#fff'; g.font = '22px monospace'; g.fillText(`${(this.states.get(eid)?.attributes.friendly_name || eid)}  ${new Date().toLocaleTimeString('en-GB')}`, 16, 34);
    g.fillStyle = '#f44'; g.beginPath(); g.arc(620, 26, 7, 0, 7); g.fill();
    return c.toDataURL('image/jpeg', 0.8);
  }
  close() { clearInterval(this.timer); }
}

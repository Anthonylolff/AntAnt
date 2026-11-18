// Home Assistant 實體：圖示、狀態文字、控制面板。
export const domainOf = e => (e || '').split('.')[0];
const ICON = {
  light: '💡', switch: '🔌', cover: '🪟', climate: '❄️', camera: '📷', media_player: '📺', vacuum: '🧹', fan: '🌀',
  sensor: '📈', binary_sensor: '🚪', lock: '🔒', person: '🧑', scene: '🎬', script: '📜', water_heater: '♨️', humidifier: '💧',
};
export function fmtNum(v, unit) {
  const n = +v; if (!isFinite(n)) return v;
  if (unit === 'W' && Math.abs(n) >= 1000) return (n / 1000).toFixed(1) + ' kW';
  return (Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 10) / 10) + (unit ? (unit.length > 2 || /[a-z]/i.test(unit[0]) ? ' ' : '') + unit : '');
}
export function deviceVisual(d, st) {
  const domain = domainOf(d.entity); const a = st?.attributes || {};
  let icon = ICON[domain] || '•', text = '', on = false, color = null, level = 1;
  if (!st) return { domain, icon, text: d.entity ? '' : '?', on, color, level };
  const s = st.state;
  switch (domain) {
    case 'light':
      on = s === 'on'; level = on ? (a.brightness ?? 255) / 255 : 0;
      if (on && a.rgb_color) color = `rgb(${a.rgb_color.join(',')})`;
      else if (on && a.color_temp_kelvin) color = kelvinToRgb(a.color_temp_kelvin);
      text = on && a.brightness != null ? Math.round(level * 100) + '%' : ''; break;
    case 'switch': case 'fan': case 'input_boolean': on = s === 'on'; break;
    case 'cover': on = s === 'open' || s === 'opening'; text = a.current_position != null ? a.current_position + '%' : (on ? '開' : '關'); break;
    case 'climate': on = s !== 'off'; text = a.current_temperature != null ? fmtNum(a.current_temperature, '°') : (a.temperature != null ? a.temperature + '°' : ''); icon = s === 'heat' ? '🔥' : '❄️'; break;
    case 'sensor': text = fmtNum(s, a.unit_of_measurement); on = a.device_class === 'power' && +s > 5; icon = { temperature: '🌡️', humidity: '💧', power: '⚡', energy: '⚡', battery: '🔋', illuminance: '☀️' }[a.device_class] || ICON.sensor; break;
    case 'binary_sensor': on = s === 'on'; icon = { door: '🚪', window: '🪟', motion: '🏃', occupancy: '🏃', moisture: '💧', smoke: '🔥' }[a.device_class] || '🚪'; text = on ? (a.device_class === 'motion' ? '有人' : '開') : ''; break;
    case 'lock': on = s === 'unlocked'; icon = on ? '🔓' : '🔒'; break;
    case 'media_player': on = !['off', 'standby', 'unavailable'].includes(s); text = on && a.media_title ? a.media_title.slice(0, 14) : ''; break;
    case 'vacuum': on = s === 'cleaning'; text = { cleaning: '清潔中', docked: '充電座', returning: '返回中', idle: '待機', paused: '暫停', error: '出錯' }[s] || s; break;
    case 'camera': on = s !== 'unavailable'; break;
    default: on = s === 'on';
  }
  if (s === 'unavailable') { text = '離線'; on = false; }
  return { domain, icon, text, on, color, level };
}
export function kelvinToRgb(k) {
  const t = k / 100; let r, g, b;
  if (t <= 66) { r = 255; g = 99.47 * Math.log(t) - 161.12; b = t <= 19 ? 0 : 138.52 * Math.log(t - 10) - 305.04; }
  else { r = 329.7 * Math.pow(t - 60, -0.1332); g = 288.12 * Math.pow(t - 60, -0.0755); b = 255; }
  const c = v => Math.max(0, Math.min(255, Math.round(v)));
  return `rgb(${c(r)},${c(g)},${c(b)})`;
}
const SWATCH = [[255, 180, 107], [255, 236, 214], [255, 255, 255], [90, 200, 255], [120, 120, 255], [255, 90, 200], [80, 230, 140]];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// 一個實體嘅控制 UI。actions: data-act="domain.service" data-arg='{json}'
export function controlHTML(entity, st, name) {
  const domain = domainOf(entity), a = st?.attributes || {}, s = st?.state;
  const title = esc(name || a.friendly_name || entity);
  const vis = deviceVisual({ entity }, st);
  let body = '';
  const tog = (on) => `<button class="ctl-tog ${on ? 'on' : ''}" data-act="${domain === 'lock' ? (s === 'locked' ? 'lock.unlock' : 'lock.lock') : domain + '.toggle'}" data-e="${entity}"><span></span></button>`;
  if (!st) return `<div class="ctl"><div class="ctl-h"><i>${vis.icon}</i><b>${title}</b><small>${esc(entity)} · 冇資料</small></div></div>`;
  let head = tog(vis.on);
  switch (domain) {
    case 'light': {
      const pct = Math.round((a.brightness ?? 0) / 2.55);
      if (s === 'on') {
        body += `<label class="ctl-row">亮度<input type="range" min="1" max="100" value="${pct || 100}" data-act="light.turn_on" data-key="brightness_pct" data-e="${entity}"></label>`;
        if (a.min_color_temp_kelvin || a.color_temp_kelvin != null || (a.supported_color_modes || []).includes('color_temp'))
          body += `<label class="ctl-row">色溫<input type="range" min="${a.min_color_temp_kelvin || 2200}" max="${a.max_color_temp_kelvin || 6500}" value="${a.color_temp_kelvin || 3000}" data-act="light.turn_on" data-key="color_temp_kelvin" data-e="${entity}" class="ct"></label>`;
        if ((a.supported_color_modes || []).some(m => ['rgb', 'hs', 'xy', 'rgbw', 'rgbww'].includes(m)))
          body += `<div class="ctl-sw">${SWATCH.map(c => `<button style="background:rgb(${c})" data-act="light.turn_on" data-arg='${JSON.stringify({ rgb_color: c })}' data-e="${entity}"></button>`).join('')}</div>`;
      }
      break;
    }
    case 'cover': head = '';
      body += `<div class="ctl-btns"><button data-act="cover.open_cover" data-e="${entity}">▲ 開</button><button data-act="cover.stop_cover" data-e="${entity}">■ 停</button><button data-act="cover.close_cover" data-e="${entity}">▼ 關</button></div>`;
      if (a.current_position != null) body += `<label class="ctl-row">位置<input type="range" min="0" max="100" value="${a.current_position}" data-act="cover.set_cover_position" data-key="position" data-e="${entity}"></label>`;
      break;
    case 'climate': {
      head = `<button class="ctl-tog ${s !== 'off' ? 'on' : ''}" data-act="climate.${s === 'off' ? 'turn_on' : 'turn_off'}" data-e="${entity}"><span></span></button>`;
      const t = a.temperature ?? 24;
      body += `<div class="ctl-temp"><button data-act="climate.set_temperature" data-arg='${JSON.stringify({ temperature: t - 0.5 })}' data-e="${entity}">−</button><b>${t}°</b><button data-act="climate.set_temperature" data-arg='${JSON.stringify({ temperature: t + 0.5 })}' data-e="${entity}">＋</button><small>室溫 ${a.current_temperature ?? '–'}°</small></div>`;
      const modes = a.hvac_modes || ['off', 'cool', 'heat', 'dry', 'fan_only', 'auto'];
      const zh = { off: '關', cool: '冷', heat: '暖', dry: '抽濕', fan_only: '風', auto: '自動', heat_cool: '冷暖' };
      body += `<div class="ctl-btns">${modes.map(m => `<button class="${m === s ? 'on' : ''}" data-act="climate.set_hvac_mode" data-arg='${JSON.stringify({ hvac_mode: m })}' data-e="${entity}">${zh[m] || m}</button>`).join('')}</div>`;
      break;
    }
    case 'camera': head = '';
      body += `<div class="ctl-cam" data-cam="${entity}"><img alt=""><span>載入畫面…</span></div>`; break;
    case 'media_player':
      head = `<button class="ctl-tog ${vis.on ? 'on' : ''}" data-act="media_player.${vis.on ? 'turn_off' : 'turn_on'}" data-e="${entity}"><span></span></button>`;
      if (vis.on) {
        body += `<div class="ctl-btns"><button data-act="media_player.media_previous_track" data-e="${entity}">⏮</button><button data-act="media_player.media_play_pause" data-e="${entity}">${s === 'playing' ? '⏸' : '▶'}</button><button data-act="media_player.media_next_track" data-e="${entity}">⏭</button></div>`;
        if (a.volume_level != null) body += `<label class="ctl-row">音量<input type="range" min="0" max="100" value="${Math.round(a.volume_level * 100)}" data-act="media_player.volume_set" data-key="volume_level" data-scale="0.01" data-e="${entity}"></label>`;
        if (a.media_title) body += `<div class="ctl-note">${esc(a.media_title)}</div>`;
      }
      break;
    case 'vacuum': head = '';
      body += `<div class="ctl-btns"><button data-act="vacuum.start" data-e="${entity}">▶ 開始</button><button data-act="vacuum.pause" data-e="${entity}">⏸ 暫停</button><button data-act="vacuum.return_to_base" data-e="${entity}">⌂ 返座</button></div>`;
      if (a.battery_level != null) body += `<div class="ctl-note">電量 ${a.battery_level}%</div>`;
      break;
    case 'sensor': case 'binary_sensor': head = `<span class="ctl-val">${esc(vis.text || s)}</span>`; break;
    case 'scene': case 'script': head = `<button class="ctl-run" data-act="${domain}.turn_on" data-e="${entity}">執行</button>`; break;
  }
  return `<div class="ctl" data-entity="${entity}"><div class="ctl-h"><i>${vis.icon}</i><b>${title}</b>${head}</div>${body}</div>`;
}

// 將按鈕 / 滑桿接去 callService
export function bindControls(root, ha) {
  root.addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b || b.tagName === 'INPUT') return;
    const [domain, service] = b.dataset.act.split('.');
    const data = b.dataset.arg ? JSON.parse(b.dataset.arg) : {};
    ha.callService(domain, service, data, { entity_id: b.dataset.e });
  });
  root.addEventListener('change', e => {
    const b = e.target.closest('input[data-act]'); if (!b) return;
    const [domain, service] = b.dataset.act.split('.');
    ha.callService(domain, service, { [b.dataset.key]: +b.value * (+b.dataset.scale || 1) }, { entity_id: b.dataset.e });
  });
}

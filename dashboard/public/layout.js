/* Public Screeps room blueprint. Building state is a dated snapshot, never live telemetry. */
(() => {
  'use strict';
  const SIZE = 50;
  const TYPES = {
    spawn: ['孵化器', '#f3c66f'], extension: ['扩展', '#e8ca87'], tower: ['防御塔', '#f19386'],
    storage: ['仓库', '#70d3b3'], terminal: ['终端', '#78bfdb'], link: ['能量链路', '#79d1de'],
    container: ['容器', '#afa68e'], lab: ['实验室', '#bda1ed'], factory: ['工厂', '#dcac84'],
    powerSpawn: ['超能孵化器', '#ee8fbe'], nuker: ['核弹发射井', '#ec9b79'], observer: ['观察者', '#a4afd9'],
    extractor: ['采矿器', '#ca9ddc'], road: ['道路', '#a0aeb7'], rampart: ['城垛', '#71bc8e'],
    constructedWall: ['人造墙', '#8c9aab']
  };
  const STATUS = { built: '已建', site: '工地', planned: '未建', unknown: '状态未知' };
  const LINK_ROLES = { hub: ['核心中转', 'H'], controller: ['控制器供能', 'C'], source: ['矿源输入', 'S'], 'remote-entry': ['外矿入口', 'E'] };
  const array = value => Array.isArray(value) ? value : [];
  const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const coordinate = value => Number.isInteger(value) && value >= 0 && value < SIZE;
  const position = item => coordinate(item?.x) && coordinate(item?.y);
  const level = value => Number.isInteger(value) && value >= 1 && value <= 8 ? value : null;
  const typeName = type => TYPES[type]?.[0] || type;
  const typeColor = type => TYPES[type]?.[1] || '#aab7c4';
  const protective = type => type === 'rampart' || type === 'constructedWall';
  const typeOrder = type => Object.keys(TYPES).indexOf(type) < 0 ? 99 : Object.keys(TYPES).indexOf(type);
  const integer = value => finite(value) ? value.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—';
  const validTime = value => Number.isFinite(typeof value === 'number' ? value : Date.parse(value));
  const readableTime = value => validTime(value) ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '时间未报告';
  const textValue = value => typeof value === 'string' ? value.slice(0, 500) : '';
  const linkDescription = item => ({
    linkRole: Object.hasOwn(LINK_ROLES, item.linkRole) ? item.linkRole : '',
    purpose: textValue(item.purpose), targetTag: textValue(item.targetTag), fallbackTargetTag: textValue(item.fallbackTargetTag),
    flow: textValue(item.flow), serviceArea: textValue(item.serviceArea),
    serviceSpot: position(item.serviceSpot) ? { x: item.serviceSpot.x, y: item.serviceSpot.y } : null
  });

  function normalizeLayouts(payload) {
    const raw = object(payload);
    const rooms = {};
    for (const [name, value] of Object.entries(object(raw.rooms))) {
      const room = object(value);
      const terrain = typeof room.terrain === 'string' ? room.terrain : room.terrain?.data;
      if (typeof terrain !== 'string' || !/^[0-3]{2500}$/.test(terrain)) continue;
      const snapshot = object(room.snapshot);
      const dated = (finite(snapshot.tick) || validTime(snapshot.capturedAt)) && snapshot.status !== 'unavailable';
      const plan = object(room.plan);
      const buildings = array(plan.buildings).filter(item => position(item) && level(item.rcl) && typeof item.type === 'string').map((item, index) => ({
        id: typeof item.id === 'string' ? item.id : `${name}:${item.type}:${item.x}:${item.y}:${index}`,
        type: item.type, x: item.x, y: item.y, rcl: item.rcl,
        priority: finite(item.priority) ? item.priority : null,
        tag: typeof item.tag === 'string' ? item.tag : '',
        label: typeof item.label === 'string' ? item.label : '',
        roadClass: typeof item.roadClass === 'string' ? item.roadClass : '',
        ...linkDescription(item),
        status: dated && Object.hasOwn(STATUS, item.status) ? item.status : 'unknown',
        conditions: array(item.conditions).filter(item => typeof item === 'string')
      }));
      const rawObjects = object(room.objects);
      rooms[name] = {
        name, terrain, currentRcl: level(room.currentRcl), snapshot,
        plan: {
          version: String(plan.version ?? '—'), layoutRevision: textValue(plan.layoutRevision), updatedAt: plan.updatedAt, notes: array(plan.notes).filter(item => typeof item === 'string'), buildings,
          optionalReservations: array(plan.optionalReservations).filter(item => position(item) && item.type === 'link').map(item => ({
            ...linkDescription(item), type: 'link', x: item.x, y: item.y, rcl: level(item.rcl),
            tag: textValue(item.tag), label: textValue(item.label), optional: true, enabled: false,
            activation: { requiresActiveRemote: item.activation?.requiresActiveRemote === true,
              requiresMeasuredBenefit: item.activation?.requiresMeasuredBenefit === true,
              minExpectedEnergyPerTick: finite(item.activation?.minExpectedEnergyPerTick) && item.activation.minExpectedEnergyPerTick >= 0 ? item.activation.minExpectedEnergyPerTick : null,
              minSavedCarry: finite(item.activation?.minSavedCarry) && item.activation.minSavedCarry >= 0 ? item.activation.minSavedCarry : null,
              notes: array(item.activation?.notes).filter(note => typeof note === 'string') }
          }))
        },
        objects: {
          sources: array(rawObjects.sources).filter(position),
          controller: position(rawObjects.controller) ? rawObjects.controller : null,
          mineral: position(rawObjects.mineral) ? rawObjects.mineral : null,
          structures: array(rawObjects.structures).filter(item => position(item) && typeof item.type === 'string').map(item => ({ ...item, status: dated && ['built', 'site'].includes(item.status) ? item.status : 'unknown' }))
        }
      };
    }
    const strategy = object(raw.regionalStrategy);
    const regionalStrategy = {
      observedAt: strategy.observedAt, source: textValue(strategy.source), note: textValue(strategy.note),
      rooms: array(strategy.rooms).filter(item => /^[WE]\d+[NS]\d+$/.test(item.name)).map(item => ({
        name: item.name, role: textValue(item.role), note: textValue(item.note),
        route: array(item.route).filter(name => typeof name === 'string' && /^[WE]\d+[NS]\d+$/.test(name)),
        sources: Number.isInteger(item.sources) && item.sources >= 0 ? item.sources : null,
        seenTick: finite(item.seenTick) ? item.seenTick : null
      }))
    };
    return { rooms, regionalStrategy, preview: raw.publicationState === 'candidate-preview', shard: typeof raw.shard === 'string' ? raw.shard : 'WORLD', primaryRoom: rooms[raw.primaryRoom] ? raw.primaryRoom : Object.keys(rooms)[0], generatedAt: raw.generatedAt };
  }
  function visibleBuildings(room, state) {
    return room.plan.buildings.filter(item => (state.mode === 'new' ? item.rcl === state.rcl : item.rcl <= state.rcl)
      && (state.type === 'all' || item.type === state.type) && (state.roads || item.type !== 'road') && (state.protection || !protective(item.type)));
  }
  function levelCounts(room, rcl) {
    return { added: room.plan.buildings.filter(item => item.rcl === rcl).length, total: room.plan.buildings.filter(item => item.rcl <= rcl).length };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { normalizeLayouts, visibleBuildings, levelCounts };
  if (typeof document === 'undefined' || !document.getElementById('layout')) return;

  const $ = id => document.getElementById(id);
  const node = (tag, className = '', text = '') => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== '') element.textContent = text;
    return element;
  };
  const svgNode = (tag, attrs = {}, text = '') => {
    const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
    if (text !== '') element.textContent = text;
    return element;
  };
  const state = { data: null, room: '', rcl: 8, mode: 'cumulative', type: 'all', roads: true, protection: true, logistics: true, selected: null, zoom: 1, telemetry: null };
  const currentRoom = () => state.data?.rooms[state.room];
  const selectedCurrentRcl = room => level(state.telemetry?.rooms?.[room.name]?.rcl) || room.currentRcl;

  function renderHeader(room) {
    const rcl = selectedCurrentRcl(room);
    $('layout-current-rcl').textContent = `当前 RCL ${rcl ?? '—'}`;
    $('layout-plan-version').textContent = `规划 ${room.plan.version}${room.plan.layoutRevision ? ` · ${room.plan.layoutRevision}` : ''}`;
    $('layout-snapshot-time').textContent = `TICK ${integer(room.snapshot.tick)} · ${readableTime(room.snapshot.capturedAt)}${room.snapshot.status === 'stale' ? ' · 来源标记为过时' : ''}`;
    const telemetryRoom = state.telemetry?.rooms?.[room.name];
    const tick = telemetryRoom?.tick ?? state.telemetry?.tick;
    $('layout-telemetry-time').textContent = telemetryRoom ? `最近遥测${state.telemetry.stale ? '（已过期）' : ''}：RCL ${rcl ?? '—'} · TICK ${integer(tick)}` : `当前 RCL 来自布局快照；等待最新遥测。`;
    const levels = $('layout-levels');
    const focusedLevel = document.activeElement?.dataset?.layoutRcl;
    levels.replaceChildren();
    for (let value = 1; value <= 8; value++) {
      const count = levelCounts(room, value);
      const button = node('button', `layout-level${rcl === value ? ' is-current' : ''}`);
      button.type = 'button'; button.dataset.layoutRcl = value;
      button.setAttribute('aria-pressed', String(state.rcl === value));
      button.setAttribute('aria-label', `RCL ${value}${rcl === value ? '，当前等级' : ''}，新增 ${count.added}，累计 ${count.total}`);
      const title = node('span', 'layout-level-title', `RCL ${value}`);
      if (rcl === value) title.append(node('i', 'layout-current-dot'));
      button.append(title, node('strong', '', `+${count.added}`), node('small', '', `累计 ${count.total}`));
      levels.append(button);
    }
    if (focusedLevel) levels.querySelector(`[data-layout-rcl="${focusedLevel}"]`)?.focus({ preventScroll: true });
  }
  function renderSummary(room, items) {
    const count = levelCounts(room, state.rcl);
    const root = $('layout-summary'); root.replaceChildren();
    for (const [label, value, suffix] of [
      [`RCL ${state.rcl} 新增`, count.added, '项'], [`截至 RCL ${state.rcl}`, count.total, '项'],
      ['当前视图', items.length, '项'], ['快照内已建 / 工地', `${items.filter(item => item.status === 'built').length} / ${items.filter(item => item.status === 'site').length}`, '项']
    ]) {
      const card = node('div', 'layout-summary-item');
      const valueNode = node('strong', '', String(value)); valueNode.append(node('small', '', suffix));
      card.append(node('span', '', label), valueNode); root.append(card);
    }
    $('layout-map-caption').textContent = `${room.name} / RCL ${state.rcl} / ${state.mode === 'new' ? '本级新增' : '累计规划'}`;
  }

  function icon(type, attributes = {}) {
    const group = svgNode('g', { class: 'layout-structure-icon', ...attributes });
    const add = (tag, attrs) => group.append(svgNode(tag, attrs));
    switch (type) {
      case 'spawn': add('circle', { cx: .5, cy: .5, r: .36 }); add('circle', { cx: .5, cy: .5, r: .16, class: 'layout-icon-cutout' }); break;
      case 'extension': add('rect', { x: .2, y: .2, width: .6, height: .6, rx: .15 }); add('circle', { cx: .5, cy: .5, r: .12, class: 'layout-icon-cutout' }); break;
      case 'tower': add('rect', { x: .21, y: .34, width: .58, height: .48, rx: .1 }); add('path', { d: 'M.36.42V.12H.64V.42Z' }); break;
      case 'storage': add('path', { d: 'M.18.18H.82V.82H.18ZM.3.34H.7M.3.5H.7M.3.66H.7', 'fill-rule': 'evenodd' }); break;
      case 'terminal': add('path', { d: 'M.3.12H.7L.9.5.7.88H.3L.1.5ZM.3.5H.7', 'fill-rule': 'evenodd' }); break;
      case 'link': add('path', { d: 'M.5.08.87.5.5.92.13.5Z' }); add('path', { d: 'M.38.5H.62', class: 'layout-icon-line' }); break;
      case 'container': add('rect', { x: .12, y: .26, width: .76, height: .48, rx: .06 }); add('path', { d: 'M.32.29V.71M.68.29V.71', class: 'layout-icon-line' }); break;
      case 'lab': add('path', { d: 'M.36.14H.64V.41L.87.8H.13L.36.41Z' }); break;
      case 'factory': add('path', { d: 'M.12.82V.37L.37.51V.3L.6.44V.13H.79V.82Z' }); break;
      case 'powerSpawn': add('circle', { cx: .5, cy: .5, r: .36 }); add('path', { d: 'M.55.19.36.52H.59L.44.82', class: 'layout-icon-line' }); break;
      case 'nuker': add('path', { d: 'M.5.1.71.39V.7L.85.88H.15L.29.7V.39Z' }); break;
      case 'observer': add('path', { d: 'M.08.5Q.5-.12.92.5Q.5 1.12.08.5Z' }); add('circle', { cx: .5, cy: .5, r: .16, class: 'layout-icon-cutout' }); break;
      case 'extractor': add('path', { d: 'M.5.1.85.3V.7L.5.9.15.7V.3Z', fill: 'none' }); add('path', { d: 'M.5.2V.8M.2.5H.8' }); break;
      case 'road': add('circle', { cx: .5, cy: .5, r: .14 }); break;
      case 'rampart': add('rect', { x: .075, y: .075, width: .85, height: .85, rx: .05, fill: 'none' }); break;
      case 'constructedWall': add('path', { d: 'M.1.18H.9V.82H.1ZM.1.5H.9M.5.18V.5M.3.5V.82M.7.5V.82' }); break;
      default: add('rect', { x: .2, y: .2, width: .6, height: .6 });
    }
    return group;
  }
  function naturalIcon(type, item) {
    const color = type === 'source' ? '#f3c354' : type === 'controller' ? '#c0bbea' : '#d193d5';
    const group = svgNode('g', { transform: `translate(${item.x} ${item.y})`, class: `layout-natural layout-natural-${type}`, fill: color, stroke: color, 'stroke-width': '.055' });
    if (type === 'source') {
      group.append(svgNode('path', { d: 'M.5.07.87.3.78.78.22.78.13.3Z' }), svgNode('path', { d: 'M.55.2.3.55H.51L.43.76.73.4H.51Z', fill: '#5a4119', stroke: 'none' }));
    } else if (type === 'controller') {
      group.append(svgNode('path', { d: 'M.5.04.94.5.5.96.06.5Z', fill: '#4e496e' }), svgNode('path', { d: 'M.23.65V.34L.4.48.5.28.61.48.77.34V.65Z' }));
    } else {
      group.append(svgNode('path', { d: 'M.5.08.86.3.78.74.5.94.18.71.13.3Z', fill: '#623d63' }), svgNode('text', { x: .5, y: .64, 'text-anchor': 'middle', stroke: 'none', 'font-size': '.48' }, String(item.mineralType || 'M')));
    }
    group.append(svgNode('title', {}, `${type === 'source' ? '能量源' : type === 'controller' ? '控制器' : '矿物'} (${item.x}, ${item.y})`));
    return group;
  }
  function visibleReservations(room) {
    if (!state.logistics || !['all', 'link'].includes(state.type)) return [];
    return room.plan.optionalReservations.filter(item => item.rcl && (state.mode === 'new' ? item.rcl === state.rcl : item.rcl <= state.rcl));
  }
  function logisticsOverlay(room, items) {
    const group = svgNode('g', { class: 'layout-logistics-overlay', 'pointer-events': 'none' });
    if (!state.logistics) return group;
    for (const item of items.filter(item => item.type === 'link' && item.targetTag)) {
      const target = items.find(target => target.tag === item.targetTag) || items.find(target => target.tag === item.fallbackTargetTag);
      if (!target || target.id === item.id) continue;
      const line = svgNode('line', { x1: item.x + .5, y1: item.y + .5, x2: target.x + .5, y2: target.y + .5,
        class: 'layout-flow-line', 'marker-end': 'url(#layout-flow-arrow)', 'data-flow-from': item.tag, 'data-flow-to': target.tag });
      line.append(svgNode('title', {}, `${item.label || LINK_ROLES[item.linkRole]?.[0] || 'Link'} → ${target.label || typeName(target.type)} · 规划用途，非实时流量`));
      group.append(line);
    }
    for (const item of visibleReservations(room)) {
      const candidate = svgNode('g', { class: 'layout-optional-reservation', transform: `translate(${item.x} ${item.y})`, 'data-reservation-tag': item.tag });
      candidate.append(svgNode('rect', { x: -.13, y: -.13, width: 1.26, height: 1.26, rx: .2 }),
        svgNode('text', { x: .5, y: .73, 'text-anchor': 'middle' }, '?'),
        svgNode('title', {}, `${item.label || '外矿入口 Link'} · 候选预留，未启用 · 条件满足后才考虑施工`));
      group.append(candidate);
    }
    return group;
  }
  function renderMap(room, items) {
    const root = $('layout-map'); root.replaceChildren();
    const map = svgNode('svg', { viewBox: '-2 -2 54 54', role: 'img', tabindex: '0', 'aria-labelledby': 'layout-svg-title layout-svg-desc', class: 'layout-map-svg' });
    map.append(svgNode('title', { id: 'layout-svg-title' }, `${room.name} 50 × 50 真实地形与 RCL ${state.rcl} 建筑蓝图`));
    map.append(svgNode('desc', { id: 'layout-svg-desc' }, '格子横坐标为 x，纵坐标为 y；点击或使用方向键选择地块。主建筑角标表示最早计划 RCL，道路和防护等级可在地块详情中查看。'));
    const defs = svgNode('defs');
    const pattern = svgNode('pattern', { id: 'layout-grid', width: 1, height: 1, patternUnits: 'userSpaceOnUse' });
    pattern.append(svgNode('path', { d: 'M1 0H0V1', fill: 'none', stroke: '#d9e4ed', 'stroke-opacity': '.065', 'stroke-width': '.04' }));
    const arrow = svgNode('marker', { id: 'layout-flow-arrow', viewBox: '0 0 8 8', refX: 7, refY: 4, markerWidth: 3, markerHeight: 3, orient: 'auto-start-reverse' });
    arrow.append(svgNode('path', { d: 'M1 1L7 4L1 7', fill: 'none', stroke: '#7cd6dd', 'stroke-width': 1.5 }));
    defs.append(pattern, arrow); map.append(defs);
    map.append(svgNode('rect', { width: 50, height: 50, fill: '#18252b' }));
    const paths = { wall: '', swamp: '' };
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
      const value = Number(room.terrain[y * SIZE + x]);
      const type = value & 1 ? 'wall' : value & 2 ? 'swamp' : null;
      if (type) paths[type] += `M${x} ${y}h1v1h-1Z`;
    }
    map.append(svgNode('path', { d: paths.swamp, fill: '#344739', class: 'layout-terrain-swamp' }), svgNode('path', { d: paths.wall, fill: '#080f17', class: 'layout-terrain-wall' }));
    map.append(svgNode('rect', { width: 50, height: 50, fill: 'url(#layout-grid)', class: 'layout-grid-overlay' }));
    map.append(logisticsOverlay(room, items));
    for (const value of [0, 10, 20, 30, 40, 49]) {
      map.append(svgNode('text', { x: value + .5, y: -.6, class: 'layout-axis', 'text-anchor': 'middle' }, String(value)));
      map.append(svgNode('text', { x: -.55, y: value + .68, class: 'layout-axis', 'text-anchor': 'end' }, String(value)));
    }
    for (const source of room.objects.sources) map.append(naturalIcon('source', source));
    if (room.objects.controller) map.append(naturalIcon('controller', room.objects.controller));
    if (room.objects.mineral) map.append(naturalIcon('mineral', room.objects.mineral));
    const sorted = [...items].sort((a, b) => (a.type === 'road' ? 0 : a.type === 'rampart' ? 2 : 1) - (b.type === 'road' ? 0 : b.type === 'rampart' ? 2 : 1));
    for (const item of sorted) {
      const minor = item.type === 'road' || item.type === 'rampart';
      const group = svgNode('g', { class: `layout-building layout-status-${item.status}${minor ? ' layout-building-overlay' : ''}`, transform: `translate(${item.x} ${item.y})`, 'data-building-id': item.id, 'data-building-type': item.type, 'data-rcl': item.rcl, color: typeColor(item.type) });
      group.append(icon(item.type));
      if (!minor) {
        group.append(svgNode('text', { x: .98, y: .26, class: 'layout-rcl-label', 'text-anchor': 'end' }, String(item.rcl)));
        group.append(svgNode('circle', { cx: .89, cy: .87, r: .085, class: 'layout-status-mark' }));
      }
      if (state.logistics && item.type === 'link' && item.linkRole) group.append(svgNode('text', { x: -.1, y: .08, class: 'layout-link-role-label', 'data-link-role': item.linkRole }, LINK_ROLES[item.linkRole][1]));
      group.append(svgNode('title', {}, `${item.label || typeName(item.type)}${item.linkRole ? ` · ${LINK_ROLES[item.linkRole][0]}` : ''} · RCL ${item.rcl} · ${STATUS[item.status]} · (${item.x}, ${item.y})`));
      map.append(group);
    }
    for (const item of room.objects.structures) {
      if (room.plan.buildings.some(planned => planned.type === item.type && planned.x === item.x && planned.y === item.y)) continue;
      const group = svgNode('g', { transform: `translate(${item.x} ${item.y})`, class: 'layout-unplanned', color: '#8896a5' });
      group.append(icon(item.type), svgNode('title', {}, `规划外 ${typeName(item.type)} (${item.x}, ${item.y})`)); map.append(group);
    }
    const cursor = svgNode('rect', { id: 'layout-map-selection', width: 1, height: 1, rx: .08, class: 'layout-map-selection', 'pointer-events': 'none' });
    map.append(cursor);
    const hits = svgNode('g', { class: 'layout-map-hits', fill: 'transparent' });
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) hits.append(svgNode('rect', { x, y, width: 1, height: 1, 'data-cell': `${x},${y}`, 'data-x': x, 'data-y': y }));
    map.append(hits); root.append(map);
    applyZoom(); updateSelection();
  }
  function renderLegend(room) {
    const root = $('layout-legend'); root.replaceChildren();
    const terrain = node('div', 'layout-legend-group');
    for (const [label, className] of [['平原', 'plain'], ['天然墙', 'wall'], ['沼泽', 'swamp'], ['能量源', 'source'], ['控制器', 'controller'], ['矿物', 'mineral']]) {
      const item = node('span'); item.append(node('i', `layout-legend-swatch ${className}`), document.createTextNode(label)); terrain.append(item);
    }
    root.append(terrain);
    const types = node('div', 'layout-legend-group layout-legend-types');
    for (const type of [...new Set(room.plan.buildings.map(item => item.type))].sort((a, b) => typeOrder(a) - typeOrder(b))) {
      const item = node('span'); const glyph = svgNode('svg', { viewBox: '0 0 1 1', 'aria-hidden': 'true', color: typeColor(type) }); glyph.append(icon(type));
      item.append(glyph, document.createTextNode(typeName(type))); types.append(item);
    }
    root.append(types);
    const statuses = node('div', 'layout-legend-group layout-legend-status');
    for (const status of ['built', 'site', 'planned', 'unknown']) { const item = node('span'); item.append(node('i', `layout-status-dot ${status}`), document.createTextNode(STATUS[status])); statuses.append(item); }
    statuses.append(node('span', 'layout-legend-note', `主建筑角标 = 最早 RCL · 道路 / 防护等级点击查看${room.objects.structures.length ? ' · 灰色建筑为规划外快照对象' : ''}`));
    root.append(statuses);
    if (state.logistics) root.append(node('p', 'layout-legend-note', 'H 核心中转 · C 控制器 · S 矿源 · 虚线箭头 = 规划传能用途（非道路） · ? = 可选预留，未启用'));
  }
  function updateSelection() {
    const room = currentRoom(); if (!room || !state.selected) return;
    const { x, y } = state.selected;
    const cursor = $('layout-map-selection'); if (cursor) { cursor.setAttribute('x', x); cursor.setAttribute('y', y); }
    $('layout-cell-coordinate').textContent = `(${x}, ${y})`;
    const root = $('layout-cell-detail'); root.replaceChildren();
    const terrain = Number(room.terrain[y * SIZE + x]);
    root.append(node('p', 'layout-cell-terrain', `${terrain & 1 ? '天然墙' : terrain & 2 ? '沼泽' : '平原'} · x ${x} / y ${y}`));
    const natural = [...room.objects.sources.map(item => ({ ...item, text: '能量源' })), ...(room.objects.controller ? [{ ...room.objects.controller, text: '房间控制器' }] : []), ...(room.objects.mineral ? [{ ...room.objects.mineral, text: `矿物 ${room.objects.mineral.mineralType || ''}` }] : [])].filter(item => item.x === x && item.y === y);
    natural.forEach(item => root.append(node('p', 'layout-natural-detail', item.text)));
    const buildings = room.plan.buildings.filter(item => item.x === x && item.y === y);
    const visible = new Set(visibleBuildings(room, state).map(item => item.id));
    for (const item of buildings) {
      const card = node('article', 'layout-cell-building');
      const header = node('div', 'layout-cell-building-heading');
      const badge = node('span', `layout-state-badge ${item.status}`, STATUS[item.status]);
      header.append(node('h4', '', typeName(item.type)), badge); card.append(header);
      card.append(node('p', 'layout-cell-rcl', `最早 RCL ${item.rcl}${item.priority !== null ? ` · 优先级 ${item.priority}` : ''}${visible.has(item.id) ? '' : ' · 当前筛选外'}`));
      if (item.label || item.tag) card.append(node('p', 'layout-cell-tag', item.label || item.tag));
      if (item.linkRole) card.append(node('p', 'layout-cell-role', `Link 分工：${LINK_ROLES[item.linkRole][0]}`));
      if (item.purpose) card.append(node('p', 'layout-cell-purpose', item.purpose));
      if (item.serviceArea) card.append(node('p', 'layout-cell-tag', `服务范围：${item.serviceArea}`));
      if (item.serviceSpot) card.append(node('p', 'layout-cell-tag', `装卸服务格：(${item.serviceSpot.x}, ${item.serviceSpot.y})`));
      if (item.targetTag) {
        const target = room.plan.buildings.find(target => target.tag === item.targetTag);
        card.append(node('p', 'layout-cell-tag', `规划去向：${target ? `${target.label || typeName(target.type)} (${target.x}, ${target.y})` : item.targetTag}`));
      }
      if (item.fallbackTargetTag) {
        const target = room.plan.buildings.find(target => target.tag === item.fallbackTargetTag);
        card.append(node('p', 'layout-cell-tag', `备用去向：${target ? `${target.label || typeName(target.type)} (${target.x}, ${target.y})` : item.fallbackTargetTag}`));
      }
      if (item.roadClass) card.append(node('p', 'layout-cell-tag', `道路分类：${item.roadClass}`));
      const conditions = node('ul', 'layout-conditions');
      for (const condition of item.conditions.length ? item.conditions : ['达到计划 RCL 后，还需满足当前建造调度与储备条件。']) conditions.append(node('li', '', condition));
      card.append(conditions); root.append(card);
    }
    const unplanned = room.objects.structures.filter(item => item.x === x && item.y === y && !buildings.some(planned => planned.type === item.type));
    for (const item of unplanned) root.append(node('p', 'layout-unplanned-detail', `规划外 ${typeName(item.type)} · ${STATUS[item.status]}`));
    const reservations = room.plan.optionalReservations.filter(item => item.x === x && item.y === y);
    for (const item of reservations) {
      const card = node('article', 'layout-reservation-detail');
      card.append(node('h4', '', item.label || '外矿入口 Link'), node('p', 'layout-candidate-label', '候选预留 · 未启用 · 不计入正式建筑'), node('p', '', item.purpose));
      card.append(activationList(item)); root.append(card);
    }
    if (!buildings.length && !unplanned.length && !reservations.length) root.append(node('p', 'layout-cell-empty', '此格没有规划建筑。'));
    if (buildings.length) root.append(node('p', 'layout-cell-footnote', `本地块共 ${buildings.length} 项规划；包含当前筛选未显示的叠层。`));
    document.querySelectorAll('[data-layout-locate]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.x) === x && Number(button.dataset.y) === y)));
  }
  function renderList(room, items) {
    const root = $('layout-building-list'); root.replaceChildren();
    $('layout-list-count').textContent = `${items.length} 项`;
    $('layout-list-caption').textContent = `当前筛选 · ${state.mode === 'new' ? `RCL ${state.rcl} 新增` : `RCL 1–${state.rcl} 累计`} · 展开类型，点击坐标定位。`;
    if (!items.length) { root.append(node('p', 'layout-list-empty', '当前等级和筛选下没有建筑。可切换等级、类型或图层。')); return; }
    const types = [...new Set(items.map(item => item.type))].sort((a, b) => typeOrder(a) - typeOrder(b));
    for (const type of types) {
      const groupItems = items.filter(item => item.type === type).sort((a, b) => a.rcl - b.rcl || a.y - b.y || a.x - b.x);
      const details = node('details', 'layout-type-group'); if (type === 'spawn') details.open = true;
      const summary = node('summary');
      const title = node('span', 'layout-type-title'); const glyph = svgNode('svg', { viewBox: '0 0 1 1', 'aria-hidden': 'true', color: typeColor(type) }); glyph.append(icon(type));
      title.append(glyph, document.createTextNode(typeName(type)));
      const stats = node('span', 'layout-type-stats', `${groupItems.length} 项 · 本级新增 ${room.plan.buildings.filter(item => item.type === type && item.rcl === state.rcl).length} / 累计 ${room.plan.buildings.filter(item => item.type === type && item.rcl <= state.rcl).length}`);
      summary.append(title, stats, node('span', 'layout-type-expand', '+')); details.append(summary);
      const entries = node('div', 'layout-coordinate-list');
      for (const item of groupItems) {
        const button = node('button', 'layout-coordinate'); button.type = 'button'; button.dataset.layoutLocate = item.id; button.dataset.x = item.x; button.dataset.y = item.y;
        button.setAttribute('aria-label', `定位${typeName(type)} (${item.x}, ${item.y})，RCL ${item.rcl}，${STATUS[item.status]}`);
        button.append(node('span', 'mono', `(${item.x}, ${item.y})`), node('span', 'layout-coordinate-rcl', `R${item.rcl}`), node('span', `layout-coordinate-state ${item.status}`, STATUS[item.status])); entries.append(button);
      }
      details.append(entries); root.append(details);
    }
  }
  function activationList(item) {
    const list = node('ul', 'layout-conditions');
    const notes = [];
    if (item.rcl) notes.push(`最早考虑 RCL ${item.rcl}，仍需可用 Link 配额。`);
    if (item.activation.requiresActiveRemote) notes.push('对应外矿已启用并有稳定输入。');
    if (item.activation.requiresMeasuredBenefit) notes.push('实测证明运输或拥堵改善后才启用。');
    if (item.activation.minExpectedEnergyPerTick !== null) notes.push(`预计持续输入至少 ${item.activation.minExpectedEnergyPerTick} energy/tick。`);
    if (item.activation.minSavedCarry !== null) notes.push(`估算至少节省 ${item.activation.minSavedCarry} 个 CARRY，并核对损耗与接收搬运成本。`);
    notes.push(...item.activation.notes);
    if (!notes.length) notes.push('完整路线、稳定流量、配额与净收益验证后，才考虑启用。');
    notes.forEach(note => list.append(node('li', '', note)));
    return list;
  }
  function logisticsButton(item) {
    const button = node('button', 'layout-logistics-locate', `(${item.x}, ${item.y}) ↗`);
    button.type = 'button'; button.dataset.logisticsX = item.x; button.dataset.logisticsY = item.y;
    button.setAttribute('aria-label', `在地图定位${item.label || 'Link'} (${item.x}, ${item.y})`);
    return button;
  }
  function renderLogistics(room, items) {
    const root = $('layout-link-roles'); root.replaceChildren();
    const links = items.filter(item => item.type === 'link');
    if (!links.length) root.append(node('p', 'layout-logistics-empty', `当前筛选无 Link。RCL 5 起可建设；可切换至更高规划等级查看分工。`));
    for (const item of links) {
      const card = node('article', 'layout-link-card');
      const head = node('div', 'layout-link-card-heading');
      head.append(node('h4', '', item.label || LINK_ROLES[item.linkRole]?.[0] || 'Link'), logisticsButton(item));
      card.append(head, node('p', 'layout-cell-rcl', `最早 RCL ${item.rcl} · 快照${STATUS[item.status]}`));
      card.append(node('p', '', item.purpose || '此版本尚未提供明确运输用途。'));
      if (item.serviceArea) card.append(node('p', 'layout-cell-tag', `服务：${item.serviceArea}`));
      if (item.targetTag) {
        const target = room.plan.buildings.find(target => target.tag === item.targetTag);
        card.append(node('p', 'layout-link-destination', `→ ${target?.label || (target ? typeName(target.type) : item.targetTag)}`));
      }
      if (item.fallbackTargetTag) {
        const target = room.plan.buildings.find(target => target.tag === item.fallbackTargetTag);
        card.append(node('p', 'layout-cell-tag', `备用 → ${target?.label || (target ? typeName(target.type) : item.fallbackTargetTag)}`));
      }
      root.append(card);
    }
    const optional = $('layout-optional-links'); optional.replaceChildren();
    if (room.plan.optionalReservations.length) {
      optional.append(node('h4', '', '可选 Link 预留'), node('p', 'layout-regional-note', '预留仅保留位置与条件，未启用；不随达到等级自动施工。地图只在对应等级和 Link 图层中显示。'));
      const cards = node('div', 'layout-optional-grid');
      for (const item of room.plan.optionalReservations) {
        const card = node('article', 'layout-reservation-card');
        const head = node('div', 'layout-link-card-heading'); head.append(node('h4', '', item.label || '外矿入口'), logisticsButton(item));
        card.append(head, node('p', 'layout-candidate-label', '候选预留 · 未启用'), node('p', '', item.purpose), activationList(item)); cards.append(card);
      }
      optional.append(cards);
    }
  }
  function renderRegional() {
    const strategy = state.data.regionalStrategy;
    $('layout-regional').hidden = !strategy.rooms.length;
    $('layout-regional-source').textContent = `${strategy.source} · 情报采集 ${readableTime(strategy.observedAt)}`;
    $('layout-regional-note').textContent = strategy.note;
    const root = $('layout-regional-rooms'); root.replaceChildren();
    for (const item of strategy.rooms) {
      const card = node('article', 'layout-regional-card');
      card.append(node('h4', 'mono', item.name), node('p', 'layout-regional-role', item.role),
        node('p', 'layout-candidate-label', '候选用途 · 未确认启用'), node('p', '', item.note),
        node('p', 'layout-region-route', item.route.join(' → ')),
        node('small', '', `${item.sources ?? '—'} 个源 · ${Math.max(0, item.route.length - 1)} 次跨房 · seen ${integer(item.seenTick)}`));
      root.append(card);
    }
  }
  function render() {
    const room = currentRoom(); if (!room) return;
    const items = visibleBuildings(room, state);
    renderHeader(room); renderSummary(room, items); renderMap(room, items); renderLegend(room); renderList(room, items); renderLogistics(room, items); renderRegional(); updateSelection();
    document.querySelectorAll('[data-layout-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.layoutMode === state.mode)));
    const notes = $('layout-plan-notes'); notes.replaceChildren(); room.plan.notes.forEach(note => notes.append(node('li', '', note)));
  }
  function applyZoom() {
    $('layout-map').style.width = `${state.zoom * 100}%`;
    $('layout-map').style.minWidth = `${540 * state.zoom}px`;
    $('layout-zoom-label').textContent = `${Math.round(state.zoom * 100)}%`;
    $('layout-zoom-out').disabled = state.zoom <= 1; $('layout-zoom-in').disabled = state.zoom >= 3;
  }
  function centerSelection() {
    if (!state.selected) return;
    const viewport = $('layout-map-scroll'); const canvas = $('layout-map');
    const width = canvas.offsetWidth || 540 * state.zoom;
    const x = (state.selected.x + 2.5) / 54 * width - viewport.clientWidth / 2;
    const y = (state.selected.y + 2.5) / 54 * width - viewport.clientHeight / 2;
    viewport.scrollLeft = Math.max(0, x); viewport.scrollTop = Math.max(0, y);
  }
  function changeZoom(amount) { state.zoom = Math.min(3, Math.max(1, state.zoom + amount)); applyZoom(); centerSelection(); }
  function chooseRoom(name) {
    if (!state.data?.rooms[name]) return;
    state.room = name; state.type = 'all'; state.zoom = 1;
    const room = currentRoom(); const spawn = room.plan.buildings.find(item => item.type === 'spawn');
    state.selected = spawn ? { x: spawn.x, y: spawn.y } : { x: 25, y: 25 };
    const typeSelect = $('layout-type'); typeSelect.replaceChildren(); const all = node('option', '', '全部建筑'); all.value = 'all'; typeSelect.append(all);
    for (const type of [...new Set(room.plan.buildings.map(item => item.type))].sort((a, b) => typeOrder(a) - typeOrder(b))) { const option = node('option', '', typeName(type)); option.value = type; typeSelect.append(option); }
    render();
  }
  function receiveTelemetry(event) {
    if (!event.detail || typeof event.detail !== 'object') return;
    state.telemetry = event.detail;
    if (currentRoom()) renderHeader(currentRoom());
  }
  window.addEventListener('screeps:telemetry', receiveTelemetry);
  document.addEventListener('screeps:telemetry', receiveTelemetry);
  $('layout-room').addEventListener('change', event => chooseRoom(event.target.value));
  $('layout-levels').addEventListener('click', event => { const button = event.target.closest('[data-layout-rcl]'); if (!button) return; state.rcl = Number(button.dataset.layoutRcl); render(); });
  document.querySelectorAll('[data-layout-mode]').forEach(button => button.addEventListener('click', () => { state.mode = button.dataset.layoutMode; render(); }));
  $('layout-type').addEventListener('change', event => { state.type = event.target.value; render(); });
  $('layout-roads').addEventListener('change', event => { state.roads = event.target.checked; render(); });
  $('layout-protection').addEventListener('change', event => { state.protection = event.target.checked; render(); });
  $('layout-logistics-toggle').addEventListener('change', event => { state.logistics = event.target.checked; render(); });
  $('layout-logistics').addEventListener('click', event => {
    const button = event.target.closest('[data-logistics-x]'); if (!button) return;
    state.selected = { x: Number(button.dataset.logisticsX), y: Number(button.dataset.logisticsY) };
    updateSelection(); centerSelection();
    $('layout-map').querySelector('svg')?.focus({ preventScroll: true });
  });
  $('layout-map').addEventListener('click', event => { const target = event.target.closest('[data-cell]'); if (!target) return; state.selected = { x: Number(target.dataset.x), y: Number(target.dataset.y) }; updateSelection(); });
  $('layout-map').addEventListener('keydown', event => {
    const movements = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    if (!movements[event.key] || !state.selected) return;
    event.preventDefault(); const [dx, dy] = movements[event.key];
    state.selected = { x: Math.max(0, Math.min(49, state.selected.x + dx)), y: Math.max(0, Math.min(49, state.selected.y + dy)) };
    updateSelection(); centerSelection();
  });
  $('layout-building-list').addEventListener('click', event => {
    const button = event.target.closest('[data-layout-locate]'); if (!button) return;
    state.selected = { x: Number(button.dataset.x), y: Number(button.dataset.y) }; updateSelection(); centerSelection();
    $('layout-map').querySelector('svg')?.focus({ preventScroll: true });
    if (typeof $('layout-map-scroll').scrollIntoView === 'function') $('layout-map-scroll').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
  $('layout-zoom-in').addEventListener('click', () => changeZoom(.5));
  $('layout-zoom-out').addEventListener('click', () => changeZoom(-.5));
  $('layout-fit').addEventListener('click', () => { state.zoom = 1; applyZoom(); $('layout-map-scroll').scrollLeft = 0; $('layout-map-scroll').scrollTop = 0; });
  $('layout-core').addEventListener('click', () => {
    const room = currentRoom(); if (!room) return;
    const core = room.plan.buildings.find(item => item.type === 'spawn') || room.plan.buildings.find(item => item.type === 'storage'); if (!core) return;
    state.selected = { x: core.x, y: core.y }; state.zoom = 2.5; applyZoom(); updateSelection(); centerSelection();
  });
  async function load() {
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch('/data/room-layouts.json', { signal: controller.signal, credentials: 'omit' });
      if (!response.ok) throw new Error('layout-unavailable');
      const data = normalizeLayouts(await response.json());
      if (!Object.keys(data.rooms).length) throw new Error('layout-invalid');
      state.data = data;
      const select = $('layout-room'); select.replaceChildren();
      for (const name of Object.keys(data.rooms).sort((a, b) => a === data.primaryRoom ? -1 : b === data.primaryRoom ? 1 : a.localeCompare(b))) { const option = node('option', '', `${name}${name === data.primaryRoom ? ' · 主房' : ''}`); option.value = name; select.append(option); }
      select.value = data.primaryRoom;
      $('layout-content').hidden = false;
      $('layout-notice').textContent = data.preview ? '本地候选预览 · 尚未确认成为游戏执行规划 · 建造状态取自标注的历史快照' : '公开规划快照 · 几何来自 API 执行规划，用途来自匹配设计 · 建造状态不是实时画面';
      $('layout-notice').classList.add('is-ready');
      chooseRoom(data.primaryRoom);
    } catch {
      $('layout-notice').textContent = '布局快照暂不可用。能源监控可继续使用；请稍后刷新页面重试。';
      $('layout-notice').classList.add('is-error');
    } finally { clearTimeout(timeout); }
  }
  load();
})();

/* Screeps energy observatory. Read-only; credentials belong exclusively to the server. */
(() => {
  'use strict';
  const WINDOWS = [300, 1500, 6000];
  const EFFICIENCY_TARGET = 0.9;
  const POLL_MS = 60000;
  const STALE_MS = 300000;
  const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
  const finite = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
  const firstNumber = (...values) => values.map(finite).find(value => value !== null) ?? null;
  const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const list = value => Array.isArray(value) ? value : [];
  const divide = (value, divisor) => finite(value) !== null && finite(divisor) !== null && divisor > 0 ? value / divisor : null;
  const clamp = (number, min = 0, max = 1) => Math.min(max, Math.max(min, number));
  const format = (value, digits = 1) => finite(value) === null ? '—' : value.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
  const integer = value => finite(value) === null ? '—' : nf.format(Math.round(value));
  const signed = (value, digits = 1) => finite(value) === null ? '—' : `${value > 0 ? '+' : ''}${format(value, digits)}`;
  const percent = value => finite(value) === null ? '—' : `${format(value * 100, 1)}%`;
  const timeValue = value => typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'string' && value.trim() ? Date.parse(value) : NaN;
  const readableTime = value => {
    const time = timeValue(value);
    return Number.isFinite(time) ? new Intl.DateTimeFormat('zh-CN', { month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false }).format(time) : '—';
  };

  /** All wire-format adaptation belongs here. Null means unreported, never zero. */
  function normalizeTelemetry(payload, preferredRoom, requestedWindow = 1500) {
    const raw = object(payload);
    const status = object(raw.status);
    const telemetry = object(raw.telemetry);
    const rawRooms = object(raw.rooms);
    const roomNames = Object.keys(rawRooms).filter(name => object(rawRooms[name]).owned !== false).sort();
    const roomName = roomNames.includes(preferredRoom) ? preferredRoom : roomNames[0] || '';
    const room = object(rawRooms[roomName]);
    const ledger = object(room.energy);
    const windowSize = WINDOWS.includes(Number(requestedWindow)) ? Number(requestedWindow) : 1500;
    const window = object(object(ledger.windows)[String(windowSize)]);
    const observed = firstNumber(window.observedTicks, window.coveredTicks);
    const requested = firstNumber(window.requestedTicks, windowSize);
    const coverage = firstNumber(window.coverage, divide(observed, requested));
    const tick = firstNumber(raw.tick, telemetry.tick, status.tick, room.tick, ledger.tick);
    const windowTick = firstNumber(window.tick, window.endTick, ledger.tick, room.tick, tick);
    const totals = object(window.totals);
    const balances = finite(window.balanceObservedTicks);
    const inventoryTicks = finite(window.inventoryObservedTicks);
    const upkeep = firstNumber(room.upkeep, object(room.economy).upkeep);
    const theoretical = finite(window.theoreticalRate);
    const utilizationObserved = finite(window.utilizationObservedTicks);
    const utilizationCoverage = finite(window.utilizationCoverage);
    const utilizationWarmingUp = window.utilizationWarmingUp === true || (utilizationCoverage !== null && utilizationCoverage < 1);
    const metrics = {
      growth: finite(window.G), eta: finite(window.eta), theoretical,
      upkeep, renewalCeiling: upkeep !== null && upkeep >= 0 && theoretical !== null && theoretical > 0 ? clamp(1 - upkeep / theoretical) : null,
      utilizationRate: finite(window.utilizationRate), utilization: finite(window.utilization),
      utilizationTheoretical: finite(window.utilizationTheoreticalRate), utilizationProductive: finite(window.utilizationProductiveRate), usefulOperating: finite(window.usefulOperatingCostRate),
      harvest: finite(window.harvestRate), upgrade: finite(window.upgradeRate), build: finite(window.buildUsefulRate),
      operating: finite(window.operatingCostRate), stock: firstNumber(window.inventoryDeltaRate, divide(window.inventoryDelta, inventoryTicks)),
      residual: firstNumber(window.residualRate, divide(window.residual, balances)),
      upgradeTotal: observed > 0 ? finite(totals.upgrade) : null,
      buildTotal: observed > 0 ? finite(totals.buildUseful) : null,
      inventoryDelta: finite(window.inventoryDelta), harvestEfficiency: divide(window.harvestRate, window.theoreticalRate),
      spawn: finite(window.spawnRate), repair: finite(window.repairRate), tower: finite(window.towerRate),
      otherBuild: finite(window.buildOtherRate), linkLoss: finite(window.linkLossRate),
      imports: firstNumber(window.importRate, divide(window.imports, balances)), exports: firstNumber(window.exportRate, divide(window.exports, balances))
    };
    const normalizePoint = value => {
      const p = object(value);
      const duration = firstNumber(p.observedTicks, p.coveredTicks);
      const upgrade = finite(p.upgrade), build = finite(p.buildUseful);
      return {
        tick: firstNumber(p.to, p.t, p.tick, p.endTick),
        growth: firstNumber(p.G, p.growthRate, divide(upgrade !== null && build !== null ? upgrade + build : null, duration)),
        harvest: firstNumber(p.harvestRate, divide(p.harvest, duration)),
        theoretical: firstNumber(p.theoreticalRate, divide(p.potential, duration)),
        utilization: divide(p.usedEnergy, finite(p.utilizationTicks)),
        duration
      };
    };
    const history = list(ledger.history).map(normalizePoint).filter(p => p.tick !== null && (windowTick === null || p.tick >= windowTick - windowSize) && (windowTick === null || p.tick <= windowTick)).sort((a,b) => a.tick-b.tick);
    // Duplicate snapshots should not create an artificial extra observation.
    const historyByTick = new Map(history.map(p => [p.tick, p]));
    const rawAlerts = raw.alerts;
    const alerts = (Array.isArray(rawAlerts) ? rawAlerts : Object.values(object(rawAlerts))).filter(a => a && typeof a === 'object' && (!a.room || a.room === roomName)).map(a => ({
      code: String(a.code || 'telemetry-alert'), message: String(a.message || a.description || a.code || '遥测异常'),
      since: finite(a.since), lastSeen: finite(a.lastSeen), severity: String(a.severity || 'warning'),
      sustained: a.sustained !== false
    }));
    return {
      raw, room, roomNames, roomName, ledger, window, windowSize, observed, coverage,cpu:object(raw.cpu),performance:object(object(raw.cpu).performance),
      tick, windowTick, rcl: finite(room.rcl), version: raw.version ?? telemetry.version ?? status.version ?? null,
      ledgerVersion: ledger.version ?? raw.ledgerVersion ?? raw.energyVersion ?? null,
      shard: typeof raw.shard === 'string' ? raw.shard : 'WORLD',
      fetchedAt: raw.fetchedAt ?? null, capturedAt: raw.capturedAt ?? ledger.capturedAt ?? null,
      stale: raw.stale === true, warmingUp: window.warmingUp === true || (coverage !== null && coverage < 1),
      hasLedger: Object.keys(ledger).length > 0, hasWindow: Object.keys(window).length > 0,
      hasUtilization: utilizationObserved !== null, utilizationObserved, utilizationCoverage, utilizationWarmingUp,
      utilizationEligible: window.utilizationEligible, utilizationIndicator: object(ledger.utilizationIndicator), economy: object(room.economy),
      eligible: window.eligible, balances, inventoryTicks, scope:object(ledger.scope), indicator:object(ledger.indicator), metrics, history: [...historyByTick.values()], alerts,
      alertsReported: rawAlerts !== undefined && rawAlerts !== null,
      inventory: object(ledger.inventory), mining: list(room.mining), hauling: object(room.hauling),
      roads: object(room.roads), construction: object(room.construction), latest: object(ledger.latest)
    };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { normalizeTelemetry, finite, divide, format, signed, percent };
  if (typeof document === 'undefined') return;

  const $ = id => document.getElementById(id);
  const setText = (id, value) => { const node = $(id); if (node) node.textContent = String(value); };
  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  };
  const svgElement = (tag, attributes = {}) => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attributes).forEach(([key,value]) => node.setAttribute(key,String(value)));
    return node;
  };
  const emptyState = (message, detail, compact = false) => {
    const node = element('div', `empty-state${compact ? ' compact' : ''}`, message);
    if (detail) node.append(element('span', '', detail));
    return node;
  };
  const state = { payload:null, normalized:null, room:'', window:1500, error:'', inFlight:false, timer:null, lastPoll:0, lastTick:null, tickChangedAt:Date.now(), hasTickComparison:false };

  function freshness(data) {
    const now = Date.now();
    const captured = timeValue(data.capturedAt);
    const fetched = timeValue(data.fetchedAt);
    if (state.error) return { level:'error', label:'连接异常', notice:`数据请求失败：${state.error}${state.payload ? '。保留最近一次成功采样，数值可能已过时。' : '。尚无可展示的数据。'}` };
    if (data.stale || (Number.isFinite(captured) && now-captured > STALE_MS) || (Number.isFinite(fetched) && now-fetched > STALE_MS) || (state.hasTickComparison && now-state.tickChangedAt > STALE_MS)) {
      return { level:'warning', label:'采样已过时', notice:`最近的游戏采样已超过 5 分钟，或服务端报告数据过时。以下为最后已知数据；页面请求成功不代表游戏 tick 已推进。${typeof object(data.raw.upstreamError).message === 'string' ? ' 上游请求：'+data.raw.upstreamError.message : ''}` };
    }
    if (!data.roomName) return { level:'neutral', label:'暂无殖民地', notice:'服务端尚未返回可展示的己方殖民地。' };
    if (!data.hasLedger) return { level:'warning', label:'账本未就绪', notice:'已有殖民地快照，但能量账本尚未提供。生产现场仍可查看；成长与能量指标将等待账本采样。' };
    if (!data.hasWindow || data.observed === 0) return { level:'neutral', label:'等待账本采样', notice:'能量账本正在开始采样，尚无可计算的统计窗口。' };
    if (!data.hasUtilization) return { level:'neutral', label:'等待新版总用能账本', notice:'' };
    if (data.utilizationWarmingUp || data.warmingUp) return { level:'warning', label:'统计窗口预热中', notice:'' };
    return { level:'', label:'已连接 · 已采样', notice:'' };
  }

  function renderStatus(data) {
    const status = freshness(data);
    $('status-chip').className = `status-chip ${status.level}`;
    setText('status-text', status.label);
    const notice = $('notice'); notice.hidden = !status.notice; notice.textContent = status.notice;
    setText('fetched-at', `采集 ${readableTime(data.fetchedAt)}${data.capturedAt ? ` · 游戏快照 ${readableTime(data.capturedAt)}` : ''}`);
    setText('version-label', `代码 ${data.version ?? '—'} · 账本 ${data.ledgerVersion ?? '—'}`);
    setText('polling-label', document.hidden ? '页面隐藏 · 检查已暂停' : '每 60 秒检查 · 服务端缓存 2 分钟');
  }

  function render() {
    const data = normalizeTelemetry(state.payload || {}, state.room, state.window);
    state.normalized = data; state.room = data.roomName;
    const m = data.metrics;
    const roomSelect = $('room-select');
    const currentOptions = Array.from(roomSelect.options, option => option.value).join('|');
    if (currentOptions !== data.roomNames.join('|') || !roomSelect.options.length) {
      roomSelect.replaceChildren(...(data.roomNames.length ? data.roomNames.map(name => { const option = element('option','',name); option.value=name; return option; }) : [element('option','','暂无殖民地')]));
      if (!data.roomNames.length) roomSelect.options[0].value='';
    }
    roomSelect.value = state.room;
    roomSelect.disabled = !data.roomNames.length;
    setText('rcl-badge', `RCL ${integer(data.rcl)}`);
    setText('shard-label', data.shard.toUpperCase());
    setText('game-tick', integer(data.tick));
    setText('utilization-value', format(m.utilizationRate, 2));
    setText('growth-value', format(m.growth, 2));
    setText('growth-efficiency', percent(m.eta));
    setText('growth-coverage', `发展样本 ${integer(data.observed)} ticks`);
    setText('window-quality', !data.hasUtilization ? '等待新版账本' : data.utilizationWarmingUp ? '预热 · 初步速率' : data.utilizationEligible === false ? '窗口不可判定' : '完整统计窗口');
    setText('growth-note', m.utilizationRate === null ? '等待新版总用能账本；不以旧分项拼接不同覆盖的数值。' : '升级 + 规划建设 + 孵化 + 维修 + 塔耗能 · 同一完整样本');
    setText('coverage-label', `总用能采样 ${integer(data.utilizationObserved)} / ${integer(data.windowSize)} ticks`);
    setText('coverage-value', percent(data.utilizationCoverage));
    $('coverage-bar').style.width = `${clamp(data.utilizationCoverage ?? 0)*100}%`;
    setText('efficiency-value', percent(m.utilization));
    setText('utilization-theoretical', `理论供给 ${format(m.utilizationTheoretical)} e/t`);
    $('efficiency-ring').style.strokeDasharray = `${clamp(m.utilization ?? 0)*100} 100`;
    setText('efficiency-gap', m.utilization === null ? '距目标 — · 等待有效采样' : m.utilization < EFFICIENCY_TARGET ? `距目标 ${format((EFFICIENCY_TARGET-m.utilization)*100)} 个百分点${data.utilizationWarmingUp ? ' · 预热估值' : ''}` : `本窗口达到目标${data.utilizationWarmingUp || data.utilizationEligible !== true ? ' · 持续性待验证' : ''}`);
    setText('efficiency-ceiling', m.renewalCeiling === null ? '发展转化率的续代估算上限 — · 缺少编制成本或理论供给数据' : `当前编制仅扣续代的发展转化率估算上限 ${percent(m.renewalCeiling)}，未扣维修等`);
    setText('sample-range', data.windowTick !== null ? `截至 tick ${integer(data.windowTick)}` : '等待游戏采样');
    setText('harvest-value', format(m.harvest));
    setText('harvest-detail', `理论上限 ${format(m.theoretical)} e/t`);
    setText('harvest-efficiency', percent(m.harvestEfficiency));
    $('harvest-bar').style.width = `${clamp(m.harvestEfficiency ?? 0)*100}%`;
    setText('upgrade-value', format(m.upgrade));
    setText('upgrade-total', `${integer(m.upgradeTotal)} energy`);
    setText('build-value', format(m.build));
    setText('build-total', `${integer(m.buildTotal)} energy`);
    setText('operating-value', format(m.operating));
    const expenseParts = [['孵化',m.spawn],['维修',m.repair],['塔',m.tower],['其他建设',m.otherBuild],['链路损耗',m.linkLoss]].filter(([,value]) => value !== null);
    setText('operating-detail', expenseParts.length ? expenseParts.map(([label,value]) => `${label} ${format(value)}`).join(' · ') : '孵化 · 维修 · 塔 · 其他');
    setText('stock-value', signed(m.stock));
    $('stock-value').className = m.stock === null || m.stock === 0 ? '' : m.stock > 0 ? 'positive' : 'negative';
    setText('stock-detail', m.inventoryDelta === null ? '正值表示能量积累' : `窗口累计 ${signed(m.inventoryDelta,0)} energy`);
    renderStatus(data); renderTrend(data); renderFlow(data); renderEconomy(data); renderCPU(data); renderMining(data); renderHauling(data); renderInfrastructure(data); renderDiagnostics(data);
  }

  function renderTrend(data) {
    const root = $('trend-chart'); root.replaceChildren();
    const points = data.history;
    const usefulPoints = points.filter(p => p.growth !== null || p.harvest !== null || p.theoretical !== null || p.utilization !== null);
    setText('history-count', `${integer(usefulPoints.length)} 个采样点`);
    setText('trend-caption', `最近 ${integer(data.windowSize)} ticks · 20-tick 聚合点，仅绘制实际采样`);
    if (usefulPoints.length < 2) { root.append(emptyState('趋势正在积累', usefulPoints.length ? '已有 1 个有效采样点；等待下一次游戏采样。' : '暂无能量账本历史。旧版快照不会补造为成长曲线。')); return; }
    const width=680,height=212,pad={left:34,right:15,top:14,bottom:28};
    const minTick=points[0].tick,maxTick=points[points.length-1].tick;
    if (minTick === maxTick) { root.append(emptyState('等待新的游戏 tick', '重复请求不会增加历史采样点。')); return; }
    const values=points.flatMap(p=>[p.growth,p.harvest,p.theoretical,p.utilization]).filter(value=>value !== null);
    const low=Math.min(0,...values), peak=Math.max(1,...values);
    const maxValue=Math.ceil(peak*1.14/5)*5;
    const x=t=>pad.left+(t-minTick)/(maxTick-minTick)*(width-pad.left-pad.right);
    const y=value=>height-pad.bottom-(value-low)/(maxValue-low)*(height-pad.top-pad.bottom);
    const svg=svgElement('svg',{viewBox:`0 0 ${width} ${height}`,role:'img','aria-label':`最近 ${data.windowSize} ticks 的实际开采、发展投入、有效用能与理论供给曲线`});
    const title=svgElement('title'); title.textContent='用能与供给：横轴 game tick，纵轴 energy / tick'; svg.append(title);
    for(let i=0;i<=4;i++){
      const value=low+(maxValue-low)*i/4,py=y(value);
      svg.append(svgElement('line',{x1:pad.left,y1:py,x2:width-pad.right,y2:py,class:'chart-grid'}));
      const label=svgElement('text',{x:pad.left-9,y:py+3,'text-anchor':'end',class:'chart-axis'}); label.textContent=format(value,value%1===0?0:1);svg.append(label);
    }
    for(let i=0;i<=3;i++){
      const tick=Math.round(minTick+(maxTick-minTick)*i/3);
      const label=svgElement('text',{x:x(tick),y:height-7,'text-anchor':i===0?'start':i===3?'end':'middle',class:'chart-axis'});label.textContent=integer(tick);svg.append(label);
    }
    const gaps=points.slice(1).map((p,i)=>p.tick-points[i].tick).sort((a,b)=>a-b);
    const typicalGap=gaps[Math.floor(gaps.length/2)] || 20;
    const series=[{key:'theoretical',color:'#748795',dash:'4 5'},{key:'harvest',color:'#eeb557'},{key:'growth',color:'#67c9b3'},{key:'utilization',color:'#a99ede'}];
    series.forEach(({key,color,dash})=>{
      let path='',previous=null;
      points.forEach(point=>{
        if(point[key]===null){previous=null;return;}
        const continuous=previous && point.tick-previous.tick<=typicalGap*2.1;
        path+=`${continuous?'L':'M'}${x(point.tick).toFixed(2)},${y(point[key]).toFixed(2)} `;
        previous=point;
      });
      if(!path)return;
      const node=svgElement('path',{d:path,class:'chart-series',stroke:color});if(dash)node.setAttribute('stroke-dasharray',dash);svg.append(node);
      const last=points[points.length-1];if(last[key]!==null&&!dash)svg.append(svgElement('circle',{cx:x(last.tick),cy:y(last[key]),r:3,fill:color,stroke:'#111b27','stroke-width':2}));
    });
    const guide=svgElement('line',{x1:0,y1:pad.top,x2:0,y2:height-pad.bottom,class:'chart-crosshair',visibility:'hidden'});svg.append(guide);
    const hit=svgElement('rect',{x:pad.left,y:pad.top,width:width-pad.left-pad.right,height:height-pad.top-pad.bottom,class:'chart-hit',tabindex:0,role:'group','aria-label':'趋势图。使用左右方向键逐点查看。'});
    svg.append(hit);root.append(svg);
    const tooltip=element('div','chart-tooltip');tooltip.hidden=true;root.append(tooltip);
    let focusedIndex=points.length-1;
    const showPoint=index=>{
      focusedIndex=clamp(index,0,points.length-1);const point=points[focusedIndex];const px=x(point.tick);
      guide.setAttribute('x1',px);guide.setAttribute('x2',px);guide.setAttribute('visibility','visible');
      tooltip.textContent=`TICK ${integer(point.tick)}\n实际开采  ${format(point.harvest,2)} e/t\n发展投入  ${format(point.growth,2)} e/t\n有效用能  ${format(point.utilization,2)} e/t\n理论供给  ${format(point.theoretical,2)} e/t`;
      tooltip.hidden=false;tooltip.style.left=`${clamp(px/width*root.clientWidth-70,0,Math.max(0,root.clientWidth-170))}px`;
      hit.setAttribute('aria-label',tooltip.textContent);
    };
    const hide=()=>{tooltip.hidden=true;guide.setAttribute('visibility','hidden');};
    hit.addEventListener('pointermove',event=>{const bounds=svg.getBoundingClientRect();const cursor=(event.clientX-bounds.left)/bounds.width*width;let nearest=0;for(let i=1;i<points.length;i++)if(Math.abs(x(points[i].tick)-cursor)<Math.abs(x(points[nearest].tick)-cursor))nearest=i;showPoint(nearest);});
    hit.addEventListener('pointerleave',hide);hit.addEventListener('focus',()=>showPoint(focusedIndex));hit.addEventListener('blur',hide);
    hit.addEventListener('keydown',event=>{if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();showPoint(focusedIndex+(event.key==='ArrowLeft'?-1:1));}if(event.key==='Escape')hide();});
  }

  function renderFlow(data) {
    const m=data.metrics, root=$('flow-content');root.replaceChildren();
    const rows=[['实际开采',m.harvest,'#eeb557','input'],['升级投入',m.upgrade,'#67c9b3',''],['有效建设',m.build,'#789dbf',''],['运营及其他支出',m.operating,'#748795',''],['库存净变化',m.stock,'#a1ada5','signed'],['账本残差',m.residual,'#536875','residual signed']];
    if(m.imports!==null&&m.imports!==0)rows.splice(1,0,['跨区输入',m.imports,'#b7b29c','']);
    if(m.exports!==null&&m.exports!==0)rows.splice(rows.length-1,0,['跨区输出',m.exports,'#899ab3','']);
    const scale=Math.max(1,...rows.map(([,value])=>Math.abs(value??0)));
    rows.forEach(([label,value,color,extra])=>{
      const row=element('div',`flow-row ${extra}`);const name=element('span','flow-label');const dot=element('i');dot.style.background=color;name.append(dot,document.createTextNode(label));
      const track=element('div','flow-track');const fill=element('span');fill.style.width=`${value===null?0:Math.abs(value)/scale*100}%`;fill.style.background=color;track.append(fill);
      const val=element('span','flow-value',extra.includes('signed')?signed(value):format(value));
      row.append(name,track,val);root.append(row);
    });
  }

  function detailRow(label, value, className='') {
    const row=element('div','detail-row');row.append(element('span','',label),element('strong',className,value));return row;
  }
  function renderEconomy(data) {
    const costs=$('cost-breakdown');costs.replaceChildren();
    const m=data.metrics,e=data.economy;
    [['孵化：续代 / 扩编',m.spawn],['维修',m.repair],['塔耗能',m.tower],['运输链路损耗 · 不计入有效用能',m.linkLoss],['规划外建设 · 不计入有效用能',m.otherBuild]].forEach(([label,value])=>costs.append(detailRow(label,`${format(value)} e/t`)));
    setText('cost-coverage', `孵化 / 维修 / 塔 / 链路覆盖 ${integer(data.balances)} ticks，规划外建设覆盖 ${integer(data.observed)} ticks；总用能采用同一组有效样本。`);
    const budgets=$('budget-breakdown');budgets.replaceChildren();
    budgets.append(detailRow('现有编制续代成本 · 估算',`${format(m.upkeep)} e/t`));
    budgets.append(detailRow('总用能中的运营投入 · 同覆盖实际',`${format(m.usefulOperating)} e/t`));
    if(!Object.keys(e).length){budgets.append(emptyState('暂无用能预算',null,true));return;}
    budgets.append(detailRow('发展总预算 / 同覆盖实际',`${format(e.usefulEnergyTarget)} / ${format(m.utilizationProductive)} e/t`));
    budgets.append(detailRow('建设预算 / 实际投入',`${format(e.buildEnergyTarget)} / ${format(m.build)} e/t`));
    budgets.append(detailRow('升级 WORK 目标 / 实际投入',`${integer(e.upgradeWorkTarget)} WORK / ${format(m.upgrade)} e/t`));
    budgets.append(detailRow('必要储备积累预算',`${format(e.reserveRate)} e/t`));
    budgets.append(detailRow('全房库存净变化 · 单列',`${signed(m.stock)} e/t`));
  }
  function renderCPU(data) {
    const p=data.performance,summary=$('cpu-summary'),stages=$('cpu-stages');summary.replaceChildren();stages.replaceChildren();
    setText('cpu-samples',finite(p.samples)!==null?`${integer(p.samples)} ticks · T ${integer(p.tick)}`:'等待性能采样');
    summary.append(detailRow('平均 CPU / 额度',`${format(p.mean,2)} / ${format(data.cpu.limit,0)}`),detailRow('窗口峰值',format(p.max,2)),detailRow('CPU bucket',integer(data.cpu.bucket)),detailRow('持久数据体积',finite(p.memoryBytes)===null?'—':`${format(p.memoryBytes/1024)} KiB`));
    const names={memory:'持久数据解析',modules:'模块加载',defense:'防御',links:'链接传输',spawn:'出生与调度',planner:'布局与施工',strategy:'扩张决策',monitor:'能源账本与监控'};
    if(!Object.keys(object(p.stages)).length){stages.append(emptyState('等待分阶段 CPU 数据',null,true));return;}
    for(const [key,value] of Object.entries(object(p.stages)))stages.append(detailRow(names[key]||key,`${format(object(value).perTick,2)} CPU/t`));
    const roles=Object.values(object(p.roles)).map(value=>finite(object(value).perTick)).filter(value=>value!==null);
    if(roles.length)stages.append(detailRow('所有 creep 行为',`${format(roles.reduce((sum,v)=>sum+v,0),2)} CPU/t`));
    const movement=object(p.movement);
    if(finite(p.samples)>0)summary.append(detailRow('目标切换 / 受阻重算',`${integer(firstNumber(object(movement.deliverySwitches).total,0))} / ${integer(firstNumber(object(movement.pathResets).total,0))}`));
  }
  function renderMining(data) {
    const root=$('mining-content');root.replaceChildren();setText('mining-count',`${integer(data.mining.length)} SOURCES`);
    if(!data.mining.length){root.append(emptyState('暂无矿点遥测','等待服务端返回矿点快照。',true));return;}
    data.mining.forEach((source,index)=>{
      const item=element('div','source-card');const heading=element('div','source-title');
      heading.append(element('strong','',`SOURCE ${String(index+1).padStart(2,'0')} · ${integer(source.x)},${integer(source.y)}`));
      const backlog=finite(source.backlogSince), elapsed=backlog!==null&&data.tick!==null?Math.max(0,data.tick-backlog):null;
      heading.append(element('span',backlog!==null?'backlog':'',backlog!==null?`积压 ${integer(elapsed)} ticks`:`${integer(source.activeMiners)} 矿工在岗`));
      const values=element('div','source-values');
      [[source.stock,'矿点库存'],[source.dropped,'地面能量'],[source.potential,'当前能力 e/t']].forEach(([value,label])=>{const group=element('div');group.append(element('strong','',integer(value)),element('small','',label));values.append(group);});
      const footer=element('div','source-footer');footer.append(element('span','',`容器 ${integer(source.buffer)} / ${integer(source.bufferCapacity)}`),element('span','',`库存 ${signed(source.netStockRate)} e/t`));
      item.append(heading,values,footer);root.append(item);
    });
  }
  function renderHauling(data) {
    const root=$('hauling-content');root.replaceChildren();const h=data.hauling;
    if(!Object.keys(h).length){root.append(emptyState('暂无物流遥测',null,true));return;}
    const stats=element('div','operation-stats');
    [[h.count,'运输单位',false],[h.loaded,'已装载',false],[h.stalled,'停滞',true]].forEach(([value,label,warn])=>{const node=element('div');node.append(element('strong',`operation-value${warn&&value>0?' warning':''}`,integer(value)),element('small','',label));stats.append(node);});
    root.append(stats,detailRow('运输能量 / 运力',`${integer(h.energy)} / ${integer(h.capacity)}`),detailRow('疲劳单位',integer(h.fatigued)),detailRow('房间可用 / 容量',`${integer(firstNumber(data.room.spawnEnergy, typeof data.room.energy==='number'?data.room.energy:null))} / ${integer(data.room.capacity)}`),detailRow('账本覆盖总库存',`${integer(data.inventory.total)} energy`));
  }
  function renderInfrastructure(data) {
    const root=$('infrastructure-content');root.replaceChildren();const roads=data.roads,building=data.construction;
    if(!Object.keys(roads).length&&!Object.keys(building).length){root.append(emptyState('暂无基建遥测',null,true));return;}
    const progress=element('div','infrastructure-progress');const label=element('div','progress-label');label.append(element('span','','规划道路'),element('strong','',`${integer(roads.built)} / ${integer(roads.planned)}`));
    const track=element('div','micro-track');const fill=element('span');fill.style.width=`${clamp(divide(roads.built,roads.planned)??0)*100}%`;track.append(fill);progress.append(label,track);root.append(progress);
    root.append(detailRow('道路工地',integer(roads.sites)),detailRow('未覆盖沼泽路段',integer(roads.swampRemaining)));
    const construction=element('div','construction-list');
    const names={extension:'能量扩展',road:'道路',container:'容器',tower:'防御塔',storage:'仓储',spawn:'孵化器',link:'能量链接',rampart:'壁垒',constructedWall:'城墙',terminal:'终端'};
    const entries=Object.entries(building).filter(([,value])=>value&&typeof value==='object');
    if(!entries.length)construction.append(detailRow('其他建设工地',integer(data.room.constructionSites)));
    entries.forEach(([type,value])=>{const row=element('div','construction-row');row.append(element('span','',`${names[type]||type} · ${integer(value.sites)} 处`),element('span','',percent(divide(value.progress,value.total))));construction.append(row);});root.append(construction);
  }
  function renderDiagnostics(data) {
    const root=$('diagnostics-content');root.replaceChildren();
    const diagnostics=data.alerts.map(alert=>({title:alert.message,description:alertDescription(alert.code),level:alert.severity==='critical'||alert.severity==='error'?'error':'warning',since:alert.since,lastSeen:alert.lastSeen}));
    if(data.metrics.utilization !== null && data.metrics.utilization < EFFICIENCY_TARGET)diagnostics.unshift({title:'总用能率尚未达到长期 90% 目标',description:`所选窗口为 ${percent(data.metrics.utilization)}，距目标 ${format((EFFICIENCY_TARGET-data.metrics.utilization)*100)} 个百分点。${data.utilizationWarmingUp || data.utilizationEligible !== true ? '当前窗口仍需结合覆盖率与收支边界解读。' : '结合开采、供能、发展投入与运营成本排查差距。'}提高运营支出本身不代表改善，需同时核查发展转化率与费用合理性。`,level:data.utilizationWarmingUp || data.utilizationEligible !== true ? 'info' : 'warning'});
    if(data.hasWindow&&!data.hasUtilization)diagnostics.unshift({title:'等待新版总用能账本',description:'旧账本仍可展示发展与支出分项；总用能率等待服务端提供同一完整样本，不将不同覆盖时长的旧分项相加。',level:'info'});
    if(data.utilizationIndicator.status==='active'||data.utilizationIndicator.status==='pending')diagnostics.push({title:data.utilizationIndicator.status==='active'?'总用能率持续低于 90% 目标':'短窗口总用能偏低，等待持续确认',description:data.utilizationIndicator.status==='active'?'1,500-tick 主窗口已满足完整覆盖与收支条件。检查开采、交付和使用环节，并核查运营成本是否合理。':'尚未满足 1,500-tick 主窗口的持续确认条件。',level:data.utilizationIndicator.status==='active'?'warning':'info',since:finite(data.utilizationIndicator.since)});
    if(data.hasUtilization&&data.utilizationWarmingUp)diagnostics.push({title:'总用能统计仍在预热',description:`完整同覆盖样本为 ${integer(data.utilizationObserved)} / ${integer(data.windowSize)} ticks。历史缺失的成本数据不会当作零或补算。`,level:'info'});
    if(data.hasUtilization&&data.utilizationEligible===false&&!data.utilizationWarmingUp)diagnostics.push({title:'总用能窗口暂不用于持续判定',description:list(data.window.utilizationBlocked).map(reason=>({'warmup-or-gap':'窗口预热或存在采样缺口','utilization-warmup-or-gap':'总用能覆盖不足或存在采样缺口','unresolved-accounting':'支出归属缺少观测','incomplete-scope':'统计范围不完整','imports':'存在跨区输入','stock-drawdown':'正在消耗既有库存','unexplained-balance':'存在未归因收支或余额缺口'}[reason]||String(reason))).join(' · ')||'尚未满足服务端的可归因条件。',level:'info'});
    if(data.indicator.status === 'active' || data.indicator.status === 'pending')diagnostics.push({title:data.indicator.status === 'active'?'有效成长持续低于理论供给的 35%':'短窗口成长偏低，等待持续确认',description:data.indicator.status === 'active'?'1,500-tick 主窗口已满足覆盖与可归因条件。结合开采、运营支出和库存变化排查瓶颈。':'300-tick 窗口偏低。尚未满足 1,500-tick 主窗口的持续确认条件。',level:data.indicator.status === 'active'?'warning':'info',since:finite(data.indicator.since)});
    if(data.hasLedger&&data.hasWindow&&data.eligible===false&&!data.warmingUp)diagnostics.push({title:'该窗口暂不用于持续低效判定',description:list(data.window.blocked).map(reason=>({'warmup-or-gap':'窗口预热或存在采样缺口','incomplete-scope':'统计范围不完整','imports':'存在跨区输入','stock-drawdown':'正在消耗既有库存','unexplained-balance':'存在未归因收支或余额缺口'}[reason]||String(reason))).join(' · ') || '服务端尚未满足可归因条件。',level:'info'});
    if(data.scope.complete===false)diagnostics.push({title:'能量统计范围存在边界',description:`账本仅覆盖己方房间内实物能量；外矿生产不计入本房间理论供给。${finite(data.scope.remoteCreeps)!==null?'当前范围外单位 '+integer(data.scope.remoteCreeps)+'。':''} ${list(data.scope.reasons).map(String).join(' · ')}`,level:'info'});
    if(data.hasWindow&&data.balances!==null&&data.observed!==null&&data.balances!==data.observed)diagnostics.push({title:'分项统计的观测时长不同',description:`成长统计覆盖 ${integer(data.observed)} ticks，收支统计覆盖 ${integer(data.balances)} ticks，库存覆盖 ${integer(data.inventoryTicks)} ticks。各速率按各自有效观测时长计算，不能强制合成精确守恒图。`,level:'info'});
    if(data.hasLedger&&data.hasWindow&&data.warmingUp)diagnostics.push({title:'统计窗口仍在预热',description:`已覆盖 ${integer(data.observed)} / ${integer(data.windowSize)} ticks。当前速率仅代表已记录区间，持续低效判断等待满足覆盖与持续条件。`,level:'info'});
    const reasons=list(data.latest.reasons);
    if(data.latest.complete===false)diagnostics.push({title:'最近一次能量记录存在缺口',description:reasons.length?reasons.map(String).join(' · '):'服务端将当前记录标记为不完整。请结合覆盖率和账本残差解读数值。',level:'info'});
    setText('alert-count',data.alertsReported?`${integer(data.alerts.length)} 项持续报告`:'诊断未上报');
    if(!diagnostics.length){
      if(!data.alertsReported){root.append(emptyState('尚未收到诊断数据','未知状态不会按“全部正常”处理。',true));return;}
      const clear=element('div','clear-state');clear.append(element('span','','✓'),document.createTextNode('当前快照未报告持续异常。持续性判断以服务端监测规则为准。'));root.append(clear);return;
    }
    diagnostics.forEach(item=>{
      const row=element('div','alert-row');row.append(element('span',`alert-icon ${item.level}`,item.level==='info'?'i':'!'));
      const copy=element('div');copy.append(element('h3','',item.title),element('p','',item.description));row.append(copy);
      if(item.since!==undefined&&item.since!==null){const when=element('div','alert-time');when.append(document.createTextNode(`持续 ${integer(data.tick!==null?Math.max(0,data.tick-item.since):null)} ticks`),element('br'),document.createTextNode(`since ${integer(item.since)}`));row.append(when);}
      root.append(row);
    });
  }
  function alertDescription(code) {
    if(code.includes('source-backlog'))return '核查矿点提货、运输分配与交付路径；库存积压本身不等同于能量损失。';
    if(code.includes('haul'))return '核查运输单位的位置、疲劳和通行状态，结合矿点库存判断阻塞。';
    if(code.includes('growth')||code.includes('efficiency')||code.includes('energy'))return '结合有效成长、实际开采、运营消耗及库存变化定位原因；以满足覆盖要求的持续窗口为准。';
    if(code.includes('road'))return '结合规划道路完成度与施工队列核查通路。';
    if(code.includes('upgrade')||code.includes('stagn'))return '核查控制器周围供能和升级单位的工作状态。';
    return '该报告来自服务端监测；以最新 game tick 和持续时间为准。';
  }

  function schedulePoll() {
    clearTimeout(state.timer);
    if(!document.hidden)state.timer=setTimeout(fetchTelemetry,POLL_MS);
  }
  async function fetchTelemetry() {
    if(state.inFlight)return;
    state.inFlight=true;state.lastPoll=Date.now();
    const button=$('refresh-button');button.disabled=true;button.classList.add('loading');
    const abort=new AbortController();const timeout=setTimeout(()=>abort.abort(),15000);
    try {
      const response=await fetch('/api/telemetry',{method:'GET',headers:{Accept:'application/json'},cache:'no-store',credentials:'same-origin',signal:abort.signal});
      const payload=await response.json().catch(()=>{throw new Error('服务端未返回有效 JSON');});
      if(!payload||typeof payload!=='object'||Array.isArray(payload))throw new Error('遥测数据结构无效');
      if(!response.ok||payload.ok===false)throw new Error(typeof payload.error==='string'?payload.error:typeof object(payload.error).message==='string'?payload.error.message:`HTTP ${response.status}`);
      state.payload=payload;state.error='';
      // Independent views consume the existing request, without extra polling.
      document.dispatchEvent(new CustomEvent('screeps:telemetry',{detail:payload}));
      const normalized=normalizeTelemetry(payload,state.room,state.window);
      if(normalized.tick!==null){
        if(state.lastTick===null||normalized.tick!==state.lastTick){state.tickChangedAt=Date.now();state.hasTickComparison=false;}
        else state.hasTickComparison=true;
        state.lastTick=normalized.tick;
      }
    } catch(error) {
      state.error=error.name==='AbortError'?'请求超时':String(error.message||'网络连接失败');
    } finally {
      clearTimeout(timeout);state.inFlight=false;button.disabled=false;button.classList.remove('loading');render();schedulePoll();
    }
  }
  $('refresh-button').addEventListener('click',fetchTelemetry);
  $('room-select').addEventListener('change',event=>{state.room=event.target.value;render();});
  document.querySelectorAll('[data-window]').forEach(button=>button.addEventListener('click',()=>{
    const value=Number(button.dataset.window);if(!WINDOWS.includes(value))return;state.window=value;
    document.querySelectorAll('[data-window]').forEach(other=>other.setAttribute('aria-pressed',String(Number(other.dataset.window)===value)));render();
  }));
  document.addEventListener('visibilitychange',()=>{
    clearTimeout(state.timer);if(state.normalized)renderStatus(state.normalized);
    if(!document.hidden){if(Date.now()-state.lastPoll>=POLL_MS)fetchTelemetry();else schedulePoll();}
  });
  document.querySelectorAll('.rail-link').forEach(link=>link.addEventListener('click',()=>{document.querySelectorAll('.rail-link').forEach(other=>other.classList.toggle('active',other===link));}));
  render();fetchTelemetry();
})();

(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const repository = 'https://github.com/AdamZmy/Automated-Screeps';
  const labels = {running:'进行中',completed:'本轮完成',blocked:'受阻',skipped:'跳过',failed:'失败',planned:'计划中',ready:'待处理','in-progress':'处理中',verifying:'验证中',done:'已完成',passed:'通过',pending:'待验证',info:'信息',warning:'注意',critical:'严重'};
  const kinds = {scheduled:'定时巡检',manual:'手动巡检',backfill:'历史补录',setup:'系统建设'};
  const idPattern = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z-[a-z0-9-]{1,75}$/;
  const state = {days:[],runs:[],day:'',filter:'',selected:'',detail:null,detailStale:false,detailFetchedAt:null,indexStale:false,indexFetchedAt:null,indexError:'',detailError:'',busy:false,sequence:0,detailSequence:0};
  function element(tag, className, text) { const node=document.createElement(tag); if(className)node.className=className; if(text!==undefined)node.textContent=String(text); return node; }
  const text = value => value===null||value===undefined||value===''?'未记录':String(value);
  function time(value, short=false) { if(!value)return '未记录'; const d=new Date(value); if(!Number.isFinite(d.getTime()))return '时间不可用'; return new Intl.DateTimeFormat('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',...(short?{}:{second:'2-digit',timeZoneName:'short'}),hour12:false}).format(d); }
  function badge(value) { return element('span','badge '+(Object.hasOwn(labels,value)?value:'info'),labels[value]||'未知状态'); }
  function safeLink(url) { try { const u=new URL(url); return u.protocol==='https:'&&!u.username&&!u.password&&((u.origin==='https://github.com'&&(u.pathname==='/AdamZmy/Automated-Screeps'||u.pathname.startsWith('/AdamZmy/Automated-Screeps/')))||u.origin==='https://screeps-energy-observatory.vercel.app')?u.href:null; } catch { return null; } }
  function link(label,url,className) { const node=element('a',className,label),safe=safeLink(url); if(!safe)return element('span',className,label); node.href=safe;node.target='_blank';node.rel='noopener noreferrer';return node; }
  function issue(number) { return Number.isSafeInteger(number)&&number>0?link('#'+number,repository+'/issues/'+number,'issue-link'):null; }
  function visibleRuns() { return state.runs.filter(run=>!state.filter||run.status===state.filter); }
  function notice() {
    const messages=[];
    if(state.indexError)messages.push('日志列表刷新失败，保留此前内容。'+state.indexError);
    if(state.detailError)messages.push(state.detail&&state.detail.id===state.selected?'详情刷新失败，保留该批次此前内容。'+state.detailError:state.detailError);
    if(state.indexStale)messages.push('列表来自过时缓存，请稍后刷新。');
    if(state.detailStale)messages.push('当前详情来自过时缓存，请稍后刷新。');
    $('logs-notice').hidden=messages.length===0;$('logs-notice').textContent=messages.join(' ');
    $('sync-label').textContent=(state.indexFetchedAt?'列表读取于 '+time(state.indexFetchedAt):'尚未取得日志列表')+(document.hidden?' · 后台暂停刷新':' · GitHub 归档');
  }
  function updateURL(replace=false) { const u=new URL(location.href); u.search='';if(state.day)u.searchParams.set('day',state.day);if(state.selected)u.searchParams.set('id',state.selected);history[replace?'replaceState':'pushState']({},'',u.pathname+u.search); }
  function renderList() {
    const runs=visibleRuns(),host=$('run-list');host.replaceChildren();$('log-count').textContent=runs.length+' / '+state.runs.length+' 个批次';
    if(!runs.length)host.append(element('div','list-empty',state.runs.length?'此筛选下没有批次。':state.indexError?'无法读取日志，请重试。':'此范围尚无巡检记录。'));
    for(const run of runs){
      const button=element('button','run-card');button.type='button';button.dataset.id=run.id;button.setAttribute('aria-current',String(run.id===state.selected));
      const top=element('span','run-card-top');top.append(element('span','mono',time(run.startedAt,true)),badge(run.status));
      const foot=element('span','run-card-foot');foot.append(element('span','',kinds[run.kind]||'未知类型'),element('span','mono',Array.isArray(run.issueNumbers)&&run.issueNumbers.length?run.issueNumbers.map(n=>'#'+n).join(' · '):'无关联 Issue'));
      button.append(top,element('strong','run-card-title',run.title),element('span','run-card-summary',run.summary||'正在记录本轮进展。'),foot);
      button.addEventListener('click',()=>selectRun(run.id));host.append(button);
    }
  }
  function section(number,title,entries,emptyText,render) {
    const node=element('section','log-section'),heading=element('div','log-section-header');heading.append(element('span','section-number',number),element('h3','',title),element('span','section-total',entries.length));node.append(heading);
    if(!entries.length)node.append(element('p','section-empty',emptyText));else for(const item of entries)node.append(render(item));return node;
  }
  function itemTop(item,statusKey,titleKey='title') { const top=element('div','journal-item-top');top.append(badge(item[statusKey]),element('h4','',text(item[titleKey])));const ref=issue(item.issue);if(ref)top.append(ref);return top; }
  function renderDetail() {
    const host=$('run-detail');host.replaceChildren();const log=state.detail;
    if(!log||log.id!==state.selected){const box=element('div','detail-empty');box.append(element('span','empty-glyph','≡'),element('h2','',state.selected?'正在读取本次记录':'选择一个巡检批次'),element('p','',state.detailError||'问题、动作和后续进度会显示在这里。'));host.append(box);notice();return;}
    const top=element('div','detail-top'),eyebrow=element('div','detail-eyebrow');eyebrow.append(element('span','',kinds[log.kind]||'未知类型'),badge(log.status));top.append(eyebrow,link('GitHub 原始记录 ↗',repository+'/blob/main/operations/inspections/'+log.id.slice(0,10)+'/'+log.id+'.md'));
    host.append(top,element('h2','run-title',log.title),element('p','run-summary',log.summary||'本轮进行中，等待进一步记录。'));
    const meta=element('dl','run-meta'),game=log.game;
    for(const [name,value] of [['开始 / 结束',time(log.startedAt)+' / '+(log.completedAt?time(log.completedAt):'进行中')],['最近更新',time(log.updatedAt)],['游戏版本 / Tick',(game?text(game.version):'未观测')+' / '+(game&&Number.isSafeInteger(game.tick)?game.tick.toLocaleString():'未观测')],['观测范围 / 采样时间',game?(Array.isArray(game.rooms)?game.rooms.join(', '):'未记录')+' / '+time(game.fetchedAt):'本批次没有新的游戏采样']]){const row=element('div');row.append(element('dt','',name),element('dd','',value));meta.append(row);}host.append(meta);
    if(log.kind==='setup'||log.kind==='backfill')host.append(element('p','detail-note',log.kind==='setup'?'这是系统建设记录，不是一次新的游戏状态巡检。':'这是依据已有证据补录的历史记录，不能当作当前游戏状态。'));
    host.append(section('01','发现的问题',log.findings,'本轮没有记录新增问题；这不等于所有已有问题均已解决。',finding=>{const box=element('div','journal-item');box.append(itemTop(finding,'severity'),element('p','',finding.detail));if(finding.evidence.length){const list=element('ul');for(const e of finding.evidence)list.append(element('li','',e));box.append(list);}return box;}));
    host.append(section('02','待办与解决进度',log.tasks,'本轮没有新增待办。',task=>{const box=element('div','journal-item');box.append(itemTop(task,'status'));const p=element('p');p.append(element('span','item-label','当前进度 · '+text(task.owner)),document.createTextNode(task.progress));const next=element('p','task-next');next.append(element('span','item-label','下一步'),document.createTextNode(task.next));box.append(p,next);return box;}));
    host.append(section('03','本轮行动',log.actions,'本轮没有记录操作。',action=>{const box=element('div','timeline-item'),title=element('h4','',action.description);title.append(badge(action.status));box.append(element('div','timeline-time',time(action.at)),title,element('p','',action.result));return box;}));
    host.append(section('04','验证与结果',log.checks,'本轮未记录验证，不能据此判定修复生效。',check=>{const box=element('div','journal-item');box.append(itemTop(check,'result','name'),element('p','',check.detail));return box;}));
    host.append(section('05','下一轮跟进',log.next,'暂未记录下一检查点。',next=>element('p','section-empty',next)));
    if(log.references.length){const refs=element('div','reference-list');for(const ref of log.references)refs.append(link(ref.label+' ↗',ref.url));const sec=element('section','log-section');sec.append(refs);host.append(sec);}notice();
  }
  async function fetchData(query='') {
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
    try { const response=await fetch('/api/inspections'+query,{signal:controller.signal,headers:{Accept:'application/json'}}),body=await response.json(); if(!response.ok||!body.ok)throw new Error(body.error?.message||'GitHub 日志暂时不可用。');if(!body.data||body.data.schemaVersion!==1)throw new Error('日志格式无法识别。');return body; }
    catch(error){throw new Error(error.name==='AbortError'?'读取超时，请稍后重试。':error.message);}
    finally{clearTimeout(timer);}
  }
  async function loadDetail(id) {
    const sequence=++state.detailSequence;if(!id){state.detail=null;state.detailStale=false;state.detailError='';renderDetail();return;}
    $('run-detail').setAttribute('aria-busy','true');
    try {const data=await fetchData('?id='+encodeURIComponent(id));if(sequence!==state.detailSequence||id!==state.selected)return; if(data.data.id!==id||!Array.isArray(data.data.tasks))throw new Error('批次详情与请求不一致。');state.detail=data.data;state.detailError='';state.detailStale=Boolean(data.stale);state.detailFetchedAt=data.fetchedAt;}
    catch(error){if(sequence!==state.detailSequence||id!==state.selected)return;state.detailError=error.message;}
    finally{if(sequence===state.detailSequence){$('run-detail').setAttribute('aria-busy','false');renderDetail();}}
  }
  async function selectRun(id,replace=false) {state.selected=id;state.detailError='';state.detailStale=false;if(state.detail?.id!==id)state.detail=null;updateURL(replace);renderList();renderDetail();await loadDetail(id);}
  async function refresh({fromURL=false}={}) {
    const sequence=++state.sequence;state.busy=true;$('logs-refresh').disabled=true;
    try {
      const root=await fetchData();if(sequence!==state.sequence)return;if(!Array.isArray(root.data.days)||!Array.isArray(root.data.runs))throw new Error('日志索引不完整。');
      state.days=root.data.days;const select=$('log-day');select.replaceChildren(element('option','','最近 50 次'));select.firstChild.value='';
      for(const day of state.days){const option=element('option','',day);option.value=day;select.append(option);}if(state.day&&!state.days.includes(state.day)){const opt=element('option','',state.day);opt.value=state.day;select.append(opt);}select.value=state.day;
      const payload=state.day?await fetchData('?day='+encodeURIComponent(state.day)):root;if(sequence!==state.sequence)return;
      if(!Array.isArray(payload.data.runs))throw new Error('日期索引不完整。');
      state.runs=payload.data.runs;state.indexFetchedAt=payload.fetchedAt;state.indexStale=Boolean(root.stale||payload.stale);state.indexError='';renderList();
      const visible=visibleRuns();let id=state.selected;
      if(!id||(!fromURL&&!visible.some(run=>run.id===id)))id=visible[0]?.id||'';
      await selectRun(id,true);
    } catch(error){if(sequence!==state.sequence)return;state.indexError=error.message;renderList();notice();}
    finally {if(sequence===state.sequence){state.busy=false;$('logs-refresh').disabled=false;notice();}}
  }
  function readURL(){const p=new URLSearchParams(location.search),id=p.get('id')||'',day=p.get('day')||'';state.selected=idPattern.test(id)?id:'';state.day=/^\d{4}-\d{2}-\d{2}$/.test(day)?day:(state.selected?state.selected.slice(0,10):'');state.detail=null;state.detailError='';}
  $('logs-refresh').addEventListener('click',()=>refresh({fromURL:true}));
  $('log-day').addEventListener('change',()=>{state.day=$('log-day').value;state.selected='';state.detail=null;state.detailSequence++;updateURL();renderDetail();refresh();});
  $('log-status').addEventListener('change',()=>{state.filter=$('log-status').value;const runs=visibleRuns();selectRun(runs.some(r=>r.id===state.selected)?state.selected:(runs[0]?.id||''));});
  window.addEventListener('popstate',()=>{readURL();state.filter='';$('log-status').value='';renderDetail();refresh({fromURL:true});});
  document.addEventListener('visibilitychange',()=>{notice();if(!document.hidden&&!state.busy)refresh({fromURL:true});});
  setInterval(()=>{if(!document.hidden&&!state.busy)refresh({fromURL:true});},60000);
  readURL();refresh({fromURL:true});
})();

(() => {
  'use strict';
  const $ = (q, root = document) => root.querySelector(q);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const icons = {
    'chevron-left':'M15 18l-6-6 6-6','chevron-right':'M9 18l6-6-6-6','chevron-down':'M6 9l6 6 6-6',
    home:'M3 10l9-7 9 7v10H3z M9 20v-7h6v7',book:'M3 4h7a3 3 0 0 1 3 3v14a4 4 0 0 0-4-3H3z M13 7a3 3 0 0 1 3-3h5v14h-5a4 4 0 0 0-3 3',
    'book-open':'M3 4h7a3 3 0 0 1 2 2 3 3 0 0 1 2-2h7v15h-7a3 3 0 0 0-2 2 3 3 0 0 0-2-2H3z M12 6v15',
    file:'M5 3h10l4 4v14H5z M14 3v5h5 M8 12h8 M8 16h5','clipboard-list':'M8 4H5v17h14V4h-3 M9 2h6v5H9z M9 11h6 M9 15h6',
    user:'M20 21v-2a7 7 0 0 0-14 0v2 M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
    'user-round':'M20 21a8 8 0 0 0-16 0 M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
    shield:'M12 3l8 3v6c0 5-8 9-8 9S4 17 4 12V6z',
    'shield-check':'M12 3l8 3v6c0 5-8 9-8 9S4 17 4 12V6z M8 12l3 3 5-6',
    'hard-hat':'M3 16h18 M5 16v-3a7 7 0 0 1 14 0v3 M9 5v7 M15 5v7 M3 16v4h18v-4',
    calendar:'M4 5h16v16H4z M8 3v4 M16 3v4 M4 10h16 M8 14h2 M14 14h2 M8 17h2',
    'calendar-days':'M4 5h16v16H4z M8 3v4 M16 3v4 M4 10h16 M8 14h2 M14 14h2 M8 17h2',
    check:'M5 12l4 4L19 6','check-circle':'M22 11a10 10 0 1 1-6-9 M22 3L12 13l-3-3','circle-check':'M22 11a10 10 0 1 1-6-9 M22 3L12 13l-3-3',
    clock:'M12 7v5l3 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
    'circle-alert':'M12 8v5 M12 16h.01 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
    info:'M12 11v6 M12 7h.01 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
    'map-pin':'M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0z M15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
    camera:'M4 7h4l2-3h4l2 3h4v14H4z M16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
    scan:'M8 3H3v5 M16 3h5v5 M3 16v5h5 M16 21h5v-5 M4 12h16',
    'scan-face':'M8 3H3v5 M16 3h5v5 M3 16v5h5 M16 21h5v-5 M9 9h.01 M15 9h.01 M9 15c2 2 4 2 6 0',
    'id-card':'M3 5h18v14H3z M7 9h2v3H7z M6 15h4 M14 9h4 M14 13h4',
    play:'M8 4l12 8-12 8z',pause:'M8 5v14 M16 5v14',
    wallet:'M3 6h17v15H3z M3 6V3h14v3 M15 11h7v6h-7z M18 14h.01',
    receipt:'M5 2l3 2 4-2 4 2 3-2v20l-3-2-4 2-4-2-3 2z M9 8h6 M9 12h6 M9 16h4',
    'credit-card':'M2 5h20v15H2z M2 10h20 M6 15h3',
    'arrow-right':'M4 12h16 M14 6l6 6-6 6','arrow-up-right':'M6 18L18 6 M6 6h12v12',
    refresh:'M20 7V2l-4 4 M20 7a9 9 0 1 0 1 9 M20 7h-5',
    'refresh-cw':'M20 7V2l-4 4 M20 7a9 9 0 1 0 1 9 M20 7h-5',
    x:'M6 6l12 12 M18 6L6 18',settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M4 5l3-2 3 2h4l3-2 3 2-1 4 2 3-2 3 1 4-3 2-3-2h-4l-3 2-3-2 1-4-2-3 2-3z',
    'help-circle':'M9 8a3 3 0 1 1 5 3l-2 2v1 M12 17h.01 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
    'message-circle':'M21 11a9 9 0 0 1-9 9 10 10 0 0 1-5-1l-5 2 2-5a9 9 0 1 1 17-5',
    phone:'M6 3l4 5-3 3c2 3 4 5 7 6l3-3 5 4-2 4C10 23 1 14 2 5z',
    'log-out':'M9 3H3v18h6 M9 12h13 M17 7l5 5-5 5',
    'file-check':'M5 3h10l4 4v14H5z M14 3v5h5 M8 14l3 3 5-6',
    'list-checks':'M9 6h12 M9 12h12 M9 18h12 M2 5l2 2 3-3 M2 11l2 2 3-3 M2 17l2 2 3-3',
    copy:'M8 8h13v13H8z M16 8V3H3v13h5',award:'M12 3a6 6 0 1 1 0 12 6 6 0 0 1 0-12 M8 14l-1 8 5-3 5 3-1-8',
    'check-square':'M19 12v8H4V5h10 M8 11l4 4 9-11',
    'file-question':'M5 3h10l4 4v14H5z M14 3v5h5 M9 12a2 2 0 1 1 3 2v1 M12 18h.01',
    'wifi-off':'M2 2l20 20 M4 7a14 14 0 0 1 4-2 M13 5a14 14 0 0 1 9 4 M6 11a9 9 0 0 1 4-2 M15 10l3 2 M9 15a4 4 0 0 1 6 0 M12 19h.01',
    'circle-x':'M8 8l8 8 M16 8l-8 8 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
    'building-2':'M4 22V2h12v20 M16 8h5v14 M8 6h4 M8 10h4 M8 14h4 M8 18h4',
    'flame':'M12 2c2 6-2 7 1 11 2-1 3-3 3-5 6 5 6 14-4 14S1 14 5 9c0 4 3 5 3 2 0-3 2-6 4-9',
    'book-marked':'M5 3h15v18H5a3 3 0 0 1 0-6h15 M5 3a3 3 0 0 0-3 3v12 M14 3v8l-3-2-3 2V3'
  };
  const icon = (name = 'shield-check', cls = '') => `<svg class="icon ${esc(cls)}" viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[name] || icons['shield-check']}"></path></svg>`;
  const defaults = () => ({ route:'M07', previous:[], pkg:'398', orderDraft:null, orderId:0, orderHistory:[], paymentStatus:'unpaid', bookingMode:'first',appointmentUsed:false,appointmentKind:'',activeExamMode:null,examDeadline:null,examHistory:[], loggedIn:false, identity:false, paid:false, booked:false, date:'',slot:'',appointmentDate:'',appointmentSlot:'',bookingHistory:[],returnTo:'',todayMode:'appointment',signed:false,trained:false,attempt:0,remaining:3,answers:{},question:0,examActive:false,practice:false,refund:'none',enterprise:false,lastScore:null,lastPassed:null,selectedRecordIndex:null,recordIndex:0,wrongIndex:0,lessonIndex:1,selectedCourse:'施工现场安全基础',form:{},consents:{},captures:{},video:false,videoProgress:35,filter:{},scenarios:{payment:'success',booking:'success',location:'success',identity:'success',change:'success',refund:'review',exam:'actual'},dateOffset:0 });
  let state = defaults();
  let dataset = {screens:[]};
  let byId = new Map();
  let busy = false;
  let toastTimer, countdownTimer, countdown = 0;
  let modalLastFocus;
  const mainRoutes = {'首页':'M07','课程':'M35','考试':'M39','我的':'M50'};
  const tabIcons = {'首页':'home','课程':'book-open','考试':'clipboard-list','我的':'user-round'};
  const content = () => $('#app-content');
  const current = () => byId.get(state.route);
  const isSuspended = () => !['none','rejected'].includes(state.refund);
  const questionRoute = index => ['M41','M42','E14'][Math.min(2,Math.max(0,index))];
  const localDateLabel = value => {if(!value)return '尚未选择';const [year,month,day]=value.split('-').map(Number);return `${month}月${day}日 周${['日','一','二','三','四','五','六'][new Date(Date.UTC(year,month-1,day)).getUTCDay()]}`;};
  const save = () => { try { sessionStorage.setItem('safe-education-preview', JSON.stringify(state)); } catch {} };
  function amount(){ const purchase=['M13','M14','M15','M16','M17','E01','E02'].includes(state.route); return (purchase?state.orderDraft?.pkg||state.pkg:state.pkg)==='98'?'98':'398'; }
  function serviceName(){ return amount()==='98'?'单独考试':'培训加考试'; }
  function interpolate(value){ return String(value ?? '').replace(/\{\{?\s*(pkg|price|service|date|slot|remaining|attempt|name)\s*\}?\}/g,(_,key)=>({pkg:state.pkg,price:amount(),service:serviceName(),date:state.date||'请选择日期',slot:state.slot||'请选择时段',remaining:state.remaining,attempt:Math.max(state.attempt,1),name:state.form.name||'示例学员'}[key])); }
  function txt(value){return esc(interpolate(value));}
  function toast(message){ const node=$('#toast'); node.textContent=message; node.classList.add('visible'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>node.classList.remove('visible'),2600); }
  function go(id, options={}){
    if(!byId.has(id)){ toast('该页面正在整理，请从目录选择其他页面'); console.warn('Missing route',id); return; }
    closeModal();
    if(options.scene) seedScene(id);
    if(options.history!==false && id!==state.route) state.previous.push(state.route);
    state.route=id;
    if(options.pkg) state.pkg=String(options.pkg);
    if(['M41','M42','E14'].includes(id)) state.question=['M41','M42','E14'].indexOf(id);
    save();
    if(location.hash!==`#${id}`) history.replaceState(null,'',`#${id}`);
    render();
    if(!options.keepScroll) content().scrollTop=0;
    $('#prototype-panel').classList.remove('open'); $('#menu-toggle').setAttribute('aria-expanded','false');
  }
  function back(){ const page=current(); const id=state.previous.pop() || page?.back || 'M07'; go(byId.has(id)?id:'M07',{history:false}); }
  function seedScene(id){
    if(['M12','M19','M27'].includes(id)) state.pkg='98';
    if(['M11','M18','M26'].includes(id)) state.pkg='398';
    if(/^M(?:1[6-9]|2\d|3[0-4]|38|4\d|5[1-5])$/.test(id)){ state.loggedIn=true;state.identity=true;state.paid=true; }
    if(['M09','M25','M53'].includes(id)){state.enterprise=true;state.paid=true;state.booked=true;}
    else if(['M07','M08','M11','M12','M13','M52','M54'].includes(id)) state.enterprise=false;
    if(['M21','M22','M23','M24','M25','M26','M27','M28','M30','M31','M32','M33','M34','M38','M39','M40'].includes(id)){state.booked=true;state.date=state.date||'2026-11-03';state.slot=state.slot||'09:00–17:00';state.appointmentDate=state.appointmentDate||state.date;state.appointmentSlot=state.appointmentSlot||state.slot;}
    if(['M24','M34','M38','M40','M41','M42','M43','M44','M45','M46'].includes(id)) state.signed=true;
    if(['M40','M41','M42','M43','M44','M45','M46'].includes(id)) state.trained=true;
    if(id==='M07') {state.paid=false;state.booked=false;state.signed=false;}
    if(id==='M08') {state.paid=true;}
    if(id==='M23'||id==='M30') state.signed=false;
    if(id==='M38') {state.pkg='398';state.trained=false;}
    if(id==='M55') state.refund='review';
    if(id==='E09'){state.trained=true;state.signed=true;}
    if(id==='E07')state.signed=false;
    if(id==='E08'){state.pkg='398';state.signed=true;state.trained=false;}
    if(id==='E11'){state.remaining=0;state.paid=true;state.booked=true;}
    if(id==='E12')state.refund='success';
    if(id==='E13')state.refund='rejected';
    if(id==='E19')state.refund='manual';
    if(id==='E20')state.refund='failed';
  }
  function attrs(data={}){return Object.entries(data).filter(([,value])=>value!==undefined&&value!==null).map(([key,value])=>`data-${key}="${esc(value)}"`).join(' ');}
  function button(action, classes=''){
    if(typeof action==='string') action={label:action};
    const data={to:action.to,action:action.action,pkg:action.pkg,value:action.value};
    return `<button type="button" class="button ${esc(action.variant||'')} ${classes}" ${attrs(data)} ${action.disabled?'disabled':''}>${action.icon?icon(action.icon):''}<span>${txt(action.label||action.title||'继续')}</span></button>`;
  }
  function normalizeItem(item){if(typeof item==='string')return {label:item}; if(Array.isArray(item))return {label:item[0],value:item[1],to:item[2]};return item||{};}
  function getItems(block){return block.items || block.rows || block.options || block.fields || block.steps || [];}
  function sectionTitle(block){return block.title?`<div class="section-heading"><h2>${txt(block.title)}</h2>${block.link?`<button type="button" class="link-button" data-to="${esc(block.to||'M22')}">${txt(block.link)}${icon('chevron-right')}</button>`:''}</div>`:'';}
  function renderBlock(b,index){
    if(typeof b==='string')return `<p class="body-copy">${txt(b)}</p>`;
    const items=getItems(b); const key=`${state.route}-${index}`;
    switch(b.type){
      case 'hero': return `<section class="hero ${b.dark?'dark':''} ${esc(b.variant||'')}">${b.eyebrow?`<span class="hero-eyebrow">${txt(b.eyebrow)}</span>`:''}<h2>${txt(b.title||b.heading||'安全教育，安心出发')}</h2>${b.subtitle||b.text?`<p class="hero-subtitle">${txt(b.subtitle||b.text)}</p>`:''}<span class="hero-icon">${icon(b.icon||'shield-check')}</span>${b.button?button(b.button,'small light'):b.to?button({label:b.label||'报名预约',to:b.to},'small light'):''}</section>`;
      case 'product': {
        const price=String(b.price||b.amount||'398').replace(/[¥￥元]/g,'');
        return `<section class="product-card ${b.featured?'featured':''}"><button type="button" class="product-card-main" ${attrs({to:b.to,pkg:price,action:b.action||'select-product'})}><div class="product-top"><span class="tag">${txt(b.badge||b.tag||'安全教育')}</span>${icon(b.icon||'shield-check')}</div><h2 class="product-title">${txt(b.title||b.name||(price==='98'?'单独考试':'培训 + 考试'))}</h2><p class="product-subtitle">${txt(b.subtitle||b.desc||b.text||'先购买服务，再选择到场日期')}</p><div class="product-price"><span class="currency">¥</span>${txt(price)}<small>${txt(b.unit||'/ 人')}</small></div>${b.tags?`<div class="product-meta">${b.tags.map(t=>`<span class="tag gray">${txt(t)}</span>`).join('')}</div>`:''}</button><div class="product-footer"><span>${txt(b.footer||'次数以所购服务为准')}</span><strong>${txt(b.cta||'查看详情')}${icon('arrow-up-right')}</strong></div></section>`;
      }
      case 'status': {
        const tone=b.tone||b.variant||'success'; const iconName=b.icon || ({success:'circle-check',warning:'clock',error:'circle-alert',info:'shield-check'}[tone]||'circle-check');
        return `<section class="status-block"><div class="status-icon ${esc(tone)}">${icon(iconName)}</div><h2>${txt(b.title||b.heading)}</h2>${b.text||b.subtitle||b.desc?`<p>${txt(b.text||b.subtitle||b.desc)}</p>`:''}${b.score!==undefined?`<div class="score-ring ${Number(b.score)>=80?'pass':''}"><strong>${txt(b.score)}</strong><span>本次考试成绩</span></div>`:''}</section>`;
      }
      case 'notice':return `<aside class="notice ${esc(b.tone||b.variant||'')}">${icon(b.icon||'info')}<p>${b.title?`<strong>${txt(b.title)}</strong>${b.text?'\n':''}`:''}${txt(b.text||b.content||b.desc||'')}</p></aside>`;
      case 'section': return `<section>${sectionTitle(b)}${b.subtitle?`<p class="small-text" style="margin-top:6px">${txt(b.subtitle)}</p>`:''}${b.text||b.content?`<p class="body-copy">${txt(b.text||b.content)}</p>`:''}${b.blocks?b.blocks.map(renderBlock).join(''):''}${items.length?`<div class="spaced-stack">${items.map(it=>typeof it==='string'?`<p class="small-text">${txt(it)}</p>`:renderBlock(it,index)).join('')}</div>`:''}</section>`;
      case 'rows':return `<section>${sectionTitle(b)}<div class="rows">${items.map(normalizeItem).map(it=>`<div class="info-row"><span class="row-label">${txt(it.label||it.title||it.name)}</span><span class="row-value ${it.accent?'accent':''}">${txt(it.value??it.text??it.subtitle??'')}${it.copy?`<button class="row-copy" data-action="copy" data-value="${esc(it.value)}" aria-label="复制${esc(it.label)}">${icon('copy')}</button>`:''}</span></div>`).join('')}</div></section>`;
      case 'form': return renderForm(b,key);
      case 'calendar': return renderCalendar(b);
      case 'slots': return `<section>${sectionTitle({...b,title:b.title||'选择时段'})}<div class="slot-grid">${(items.length?items:[state.pkg==='398'&&!state.trained?'09:00–17:00':'09:00–10:00',state.pkg==='398'&&!state.trained?'培训与考试同日安排':'14:00–15:00']).map(normalizeItem).map((it,i)=>`<button type="button" class="slot" data-action="slot" data-value="${esc(it.value||it.label||it.title)}" aria-pressed="${state.slot===(it.value||it.label||it.title)}" ${it.disabled?'disabled':''}><strong>${txt(it.label||it.title||it.value)}</strong><small>${txt(it.subtitle||it.note||it.text||(state.pkg==='398'&&!state.trained?'整天场次':'可预约'))}</small></button>`).join('')}</div>${state.date?`<p class="selection-summary" style="margin-top:12px">已选 ${txt(state.date)}${state.slot?' · '+txt(state.slot):'，请选择时段'}</p>`:''}</section>`;
      case 'course':return `<section class="course-card"><button type="button" style="width:100%;padding:0;text-align:left" data-to="${esc(b.to||'M36')}"><div class="course-cover ${esc(b.color||b.variant||'')}"><div><small>${txt(b.eyebrow||'SAFETY EDUCATION')}</small><strong>${txt(b.cover||b.title||'安全生产基础')}</strong></div>${icon(b.icon||'hard-hat')}</div><div class="course-info"><h3>${txt(b.title||'安全生产基础知识')}</h3><p>${txt(b.subtitle||b.text||'系统学习，掌握安全作业要点')}</p><div class="progress"><span style="width:${Math.min(100,Math.max(0,Number(b.progress??35)))}%"></span></div><div class="progress-meta"><span>${txt(b.meta||'视频课程')}</span><span>已学 ${txt(b.progress??35)}%</span></div></div></button></section>`;
      case 'video':return `<section class="video-player"><div class="video-title">${txt(b.title||'安全生产基础知识')}</div><button type="button" class="play-button" data-action="video" aria-label="${state.video?'暂停':'播放'}视频">${icon(state.video?'pause':'play')}</button><div class="video-toolbar"><span>${state.video?'02:16':'02:08'}</span><div class="video-track"><span style="width:${state.videoProgress}%"></span></div><span>${txt(b.duration||'12:30')}</span></div></section>`;
      case 'question':return renderQuestion(b);
      case 'answers':return b.explanation?renderExplanation(b):renderAnswers(b);
      case 'menu':return `<section>${sectionTitle(b)}<div class="menu-list">${items.map(normalizeItem).map(it=>`<button type="button" class="menu-row" ${attrs({to:it.to,action:it.action,value:it.value})}><span class="menu-icon">${icon(it.icon||'file')}</span><span class="menu-label">${txt(it.label||it.title||it.name)}</span>${it.value||it.subtitle?`<small>${txt(it.value||it.subtitle)}</small>`:''}${icon('chevron-right')}</button>`).join('')}</div></section>`;
      case 'steps':return `<section>${sectionTitle(b)}<div class="steps">${items.map(normalizeItem).map((it,i)=>`<div class="step ${esc(it.status||it.state||(i<Number(b.active??0)?'done':i===Number(b.active??0)?'active':''))}"><div class="step-marker">${it.status==='done'||it.state==='done'||i<Number(b.active??0)?icon('check'):i+1}</div><div class="step-content"><strong>${txt(it.title||it.label)}</strong><p>${txt(it.text||it.subtitle||it.desc||'')}</p></div></div>`).join('')}</div></section>`;
      case 'identity':return renderIdentity(b,index);
      case 'stats':return `<section class="stats-grid">${items.map(normalizeItem).map((it,i)=>`<div class="stat ${i===0?'accent':''}"><strong>${txt(it.value||it.number||'0')}</strong><span>${txt(it.label||it.title)}</span></div>`).join('')}</section>`;
      case 'tabs':return `<div class="filter-tabs" role="tablist" aria-label="${esc(b.title||'筛选')}">${items.map(normalizeItem).map((it,i)=>`<button type="button" role="tab" class="filter-tab" ${attrs({action:'filter',key,value:it.value||it.label||it.title,to:it.to})} aria-selected="${(state.filter[key]||b.selected||normalizeItem(items[0]).label)===(it.value||it.label||it.title)}">${txt(it.label||it.title)}</button>`).join('')}</div>`;
      case 'quick':
      case 'grid':if(b.count)return renderAnswerGrid(b);return `<section>${sectionTitle(b)}<div class="quick-grid">${items.map(normalizeItem).map(it=>`<button type="button" ${attrs({to:it.to,action:it.action,value:it.value})}><span class="quick-icon">${icon(it.icon||'calendar')}</span><span>${txt(it.label||it.title)}</span></button>`).join('')}</div></section>`;
      case 'check':return `<label class="consent"><input type="checkbox" data-consent="${esc(state.route)}" ${state.consents[state.route]?'checked':''}><span>${txt(b.text)} ${state.route==='M01'?'<a href="#E18" data-action="agreement">查看协议</a>':''}</span></label>`;
      case 'link':return `<button type="button" class="route-inline" data-to="${esc(b.to)}">${txt(b.text)}${icon('chevron-right')}</button>`;
      case 'price':return `<section class="price-block"><small>${txt(b.unit==='应付金额'?b.unit:b.tag||'服务价格')}</small><div class="product-price"><span class="currency">¥</span>${txt(b.price)}${b.unit!=='应付金额'?`<small>${txt(b.unit||'/人')}</small>`:''}</div>${b.unit==='应付金额'?`<p class="small-text">${txt(b.tag)}</p>`:''}</section>`;
      case 'badge':return `<div><span class="tag">${txt(b.text)}</span></div>`;
      case 'benefits':return `<section class="benefit-list">${items.map(normalizeItem).map(it=>`<div class="benefit-item">${icon('circle-check')}<span>${txt(it.label||it.text)}</span></div>`).join('')}</section>`;
      case 'order':return renderOrder(b);
      case 'appointment':return renderAppointment(b);
      case 'comparison':return `<section class="comparison"><div><small>原预约</small><p>${txt(b.old)}</p></div><div class="comparison-arrow">${icon('arrow-right')}</div><div class="comparison-new"><small>新预约</small><p>${txt(b.new)}</p></div></section>`;
      case 'payment':return `<section class="payment-method"><span class="payment-mark">${icon('wallet')}</span><div><strong>${txt(b.title)}</strong><p>${txt(b.text)}</p></div><span class="payment-check">${icon('circle-check')}</span></section>`;
      case 'location':return `<section class="location-block"><div class="location-map"><div class="map-grid"></div><span class="map-radius"></span><span class="map-marker">${icon('map-pin')}</span><span class="map-label">海珠培训点</span></div><div class="location-copy"><h3>${txt(b.title)}</h3><p>${txt(b.distance)}</p><small>${txt(b.radius)}</small></div></section>`;
      case 'progress':return `<section><div class="label-value"><span class="muted">${txt(b.label)}</span><span>${Number(b.value)}%</span></div><div class="progress"><span style="width:${Number(b.value)}%"></span></div></section>`;
      case 'exam':return renderExam(b);
      case 'examBar':return `<section class="question-header"><span class="question-number">${state.question+1} / ${examQuestions.length}</span><span>${state.practice?'模拟练习':`第${Math.max(1,state.attempt)}次 / 共3次`}</span><span class="question-timer">${icon('clock')}<span id="exam-clock">${txt(b.time||'29:42')}</span></span></section>`;
      case 'score':return `<section class="status-block"><span class="tag ${b.tone==='success'?'green':'warning'}">${txt(b.label)}</span><div class="score-ring ${b.tone==='success'?'pass':''}"><strong>${txt(b.value)}</strong><span>${state.practice?'本次模拟成绩':'本次考试成绩'}</span></div></section>`;
      case 'record':return `<button type="button" class="record-card" data-action="open-record" data-record-index="${Number.isInteger(b.recordIndex)?b.recordIndex:''}" data-to="${esc(b.to)}"><div><strong>${txt(b.title)}</strong><p>${txt(b.date)}</p></div><div class="record-score"><strong>${txt(b.score)}</strong><small>${txt(b.state)}</small></div>${icon('chevron-right')}</button>`;
      case 'profile':return `<section class="profile-top"><span class="avatar">${icon('user-round')}</span><div><h2 class="profile-name">${txt(state.form.name||b.name)}</h2><div class="profile-meta"><span class="tag ${state.identity?'green':'gray'}">${state.identity?'已实名认证':'未实名认证'}</span></div><p class="small-text">${txt(b.text)}</p></div></section>`;
      case 'modal':return `<section class="modal-preview"><h2>${txt(b.title)}</h2><p>${txt(b.text)}</p><div class="spaced-stack">${button({label:b.primary,to:b.to,action:state.route==='E10'?'submit-exam':state.route==='E17'?'confirm-logout':undefined})}${button({label:b.secondary,to:b.cancel,variant:'secondary'})}</div></section>`;
      default: return `<section class="card">${b.title?`<h3>${txt(b.title)}</h3>`:''}${b.text||b.content?`<p class="small-text">${txt(b.text||b.content)}</p>`:''}${items.map(normalizeItem).map(it=>`<p class="label-value"><span>${txt(it.label||it.title)}</span><span>${txt(it.value||it.text)}</span></p>`).join('')}</section>`;
    }
  }
  function fieldId(field,index){const label=String(field.label||field.title||field.name||'');return field.key||field.name||field.id||(/手机号/.test(label)?'phone':/验证码/.test(label)?'code':/姓名/.test(label)?'name':/退款原因|原因/.test(label)?'reason':/身份证/.test(label)?'identityNo':`field${index}`);}
  function renderForm(b,key){
    const fields=getItems(b);
    return `<section>${sectionTitle(b)}<div class="error-summary" id="form-errors" role="alert" tabindex="-1"></div><div class="form-fields">${fields.map(normalizeItem).map((f,i)=>{
      const id=fieldId(f,i), label=f.label||f.title||f.name||''; const type=f.type||f.kind||(/手机号|验证码/.test(label)?'tel':'text'); const value=state.form[id]??f.value??'';
      if(type==='checkbox'||type==='consent')return `<label class="consent"><input type="checkbox" name="${esc(id)}" data-consent="${esc(id)}" ${state.consents[id]?'checked':''}><span>${txt(label||f.text)}</span></label>`;
      let input=type==='textarea'?`<textarea class="field-input" id="${esc(id)}" name="${esc(id)}" placeholder="${esc(f.placeholder||'请填写'+label)}" ${f.readonly?'readonly':''}>${esc(value)}</textarea>`:type==='select'?`<select class="field-input" id="${esc(id)}" name="${esc(id)}"><option value="">${esc(f.placeholder||'请选择')}</option>${(f.options||(/退款原因/.test(label)?['时间安排变化','暂时无法参加','其他原因']:['建筑施工','电工作业','高处作业','其他工种'])).map(normalizeItem).map(op=>`<option value="${esc(op.value||op.label)}" ${value===(op.value||op.label)?'selected':''}>${txt(op.label||op.value)}</option>`).join('')}</select>`:`<input class="field-input" type="${type==='phone'||type==='code'?'tel':esc(type)}" id="${esc(id)}" name="${esc(id)}" placeholder="${esc(f.placeholder||'请输入'+label)}" value="${esc(value)}" ${f.readonly?'readonly':''} ${/手机号/.test(label)?'inputmode="numeric" maxlength="11" autocomplete="tel"':/验证码/.test(label)?'inputmode="numeric" maxlength="6" autocomplete="one-time-code"':''}>`;
      if(/验证码/.test(label)) input=`<div class="verification-field">${input}<button type="button" class="send-code" data-action="send-code" ${countdown?'disabled':''}>${countdown?countdown+'秒后重新获取':'获取验证码'}</button></div>`;
      return `<div class="field"><label for="${esc(id)}" class="field-label">${f.required?'<span class="required">*</span>':''}${txt(label)}</label>${input}${f.hint||f.note?`<p class="field-hint">${txt(f.hint||f.note)}</p>`:''}<p class="field-error" data-error-for="${esc(id)}" hidden></p></div>`;
    }).join('')}${b.consent?`<label class="consent"><input type="checkbox" data-consent="agreement" ${state.consents.agreement?'checked':''}><span>${txt(b.consent)}</span></label>`:''}</div></section>`;
  }
  function renderCalendar(b){
    const baseDate=new Date(Date.UTC(2026,10+state.dateOffset,1));const year=baseDate.getUTCFullYear(),month=baseDate.getUTCMonth();const length=new Date(Date.UTC(year,month+1,0)).getUTCDate();const offset=(baseDate.getUTCDay()+6)%7;
    const training=b.mode?b.mode==='training':state.pkg==='398'&&!state.trained;const allowed=training?[2,4]:[1,3,5];const week=['一','二','三','四','五','六','日'];
    let days=Array.from({length:offset},()=>'<span></span>').join('');
    for(let d=1;d<=length;d++){const dt=new Date(Date.UTC(year,month,d));const value=`${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;const enabled=allowed.includes(dt.getUTCDay());const full=enabled&&d===12;days+=`<button type="button" class="day" data-action="date" data-value="${value}" aria-label="${month+1}月${d}日${full?'已满':enabled?'可预约':'不开放'}" aria-pressed="${state.date===value}" ${!enabled||full?'disabled':''}><span>${d}</span><small>${full?'已满':enabled?'可约':'休息'}</small></button>`;}
    return `<section class="calendar"><div class="calendar-header"><strong>${year}年${month+1}月</strong><div class="calendar-nav"><button type="button" data-action="month" data-value="-1" aria-label="上一月" ${state.dateOffset<=0?'disabled':''}>${icon('chevron-left')}</button><button type="button" data-action="month" data-value="1" aria-label="下一月">${icon('chevron-right')}</button></div></div><div class="calendar-grid">${week.map(w=>`<span class="weekday">${w}</span>`).join('')}${days}</div><div class="calendar-legend"><span><i class="legend-point"></i>可预约</span><span><i class="legend-point disabled"></i>未开放／已满</span></div></section>`;
  }
  function renderIdentity(b,index){
    if(b.mode==='face'||b.kind==='face'||/正脸|人脸/.test(b.title||''))return `<section><div class="camera-frame ${state.captures.face?'captured':''}">${icon(state.captures.face?'check':'user-round')}</div><p class="camera-caption">${txt(b.title)}<br>${txt(b.text||b.subtitle||'请保持正脸完整，确保光线充足')}</p>${button({label:state.captures.face?'重新拍摄':'拍摄正脸',action:'demo-capture',value:'face'},'secondary full')}</section>`;
    const key=b.kind==='id-back'?'back':'front';
    return `<button type="button" class="identity-card ${state.captures[key]?'selected':''}" data-action="demo-capture" data-value="${key}">${icon(state.captures[key]?'circle-check':'id-card')}<strong>${txt(b.title||'身份证采集')}</strong><small>${state.captures[key]?'已完成采集，点击可重拍':txt(b.text||'点击采集')}</small></button>`;
  }
  const examQuestions=[{type:'单选题',stem:'进入施工现场，以下哪项做法符合安全要求？',options:['正确佩戴安全帽，并系紧下颏带','为方便作业，可以不佩戴安全帽','只在有检查人员时佩戴安全帽','用普通遮阳帽代替安全帽'],correct:[0]}, {type:'多选题',stem:'开展高处作业前，应当落实哪些安全措施？',options:['检查安全带及防护设施','确认作业环境和天气条件','未培训人员可直接独立作业','设置警戒区域并做好现场防护'],correct:[0,1,3]}, {type:'判断题',stem:'发现安全隐患时，应及时报告并采取必要措施，不得冒险作业。',options:['正确','错误'],correct:[0]}];
  function renderQuestion(b){
    const historyMode=state.route==='M48'||state.route==='E15';
    const q=historyMode?{type:b.kind,stem:b.text,options:b.options}:examQuestions[state.question%examQuestions.length];
    return `<section><h2 class="question-stem"><span class="question-tag">${txt(q.type)}</span>${txt(q.stem)}</h2>${renderAnswers({items:q.options,historyMode,selected:historyMode?b.selected:undefined})}</section>`;
  }
  function renderAnswers(b){const q=examQuestions[state.question%examQuestions.length];const opts=getItems(b).length?getItems(b).map(normalizeItem).map(it=>it.label||it.text||it.title||it.value):q.options;const selected=b.selected||state.answers[state.question]||[];return `<section class="answers">${opts.map((label,i)=>`<button type="button" class="answer-option ${q.type==='多选题'?'multiple':''}" ${b.historyMode?'disabled':`data-action="answer" data-value="${i}"`} aria-pressed="${selected.includes(i)}"><span class="answer-letter">${q.type==='判断题'?icon(i===0?'check':'x'):String.fromCharCode(65+i)}</span><span class="answer-label">${txt(label)}</span></button>`).join('')}</section>`;}
  function renderExplanation(b){return `<section class="explanation"><div><span>正确答案</span><strong>${txt(b.correct)}</strong></div><div><span>我的答案</span><strong>${txt(b.mine)}</strong></div><hr><h3>解析</h3><p>${txt(b.explanation)}</p></section>`;}
  function renderAnswerGrid(){return `<div class="answer-grid">${examQuestions.map((q,i)=>`<button type="button" class="${state.answers[i]?.length?'answered':''} ${state.question===i?'current':''}" data-action="jump-question" data-value="${i}" aria-label="第${i+1}题${state.answers[i]?.length?'，已答':'，未答'}">${i+1}</button>`).join('')}</div>`;}
  function renderOrder(b){return `<section class="order-card"><button type="button" class="order-main" ${b.to?`data-to="${esc(b.to)}"`:''}><span class="order-icon">${icon(b.title?.includes('培训')?'hard-hat':'clipboard-list')}</span><div class="order-text"><strong>${txt(b.title)}</strong><p>${txt(b.text)}</p><span class="tag ${b.tag==='单位代付'?'gray':''}">${txt(b.tag)}</span></div><span class="order-price">¥${txt(b.price)}</span></button></section>`;}
  function renderAppointment(b){return `<section class="appointment-card"><div class="appointment-top"><span class="tag ${b.state==='今日已签到'?'green':''}">${txt(b.state)}</span>${b.to?`<button class="route-inline" data-to="${esc(b.to)}">${txt(b.cta||'查看详情')}${icon('chevron-right')}</button>`:''}</div><h3>${txt(b.title)}</h3><div class="appointment-date">${txt(b.date)}</div><p class="appointment-time">${icon('clock')}${txt(b.time)}</p><p class="appointment-place">${icon('map-pin')}海珠区培训点</p></section>`;}
  function renderExam(b){const practice=/模拟/.test(b.title||'');return `<section class="exam-card"><div class="product-top"><span class="tag ${practice?'gray':''}">${txt(b.state)}</span>${icon(practice?'book-marked':'clipboard-list')}</div><h3>${txt(b.title)}</h3><p>${txt(b.text)}</p><div class="exam-card-footer"><small>${txt(b.times)}</small><button type="button" class="button small ${practice?'secondary':''}" data-action="${practice?'practice-entry':'exam-entry'}" data-to="${esc(b.to)}">${txt(b.cta||'查看考试')}</button></div></section>`;}
  function pageView(original){
    const page=structuredClone(original);
    const transactional=['M13','M14','M15','M16','M17','M20','M21','M23','M24','M26','M27','M28','M29','M30','M31','M32','M34','M38','M40','M44','M45','M46','M52','M54','M55','E01','E04','E05','E12','E13','E19','E20'];
    const isTransaction=transactional.includes(page.id);
    const service=serviceName();const price=amount();const date=localDateLabel(['M20','M28'].includes(page.id)?state.date:state.appointmentDate||state.date);const slot=['M20','M28'].includes(page.id)?state.slot:state.appointmentSlot||state.slot;
    page.blocks=page.blocks.map(block=>{
      const b=structuredClone(block);
      if(isTransaction){
        if(b.type==='order'){b.title=service;b.price=price;b.text=price==='398'?'1次现场培训 · 本轮3次考试机会（示例）':'不含培训 · 本轮3次考试机会（示例）';}
        if(b.type==='price'){b.price=price+'.00';b.tag='安全教育 · '+service;}
        if(b.type==='rows')b.items=b.items.map(row=>{
          const item={...row};
          if(['服务','所购服务'].includes(item.label))item.value=service;
          if(/应付金额|实际支付|服务金额|申请退款金额|退款金额|申请金额|当前报价/.test(item.label))item.value='¥'+price+'.00';
          if(/报名人|预约人|服务对象|姓名/.test(item.label))item.value=state.form.name||'陈同学';
          if(/剩余机会|剩余考试机会/.test(item.label))item.value=state.remaining+'次（示例）';
          if(item.label==='付款来源')item.value=state.enterprise?'单位代付':'本人付款';
          if(item.label==='签到日期')item.value=state.appointmentDate||state.date||'2026-11-03';
          return item;
        });
        if(b.type==='appointment'){const bookingService=state.appointmentKind==='exam'||['M20','M28'].includes(page.id)&&(state.bookingMode==='next-exam'||state.pkg==='98'||state.trained)?'单独考试':service;b.title=state.enterprise?'单位代付 · '+bookingService:'安全教育 · '+bookingService;b.date=date;b.time=slot||'请选择时段';if(['M23','M24','M30'].includes(page.id))b.state=state.signed?'今日已签到':'未签到';}
        if(b.type==='comparison'){b.old=localDateLabel(state.appointmentDate)+' '+state.appointmentSlot;b.new=localDateLabel(state.date)+' '+state.slot;}
      }
      if(b.type==='profile')b.tag=state.identity?'已实名认证':'未实名认证';
      if(b.type==='rows')b.items=b.items.map(it=>({...it,value:['姓名','报名人','预约人','服务对象'].includes(it.label)?state.form.name||it.value:it.value}));
      if(b.type==='form')b.fields=b.fields.map(field=>({...field,kind:field.kind||'text'}));
      if(page.id==='M20'&&b.type==='notice')b.text=state.bookingMode==='next-exam'?'本次新增考试预约，不修改已使用预约，不收费、不重置剩余次数。':state.pkg==='98'?'本次仅安排考试，每名学员占1个名额。':'培训和关联考试同日安排，每名学员只占1个名额。';
      if(page.id==='M28'&&b.type==='notice')b.text=state.pkg==='398'&&!state.trained?'培训和关联考试一起改。改期失败时原预约继续有效。':'仅更换未参加的考试预约，不重复培训、不收费，失败时原安排保留。';
      if(['M18','M19','M26','M27','M29'].includes(page.id)){
        const training=state.pkg==='398'&&!state.trained&&page.id!=='M29';
        if(b.type==='calendar')b.mode=training?'training':'exam';
        if(b.type==='slots')b.items=training?['09:00–17:00 · 培训及考试']:['09:00–10:30','10:30–12:00','14:00–15:30'];
        if(b.type==='badge')b.text=training?'398元 · 培训加考试':state.pkg+'元 · 单独考试';
      }
      if(page.id==='M38'&&state.trained){if(b.type==='status'){b.title='本轮培训已确认';b.text='现在可前往考试须知，后续剩余考试无需重复培训。';b.tone='success';}if(b.type==='steps')b.active=2;if(b.type==='notice')b.text='本轮现场培训参加事实已确认。签到和考试记录仍分别保留。';}
      if(page.id==='M34'){if(b.type==='notice')b.text=state.pkg==='98'?'签到成功，可查看考试并进入须知。仍须主动点击开始，签到不扣次数。':'398元需先实际参加培训，并由工作人员确认后才能考试。';}
      if(['M40','M43','M44','M45'].includes(page.id)&&b.type==='stats')b.items=b.items.map(item=>({...item,value:item.label==='题目数量'||item.label==='本卷题数'?examQuestions.length+'题':item.label==='本轮考试'?'第'+Math.max(1,state.attempt)+'次':item.label==='剩余机会'?state.remaining+'次':item.value}));
      if(page.id==='M40'&&b.type==='benefits')b.items=b.items.map(v=>v.includes('第1次')?'本次为第'+(state.attempt+1)+'次考试（配置示例）':v);
      if(page.id==='M43'&&b.type==='section')b.subtitle='已答'+Object.values(state.answers).filter(a=>a.length).length+'题，共'+examQuestions.length+'题演示题';
      if(['M41','M42','E14'].includes(page.id)&&b.type==='progress'){b.value=Math.round(Object.values(state.answers).filter(a=>a.length).length/examQuestions.length*100);b.label='已答'+Object.values(state.answers).filter(a=>a.length).length+'题 / 共'+examQuestions.length+'题';}
      if(b.type==='score'&&state.lastScore!==null&&!['M48','E15'].includes(page.id))b.value=String(state.lastScore);
      if(page.id==='M39'&&b.type==='exam'&&!/模拟/.test(b.title)){
        b.times='本轮剩余'+state.remaining+'次（示例）';b.text=price+'元服务 · '+(state.signed?'今日已签到':'未签到');
        if(state.examActive&&state.activeExamMode!=='practice'){b.state='考试进行中';b.cta='继续答题';b.to=questionRoute(state.question);}
        else if(isSuspended()){b.state=state.refund==='success'?'本轮资格已结束':'退款处理中，服务暂停';b.cta='查看退款进度';b.to='M55';}
        else if(!state.paid){b.state='尚未购买服务';b.cta='报名预约';b.to='M10';}
        else if(!state.booked){b.state='已付款待预约';b.cta='去预约';b.to=state.pkg==='98'?'M19':'M18';}
        else if(!state.signed){b.state='等待现场签到';b.cta='去签到';b.to='E07';}
        else if(state.pkg==='398'&&!state.trained){b.state='等待培训确认';b.cta='查看培训状态';b.to='E08';}
        else if(state.remaining<=0){b.state='考试次数已用完';b.cta='查看记录';b.to='E11';}
        else{b.state='可开始考试';b.cta='查看考试须知';b.to='M40';}
      }
      if(page.id==='M39'&&b.type==='exam'&&/模拟/.test(b.title)&&state.examActive&&state.activeExamMode==='practice'){b.state='模拟练习进行中';b.cta='继续答题';b.to=questionRoute(state.question);}
      if(page.id==='M52'){
        if(b.type==='status'){b.title=isSuspended()?'退款处理中':!state.paid?state.paymentStatus==='pending'?'付款结果核实中':'待付款':state.booked?'已预约':'已付款待预约';b.text=isSuspended()?'本轮服务已暂停，请查看退款进度。':!state.paid?state.paymentStatus==='pending'?'付款结果尚未确认，请勿重复付款。':'请先完成原订单付款，确认后开通服务。':state.booked?'已安排到场日期，可查看本人预约。':'服务已开通，选择日期后完成预约。';}
        if(b.type==='menu')b.items=b.items.filter(it=>!it.label.includes('退款')||state.paid).map(it=>it.label.includes('退款')?{...it,to:isSuspended()?'M55':'M54',label:isSuspended()?'查看退款进度':it.label}:{...it,to:state.booked?'M23':state.pkg==='98'?'M19':'M18',label:state.booked?'查看本人预约':it.label});
      }
      if(page.id==='M55'){
        const statuses={review:['退款审核中','申请已收到，服务暂时暂停。','warning'],rejected:['本次申请未通过','仅解除本次退款暂停，其他暂停原因仍需处理。','warning'],manual:['审核通过，待人工退款','审核通过不等于退款到账。','warning'],processing:['人工退款办理中','工作人员办理后由运营核实登记。','warning'],failed:['退款仍在处理中','本次办理未成功，申请和服务暂停保留。','warning'],success:['退款已完成','本轮资格已结束，历史记录保留。','success']};const r=statuses[state.refund]||statuses[state.scenarios.refund]||statuses.review;
        if(b.type==='status'){b.title=r[0];b.text=r[1];b.tone=r[2];}
        if(b.type==='steps')b.active=state.refund==='success'?3:['manual','processing','failed'].includes(state.refund)?2:1;
        if(b.type==='rows')b.items=b.items.map(it=>({...it,value:it.label==='服务状态'?(state.refund==='success'?'已结束':state.refund==='rejected'?'本次暂停已解除':'已暂停'):it.label==='申请原因'?(state.form.reason||'时间安排变化'):it.value}));
      }
      return b;
    });
    if(page.id==='M08'){
      page.blocks=page.blocks.map(b=>b.type==='appointment'?state.booked?{...b,title:'安全教育 · '+service,date:localDateLabel(state.appointmentDate),time:state.appointmentSlot,state:state.signed?'今日已签到':'待到场',to:state.signed?'M24':'M23'}:{type:'order',title:service,price,tag:'已付款待预约',text:'服务已开通，尚未选择日期',to:state.pkg==='98'?'M19':'M18'}:b);
    }
    if(page.id==='M22'){
      const first=page.blocks.findIndex(b=>b.type==='appointment');
      page.blocks=page.blocks.filter((b,i)=>b.type!=='appointment'||i===first);
      if(first>=0){if(state.booked)page.blocks[first]={type:'appointment',title:'安全教育 · '+service,date:localDateLabel(state.appointmentDate),time:state.appointmentSlot,state:state.appointmentUsed?'已参加考试':state.signed?'今日已签到':'待到场',to:state.signed?'M24':'M23',cta:'查看详情'};else page.blocks.splice(first,1,{type:'status',title:'还没有预约记录',text:'购买服务后即可预约未来到场日期。',tone:'soft',icon:'calendar-days'});}
      page.blocks.push(...state.bookingHistory.slice().reverse().map(b=>({type:'appointment',title:'历史预约 · '+(b.used?'已参加考试':'原安排'),date:localDateLabel(b.date),time:b.slot,state:'历史记录',to:'M47',cta:'查看记录'})));
    }
    if(page.id==='M51'){
      page.blocks=page.blocks.filter(b=>b.type==='tabs');
      const status=isSuspended()?state.refund==='success'?'已退款':'退款处理中':!state.paid?state.paymentStatus==='pending'?'付款核实中':'待付款':state.booked?'已预约':'已付款待预约';
      page.blocks.push({type:'order',title:service,price,tag:status,text:'本人本轮服务 · 剩余'+state.remaining+'次（示例）',to:isSuspended()?'M55':'M52'});
      page.blocks.push(...state.orderHistory.slice().reverse().map(o=>({type:'order',title:'历史订单 · '+(o.pkg==='98'?'单独考试':'培训 + 考试'),price:o.pkg,tag:o.refund==='success'?'已退款':'历史记录',text:'原订单、已用次数和成绩保留',to:'M47'})));
      if(state.enterprise)page.blocks.unshift({type:'order',title:service,price,tag:'单位代付',text:'本人资格，无需重复付款',to:'M53'});
    }
    if(['M48','E15'].includes(page.id)){
      const index=(page.id==='M48'?state.wrongIndex:state.recordIndex)%examQuestions.length;const q=examQuestions[index];const correct=q.correct.map(i=>String.fromCharCode(65+i)+' · '+q.options[i]).join('；');
      const selectedRecord=Number.isInteger(state.selectedRecordIndex)?state.examHistory[state.selectedRecordIndex]:state.examHistory.slice().reverse().find(r=>r.status==='submitted');
      const mine=page.id==='M48'?[q.options.length-1]:selectedRecord?selectedRecord.answers[index]||[]:q.correct;
      const mineText=mine.length?mine.map(i=>String.fromCharCode(65+i)+' · '+q.options[i]).join('；'):'未作答';
      page.blocks=page.blocks.map(b=>b.type==='question'?{...b,kind:q.type+(page.id==='M48'?' · 错题':' · 已评分记录'),index:index+1,total:examQuestions.length,text:q.stem,options:q.options,selected:mine}:b.type==='answers'?{...b,correct,mine:mineText,explanation:['进入施工现场应正确佩戴符合要求的个人防护用品。','高处作业前应检查防护用品、作业环境和警戒措施，禁止未经培训独立作业。','发现安全隐患应及时报告，并采取必要措施，不能冒险作业。'][index]}:b);
    }
    const filter=Object.entries(state.filter).find(([key])=>key.startsWith(page.id+'-'))?.[1];
    if(page.id==='M35'&&filter&&filter!=='全部课程')page.blocks=page.blocks.filter(b=>b.type!=='course'||(filter==='已完成'?Number(b.progress)===100:Number(b.progress)>0&&Number(b.progress)<100));
    if(page.id==='M47'&&state.examHistory.length){
      page.blocks=page.blocks.filter(b=>b.type!=='record');
      page.blocks.push(...state.examHistory.slice().reverse().map((r,i)=>({type:'record',title:r.mode==='practice'?'安全知识模拟练习':'安全教育培训考试',date:r.mode==='practice'?'模拟 · 独立记录':'本轮第'+r.attempt+'次',score:r.status==='timeout'?'未评分':r.score+'分',state:r.status==='timeout'?'超时未交卷':r.passed?'通过':'未通过',recordIndex:state.examHistory.length-1-i,to:r.status==='timeout'?'M46':'E15'})));
    }
    if(page.id==='M36'&&filter==='课程简介')page.blocks=page.blocks.filter(b=>b.type!=='menu').concat([{type:'section',title:'课程简介',text:'通过常见安全风险、个人防护用品及作业前检查等内容，帮助学员掌握基础安全知识。现场培训参加情况由工作人员另行确认。'}]);
    if(page.id==='M36')page.blocks=page.blocks.map(b=>b.type==='video'?{...b,title:state.selectedCourse}:b);
    if(page.id==='M37')page.blocks=page.blocks.map(b=>b.type==='video'?{...b,title:['认识常见安全风险','个人防护用品使用','作业前安全检查'][state.lessonIndex]}:b.type==='section'?{...b,title:'第'+(state.lessonIndex+1)+'课 · '+['认识常见安全风险','个人防护用品使用','作业前安全检查'][state.lessonIndex],subtitle:state.selectedCourse}:b);
    if(page.id==='M22'&&filter&&filter!=='全部')page.blocks=page.blocks.filter(b=>b.type!=='appointment'||(filter==='已完成'?b.state==='历史记录'||b.state==='已参加考试':b.state!=='历史记录'&&b.state!=='已参加考试'));
    if(page.id==='M51'&&filter&&filter!=='全部')page.blocks=page.blocks.filter(b=>b.type!=='order'||(filter==='待付款'?['待付款','付款核实中'].includes(b.tag):filter==='退款'?b.tag.includes('退款'):['已预约','已付款待预约','单位代付'].includes(b.tag)));
    if(page.id==='M39'&&filter==='模拟练习')page.blocks=page.blocks.filter(b=>b.type!=='exam'||/模拟/.test(b.title));
    if(page.id==='M39'&&filter==='正式考试')page.blocks=page.blocks.filter(b=>b.type!=='exam'||!/模拟/.test(b.title));
    if(page.id==='M39'&&filter==='考试记录')page.blocks=page.blocks.filter(b=>b.type!=='exam').concat([{type:'record',title:'安全教育培训考试',date:'本轮考试记录',score:state.lastScore!==null?state.lastScore+'分':'查看记录',state:'历史保留',to:'M47'}]);
    if(page.id==='M47'&&filter==='未交卷'){page.blocks=page.blocks.filter(b=>b.type!=='record'||b.state==='超时未交卷');if(!page.blocks.some(b=>b.type==='record'))page.blocks.push({type:'status',title:'暂无未交卷记录',text:'超时未交卷记录与已评分成绩分别展示。',tone:'soft',icon:'file'});}
    if(page.id==='M47'&&filter==='已交卷')page.blocks=page.blocks.filter(b=>b.type!=='record'||b.state!=='超时未交卷');
    if(page.id==='M52'){page.actions=[state.paid?{label:isSuspended()?'查看退款进度':state.booked?'查看预约':'去预约',to:isSuspended()?'M55':state.booked?'M23':state.pkg==='98'?'M19':'M18'}:state.paymentStatus==='pending'?{label:'查询付款结果',to:'M15'}:{label:'继续付款',to:'M14'}];}
    if(page.id==='M06'&&state.returnTo)page.actions=[{label:state.returnTo==='M13'?'继续报名':'返回原操作',to:state.returnTo}];
    if(page.id==='M14')page.actions=page.actions.map((a,i)=>i===0?{...a,label:'微信支付 ¥'+price+'.00'}:a);
    if(page.id==='M34'&&state.pkg==='98')page.actions=[{label:'查看我的考试',to:'M39'},{label:'查看预约详情',to:'M24',variant:'secondary'}];
    if(page.id==='M24'&&state.pkg==='98')page.actions=[{label:'查看我的考试',to:'M39'},{label:'更换预约时间',to:'M27',variant:'secondary'}];
    if(page.id==='M55'&&state.refund==='none')state.refund=state.scenarios.refund;
    return page;
  }
  function render(){
    const rawPage=current(); if(!rawPage)return; const page=pageView(rawPage);
    $('#screen-caption').textContent=`${page.id} · ${page.name||page.title}`;
    $('#page-counter').textContent=`${dataset.screens.findIndex(p=>p.id===page.id)+1} / ${dataset.screens.length}`;
    $('#app-header').innerHTML=`<button type="button" class="back-button" data-action="back" aria-label="返回">${icon(page.back===false?'home':'chevron-left')}</button><span class="app-header-title">${txt(page.title||page.name)}</span><span class="mini-capsule" aria-hidden="true"><span>•••</span><span class="capsule-circle"></span></span>`;
    content().innerHTML=(page.blocks||[]).map(renderBlock).join('');
    content().classList.remove('page-enter');requestAnimationFrame(()=>content().classList.add('page-enter'));
    const actions=page.actions||[];
    $('#action-bar').innerHTML=actions.map(action=>button(action)).join('');
    const tab=page.tab;
    $('#tab-bar').hidden=!tab;
    $('#tab-bar').innerHTML=Object.entries(mainRoutes).map(([label,id])=>`<button type="button" class="tab-item" data-tab="${esc(label)}" data-to="${id}" ${tab===label?'aria-current="page"':''}>${icon(tabIcons[label])}<span>${label}</span></button>`).join('');
    document.querySelectorAll('.screen-link').forEach(node=>node.setAttribute('aria-current',node.dataset.to===page.id?'page':'false'));
    $('#stage-description').textContent=`${page.group||'小程序'} · ${page.name||page.title}`;
    syncScenarioControls();
  }
  function renderDirectory(filter=''){
    const groups=new Map();dataset.screens.filter(p=>`${p.id} ${p.name} ${p.title}`.toLowerCase().includes(filter.toLowerCase())).forEach(p=>{const key=p.group||'其他状态';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(p);});
    $('#screen-directory').innerHTML=[...groups].map(([group,pages],i)=>`<details class="screen-group" ${filter||i<2?'open':''}><summary>${esc(group)}<span>${pages.length}</span></summary>${pages.map(p=>`<button type="button" class="screen-link" data-to="${esc(p.id)}" data-scene="true" ${p.id===state.route?'aria-current="page"':''}><span>${esc(p.id)}</span><span>${esc(p.name||p.title)}</span></button>`).join('')}</details>`).join('');
  }
  const scenarioDefinitions={payment:['付款结果',[['success','成功'],['pending','结果待核实'],['fail','未付款／失败'],['expired','订单过期']]],booking:['预约结果',[['success','成功'],['full','名额已满'],['fail','保存失败']]],location:['定位核验',[['success','范围内'],['outside','不在范围内'],['denied','授权失败'],['service','服务异常']]],identity:['照片核验',[['success','比对通过'],['mismatch','身份不符'],['service','服务异常']]],change:['改期结果',[['success','成功'],['full','新日期已满'],['fail','保存失败']]],refund:['退款进度',[['review','审核中'],['rejected','审核拒绝'],['manual','待人工退款'],['processing','办理中'],['failed','办理失败'],['success','退款成功']]],exam:['考试结果',[['actual','按答题评分'],['pass','通过'],['fail','未通过'],['timeout','超时未交卷']]]};
  function renderControls(){
    $('#quick-links').innerHTML=[['购买预约','M10'],['签到考试','M30'],['订单退款','M51']].map(([label,id])=>`<button type="button" data-action="quick-flow" data-to="${id}">${label}</button>`).join('');
    $('#scenario-controls').innerHTML=`<label class="scenario-control"><span>当前套餐</span><select id="scenario-pkg" data-scenario="pkg"><option value="398">398元 培训加考试</option><option value="98">98元 单独考试</option></select></label><label class="scenario-control"><span>培训参加确认</span><select id="scenario-trained" data-scenario="trained"><option value="false">尚未确认</option><option value="true">工作人员已确认</option></select></label>`+Object.entries(scenarioDefinitions).map(([key,[label,options]])=>`<label class="scenario-control"><span>${label}</span><select id="scenario-${key}" data-scenario="${key}">${options.map(([value,text])=>`<option value="${value}">${text}</option>`).join('')}</select></label>`).join('')+`<label class="scenario-control"><span>签到演示日期</span><select data-scenario="todayMode"><option value="appointment">按本人预约当天演示</option><option value="other">非预约当天</option></select></label><p class="panel-note">交互原型使用3道示例题，题型覆盖单选、多选和判断。侧栏培训状态代表工作人员确认结果，学员页面不能自行确认。</p><button class="reset-demo" type="button" data-action="fill-demo">预填演示资料</button><button class="reset-demo" type="button" data-action="timeout">演示本次考试超时</button>`;
  }
  function syncScenarioControls(){document.querySelectorAll('[data-scenario]').forEach(el=>{const key=el.dataset.scenario;el.value=key==='pkg'?state.pkg:key==='trained'?String(state.trained):key==='todayMode'?state.todayMode:state.scenarios[key];});}
  function closeModal(){const root=$('#modal-root');if(root?.firstChild){root.innerHTML='';modalLastFocus?.focus();}}
  function modal({title,body,actions=[],dialog=false,html=''}){
    modalLastFocus=document.activeElement;
    $('#modal-root').innerHTML=`<div class="modal-backdrop ${dialog?'dialog-mode':''}"><section class="${dialog?'modal-dialog':'modal-sheet'}" role="dialog" aria-modal="true" aria-labelledby="modal-heading" tabindex="-1">${dialog?'':'<div class="sheet-handle"></div>'}<button class="modal-close" type="button" data-action="close-modal" aria-label="关闭">${icon('x')}</button><h2 class="modal-title" id="modal-heading">${esc(title)}</h2>${body?`<p class="modal-body">${esc(body)}</p>`:''}${html}<div class="modal-actions">${actions.map(a=>button(a)).join('')}</div></section></div>`;
    requestAnimationFrame(()=>$('#modal-root [role=dialog]').focus());
  }
  function validate(fields){
    const errors=[];
    fields.forEach(([name,test,message])=>{const input=$(`[name="${CSS.escape(name)}"]`,content());const error=$(`[data-error-for="${CSS.escape(name)}"]`,content());const valid=test(state.form[name]??'');if(input)input.setAttribute('aria-invalid',String(!valid));if(error){error.textContent=valid?'':message;error.hidden=valid;}if(!valid)errors.push(message);});
    if(errors.length){const summary=$('#form-errors');if(summary){summary.textContent=errors.join('；');summary.focus();}else toast(errors[0]);return false;}return true;
  }
  async function settle(callback,buttonNode){if(busy)return;busy=true;if(buttonNode){buttonNode.disabled=true;buttonNode.classList.add('loading');}await new Promise(resolve=>setTimeout(resolve,420));try{callback();}finally{busy=false;if(buttonNode?.isConnected){buttonNode.disabled=false;buttonNode.classList.remove('loading');}}}
  function routeFor(fragment,fallback){return dataset.screens.find(p=>new RegExp(fragment).test(`${p.name||''} ${p.title||''}`))?.id||fallback;}
  function ensureDate(){if(!state.date||!state.slot){toast('请先选择日期和时段');return false;}return true;}
  function beginOrder(){
    if(state.examActive){toast('请先完成当前进行中的考试，再购买新一轮服务');return false;}
    if(state.orderDraft?.submitted)return true;
    const selected=state.orderDraft?.pkg||state.pkg;
    if(state.orderId||state.paid||state.booked||state.attempt>0||state.refund!=='none')state.orderHistory.push({id:state.orderId,pkg:state.pkg,paid:state.paid,remaining:state.remaining,attempt:state.attempt,refund:state.refund,date:state.appointmentDate,slot:state.appointmentSlot,trained:state.trained,used:state.appointmentUsed,lastScore:state.lastScore,lastPassed:state.lastPassed,answers:structuredClone(state.answers)});
    if(state.booked)state.bookingHistory.push({date:state.appointmentDate,slot:state.appointmentSlot,signed:state.signed,used:state.appointmentUsed});
    state.orderId++;state.pkg=selected;state.orderDraft={pkg:selected,submitted:true};state.paymentStatus='unpaid';state.paid=false;state.booked=false;state.date='';state.slot='';state.appointmentDate='';state.appointmentSlot='';state.appointmentUsed=false;state.appointmentKind='';state.signed=false;state.trained=false;state.attempt=0;state.remaining=3;state.refund='none';state.answers={};state.question=0;state.examActive=false;state.activeExamMode=null;state.practice=false;state.bookingMode='first';state.lastScore=null;state.lastPassed=null;
    save();return true;
  }
  function usedAppointment(){modal({title:'已使用的预约不能改期',body:'本次预约已经参加过考试。请凭本轮剩余次数预约下次考试，原预约和考试记录保留。',actions:[{label:'预约下次考试',to:'M29'},{label:'查看考试记录',to:'M47',variant:'secondary'}]});}
  function newExam(){
    if(state.examActive){state.practice=state.activeExamMode==='practice';go(questionRoute(state.question));return;}
    if(!state.loggedIn){state.returnTo=state.practice?'M49':'M40';go('M01');return;}
    if(!state.identity){state.returnTo=state.practice?'M49':'M40';go('M03');return;}
    if(!state.practice&&(!state.paid||!state.booked||isSuspended())){toast(isSuspended()?'服务暂停期间不能新开考':'请先购买服务并完成预约');return;}
    if(!state.practice&&state.todayMode!=='appointment'){toast('仅可在有效预约日期开始新考试');return;}
    if(!state.practice&&!state.signed){modal({title:'请先完成签到',body:'当天有效签到后，才能开始本次考试。签到不会消耗考试次数。',actions:[{label:'去签到',to:'M30'},{label:'稍后再说',action:'close-modal',variant:'secondary'}]});return;}
    if(!state.practice&&state.pkg==='398'&&!state.trained){modal({title:'请先参加培训',body:'请先实际参加本轮现场培训，并由工作人员确认。签到和视频学习都不能代替培训参加确认。',actions:[{label:'查看培训状态',to:'M38'},{label:'知道了',action:'close-modal',variant:'secondary'}]});return;}
    if(!state.practice&&state.remaining<=0){modal({title:'考试次数已用完',body:'本轮考试记录已保留。如仍需考试，请重新购买服务。',actions:[{label:'重新购买',to:'M10'},{label:'查看记录',to:'M47',variant:'secondary'}]});return;}
    state.examActive=true;state.activeExamMode=state.practice?'practice':'formal';state.examDeadline=Date.now()+30*60*1000;state.question=0;state.answers={};if(!state.practice){state.attempt++;state.remaining--;state.appointmentUsed=true;}save();go('M41');
  }
  function answerCard(){const html=`<p class="small-text">已答 ${Object.keys(state.answers).length} / ${examQuestions.length} 题</p><div class="answer-grid">${examQuestions.map((q,i)=>`<button type="button" class="${state.answers[i]?.length?'answered':''} ${state.question===i?'current':''}" data-action="jump-question" data-value="${i}">${i+1}</button>`).join('')}</div>`;modal({title:'答题卡',html,actions:[{label:'确认交卷',action:'confirm-submit'},{label:'继续答题',action:'close-modal',variant:'secondary'}]});}
  function confirmSubmit(){const count=examQuestions.length-Object.values(state.answers).filter(a=>a.length).length;modal({title:count?`还有${count}题未作答`:'确认提交试卷？',body:count?'提交后将按已作答内容评分，未作答题按空白答案处理。':'交卷后本次答案将提交评分，无法继续修改。',dialog:true,actions:[{label:'继续答题',action:'close-modal',variant:'secondary'},{label:'确认交卷',action:'submit-exam'}]});}
  function finishExam(timeout=false){
    state.examActive=false;state.practice=state.activeExamMode==='practice';
    const correct=examQuestions.filter((q,i)=>{const a=[...(state.answers[i]||[])].sort();return a.length===q.correct.length&&a.every((v,k)=>v===q.correct[k]);}).length;
    const result=timeout?'timeout':state.scenarios.exam==='actual'?(correct===examQuestions.length?'pass':'fail'):state.scenarios.exam;
    state.lastScore=result==='timeout'?null:result==='pass'?state.scenarios.exam==='actual'?100:86:state.scenarios.exam==='actual'?Math.round(correct/examQuestions.length*100):56;state.lastPassed=result==='pass';
    state.examHistory.push({mode:state.practice?'practice':'formal',orderId:state.orderId,attempt:state.attempt,score:state.lastScore,passed:state.lastPassed,status:result==='timeout'?'timeout':'submitted',answers:structuredClone(state.answers)});state.examDeadline=null;
    save();go(result==='timeout'?'M46':state.practice?'E22':result==='fail'?'M45':'M44');
  }
  function act(action,to,node){
    const id=state.route;const value=node?.dataset.value;
    if(action==='back'){back();return;}
    if(action==='open-record'){state.selectedRecordIndex=node.dataset.recordIndex===''?null:Number(node.dataset.recordIndex);state.recordIndex=0;save();go(to);return;}
    if(action==='close-modal'){closeModal();return;}
    if(action==='begin-checkin'){act('locate','M31',node);return;}
    if(action==='confirm-refund'&&to){state.refund=state.scenarios.refund;go(to);return;}
    if(action==='date'){state.date=value;state.slot='';save();render();return;}
    if(action==='slot'){state.slot=value;save();render();return;}
    if(action==='month'){state.dateOffset=Math.max(0,state.dateOffset+Number(value));render();return;}
    if(action==='filter'){state.filter[node.dataset.key]=value;if(id==='M48')state.wrongIndex=value==='多选'?1:value==='判断'?2:0;if(to)go(to);else{render();toast(`已切换：${value}`);}return;}
    if(action==='select-product'){const sku=node.dataset.pkg||value||'398';state.orderDraft={pkg:String(sku),submitted:false};state.consents.M13=false;save();if(to)go(to);else go(sku==='98'?'M12':'M11');return;}
    if(action==='send-code'){
      if(!validate([['phone',v=>/^1\d{10}$/.test(v),'请输入正确的11位手机号']]))return;
      countdown=60;toast('演示验证码已准备：123456，不发送短信');render();clearInterval(countdownTimer);countdownTimer=setInterval(()=>{countdown=Math.max(0,countdown-1);document.querySelectorAll('.send-code').forEach(b=>{b.disabled=countdown>0;b.textContent=countdown?countdown+'秒后重新获取':'获取验证码';});if(!countdown)clearInterval(countdownTimer);},1000);return;
    }
    if(action==='demo-capture'){state.captures[value||'face']=true;save();render();toast('演示采集完成');return;}
    if(action==='video'){state.video=!state.video;state.videoProgress=state.video?40:35;render();return;}
    if(action==='answer'){const q=examQuestions[state.question%examQuestions.length];const index=Number(value);let selected=state.answers[state.question]||[];selected=q.type==='多选题'?(selected.includes(index)?selected.filter(v=>v!==index):[...selected,index]):[index];state.answers[state.question]=selected;save();render();return;}
    if(action==='next-question'){state.question=Math.min(examQuestions.length-1,state.question+1);save();go(questionRoute(state.question),{history:false});return;}
    if(action==='prev-question'){state.question=Math.max(0,state.question-1);save();go(questionRoute(state.question),{history:false});return;}
    if(action==='answer-card'){answerCard();return;}
    if(action==='jump-question'){state.question=Number(value);closeModal();save();go(questionRoute(state.question),{history:false});return;}
    if(action==='confirm-submit'){confirmSubmit();return;}
    if(action==='submit-exam'){if(!state.examActive){toast('此状态页没有进行中的考试，请从考试须知开始演示');return;}settle(()=>finishExam(false),node);return;}
    if(action==='timeout'){if(!state.examActive){toast('当前没有进行中的考试');return;}finishExam(true);return;}
    if(action==='start-exam'){newExam();return;}
    if(action==='copy'){toast('订单号已复制');if(navigator.clipboard?.writeText)navigator.clipboard.writeText(value||'演示订单').catch(()=>{});return;}
    if(action==='fill-demo'){state.form={...state.form,phone:'13800000000',code:'123456',name:'示例学员',reason:'本人暂无法参加，申请退回未使用服务费用'};state.consents={M01:true,M03:true,M13:true,M30:true,M40:true,M49:true,M54:true};save();render();toast('已预填演示资料');return;}
    if(action==='choose398'||action==='choose98'){
      state.orderDraft={pkg:action==='choose98'?'98':'398',submitted:false};state.consents.M13=false;
      if(!state.loggedIn){state.returnTo=to||'M13';go('M01');return;}
      go(to||'M13');return;
    }
    if(action==='identityConsent'){if(!state.consents.M03){toast('请先了解并同意实名核验用途');return;}go(to||'M04');return;}
    if(action==='exam-entry'){if(['M41','M42','E14'].includes(to)){state.practice=state.activeExamMode==='practice';go(to);return;}if(!state.loggedIn){state.returnTo=to||'M39';go('M01');return;}if(!state.identity){state.returnTo=to||'M39';go('M03');return;}go(to);return;}
    if(action==='practice-entry'){if(state.examActive){toast('请先完成当前进行中的考试');state.practice=state.activeExamMode==='practice';go(questionRoute(state.question));return;}state.practice=true;go(to||'M49');return;}
    if(action==='nextWrong'){state.wrongIndex++;go('M48',{history:false});toast('已切换下一道错题');return;}
    if(action==='nextRecord'){state.recordIndex++;go('E15',{history:false});toast('已切换下一题记录');return;}
    if(action==='quick-flow'){if(to==='M30'){state.paid=true;state.booked=true;state.identity=true;state.signed=false;state.date='2026-11-03';state.slot='09:00–17:00';state.appointmentDate=state.date;state.appointmentSlot=state.slot;state.loggedIn=true;}if(to==='M51'){state.paid=true;state.booked=true;}go(to);return;}
    if(action==='logout'){modal({title:'退出登录？',body:'退出后可使用本人手机号重新登录。',dialog:true,actions:[{label:'暂不退出',action:'close-modal',variant:'secondary'},{label:'退出登录',action:'confirm-logout'}]});return;}
    if(action==='confirm-logout'){state.loggedIn=false;go('M01');return;}
    if(action==='agreement'){modal({title:'服务协议与隐私说明',body:'此处为交互原型的协议展示状态。正式协议以机构确认的最终内容为准。定位、身份资料及正脸照片仅用于相应核验流程。',actions:[{label:'已阅读',action:'close-modal'}]});return;}
    if(action==='locate'||action==='location'){settle(()=>{const result=state.scenarios.location;if(result==='success'){go(to||'M32');}else modal({title:result==='outside'?'尚未到达培训地点':result==='denied'?'未获得定位权限':'定位服务暂不可用',body:result==='outside'?'请到达预约地点的允许范围内后再签到。当前未完成签到，不消耗考试次数。':'可以重新尝试；设备或服务异常时请联系有权限的现场工作人员核验。',actions:[{label:'重新尝试',action:'close-modal'},{label:'查看人工核验说明',to:'M33',variant:'secondary'}]});},node);return;}
    if(action==='practice'){state.practice=true;go(to||'M49');return;}
    if(id==='M01'&&to){if(!validate([['phone',v=>/^1\d{10}$/.test(v),'请输入正确的11位手机号'],['code',v=>v==='123456','请输入正确的演示验证码123456']]))return;if(!state.consents.M01){toast('请先阅读并同意服务协议和隐私政策');return;}state.loggedIn=true;settle(()=>go(to),node);return;}
    if(id==='M02'&&to){if(!validate([['name',v=>String(v).trim().length>=2,'请填写本人真实姓名']]))return;go(to);return;}
    if(id==='M04'&&to){if(!state.captures.front||!state.captures.back){toast('请先完成身份证正反面采集');return;}go(to);return;}
    if((id==='M05'||id==='M32')&&to){if(!state.captures.face)state.captures.face=true;settle(()=>{if(state.scenarios.identity==='success'){if(id==='M05')state.identity=true;else{if(!state.booked||isSuspended()){toast('本次预约或服务状态不可用于签到');return;}state.signed=true;}save();go(to);}else go('M33');},node);return;}
    if(id==='M13'&&to){if(!state.loggedIn){state.returnTo='M13';go('M01');return;}if(!state.consents.M13){toast('请先确认服务内容、考试次数及退费条款');return;}if(!beginOrder())return;go(to);return;}
    if(action==='confirm-order'&&to){state.consents.order=true;go(to);return;}
    if(id==='M14'&&to&&action==='pay'){if(state.paymentStatus==='pending'){go('M15');return;}modal({title:'微信支付演示',body:`本次订单金额 ¥${amount()}。这是本地交互演示，不发起真实付款。`,actions:[{label:'完成演示付款',action:'pay-result'},{label:'取消支付',to:'M17',variant:'secondary'}]});return;}
    if(action==='pay-result'){settle(()=>{const result=state.scenarios.payment;if(result==='success'){state.paid=true;state.paymentStatus='paid';state.enterprise=false;go('M16');}else{state.paymentStatus=result==='pending'?'pending':result==='expired'?'expired':'unpaid';go(result==='pending'?'M15':result==='expired'?'E02':'M17');}},node);return;}
    if(id==='M15'&&to&&action==='verifyPay'){if(state.scenarios.payment==='success'){state.paid=true;state.paymentStatus='paid';go('M16');}else toast('付款结果仍在核实中，请勿重复付款');return;}
    if(['M18','M19','M26','M27','M29'].includes(id)&&to){if(!ensureDate())return;state.bookingMode=id==='M29'?'next-exam':['M26','M27'].includes(id)?'change':'first';if(state.scenarios.booking==='full'&&['M18','M19','M29'].includes(id)){modal({title:'该日期名额已满',body:'请重新选择其他日期。本次未创建预约，不占名额，已付款资格保留。',actions:[{label:'重新选择',action:'close-modal'}]});return;}go(to);return;}
    if(id==='M20'&&to){if(!state.paid||isSuspended()){toast('请先完成付款，或处理服务暂停事项');return;}settle(()=>{if(state.scenarios.booking!=='success'){modal({title:state.scenarios.booking==='full'?'名额不足':'预约未保存成功',body:'本次不产生预约，也不占名额。已付款资格保留，可以重新选择日期。',actions:[{label:'重新选择',to:state.pkg==='98'?'M19':'M18'}]});return;}if(state.booked&&state.bookingMode==='next-exam')state.bookingHistory.push({date:state.appointmentDate,slot:state.appointmentSlot,signed:state.signed,used:state.appointmentUsed});state.booked=true;state.appointmentDate=state.date;state.appointmentSlot=state.slot;state.appointmentKind=state.bookingMode==='next-exam'||state.pkg==='98'||state.trained?'exam':'training';state.signed=false;state.appointmentUsed=false;go(to);},node);return;}
    if(id==='M28'&&to&&action==='reschedule'){if(state.appointmentUsed){usedAppointment();return;}if(isSuspended()){toast('退款处理中，暂不能改期');return;}if(state.examActive){toast('请先完成进行中的考试，不能通过改期取消');return;}settle(()=>{if(state.scenarios.change!=='success'){modal({title:'本次改期未完成',body:'原预约、原名额及签到适用关系保持不变，新日期未占位。请选择其他可约日期重试。',actions:[{label:'重新选时间',to:state.pkg==='98'||state.trained?'M27':'M26'},{label:'保留原安排',to:'M23',variant:'secondary'}]});return;}state.bookingHistory.push({date:state.appointmentDate,slot:state.appointmentSlot,signed:state.signed});state.appointmentDate=state.date;state.appointmentSlot=state.slot;state.appointmentKind=state.pkg==='98'||state.trained?'exam':'training';state.signed=false;state.booked=true;go(to);toast('改期成功，按新日期到场并重新签到');},node);return;}
    if(id==='M31'&&to){act('locate',to,node);return;}
    if(id==='M30'&&to&&action==='checkin'){if(!state.booked||!state.paid||isSuspended()){toast('需要本人有效预约和正常服务资格才能签到');return;}if(state.todayMode!=='appointment'){toast('今天不是预约日期，请在预约当天到场签到');return;}if(!state.consents.M30){toast('请先了解并同意定位及照片核验用途');return;}modal({title:'开始现场签到',body:'本原型将演示定位与照片核验，不调用真实定位和相机。仅定位成功不算签到完成。',actions:[{label:'开始核验',action:'begin-checkin',to},{label:'稍后再说',action:'close-modal',variant:'secondary'}]});return;}
    if(['M39','M40','M49'].includes(id)&&to==='M41'){if(!state.consents[id]&&id!=='M39'){toast('请先阅读并确认考试须知');return;}state.practice=id==='M49';newExam();return;}
    if(['M41','M42','E14'].includes(id)&&to){if(/下一题/.test(node.textContent)){act('next-question',null,node);return;}if(/上一题/.test(node.textContent)){act('prev-question',null,node);return;}if(/答题卡/.test(node.textContent)||to==='M43'){answerCard();return;}if(/交卷|提交/.test(node.textContent)){confirmSubmit();return;}}
    if(id==='M43'&&action==='submitDialog'){confirmSubmit();return;}
    if(id==='M54'&&to&&action==='refund'){if(!state.paid){toast('本单尚未确认付款，不能申请服务退款；如已扣款请先核实付款结果');return;}if(state.enterprise){toast('单位代付订单须由单位联系人办理退款');return;}if(state.refund!=='none'&&state.refund!=='rejected'){go('M55');return;}if(state.examActive||state.attempt>0||(state.pkg==='398'&&state.trained)){toast('本轮服务已使用，不能申请普通未使用退款');return;}if(!state.consents.M54){toast('请先确认退款后的服务暂停规则');return;}if(!validate([['reason',v=>String(v).trim().length>=4,'请填写退款原因，至少4个字']]))return;modal({title:'确认申请退款？',body:'申请接收后，该服务将暂停预约、改期、培训确认和新开考。审核通过后仍需人工办理退款。',actions:[{label:'确认申请',action:'confirm-refund',to},{label:'暂不申请',action:'close-modal',variant:'secondary'}]});return;}
    if(action==='confirm-refund'&&to){state.refund=state.scenarios.refund;go(to);return;}
    if(to){
      if(id==='M06'&&state.returnTo){to=state.returnTo;state.returnTo='';}
      if(to==='M36'){state.selectedCourse=node.closest('.course-card')?.querySelector('h3')?.textContent||state.selectedCourse;}
      if(id==='M37'&&to==='M37'){state.lessonIndex=(state.lessonIndex+1)%3;toast('已切换到下一课');}
      if(id==='M03'&&to==='M07'&&state.returnTo){to=state.returnTo;state.returnTo='';}
      if(id==='E17'&&to==='M01')state.loggedIn=false;
      if(['M18','M19','M26','M27','M29'].includes(to)&&isSuspended()){toast('服务已暂停，请先处理退款');return;}
      if(to==='M54'&&!state.paid){toast('请先核实付款，未确认收款不能申请普通服务退款');return;}
      if(to==='M54'&&(state.enterprise||state.trained||state.attempt>0)){toast(state.enterprise?'单位代付退款请联系单位联系人':'本轮服务已使用，不能申请普通未使用退款');return;}
      if(['M26','M27'].includes(to)&&state.examActive){toast('本次考试进行中，请先完成考试');return;}
      if(['M26','M27'].includes(to)&&state.appointmentUsed){usedAppointment();return;}
      if(to==='M29'&&(state.examActive||!state.paid||state.remaining<=0||state.pkg==='398'&&!state.trained)){toast('请先完成当前考试，并确认有效资格、剩余次数及培训条件');return;}
      if(to==='M14'&&state.paymentStatus==='pending'){go('M15');return;}
      if(node?.dataset.pkg)state.pkg=node.dataset.pkg;if(id==='M16'&&to==='M18')to=state.pkg==='98'?'M19':'M18';if((id==='M23'||id==='M24'||id==='M25')&&to==='M26')to=state.pkg==='98'||state.trained?'M27':'M26';go(to);return;}
    toast('已更新演示状态');
  }
  function bind(){
    document.addEventListener('click',event=>{
      const target=event.target.closest('button,a');if(!target||target.disabled)return;
      if(target.id==='menu-toggle'){const panel=$('#prototype-panel');const open=panel.classList.toggle('open');target.setAttribute('aria-expanded',String(open));return;}
      if(target.id==='reset-demo'){closeModal();state=defaults();save();go('M07',{history:false});renderDirectory();toast('演示已重置');return;}
      if(target.matches('[data-scene]')){go(target.dataset.to,{scene:true});return;}
      if(target.closest('#tab-bar')){if(target.dataset.tab==='首页')go(state.enterprise?'M09':state.paid?'M08':'M07');else go(target.dataset.to);return;}
      if(target.dataset.action||target.dataset.to){event.preventDefault();act(target.dataset.action,target.dataset.to,target);}
      else if(target.closest('.product-footer')){toast('点击套餐卡片查看详情');}
    });
    document.addEventListener('input',event=>{if(event.target.id==='screen-search'){renderDirectory(event.target.value);return;}if(event.target.name){state.form[event.target.name]=event.target.value;save();}});
    document.addEventListener('change',event=>{
      const el=event.target;
      if(el.dataset.consent){state.consents[el.dataset.consent]=el.checked;save();}
      if(el.dataset.scenario){const key=el.dataset.scenario;if(key==='pkg'){state.pkg=el.value;state.date='';state.slot='';}else if(key==='trained'){if(isSuspended()){el.value=String(state.trained);toast('服务暂停期间不能确认参加培训');return;}state.trained=el.value==='true';}else if(key==='todayMode')state.todayMode=el.value;else{state.scenarios[key]=el.value;if(key==='refund'&&state.refund!=='none')state.refund=el.value;};save();render();toast('演示状态已更新');}
    });
    document.addEventListener('keydown',event=>{const dialog=$('#modal-root [role=dialog]');if(!dialog)return;if(event.key==='Escape'){closeModal();return;}if(event.key==='Tab'){const focusables=dialog.querySelectorAll('button,input,select,textarea,a[href],[tabindex="0"]');const first=focusables[0],last=focusables[focusables.length-1];if(!first)return;if(event.shiftKey&&(document.activeElement===first||document.activeElement===dialog)){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}});
    setInterval(()=>{if(!state.examActive||!state.examDeadline)return;const seconds=Math.max(0,Math.ceil((state.examDeadline-Date.now())/1000));const clock=$('#exam-clock');if(clock)clock.textContent=String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');if(seconds===0)finishExam(true);},1000);
    window.addEventListener('hashchange',()=>{const id=location.hash.slice(1);if(byId.has(id)&&id!==state.route)go(id);});
  }
  async function init(){
    if(new URLSearchParams(location.search).has('embed')) document.body.classList.add('embedded');
    bind();
    try{
      const response=await fetch('./screens.json',{cache:'no-store'});if(!response.ok)throw new Error(`页面数据尚未就绪（${response.status}）`);dataset=await response.json();if(!Array.isArray(dataset.screens)||!dataset.screens.length)throw new Error('页面数据为空');byId=new Map(dataset.screens.map(p=>[p.id,p]));
      try{const saved=JSON.parse(sessionStorage.getItem('safe-education-preview')||'null');if(saved)state={...defaults(),...saved,scenarios:{...defaults().scenarios,...saved.scenarios}};}catch{}
      const requested=location.hash.slice(1);state.route=byId.has(requested)?requested:byId.has(state.route)?state.route:dataset.screens[0].id;
      renderControls();renderDirectory();render();
      window.previewApp={go,reset(){state=defaults();save();go('M07',{history:false});},get state(){return structuredClone(state)},get screens(){return dataset.screens},setScenario(key,value){if(key==='pkg')state.pkg=value;else if(key==='trained'){if(!isSuspended())state.trained=value;}else state.scenarios[key]=value;save();render();},startExam:newExam,finishExam,showModal:modal};
      document.dispatchEvent(new CustomEvent('preview-ready',{detail:{screens:dataset.screens.length}}));
    }catch(error){content().innerHTML=`<section class="fatal-error"><h2>正在准备交互预览</h2><p>${esc(error.message)}</p><p>请通过本地HTTP服务打开本页面，待页面数据生成后刷新。</p><button class="button full" onclick="location.reload()">重新加载</button></section>`;console.error(error);}
  }
  init();
})();

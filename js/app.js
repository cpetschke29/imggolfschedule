/* Week Planner app: screens, drag and drop, analytics, News & PTO. */
(function(){
var SAMPLE=window.SAMPLE_DATA||null;
var KEY='week-planner-v2',OLDKEY='week-planner-v1';
var PPH=44;
var state,hist=[],pre=null,edit=null,ezones=[];
var fullDay=false,fdWin={tStart:360,tEnd:1140};
var mode='edit',coachFilter='',anWeek='all',anGroup='players',anSplit=false,anOK=false,pinPrompt=false,pinMsg='';
/* the staff PIN is no longer in this file: it is checked by the database. It is kept only for this tab's session so saves can be authorized. */
var UNLOCK_KEY='week-planner-unlocked',PIN_KEY='week-planner-pin';
var unlocked=false,staffPin='';try{staffPin=sessionStorage.getItem(PIN_KEY)||'';unlocked=sessionStorage.getItem(UNLOCK_KEY)==='1'&&!!staffPin}catch(e){}
function parseHash(){
  var h='';try{h=decodeURIComponent(location.hash||'')}catch(e){h=location.hash||''}
  if(/^#analytics/.test(h)){mode='analytics'}
  else if(/^#coach/.test(h)){mode='coach';var m=/^#coach=(.+)$/.exec(h);coachFilter=m?m[1]:'';fullDay=!!coachFilter&&!isSpecCoach(coachFilter)}
  else if(/^#news/.test(h)){mode='news'}
  else if(/^#tee/.test(h)){mode='tee'}
  else mode='edit';
  if(!unlocked&&mode!=='coach'&&mode!=='news')mode='coach';
}
parseHash();
function coachKey(n){return String(n||'').replace(/\s*\(.*?\)\s*/g,' ').replace(/\s+/g,' ').trim()}
/* names are matched ignoring case, and treating a capital I, a lowercase l and a 1 as the same letter (so a typed "AI" still finds "Al") */
function nameFz(n){return String(n||'').replace(/\(.*?\)/g,' ').replace(/\s+/g,' ').trim().toLowerCase().replace(/[i1|]/g,'l')}
/* Kev Collins is the Putting Specialist: his schedule is the groups tagged Putting Specialist, day by day */
function isSpecCoach(n){return /collins/i.test(String(n||''))}
function hasSpecTag(cell){return !!cell&&(cell.tags||[]).indexOf('Putting Specialist')>=0}
function podVisibleFor(p,f){
  f=(f===undefined)?coachFilter:f;
  if(!f)return true;
  if(isSpecCoach(f))return p.cells.some(hasSpecTag);
  if(coachKey(p.name)===f)return true;
  /* the lead coach, each coach in a camp group, and everyone listed under a lead coach all see that group */
  var k=nameFz(f);
  return peopleOfPod(p).some(function(n){return nameFz(n)===k});
}
/* everyone who appears in the given tabs: lead coaches, the coaches under them, and each coach in a camp group */
function staffNamesFor(sessList,withMaster){
  var m={};
  sessList.forEach(function(s){
    /* the summer / holiday camp coaches are not on the pick-your-name lists */
    if(isCamp(s)&&s.season)return;
    s.pods.forEach(function(p){
    (isCamp(s)?podCoachDisplay(p):peopleOfPod(p)).forEach(function(n){
      n=String(n).trim();if(!n||/[&,]/.test(n))return;
      var k=nameFz(n);if(!m[k])m[k]=n;
    });
  })});
  if(withMaster)coachListNames().forEach(function(n){var k=String(n).toLowerCase();if(!m[k])m[k]=n});
  return Object.keys(m).map(function(k){return m[k]}).sort(function(a,b){return a.localeCompare(b)});
}
function allCoaches(){var m={};weekSessions(weekOf(cur())).forEach(function(x){x.pods.forEach(function(p){var k=coachKey(p.name);if(k)m[k]=1})});return Object.keys(m).sort()}
var $=function(s){return document.querySelector(s)};
var esc=function(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})};

/* ---- time formatting ---- */
function hourLabel(h){return (h%12||12)+(h<12||h===24?'am':'pm')}
function zoneLabel(z){return /^\d+$/.test(z)?'Zone '+z:z}
function zoneText(zs){
  zs=(zs||[]).slice().sort(function(a,b){return state.zones.indexOf(a)-state.zones.indexOf(b)});
  var nums=zs.filter(function(z){return /^\d+$/.test(z)}),oth=zs.filter(function(z){return !/^\d+$/.test(z)});
  var p=[];if(nums.length)p.push('Zone '+nums.join(', '));
  return p.concat(oth).join(' · ');
}

function blankSession(name,nd){
  var days=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].slice(0,nd||5).map(function(n){return {name:n,theme:''}});
  var w=winFor(name);
  return {id:uid(),name:name,title:name+' Schedule',tStart:w.s,tEnd:w.e,days:days,pods:[],trips:blankTrips(days.length)};
}
function blankState(){
  var a=blankSession('AM'),b=blankSession('PM');
  return {v:5,news:[],courses9:DEFAULT_COURSES9.slice(),courses18:DEFAULT_COURSES18.slice(),categories:clone(DEFAULT_CATS),tags:clone(DEFAULT_TAGS),zones:DEFAULT_ZONES.slice(),coachLocked:false,templates:clone(DEFAULT_TEMPLATES),sessions:[a,b],active:a.id};
}
function load(){
  var s;
  try{
    s=localStorage.getItem(KEY);
    if(s){var o=JSON.parse(s);if(o&&o.sessions&&o.sessions.length){state=migrateState(o);return}}
    s=localStorage.getItem(OLDKEY);
    if(s){var o1=JSON.parse(s);if(o1&&o1.sessions&&o1.sessions.length){state=migrateState(o1);return}}
  }catch(e){}
  state=SAMPLE?clone(SAMPLE):blankState();
}
var saveT;
/* only staff keep a browser copy; a coach's view always comes from the shared schedule, so it can never overwrite staff data saved in the same browser */
var applying=false,bootLocal=null;try{bootLocal=localStorage.getItem(KEY)}catch(e){}
function save(){
  if(applying||!unlocked)return;
  clearTimeout(saveT);saveT=setTimeout(function(){try{localStorage.setItem(KEY,JSON.stringify(state))}catch(e){}pushSoon()},200)
}
function pushHist(s){hist.push(s);if(hist.length>80)hist.shift();$('#bUndo').disabled=!hist.length}
/* the faint "Updated" note in the corner follows the last saved change to the schedule */
function touch(){state.updatedAt=Date.now()}
function updateBadge(){
  var b=document.getElementById('updbadge');if(!b)return;
  if(!state.updatedAt){b.hidden=true;return}
  b.textContent='Updated '+new Date(state.updatedAt).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
  b.hidden=false;
}
/* first screen for coaches and other staff: pick a name, or choose General staff to see everyone */
var WHO_KEY='wp-who',whoApplied=false;
function getWho(){try{return localStorage.getItem(WHO_KEY)}catch(e){return null}}
function setWho(v){try{if(v==null)localStorage.removeItem(WHO_KEY);else localStorage.setItem(WHO_KEY,v)}catch(e){}}
/* the first screen's name list: every full-time coach (this week's groups and the master list); summer / holiday camp coaches are left out */
function autoHomeNames(){
  var vis=visibleWeeks();
  return staffNamesFor(state.sessions.filter(function(s){return vis.indexOf(weekOf(s))>=0}),true);
}
/* the home page list is the one you set in Edit mode (menu, Edit name list); until you set it, it follows the schedule */
function homeNames(){
  return (state.homeNames&&state.homeNames.length)?state.homeNames.slice().sort(function(a,b){return a.localeCompare(b)}):autoHomeNames();
}
function fillLanding(){
  var names=homeNames();
  $('#lwho').innerHTML='<option value="">Choose your name…</option>'+names.map(function(n){return '<option value="'+esc(n)+'">'+esc(n)+'</option>'}).join('');
}
/* a coach who picks their name sees their whole day: the AM and PM tabs together on one timeline */
/* the sessions that make up a coach's day: AM, PM and the regular Camp tab (not a Summer / Holiday camp, which has its own pages) */
function fdSessions(wk){return weekSessions(wk).filter(function(x){return !(isCamp(x)&&x.season)})}
function fdCan(){
  if(mode!=='coach'||!coachFilter||isSpecCoach(coachFilter)||!state.sessions.length)return false;
  var wk=weekOf(cur());
  return !seasonCamp(wk)&&fdSessions(wk).filter(function(x){return !isCamp(x)}).length>1;
}
/* a coach who picked their name always sees AM and PM as one day (Camp stays its own tab) */
var fdOff=false;
function fdOn(){return !fdOff&&fdCan()}
function fullDaySession(wk){
  var ss=fdSessions(wk).sort(function(a,b){return a.tStart-b.tStart});
  var base=ss.filter(function(x){return !isCamp(x)})[0]||ss[0],pods=[],map={};
  ss.forEach(function(s){
    s.pods.forEach(function(p){
      if(!podVisibleFor(p))return;
      /* one row for the coach, whichever pods they are in, so the AM and PM run on as one continuous day */
      var k='one',m=map[k];
      if(!m){m=map[k]={id:'fdcoach',name:coachFilter,players:'',program:p.program||'',color:p.color,cells:base.days.map(function(){return {cards:[],tags:[],tagWhen:{},_ptoWhen:{},wxBy:{},weather:''}})};pods.push(m)}
      if(nameFz(coachKey(p.name))===nameFz(coachFilter)){if(!m.players&&p.players)m.players=p.players}
      else{var wl=s.name+': with '+coachKey(p.name);(m.withs=m.withs||[]).indexOf(wl)<0&&m.withs.push(wl)}
      if(!m.program&&p.program)m.program=p.program;
      p.cells.forEach(function(c,j){
        var t=m.cells[j];if(!t)return;
        var lab=isCamp(s)?'CAMP':String(s.name||'').trim().toUpperCase();
        /* each card remembers which tab it came from, so an AM or PM tag can sit on the right tile */
        t.cards=t.cards.concat(c.cards.map(function(cd){var k=Object.assign({},cd);k._ses=lab;return k}));
        function when(map,n){var a=map[n]=map[n]||[];if(a.indexOf(lab)<0)a.push(lab)}
        (c.tags||[]).forEach(function(n){if(t.tags.indexOf(n)<0)t.tags.push(n);when(t.tagWhen,n)});
        if(!t.weather&&c.weather)t.weather=c.weather;
        /* the AM and the PM can have different weather safety rooms, so each is kept with its session */
        if(String(c.weather||'').trim())t.wxBy[lab]=String(c.weather).trim();
        ptoNames(s,p,j).forEach(function(n){t._pto=t._pto||[];if(t._pto.indexOf(n)<0)t._pto.push(n);when(t._ptoWhen,n)});
      });
    });
  });
  pods.forEach(function(m){if(m.withs&&m.withs.length)m.players=(m.players?m.players+'\n':'')+m.withs.join('\n')});
  /* the coach's Breakthroughs go onto their day as tiles, so you can see how each one fits in */
  var campS=weekSessions(wk).filter(isCamp)[0];
  if(campS&&campS.bt&&campS.bt.length){
    var mineBT=campS.bt.filter(function(r){return r&&nameFz(r.coach)===nameFz(coachFilter)});
    if(mineBT.length&&!pods.length)pods.push({id:'fdcoach',name:coachFilter,players:'',program:'',cells:base.days.map(function(){return {cards:[],tags:[],tagWhen:{},_ptoWhen:{},wxBy:{},weather:''}})});
    if(mineBT.length)mineBT.forEach(function(r){
      var st=typeof r.start==='string'?(r.start?fromHHMM(r.start):null):r.start;
      var en=typeof r.end==='string'?(r.end?fromHHMM(r.end):null):r.end;
      var t=pods[0].cells[+r.day];if(st==null||!t)return;
      if(en==null||en<=st)en=st+45;
      t.cards.push({id:'bt'+(r.id||uid()),cat:'other',title:'BT · '+(r.session==='WIB'?'WITB':r.session)+' · '+r.student,details:'',zones:[],start:st,end:en,color:BT_COLORS[r.session]||'#6F7C8E',_bt:true,_ses:st<750?'AM':'PM'});
    });
  }
  /* phone: a tag for the AM or the PM goes onto that session's practice tile (the first one) instead of a row of tags */
  if(isMobile())pods.forEach(function(m){m.cells.forEach(function(t){
    var left=[];
    t.tags.forEach(function(n){
      var rest=[];
      (t.tagWhen[n]||[]).forEach(function(lab){
        var cs=t.cards.filter(function(cd){return cd._ses===lab&&!cd._bt}).sort(function(a,b){return a.start-b.start});
        var tg=cs.filter(function(cd){return cd.cat==='practice'})[0]||cs[0];
        if(tg){tg._tagBadges=tg._tagBadges||[];if(tg._tagBadges.indexOf(n)<0)tg._tagBadges.push(n)}else rest.push(lab);
      });
      if(rest.length){t.tagWhen[n]=rest;left.push(n)}else delete t.tagWhen[n];
    });
    t.tags=left;
  })});
  var ts=Math.min.apply(null,ss.map(function(x){return x.tStart})),te=Math.max.apply(null,ss.map(function(x){return x.tEnd}));
  fdWin.tStart=ts;fdWin.tEnd=te;
  return {id:'fullday',name:'Full day',title:base.title,days:base.days,tStart:ts,tEnd:te,pods:pods,trips:base.trips};
}
function chooseWho(v){
  setWho(v);whoApplied=true;
  coachFilter=(v&&v.indexOf('c:')===0)?v.slice(2):'';
  fullDay=!!coachFilter&&!isSpecCoach(coachFilter);
  coachDefaultView();
  /* opening from the name list always lands on the schedule (today's day on a phone), never the Campers or Breakthroughs pages */
  btView=false;campView=false;mDay=null;mDayWk=null;
  mode='coach';syncHash();render();window.scrollTo(0,0);
}
/* today's column: a soft wash, a Today tag and a thin line at the current time */
function todayCol(s){
  var w0=weekStart(weekOf(s));if(!w0)return -1;
  var t=new Date();t.setHours(0,0,0,0);
  var j=Math.round((t.getTime()-w0.getTime())/86400000);
  return (j>=0&&j<s.days.length)?j:-1;
}
function markToday(s){
  var j=todayCol(s);if(j<0)return;
  var g=document.getElementById('grid');if(!g)return;
  var dh=g.querySelectorAll('.dayh');if(dh[j]){dh[j].classList.add('today');dh[j].insertAdjacentHTML('beforeend','<span class="todaytag">Today</span>')}
  var secs=g.querySelectorAll('.dsec');if(secs[j]){secs[j].classList.add('today');var hd=secs[j].querySelector('.dsech');if(hd)hd.insertAdjacentHTML('beforeend','<span class="todaytag">Today</span>')}
  g.querySelectorAll('.tl[data-j="'+j+'"]').forEach(function(tl){
    tl.parentNode.classList.add('today');
    tl.insertAdjacentHTML('beforeend','<div class="nowline"></div>');
  });
  nowLines();
}
var viewWin=null;
function nowLines(){
  var s=viewWin||cur(),n=new Date(),m=n.getHours()*60+n.getMinutes();
  document.querySelectorAll('.nowline').forEach(function(l){
    var y=(m-s.tStart)*PPH/60;
    l.style.display=(m>=s.tStart&&m<=s.tEnd)?'':'none';
    l.style.top=y+'px';
  });
}
setInterval(nowLines,60000);
function mutate(fn,msg){pushHist(JSON.stringify(state));fn();touch();save();render();if(msg)toast(msg,true)}
function undo(){
  if(!unlocked)return;
  if(!hist.length)return;
  /* settings are not part of what Undo rolls back: PIN, drivers and their phone numbers, Breakthrough coaches, drive time */
  var keep={analyticsPin:state.analyticsPin,drivers:state.drivers,btCoaches:state.btCoaches,driveMin:state.driveMin};
  state=JSON.parse(hist.pop());
  Object.keys(keep).forEach(function(k){if(keep[k]!==undefined)state[k]=keep[k];else delete state[k]});
  touch();save();render();$('#bUndo').disabled=!hist.length;hideToast();
}
function cur(){return state.sessions.filter(function(s){return s.id===state.active})[0]||state.sessions[0]}
/* ---- weeks: each week is the set of tabs sharing a "Week of" date ---- */
function weekSessions(wk){return state.sessions.filter(function(s){return weekOf(s)===wk})}
/* Holiday and Summer weeks: the Camp tab is the schedule, and Breakthroughs get a tab of their own. */
var btView=false,campView=false;
function seasonCamp(wk){return weekSessions(wk).filter(function(x){return isCamp(x)&&x.season})[0]||null}
function weekSeason(wk){var c=seasonCamp(wk);return c?c.season:''}
function tabLabel(s){return isCamp(s)&&s.season?s.season+' Camp':s.name}
function allWeeks(){var o=[];state.sessions.forEach(function(s){var w=weekOf(s);if(o.indexOf(w)<0)o.push(w)});return o}
function weekTime(w){var d=weekStart(w);return d?d.getTime():null}
function sortWeeksDesc(a){return a.slice().sort(function(x,y){var tx=weekTime(x),ty=weekTime(y);if(tx==null&&ty==null)return 0;if(tx==null)return 1;if(ty==null)return -1;return ty-tx})}
/* A week goes to the archive on the Saturday after its Friday. */
function isArchived(w){
  var d=weekStart(w);if(!d)return false;
  var t=new Date();t.setHours(0,0,0,0);
  return t.getTime()>=new Date(d.getFullYear(),d.getMonth(),d.getDate()+5).getTime();
}
function isPublished(w){return !!(state.published&&state.published[w])}
/* range staff see a week once it is published to them, or to everyone */
function isRangePub(w){return isPublished(w)||!!(state.publishedRange&&state.publishedRange[w])}
function visibleWeeks(){var all=allWeeks();return unlocked?all:all.filter(function(w){return isPublished(w)&&!isArchived(w)})}
function weekLabel(w){return w==='No week label'?w:'Week of '+w}
function switchWeek(w){
  var s=cur(),list=weekSessions(w);if(!list.length)return;
  var m=list.filter(function(x){return x.name===s.name})[0]||list[0];
  state.active=m.id;save();render();
}
function ensureWeek(vis){
  if(!vis.length||vis.indexOf(weekOf(cur()))>=0)return;
  state.active=weekSessions(sortWeeksDesc(vis).reverse()[0])[0].id;save();
}
/* coaches open on this week's AM tab before 12:30pm and its PM tab after; later weeks are in the week dropdown */
function coachDefaultView(){
  var vis=visibleWeeks();if(!vis.length)return;
  var today=new Date();today.setHours(0,0,0,0);
  var cw=null;
  vis.forEach(function(w){var t=weekTime(w);if(t!=null&&t<=today.getTime()&&today.getTime()<t+7*86400000)cw=w});
  if(!cw)cw=sortWeeksDesc(vis).reverse()[0];
  var all=weekSessions(cw),list=all.filter(function(x){return !isCamp(x)});
  var n=new Date(),want=(n.getHours()*60+n.getMinutes()<750)?'am':'pm';
  var s=list.filter(function(x){return String(x.name).trim().toLowerCase()===want})[0]||list[0]||all[0];
  if(s)state.active=s.id;
}
function defaultWeek(){
  var live=sortWeeksDesc(allWeeks()).reverse().filter(function(w){return weekTime(w)!=null&&!isArchived(w)});
  if(live.length&&live.indexOf(weekOf(cur()))<0)state.active=weekSessions(live[0])[0].id;
}
function renderWeekBar(vis){
  var cw=weekOf(cur()),desc=sortWeeksDesc(vis),sel=$('#weeksel');
  function opt(w){return '<option value="'+esc(w)+'"'+(w===cw?' selected':'')+'>'+esc(isMobile()?w:weekLabel(w))+(weekSeason(w)?' · '+esc(weekSeason(w))+(isMobile()?'':' Camp'):'')+(unlocked&&isPublished(w)?' ✓':(unlocked&&isRangePub(w)?' · Range':''))+'</option>'}
  /* current week first, then the future weeks in order; archived weeks last, newest first */
  var live=vis.filter(function(w){return !isArchived(w)}).sort(function(x,y){
    var tx=weekTime(x),ty=weekTime(y);
    if(tx==null&&ty==null)return 0;if(tx==null)return 1;if(ty==null)return -1;return tx-ty;
  }),arch=desc.filter(isArchived),h;
  if(unlocked){
    h=(live.length?'<optgroup label="Current &amp; upcoming">'+live.map(opt).join('')+'</optgroup>':'')+
      (arch.length?'<optgroup label="Archived">'+arch.map(opt).join('')+'</optgroup>':'')+
      '<option value="__new__">+ New week…</option>';
  }else h=live.map(opt).join('');
  sel.innerHTML=h;
  sel.hidden=!unlocked&&vis.length<2;
  $('#wkpill').hidden=sel.hidden;wkArrows();
  var arc=isArchived(cw);
  $('#bPub').hidden=arc;$('#bPub').textContent=isPublished(cw)?'General staff ✓':'Publish to general staff';
  $('#bPub').classList.toggle('on',isPublished(cw));
  var rb=$('#bPubRange');rb.hidden=arc;
  /* publishing to general staff already covers range staff, so that button just shows as done */
  rb.textContent=isRangePub(cw)?'Range staff ✓':'Publish to range staff';
  rb.classList.toggle('on',isRangePub(cw));rb.disabled=isPublished(cw);
  rb.title=isPublished(cw)?'Range staff can see this week because it is published to general staff.':'Range staff see this week. General staff still do not.';
  $('#wkbadge').hidden=!arc;
}
/* ---- New week: copy a week's base schedule (coaches, groups and blocks, with zones and courses left blank) ---- */
function weekLabelFromDate(d){return (d.getMonth()+1)+'/'+d.getDate()+'/'+String(d.getFullYear()).slice(2)}
function setWeekInTitle(t,lbl){
  t=String(t||'');
  return /week of\s*[\d\/\.\-]+/i.test(t)?t.replace(/(week of\s*)[\d\/\.\-]+/i,'$1'+lbl):t+' (Week of '+lbl+')';
}
function blankCopyCard(cd){
  var c=clone(cd);
  c.id=uid();delete c.driver;delete c.load;delete c.booked;
  if(catOf(c.cat).trip){
    c.course='';
    if(c.holes)c.title=courseTitle(c.holes,'');
    else c.title=String(c.title||'').replace(/\s+at\s+.+$/i,'');
  }
  return c;
}
function copySessionForWeek(x,lbl,withEvents){
  var c=clone(x);
  c.id=uid();c.title=setWeekInTitle(x.title,lbl);
  c.pods.forEach(function(p,pi){
    p.id=uid();
    if(isCamp(x))p.campers=[];
    p.cells=x.pods[pi].cells.map(function(cell){
      /* weekly tags (MENTAL, MP FLOAT, GEARS) start fresh; Functional and any others carry over */
      var tags=(cell.tags||[]).filter(function(n){return ['mental','mp float','gears'].indexOf(String(n).trim().toLowerCase())<0});
      return {tags:tags,weather:'',cards:withEvents?cell.cards.map(blankCopyCard):[]};
    });
  });
  c.trips={label:(x.trips&&x.trips.label)||'Transportation trips',dates:Array(c.days.length).fill(''),rows:[]};
  if(isCamp(x)){c.bt=[];c.btOff=[]}
  return c;
}
/* Adds AM and PM from the most recent regular week, for the rare week that runs full-time next to camp. */
function addFulltime(){
  var wk=weekOf(cur()),src=null;
  sortWeeksDesc(allWeeks()).some(function(w){
    if(w!==wk&&weekSessions(w).some(function(x){return !isCamp(x)})){src=w;return true}
    return false;
  });
  if(!src){toast('There is no other week with AM and PM tabs to copy from.');return}
  mutate(function(){
    weekSessions(src).filter(function(x){return !isCamp(x)}).forEach(function(x){state.sessions.push(copySessionForWeek(x,wk,true))});
  },'Added AM and PM from '+weekLabel(src)+'. Delete a tab in Customize if you do not need it.');
}
function openNewWeek(){
  var wks=sortWeeksDesc(allWeeks()),cw=weekOf(cur());
  $('#nwsrc').innerHTML=wks.map(function(w){return '<option value="'+esc(w)+'"'+(w===cw?' selected':'')+'>'+esc(weekLabel(w))+(isArchived(w)?' (archived)':'')+'</option>'}).join('');
  var latest=wks.map(weekTime).filter(function(t){return t!=null})[0],d;
  if(latest!=null){var l=new Date(latest);d=new Date(l.getFullYear(),l.getMonth(),l.getDate()+7)}
  else{d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()+((8-d.getDay())%7||7))}
  $('#nwdate').value=d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2);
  $('#nwev').checked=true;
  $('#nwtype').value='';$('#nwft').checked=false;$('#nwftrow').hidden=true;
  $('#nwdlg').showModal();
}
/* picking a camp type points "Copy from" at the latest camp week of that kind, if there is one */
$('#nwtype').onchange=function(){
  var t=this.value;$('#nwftrow').hidden=!t;
  var pick=sortWeeksDesc(allWeeks()).filter(function(w){return t?!!seasonCamp(w):weekSessions(w).some(function(x){return !isCamp(x)})})[0];
  if(pick)$('#nwsrc').value=pick;
};
function createWeek(){
  var src=$('#nwsrc').value,v=$('#nwdate').value,type=$('#nwtype').value,ft=$('#nwft').checked;
  if(!v){$('#nwdate').focus();return}
  var p=v.split('-'),d=new Date(+p[0],+p[1]-1,+p[2]),lbl=weekLabelFromDate(d),withEvents=$('#nwev').checked;
  var from=weekSessions(src);
  if(!from.length)return;
  var fullSrc=from.filter(function(x){return !isCamp(x)});
  if(!type&&!fullSrc.length){toast('That week has no AM or PM tabs to copy. Pick a week that has them, or choose a camp week type.');return}
  if(type&&ft&&!fullSrc.length){
    var rw=sortWeeksDesc(allWeeks()).filter(function(w){return weekSessions(w).some(function(x){return !isCamp(x)})})[0];
    fullSrc=rw?weekSessions(rw).filter(function(x){return !isCamp(x)}):[];
  }
  var exists=allWeeks().indexOf(lbl)>=0;
  function monday(){
    if(d.getDay()!==1)askConfirm(lbl+' is not a Monday. Create it anyway?',go,'Create it');
    else go();
  }
  function go(){$('#nwdlg').close();build()}
  if(exists)askConfirm('You already have the week of '+lbl+'. Replace its schedule tabs with this copy? Its news, PTO and other notes are kept.',monday,'Replace');
  else monday();
  function build(){
  mutate(function(){
    if(exists)state.sessions=state.sessions.filter(function(x){return weekOf(x)!==lbl});
    var first=null;
    if(type){
      /* Holiday or Summer: one camp schedule, coaches kept in each group, campers and Breakthroughs left empty */
      var c0=from.filter(isCamp)[0],camp;
      if(c0)camp=copySessionForWeek(c0,lbl,withEvents);
      else{camp=makeCamp(lbl,true,['New group']);camp.title=type+' Camp Schedule (Week of '+lbl+')'}
      camp.season=type;
      state.sessions.push(camp);first=camp.id;
      if(ft)fullSrc.forEach(function(x){state.sessions.push(copySessionForWeek(x,lbl,withEvents))});
    }else{
      from.forEach(function(x){var c=copySessionForWeek(x,lbl,withEvents);if(isCamp(c))delete c.season;state.sessions.push(c);if(!first)first=c.id});
      if(!from.some(isCamp))state.sessions.push(makeCamp(lbl,false));
    }
    state.active=first;btView=false;
  },'Created the '+(type?type+' camp ':'')+'week of '+lbl+' from '+weekLabel(src)+'. It is not published yet.');
  }
}
$('#nwgo').onclick=createWeek;
$('#nwcancel').onclick=function(){$('#nwdlg').close()};
$('#nwdlg').addEventListener('mousedown',function(e){if(e.target===this)this.close()});
function deleteWeek(){
  var wk=weekOf(cur());
  if(allWeeks().length<2){toast('This is your only week, so it can’t be deleted.');return}
  var n=weekSessions(wk).length;
  askConfirm('Delete '+weekLabel(wk)+'? This removes its '+n+' schedule tab'+(n>1?'s':'')+', its news, PTO and tee time requests. You can press Undo right after.',function(){
  mutate(function(){
    state.sessions=state.sessions.filter(function(x){return weekOf(x)!==wk});
    state.news=(state.news||[]).filter(function(x){return x.week!==wk});
    if(state.published)delete state.published[wk];
    if(state.publishedRange)delete state.publishedRange[wk];
    state.coverage=(state.coverage||[]).filter(function(x){return x.week!==wk});
    state.trav=(state.trav||[]).filter(function(x){return x.week!==wk});
    if(state.coverageOn)delete state.coverageOn[wk];
    Object.keys(state.tee||{}).forEach(function(k){if(k.indexOf(wk+'|')===0)delete state.tee[k]});
    state.active=state.sessions[0].id;defaultWeek();
  },'Deleted '+weekLabel(wk)+'.');
  },'Delete week');
}
function catOf(id){
  return state.categories.filter(function(c){return c.id===id})[0]||state.categories.filter(function(c){return c.id==='other'})[0]||state.categories[0];
}
function setPath(o,path,val){
  var k=path.split('.');
  for(var i=0;i<k.length-1;i++)o=o[k[i]];
  o[k[k.length-1]]=val;
}

/* ---- toast ---- */
var toastT;
function toast(msg,undoable,warn){
  $('#tmsg').textContent=msg;
  $('#tundo').style.display=undoable?'':'none';
  $('#toast').className='toast on'+(warn?' warn':'');
  clearTimeout(toastT);toastT=setTimeout(hideToast,warn?9000:5000);
}
function hideToast(){$('#toast').classList.remove('on')}

/* ---- in-page questions: the built-in prompt() and confirm() boxes are blocked in some viewers ---- */
var askState=null;
function askOpen(o){
  askState={cb:o.onOk,cancel:o.onCancel,done:false,input:!!o.input};
  $('#asktitle').textContent=o.title||'Please confirm';
  $('#askmsg').textContent=o.msg||'';
  $('#askin').style.display=o.input?'':'none';
  $('#askin').type=o.password?'password':'text';
  $('#askin').value='';$('#askin').placeholder=o.placeholder||'';
  $('#askok').textContent=o.ok||'OK';
  $('#askdlg').showModal();
  if(o.input)$('#askin').focus();else $('#askok').focus();
}
function askConfirm(msg,onOk,okLabel,title){askOpen({title:title,msg:msg,ok:okLabel||'Yes',onOk:onOk})}
function askText(title,msg,placeholder,onOk,onCancel){askOpen({title:title,msg:msg,input:true,placeholder:placeholder,ok:'Add',onOk:onOk,onCancel:onCancel})}
function askAnswer(){
  var a=askState;if(!a)return;
  var v=$('#askin').value.trim();
  if(a.input&&!v){$('#askin').focus();return}
  askState=null;$('#askdlg').close();
  if(a.cb)a.cb(v);
}
function askDismiss(){
  var a=askState;askState=null;
  if($('#askdlg').open)$('#askdlg').close();
  if(a&&a.cancel)a.cancel();
}
$('#askok').onclick=askAnswer;
$('#askno').onclick=askDismiss;
$('#askdlg').addEventListener('cancel',function(e){e.preventDefault();askDismiss()});
$('#askin').addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();askAnswer()}});

/* ---- zone conflicts (only when times overlap) ---- */
function overlaps(a,b){return a.start<b.end&&b.start<a.end}
/* an event is one piece, or several when it is split into time blocks with their own zones */
function pieces(c){
  if(c.segments&&c.segments.length)return c.segments.map(function(s){return {start:s.start,end:s.end,zones:s.zones||[]}});
  return [{start:c.start,end:c.end,zones:c.zones||[]}];
}
function findConf(sess,j,cand,excludeId){
  var out=[],cp=pieces(cand).filter(function(x){return x.zones&&x.zones.length});
  if(!cp.length)return out;
  /* zones are shared by every tab in the same week, so Camp and AM/PM can collide */
  weekSessions(weekOf(sess)).forEach(function(s2){
    var other=s2!==sess;
    s2.pods.forEach(function(p){
      var cell=p.cells[j];if(!cell)return;
      cell.cards.forEach(function(o){
        if(o.id===excludeId)return;
        pieces(o).forEach(function(op){
          if(!op.zones.length)return;
          cp.forEach(function(a){
            if(!overlaps(a,op))return;
            var sh=a.zones.filter(function(z){return op.zones.indexOf(z)>=0});
            if(sh.length)out.push({pod:p.name+(other?' ('+s2.name+')':''),zones:sh,card:{start:op.start,end:op.end}});
          });
        });
      });
    });
  });
  return out;
}
/* Camp and the AM/PM pods heading to the same course at the same time share a bus. */
function joinList(sess,card,j){
  var out=[];
  if(!catOf(card.cat).trip)return out;
  var camp=isCamp(sess),cn=courseOf(card).toLowerCase();
  weekSessions(weekOf(sess)).forEach(function(s2){
    if(s2===sess||isCamp(s2)===camp)return;
    s2.pods.forEach(function(p){
      var cell=p.cells[j];if(!cell)return;
      cell.cards.forEach(function(o){
        if(!catOf(o.cat).trip||!overlaps(card,o)||courseOf(o).toLowerCase()!==cn)return;
        if(out.indexOf(p.name)<0)out.push(p.name);
      });
    });
  });
  return out;
}
function joinText(sess,card,j){
  var l=joinList(sess,card,j);
  if(!l.length)return '';
  return isCamp(sess)?'Joining '+l.join(', ')+' at '+courseOf(card):'Camp is joining at '+courseOf(card)+' ('+l.join(', ')+')';
}
function confText(list){
  return list.map(function(x){return x.zones.map(zoneLabel).join(' & ')+' is also booked by '+x.pod+' ('+fmtRange(x.card.start,x.card.end)+')'}).join('; ');
}
function confMap(sess){
  var m={};
  sess.pods.forEach(function(p){p.cells.forEach(function(cell,j){cell.cards.forEach(function(c){
    var l=findConf(sess,j,c,c.id);if(l.length)m[c.id]=l;
  })})});
  return m;
}
function alertCard(id){
  var f=findCard(id);if(!f)return;
  var l=findConf(cur(),f.j,f.card,f.card.id);
  if(l.length){toast('Heads up: '+confText(l)+'.',true,true);return}
  var jt=joinText(cur(),f.card,f.j);
  if(jt)toast(jt+'. They can share one bus.',true);
}

/* ---- render ---- */
function render(){
  PROGRAM_COLORS=state.programColors||{};
  if(rangeOpen)renderRange();
  if(mode==='analytics'&&state.analyticsPin&&!anOK&&!unlocked){mode='coach';pinPrompt=true}
  document.body.classList.toggle('staff',unlocked);
  /* the staff log in is the last thing in the menu: a row you tap, then the password box opens */
  $('#mlogin').hidden=unlocked||!loginOpen;$('#mloginopen').hidden=unlocked||loginOpen;$('#mloggedin').hidden=!unlocked;
  updateBadge();
  if(!whoApplied){
    whoApplied=true;
    var w0=getWho();
    if(!unlocked&&w0&&w0.indexOf('c:')===0&&!coachFilter){coachFilter=w0.slice(2);fullDay=!isSpecCoach(coachFilter)}
  }
  var needLanding=!unlocked&&getWho()==null&&!rangeOpen;
  $('#landing').hidden=!needLanding;
  if(needLanding)fillLanding();
  if(!state.sessions.some(function(s){return s.id===state.active}))state.active=state.sessions[0].id;
  /* a coach's My Day holds the camp too, so there is no separate Camp tab to land on */
  if(fdCan()&&isCamp(cur())){var fl0=weekSessions(weekOf(cur())).filter(function(x){return !isCamp(x)});if(fl0.length)state.active=fl0[0].id}
  document.body.classList.toggle('mobile',isMobile());
  /* on a phone the week picker sits in the white header, which moves everything up */
  var wsel=$('#weeksel'),topEl=document.querySelector('.top'),barEl0=document.querySelector('.bar');
  if(isMobile()){if(wsel.parentNode!==$('#wkslot'))$('#wkslot').appendChild(wsel)}
  else if(wsel.parentNode!==barEl0)barEl0.insertBefore(wsel,$('#wkbadge'));
  var nb=$('#bNewsM');nb.classList.toggle('on',mode==='news');
  nb.classList.toggle('dot',(state.news||[]).some(function(n){return n.week===weekOf(cur())}));
  document.body.classList.toggle('coach',mode==='coach');
  document.body.classList.toggle('locked',mode==='coach'&&!!state.coachLocked);
  document.body.classList.toggle('analytics',mode==='analytics');
  $('#mAnalytics').textContent=state.analyticsPin?'Analytics \uD83D\uDD12':'Analytics';
  if(mode==='tee'&&!unlocked)mode='coach';
  document.querySelectorAll('#layoutseg [data-lay]').forEach(function(b){b.setAttribute('aria-pressed',b.dataset.lay===layoutMode)});
  document.body.classList.toggle('news',mode==='news');
  document.body.classList.toggle('tee',mode==='tee');
  $('#mTee').setAttribute('aria-pressed',mode==='tee');
  $('#teepage').hidden=(mode!=='tee');
  $('#mEdit').setAttribute('aria-pressed',mode==='edit');$('#mCoach').setAttribute('aria-pressed',mode==='coach');$('#mAnalytics').setAttribute('aria-pressed',mode==='analytics');$('#mNews').setAttribute('aria-pressed',mode==='news');
  $('#boardwrap').hidden=(mode==='analytics'||mode==='news'||mode==='tee');$('#analytics').hidden=(mode!=='analytics');$('#newspage').hidden=(mode!=='news');
  $('#btpage').hidden=true;$('#daybar').hidden=true;
  $('#sesstitle').readOnly=mode==='coach'||mode==='news'||mode==='tee';
  var vis=visibleWeeks();ensureWeek(vis);renderWeekBar(vis);
  if(!unlocked&&!vis.length){
    ['boardwrap','newspage','teepage','analytics','btpage'].forEach(function(id){$('#'+id).hidden=true});
    $('#nopub').hidden=false;$('#tabs').innerHTML='';$('#sesstitle').value='';return;
  }
  $('#nopub').hidden=true;
  if(mode==='analytics'){renderAnalytics();return}
  if(mode==='news'){renderTabs();renderNewsPage();$('#sesstitle').value=cur().title||'';return}
  if(mode==='tee'){renderTabs();renderTeePage();$('#sesstitle').value=cur().title||'';return}
  var sc0=seasonCamp(weekOf(cur()));
  if((btView||campView)&&(!sc0||sc0.id!==state.active)){btView=false;campView=false}
  if(btView&&sc0&&!btTabOk(sc0))btView=false;
  document.querySelector('.lib').style.display=(btView||campView)?'none':'';
  $('#boardwrap').classList.toggle('onlycamp',campView);
  $('#boardwrap').classList.toggle('fullday',fdOn());
  $('#boardwrap').classList.toggle('seasonal',!!(isCamp(cur())&&cur().season));
  if(btView){
    $('#boardwrap').hidden=true;$('#btpage').hidden=false;
    renderTabs();renderBTPage(sc0);renderDayBar();
  }else{
    renderTabs();renderLib();renderGrid();renderTrips();renderCamp();renderDayBar();
  }
  $('#sesstitle').value=fdOn()?'My Day ('+weekLabel(weekOf(cur()))+')':(cur().title||'');
  var pf=$('#podfilter');
  if(isCamp(cur())&&cur().season){
    /* on a Summer / Holiday camp the filter lists each coach on their own, in their group's color; picking one shows the group they are in */
    var seen={},po=[];
    cur().pods.forEach(function(p){podCoachDisplay(p).forEach(function(n){var k=nameFz(n);if(n&&!seen[k]){seen[k]=1;po.push({k:n,n:n,c:p.color})}})});
    /* the Breakthrough coaches (and Mike for WITB) are on the list too, so each can see just their own times */
    var btn=btCoachListFor(cur()).slice();
    if((cur().bt||[]).some(function(r){return r.session==='WIB'}))btn.push('Mike');
    btn.forEach(function(n){var k=nameFz(n);if(n&&!seen[k]){seen[k]=1;po.push({k:n,n:n,c:''})}});
    po.sort(function(a,b){return a.n.localeCompare(b.n)});
    /* a coach picked in another week stays picked here, even if they have no group in this one */
    if(coachFilter&&!po.some(function(o){return nameFz(o.k)===nameFz(coachFilter)}))po.push({k:coachFilter,n:coachFilter,c:''});
    var selKey='';
    if(coachFilter){var sm=po.filter(function(o){return nameFz(o.k)===nameFz(coachFilter)})[0];if(sm)selKey=sm.k}
    pf.innerHTML='<option value="">All coaches</option>'+po.map(function(o){
      var st='';
      if(o.c){var m=/^#?([0-9a-f]{6})$/i.exec(String(o.c).trim()),dk=m&&(0.299*parseInt(m[1].substr(0,2),16)+0.587*parseInt(m[1].substr(2,2),16)+0.114*parseInt(m[1].substr(4,2),16))<140;
        st=' style="background:'+esc(o.c)+';color:'+(dk?'#fff':'#172337')+'"'}
      return '<option value="'+esc(o.k)+'"'+st+(o.k===selKey?' selected':'')+'>'+esc(o.n)+'</option>'}).join('');
    var pc=po.filter(function(o){return o.k===selKey})[0];
    pf.style.background=pc&&pc.c?pc.c:'';
    var pm=pc&&pc.c&&/^#?([0-9a-f]{6})$/i.exec(String(pc.c).trim());
    pf.style.color=pm?((0.299*parseInt(pm[1].substr(0,2),16)+0.587*parseInt(pm[1].substr(2,2),16)+0.114*parseInt(pm[1].substr(4,2),16))<140?'#fff':'#172337'):'';
    $('#lockbadge').textContent=state.coachLocked?'View only':'Drag cards to move them';
    document.querySelectorAll('textarea.players').forEach(autosize);
    initPodSort();
    return;
  }
  pf.style.background='';pf.style.color='';
  var cl=staffNamesFor(weekSessions(weekOf(cur())),false);
  coachListNames().forEach(function(n){if(isSpecCoach(n)&&cl.indexOf(n)<0)cl.push(n)});cl.sort(function(a,b){return a.localeCompare(b)});
  /* the coach you picked stays picked when you change weeks, even if they have no group in that week: they just see nothing scheduled */
  if(coachFilter&&!cl.some(function(n){return nameFz(n)===nameFz(coachFilter)})){cl.push(coachFilter);cl.sort(function(a,b){return a.localeCompare(b)})}
  pf.innerHTML='<option value="">All coaches</option>'+cl.map(function(n){return '<option value="'+esc(n)+'"'+(coachFilter&&nameFz(n)===nameFz(coachFilter)?' selected':'')+'>'+esc(n)+'</option>'}).join('');
  $('#lockbadge').textContent=state.coachLocked?'View only':'Drag cards to move them';
  document.querySelectorAll('textarea.players').forEach(autosize);
  initPodSort();
}
/* on a phone, only the Breakthrough coaches (and Mike for WITB) get the Breakthroughs tab; everyone else already sees theirs under their schedule */
function btTabOk(sc){
  if(!isMobile()||unlocked)return true;
  if(!coachFilter||!sc)return false;
  var f=nameFz(coachFilter);
  if(btCoachListFor(sc).some(function(n){return nameFz(n)===f}))return true;
  return /^mike\b/i.test(String(coachFilter).trim())&&(sc.bt||[]).some(function(r){return r.session==='WIB'});
}
function renderTabs(){
  var wk=weekOf(cur()),sc=seasonCamp(wk);
  var fd=fdOn();
  var barEl=document.querySelector('.bar');if(barEl)barEl.classList.toggle('single',fdCan());
  var h=fdCan()?'<button class="tab" role="tab" aria-selected="'+fd+'" data-act="fullday" title="Your AM, PM and camp together">My Day</button>':'';
  h+=weekSessions(wk).map(function(s){
    if(fdCan())return '';
    var on=s.id===state.active&&!((btView||campView)&&sc)&&!fd;
    var out='<button class="tab" role="tab" aria-selected="'+on+'" data-act="tab" data-id="'+s.id+'">'+esc(tabLabel(s))+'</button>';
    if(sc&&s===sc)out+='<button class="tab" role="tab" aria-selected="'+(campView&&s.id===state.active)+'" data-act="camptab">Campers</button>'+
      (btTabOk(sc)?'<button class="tab" role="tab" aria-selected="'+(btView&&s.id===state.active)+'" data-act="bttab">Breakthroughs</button>':'');
    return out;
  }).join('');
  h+='<button class="tab add edit-only" data-act="addsess" title="Add a blank schedule tab">+ Add</button>';
  if(!weekSessions(wk).some(isCamp))h+='<button class="tab add edit-only" data-act="addcamp" title="Add a Camp tab to this week">+ Camp</button>';
  $('#tabs').innerHTML=h;
}
function renderLib(){
  $('#libchips').innerHTML=state.templates.map(function(t,i){
    return '<div class="libchip" data-tpl="'+i+'" data-act="edittpl" style="--c:'+(t.color||catOf(t.cat).color)+'" title="'+esc(t.details||'Click to edit')+'"><span class="libgrip" title="Drag to rearrange the library">⠿</span><span>'+esc(t.title)+'</span><small>'+Math.round(t.dur/6)/10+'h</small></div>';
  }).join('');
}
function layout(cards){
  var cs=cards.slice().sort(function(a,b){return a.start-b.start||a.end-b.end}),res=[],cluster=[],cEnd=-1,lanesEnd=[];
  function flush(){var n=lanesEnd.length;cluster.forEach(function(x){x.lanes=n});cluster=[];lanesEnd=[]}
  cs.forEach(function(c){
    if(cluster.length&&c.start>=cEnd){flush();cEnd=-1}
    var l=0;while(l<lanesEnd.length&&lanesEnd[l]>c.start)l++;
    lanesEnd[l]=c.end;cEnd=Math.max(cEnd,c.end);
    var x={c:c,lane:l,lanes:1};cluster.push(x);res.push(x);
  });
  flush();return res;
}
/* A long event (like a 36 hole day) that runs past the end of the AM tab continues into the PM tab as a read-only copy. */
function ghostsFor(s,p,j){
  var out=[],pn=String(p.name||'').trim().toLowerCase();
  if(isCamp(s))return out;
  weekSessions(weekOf(s)).forEach(function(s2){
    if(s2===s||isCamp(s2)||s2.tEnd>s.tStart)return;
    var p2=s2.pods.filter(function(x){return String(x.name||'').trim().toLowerCase()===pn})[0],cell=p2&&p2.cells[j];
    if(!cell)return;
    cell.cards.forEach(function(c){
      if(c.end<=s.tStart)return;
      out.push({id:'g'+c.id,cat:c.cat,title:c.title,details:'',zones:[],start:Math.max(c.start,s.tStart),end:Math.min(c.end,s.tEnd),rs:c.start,re:c.end,tee:c.tee,teeLabel:c.teeLabel,ghost:true,from:s2.name,src:c.id});
    });
  });
  return out;
}
function cardHtml(x,sess,conf,ro,j){
  var c=x.c,cat=catOf(c.cat),trip=!!cat.trip,ghost=!!c.ghost,jt=(trip&&!ghost)?joinText(sess,c,j):'';
  var rs0=c.rs!=null?c.rs:c.start,re0=c.re!=null?c.re:c.end;
  var top=(c.start-sess.tStart)*PPH/60,hp=Math.max(24,(Math.min(c.end,sess.tEnd)-c.start)*PPH/60);
  var split=!!(c.segments&&c.segments.length);
  var z=split?'':zoneText(c.zones),cf=conf[c.id];
  var lines=[];
  if(ghost)lines.push('Continues from '+c.from);
  if(split)c.segments.forEach(function(sg){lines.push(fmtRange(sg.start,sg.end)+' · '+(zoneText(sg.zones)||'no zones'))});
  if(trip){
    lines.push('Bus departs at '+fmtT(rs0,true));
    if(c.tee!=null)lines.push((c.teeLabel==='Shotgun'?'Shotgun at ':'Tee time at ')+fmtT(c.tee,true));
    lines.push('Pick up at '+fmtT(re0,true));
  }
  String(c.details||'').split('\n').forEach(function(l){if(l.trim())lines.push(l.trim())});
  var det=lines.map(esc).join('<br>');
  var cm=trip?esc(z):(fmtRange(rs0,re0)+(z?'<span class="cz"><i class="sep"> \u00B7 </i>'+esc(z)+'</span>':''));
  var tip=c.title+'\n'+fmtRange(rs0,re0)+(z?'\n'+z:'')+(lines.length?'\n'+lines.join('\n'):'')+(cf?'\n\u26A0 '+confText(cf):'')+(jt?'\n\u25CF '+jt:'');
  if(ghost)return '<div class="card ghostc" title="'+esc(tip+'\nEdit it in the '+c.from+' tab.')+'" style="--c:'+cat.color+';top:'+top+'px;height:'+hp+'px;left:calc('+(x.lane/x.lanes*100)+'% + 2px);width:calc('+(100/x.lanes)+'% - 4px)">'+
    '<div class="ct">'+esc(c.title)+'</div>'+(cm?'<div class="cm">'+cm+'</div>':'')+(det?'<div class="cd">'+det+'</div>':'')+
    (ro?'':'<div class="cact"><button class="x" data-act="delghost" data-src="'+c.src+'" title="Delete this event (it also removes the '+esc(c.from)+' part)" aria-label="Delete event">×</button></div>')+'</div>';
  var tb=(c._tagBadges||[]).map(function(n){return '<span class="ctag" style="--chip:'+tagColor(n)+'">'+esc(n)+'</span>'}).join('');
  return '<div class="card'+(tb?' hastags':'')+(cf?' warn':'')+(c.end>sess.tEnd?' longev':'')+(split?' segev':'')+((!split&&!(c.zones&&c.zones.length))?' nozone':'')+'" data-id="'+c.id+'" data-act="edit" title="'+esc(tip)+'" style="--c:'+(c.color||cat.color)+';top:'+top+'px;height:'+hp+'px;left:calc('+(x.lane/x.lanes*100)+'% + 2px);width:calc('+(100/x.lanes)+'% - 4px)">'+
    '<div class="ct">'+esc(c.title)+'</div>'+(cm?'<div class="cm">'+cm+'</div>':'')+(det?'<div class="cd">'+det+'</div>':'')+
    (jt?'<div class="cjoin">'+esc(jt)+'</div><span class="joinbadge" title="'+esc(jt)+'" aria-label="'+esc(jt)+'"></span>':'')+
    (cf?'<span class="wbadge" aria-label="Zone overlap">\u26A0</span>':'')+
    (tb?'<div class="ctags">'+tb+'</div>':'')+
    (ro?'':'<div class="cact"><button class="x" data-act="dup" title="Duplicate" aria-label="Duplicate event">\u29C9</button><button class="x" data-act="del" title="Delete" aria-label="Delete event">\u00D7</button></div>')+
    '<div class="rs"></div></div>';
}
function tagColor(n){return tagColorOf(state,n)}
var BT_COLORS={'Full Swing':'#2F6FDE','Putting':'#2E9E5B','Short Game':'#E8833A','WIB':'#E5568C'};
/* A coach's Breakthroughs for this day show up as tags on their own pod, in the AM, PM or Camp tab that holds that time. */
function btChips(s,p,j){
  var camp=weekSessions(weekOf(s)).filter(isCamp)[0];
  if(!camp||!camp.bt||!camp.bt.length)return [];
  var names=podCoachNames(p);
  return camp.bt.filter(function(r){
    var st=typeof r.start==='string'?(r.start?fromHHMM(r.start):null):r.start;
    return (j==null||+r.day===j)&&st!=null&&r.coach&&names.indexOf(normName(r.coach))>=0&&st>=s.tStart&&st<s.tEnd;
  }).sort(function(a,b){return (+a.day)-(+b.day)||a.start-b.start});
}
/* Listed under the coach's name in the pod column. */
function podBtHtml(s,p,j){
  var l=btChips(s,p,j);
  if(!l.length)return '';
  return '<div class="podbt">'+l.map(function(r){
    var d=(s.days[+r.day]||{}).name||'';
    return '<div class="podbtr" style="--tc:'+(BT_COLORS[r.session]||'#6F7C8E')+'" title="'+esc(r.session+', '+fmtRange(r.start,r.end)+', '+r.coach+' w/ '+r.student)+'"><i></i><span>'+esc(dayShort(d))+' '+fmtT(r.start,true)+' · '+esc(r.session)+'<br><small>'+esc(r.coach)+' w/ '+esc(r.student)+'</small></span></div>';
  }).join('')+'</div>';
}
/* Under the coach's name on a camp schedule: when the campers in this pod have a Breakthrough, with the students sharing a time listed together. */
function podCamperBtHtml(s,p,j){
  if(!isCamp(s)||!s.bt||!s.bt.length)return '';
  var names={};(p.campers||[]).forEach(function(c){var n=String(c.name||'').trim();if(n)names[n]=1});
  var rows=s.bt.filter(function(r){
    var st=typeof r.start==='string'?(r.start?fromHHMM(r.start):null):r.start;
    return r&&names[r.student]&&st!=null&&(j==null||+r.day===j);
  }).map(function(r){return {day:+r.day,start:typeof r.start==='string'?fromHHMM(r.start):r.start,session:r.session,coach:r.coach,student:r.student}});
  if(!rows.length)return '';
  rows.sort(function(a,b){return a.day-b.day||a.start-b.start});
  /* first names only; a last initial is added when two campers in the pod share a first name */
  var firsts={};
  function first(n){n=String(n||'').trim();var i=n.indexOf(',');if(i>0)n=n.slice(i+1).trim()+' '+n.slice(0,i).trim();return n.split(/\s+/)[0]||n}
  Object.keys(names).forEach(function(n){var f=first(n);firsts[f]=(firsts[f]||0)+1});
  function short(n){var f=first(n);if(firsts[f]>1){var parts=String(n).replace(/,.*$/,'').trim().split(/\s+/);var l=parts[parts.length-1];if(String(n).indexOf(',')<0&&parts.length>1)return f+' '+l.charAt(0)+'.'}return f}
  var days=[];
  rows.forEach(function(r){
    var d=days.filter(function(x){return x.day===r.day})[0];
    if(!d){d={day:r.day,times:[]};days.push(d)}
    var g=d.times.filter(function(x){return x.start===r.start})[0];
    if(!g){g={start:r.start,names:[]};d.times.push(g)}
    var nm=short(r.student);if(g.names.indexOf(nm)<0)g.names.push(nm);
  });
  return '<div class="podcbt"><div class="pcbh">Breakthroughs</div>'+days.map(function(d){
    var dn=(s.days[d.day]||{}).name||'';
    return '<div class="pcbd">'+(j==null?'<div class="pcbdn">'+esc(dayShort(dn))+'</div>':'')+d.times.map(function(g){
      return '<div class="pcbr"><b>'+fmtT(g.start,true)+'</b> '+esc(g.names.join(', '))+'</div>';
    }).join('')+'</div>';
  }).join('')+'</div>';
}
/* on a coach's combined day, a tag says whether it belongs to the AM, the PM, the camp, or several of them */
/* weather safety for a day: one room, or "AM: room, PM: room" when the AM and PM differ */
function wxText(c){
  var by=c.wxBy,keys=by?Object.keys(by):[];
  if(!keys.length)return esc(c.weather);
  var order=['AM','PM','CAMP'];
  keys.sort(function(a,b){var x=order.indexOf(a),y=order.indexOf(b);return (x<0?9:x)-(y<0?9:y)});
  var vals=keys.map(function(k){return by[k]}),uniq=vals.filter(function(v,i){return vals.indexOf(v)===i});
  var lab=function(k){return k==='CAMP'?'Camp':k};
  if(uniq.length===1)return esc(uniq[0])+(keys.length===1?' ('+esc(lab(keys[0]))+')':'');
  return keys.map(function(k){return '<b>'+esc(lab(k))+':</b> '+esc(by[k])}).join('<span class="wxsep"> · </span>');
}
function tagWhen(map,n){
  var l=map&&map[n];if(!l||!l.length)return '';
  var order=['AM','PM','CAMP'];
  l=l.slice().sort(function(a,b){var x=order.indexOf(a),y=order.indexOf(b);return (x<0?9:x)-(y<0?9:y)});
  return '<i class="tw">'+esc(l.map(function(x){return x==='CAMP'?'Camp':x}).join(' & '))+'</i>';
}
function tagsHtml(c,i,j,ro,ptoList,btList){
  var h=(btList||[]).map(function(r){
    var tip='Breakthrough: '+r.student+', '+r.session+', '+fmtRange(r.start,r.end);
    return '<span class="tagchip btchipt" style="--chip:'+(BT_COLORS[r.session]||'#6F7C8E')+'" title="'+esc(tip)+'">BT '+fmtT(r.start,true)+' · '+esc(r.session)+' · '+esc(r.student)+'</span>';
  }).join('')+(ptoList||[]).map(function(n){return '<span class="tagchip ptochip" style="--chip:#D9534F" title="'+esc(n)+' is out (PTO). Change it in News &amp; PTO.">'+esc(n)+' PTO'+tagWhen(c._ptoWhen,n)+'</span>'}).join(''),mine=c.tags||[];
  mine.forEach(function(n){
    h+='<span class="tagchip" style="--chip:'+tagColor(n)+'">'+esc(n)+tagWhen(c.tagWhen,n)+(ro?'':'<button class="tx" data-act="rmtag" data-i="'+i+'" data-j="'+j+'" data-n="'+esc(n)+'" aria-label="Remove tag '+esc(n)+'">\u00D7</button>')+'</span>';
  });
  if(!ro){
    var avail=state.tags.filter(function(t){return mine.indexOf(t.name)<0});
    h+='<select class="tagadd" data-i="'+i+'" data-j="'+j+'" aria-label="Add tag"><option value="">+ tag</option>'+avail.map(function(t){return '<option>'+esc(t.name)+'</option>'}).join('')+'<option value="__edit__">Edit tags\u2026</option></select>';
  }
  return h;
}
/* program types for a pod (TRAIN, COMPETE...): the list can grow with "+ New program" */
function programList(){return state.programs||(state.programs=['TRAIN','COMPETE','Tournament'])}
function programOptions(p){
  var list=programList().slice();
  if(p.program&&list.indexOf(p.program)<0)list.push(p.program);
  return ['<option value=""'+(p.program?'':' selected')+'>+ program</option>'].concat(list.map(function(o){
    return '<option value="'+esc(o)+'"'+(o===(p.program||'')?' selected':'')+'>'+esc(o)+'</option>';
  })).concat(['<option value="__newprog__">+ New program…</option>','<option value="__edit__">Edit programs…</option>']).join('');
}
function newProgramFor(path){
  askText('New program type','Name for the program, for example Week Program.','Program name',function(n){
    pushHist(JSON.stringify(state));
    var l=programList();
    var ex=l.filter(function(x){return String(x).toLowerCase()===n.toLowerCase()})[0];
    if(!ex){l.push(n);ex=n}
    setPath(cur(),path,ex);touch();save();render();
  },function(){render()});
}
function chipStyle(v){return '--chip:'+chipColor(v)+';--len:'+Math.max(5,(v||'').length)}
/* Edit view layout: "coach" = a row per coach with the days across, "day" = a section per day with the coaches side by side */
var layoutMode='coach';try{layoutMode=localStorage.getItem('wp-layout')==='day'?'day':'coach'}catch(e){}
function renderGridByDay(){
  viewWin=null;
  var s=cur(),H=(s.tEnd-s.tStart)/60*PPH,off=((60-s.tStart%60)%60)/60*PPH,conf=confMap(s),wx=wxMap(s),np=s.pods.length;
  var axl='';
  for(var t=Math.ceil(s.tStart/60)*60;t<=s.tEnd;t+=60)axl+='<span style="top:'+((t-s.tStart)/60*PPH)+'px">'+hourLabel(t/60)+'</span>';
  var h='<div class="bydays">';
  if(!np)h+='<div class="empty">No pods yet. Add one to start building the week.</div>';
  else s.days.forEach(function(d,j){
    h+='<section class="dsec"><div class="dsech"><input class="dname" data-p="days.'+j+'.name" value="'+esc(d.name)+'" aria-label="Day name"></div><div class="dgrid" style="--np:'+np+'"><div class="dcorner"></div>';
    s.pods.forEach(function(p,i){
      h+='<div class="dpodh"><div class="podid"><div class="podtop"><input class="pname" data-p="pods.'+i+'.name" value="'+esc(p.name)+'" aria-label="Pod name">'+
        (j===0?'<button class="x" data-act="delpod" data-i="'+i+'" title="Delete pod" aria-label="Delete pod">×</button>':'')+'</div>'+
        '<textarea class="players" rows="1" data-p="pods.'+i+'.players" placeholder="Players" aria-label="Players">'+esc(p.players)+'</textarea>'+podBtHtml(s,p,j)+podCamperBtHtml(s,p,j)+'</div>'+
        '<select class="chipin'+(p.program?'':' empty')+'" data-p="pods.'+i+'.program" style="'+chipStyle(p.program)+'" aria-label="Program">'+
          programOptions(p)+'</select></div>';
    });
    h+='<div class="dcorner"></div>';
    s.pods.forEach(function(p,i){h+='<div class="tagrow">'+tagsHtml(p.cells[j]||{},i,j,false,ptoNames(s,p,j))+'</div>'});
    h+='<div class="axis"><div class="axl" style="height:'+H+'px">'+axl+'</div></div>';
    s.pods.forEach(function(p,i){
      var c=p.cells[j]||{cards:[]};
      h+='<div class="tlcell"><div class="tl" data-i="'+i+'" data-j="'+j+'" style="height:'+H+'px;background-position:0 '+off+'px">'+layout(c.cards.concat(ghostsFor(s,p,j))).map(function(x){return cardHtml(x,s,conf,false,j)}).join('')+'</div></div>';
    });
    h+='<div class="dcorner"></div>';
    s.pods.forEach(function(p,i){
      var c=p.cells[j]||{weather:''},w=wx[i+'|'+j];
      h+='<div class="foot"><button class="add" data-act="add" data-i="'+i+'" data-j="'+j+'">+ Add event</button>'+
        '<label class="wx'+(w?' warn':'')+'" data-wi="'+i+'" data-wj="'+j+'" title="'+esc(w?c.weather+' is also the weather safety spot for '+w.join(', '):'')+'"><span>Weather safety:</span><input list="wxlist" data-p="pods.'+i+'.cells.'+j+'.weather" value="'+esc(c.weather)+'" placeholder="location" aria-label="Weather safety location"><b class="wxflag" aria-hidden="true">⚠</b></label></div>';
    });
    h+='</div></section>';
  });
  h+='</div><div class="addpod"><button class="btn" data-act="addpod">+ Add pod</button></div>'+wxDatalist(s);
  $('#grid').innerHTML=h;
  markToday(s);
}
/* ---- phone: one day at a time, swipe or tap the day strip ---- */
var MQ=window.matchMedia?window.matchMedia('(max-width:700px),(hover:none) and (pointer:coarse)'):{matches:false};
function isMobile(){return !!MQ.matches}
if(MQ.addEventListener)MQ.addEventListener('change',function(){render()});else if(MQ.addListener)MQ.addListener(function(){render()});
window.addEventListener('orientationchange',function(){setTimeout(function(){if(isMobile())render()},300)});
var mDay=null,mDayWk=null;
var mShown=null;
function mobDay(s){
  var wk=weekOf(s);
  /* changing weeks keeps the weekday you were on (this week opens on today) */
  if(mDayWk!==wk){mDay=(todayCol(s)<0&&mShown!=null)?mShown:null;mDayWk=wk}
  var j;
  if(mDay!=null&&mDay<s.days.length)j=mDay;
  else{var t=todayCol(s);j=t>=0?t:0}
  mShown=j;return j;
}
/* the whole day should fit on the screen: scale the hour height to the phone, never smaller than 26px an hour or bigger than the desktop's 44 */
function mobPPH(s){
  var hours=Math.max(1,(s.tEnd-s.tStart)/60),avail=(window.innerHeight||700)-300;
  return Math.max(34,Math.min(52,Math.floor(avail/hours)));
}
/* a coach sees only the part of the day they are working: from half an hour before their first event to half an hour after their last */
var mFull=false;
function mobTrim(s,md,fd){
  var lo=1e9,hi=-1,any=false;
  s.pods.forEach(function(p){
    if(!fd&&coachFilter&&!podVisibleFor(p))return;
    var c=p.cells[md];if(!c)return;
    c.cards.concat(ghostsFor(s,p,md)).forEach(function(x){any=true;lo=Math.min(lo,x.start);hi=Math.max(hi,x.end)});
  });
  if(!any){lo=540;hi=720}
  /* from the hour the first event starts to the hour the last one ends (3:45 ends the day at 4:00) */
  var a=Math.max(s.tStart,Math.floor(lo/60)*60),b=Math.min(s.tEnd,Math.ceil(hi/60)*60);
  if(b-a<120){b=Math.min(s.tEnd,a+120);if(b-a<120)a=Math.max(s.tStart,b-120)}
  var t=Object.assign({},s);t.tStart=a;t.tEnd=b;t._none=!any;
  return t;
}
function wkStep(d){
  var sel=$('#weeksel'),ws=Array.prototype.map.call(sel.options,function(o){return o.value}).filter(function(v){return weekTime(v)!=null}).sort(function(a,b){return weekTime(a)-weekTime(b)});
  var n=ws[ws.indexOf(sel.value)+d];
  if(n!==undefined)switchWeek(n);
}
function wkArrows(){
  var sel=$('#weeksel'),ws=Array.prototype.map.call(sel.options,function(o){return o.value}).filter(function(v){return weekTime(v)!=null}).sort(function(a,b){return weekTime(a)-weekTime(b)}),i=ws.indexOf(sel.value);
  $('#wkPrev').disabled=i<=0;$('#wkNext').disabled=i<0||i>=ws.length-1;
}
function mobStep(d){
  var s=cur(),j=mobDay(s)+d;
  if(j<0||j>=s.days.length)return;
  mDay=j;render();
}
function renderDayBar(){
  var el=$('#daybar');
  if(!isMobile()||campView||(mode!=='coach'&&mode!=='edit')){el.hidden=true;return}
  var s=cur(),md=mobDay(s),tc=todayCol(s),w0=weekStart(weekOf(s));
  el.hidden=false;
  el.innerHTML=s.days.map(function(d,j){
    var dt=w0?new Date(w0.getFullYear(),w0.getMonth(),w0.getDate()+j).getDate():'';
    return '<button class="dbtn'+(j===tc?' today':'')+'" data-act="mday" data-j="'+j+'" role="tab" aria-pressed="'+(j===md)+'"><b>'+esc(dayShort(d.name))+'</b><small>'+dt+'</small></button>';
  }).join('');
}
function renderGrid(){
  if(mode==='edit'&&layoutMode==='day'&&!isMobile()){renderGridByDay();return}
  var fd=fdOn(),s=fd?fullDaySession(weekOf(cur())):cur(),nd=s.days.length,ro=mode==='coach';
  var mob=isMobile(),md=mob?mobDay(s):-1;
  if(mob&&ro&&!mFull)s=mobTrim(s,md,fd);
  PPH=mob?mobPPH(s):44;
  viewWin={tStart:s.tStart,tEnd:s.tEnd};
  var H=(s.tEnd-s.tStart)/60*PPH,off=((60-s.tStart%60)%60)/60*PPH,conf=confMap(s);
  var h='<div class="gridin" style="--nd:'+nd+(mob?';--pph:'+PPH+'px':'')+'"><div class="hrow"><div class="corner">Pods</div><div></div>';
  s.days.forEach(function(d,i){
    h+='<div class="dayh">'+(ro?'<span class="dname">'+esc(d.name)+'</span>':
      '<input class="dname" data-p="days.'+i+'.name" value="'+esc(d.name)+'" aria-label="Day name">')+'</div>';
  });
  h+='</div><div class="pods" id="pods">';
  var axl='';
  for(var t=Math.ceil(s.tStart/60)*60;t<=s.tEnd;t+=60)axl+='<span style="top:'+((t-s.tStart)/60*PPH)+'px">'+hourLabel(t/60)+'</span>';
  var shown=0,wx=wxMap(s);
  var specView=ro&&isSpecCoach(coachFilter);
  s.pods.forEach(function(p,i){
    if(ro&&coachFilter&&!fd&&!podVisibleFor(p))return;
    shown++;
    h+='<section class="pod'+(fd?' fdpod':'')+'" data-id="'+p.id+'"><div class="podh" style="grid-column:1;grid-row:1/4'+(p.color?';box-shadow:inset 6px 0 0 '+esc(p.color):'')+'">';
    if(ro){
      h+='<div class="podid"><span class="pname">'+esc(p.name)+'</span><span class="players">'+esc(p.players)+'</span>'+(specView?'<span class="speclabel">Putting Specialist group</span>':'')+(specView||fd?'':podBtHtml(s,p)+podCamperBtHtml(s,p))+'</div>'+(p.program?'<span class="chipin chipro" style="'+chipStyle(p.program)+'">'+esc(p.program)+'</span>':'');
    }else{
      h+='<div class="podid"><div class="podtop"><span class="grip" title="Drag to reorder pods">\u283F</span><input class="pname" data-p="pods.'+i+'.name" value="'+esc(p.name)+'" aria-label="Pod name">'+
        '<button class="x" data-act="delpod" data-i="'+i+'" title="Delete pod" aria-label="Delete pod">\u00D7</button></div>'+
        '<textarea class="players" rows="1" data-p="pods.'+i+'.players" placeholder="Players" aria-label="Players">'+esc(p.players)+'</textarea>'+podBtHtml(s,p)+podCamperBtHtml(s,p)+'</div>'+
        '<select class="chipin'+(p.program?'':' empty')+'" data-p="pods.'+i+'.program" style="'+chipStyle(p.program)+'" aria-label="Program">'+
          programOptions(p)+'</select>';
    }
    h+='</div><div class="axis ax1" style="grid-column:2;grid-row:1"></div><div class="axis ax2" style="grid-column:2;grid-row:2"><div class="axl" style="height:'+H+'px">'+axl+'</div></div><div class="axis ax3" style="grid-column:2;grid-row:3"></div>';
    p.cells.forEach(function(c,j){
      if(mob&&j!==md)return;
      var col='grid-column:'+(3+j)+';';
      var offDay=specView&&!hasSpecTag(c);
      h+='<div class="tagrow" style="'+col+'grid-row:1">'+(offDay?'':tagsHtml(c,i,j,ro,c._pto||ptoNames(s,p,j)))+(specView&&!offDay?'<span class="tagchip" style="--chip:#8E5BD0">with '+esc(coachKey(p.name))+'</span>':'')+'</div>'+
        '<div class="tlcell'+(offDay?' offday':'')+'" style="'+col+'grid-row:2"><div class="tl" data-i="'+i+'" data-j="'+j+'" style="height:'+H+'px;background-position:0 '+off+'px">'+layout(offDay?[]:c.cards.concat(ghostsFor(s,p,j))).map(function(x){return cardHtml(x,s,conf,ro,j)}).join('')+'</div></div>'+
        '<div class="foot" style="'+col+'grid-row:3">'+(ro?podCamperBtHtml(s,p,j)+'<div class="wxro'+(wx[i+'|'+j]?' warn':'')+'" title="'+esc(wx[i+'|'+j]?c.weather+' is also the weather safety spot for '+wx[i+'|'+j].join(', '):'')+'">'+(c.weather?(wx[i+'|'+j]?'\u26A0 ':'')+'Weather safety: '+wxText(c):'')+'</div>':
          podCamperBtHtml(s,p,j)+'<button class="add" data-act="add" data-i="'+i+'" data-j="'+j+'">+ Add event</button>'+
          '<label class="wx'+(wx[i+'|'+j]?' warn':'')+'" data-wi="'+i+'" data-wj="'+j+'" title="'+esc(wx[i+'|'+j]?c.weather+' is also the weather safety spot for '+wx[i+'|'+j].join(', '):'')+'"><span>Weather safety:</span><input list="wxlist" data-p="pods.'+i+'.cells.'+j+'.weather" value="'+esc(c.weather)+'" placeholder="location" aria-label="Weather safety location"><b class="wxflag" aria-hidden="true">\u26A0</b></label>')+'</div>';
    });
    h+='</section>';
  });
  h+='</div>';
  if(!shown)h+='<div class="empty">'+(s.pods.length||fd?'Nothing scheduled for '+esc(coachFilter)+' in this tab.':'No pods yet. Add one to start building the week.')+'</div>';
  if(mob&&ro&&s._none)h+='<div class="empty mnone">Nothing scheduled for '+esc(dayName(s,md))+'.</div>';
  if(!ro)h+='<div class="addpod"><button class="btn" data-act="addpod">+ Add pod</button></div>';
  h+='</div>';
  h+=wxDatalist(s);
  $('#grid').innerHTML=h;
  markToday(s);
}
/* ---- camp: one extra tab per week with a camper roster and a Breakthroughs table ---- */
var CAMP_COLS=[['name','Name'],['opp','Opportunity #'],['mf','M/F'],['age','Age'],['scoring','Scoring'],['country','Country'],['email','E-mail'],['pkg','Package/Product'],['arrival','Arrival'],['departure','Departure'],['owner','Opp. Owner'],['note','Notes']];
var BT_SESSIONS=['WIB','Full Swing','Putting','Short Game'];
function campCard(cat,title,start,end,o){
  var c={id:uid(),cat:cat,title:title,details:'',zones:[],start:start,end:end};
  Object.keys(o||{}).forEach(function(k){c[k]=o[k]});
  return c;
}
/* A starting camp week built from the sample camp schedule. Times are minutes after midnight. */
function campSeedDays(){
  var P=function(a,b,z,d){return campCard('practice','Practice',a,b,{zones:z.map(String),details:d||''})};
  var SC=function(a,b){return campCard('sc','S&C',a,b)};
  var LR=function(a,b){return campCard('other','LUNCH/REST',a,b)};
  var BUS=function(dep,tee,pick){return campCard('course',courseTitle(9,'IMGCC'),dep,pick,{holes:9,course:'IMGCC',tee:tee,teeLabel:'Tee time'})};
  return [
    [P(540,675,[5,7,11,12],'(corner)'),SC(675,720),LR(720,795),P(810,960,[2,6,8])],
    [P(540,675,[9,10,12]),campCard('specialist','Core Mental',675,720),LR(720,795),BUS(770,810,945)],
    [P(540,675,[9,10,12],'(corner)'),LR(675,795),BUS(780,810,945)],
    [P(540,675,[5,7,11,12],'(corner)'),SC(675,720),LR(720,795),campCard('course','POPSTROKE',770,930,{holes:0})],
    [P(540,675,[9,10,12]),SC(675,720),LR(720,795),BUS(770,810,945)]
  ];
}
function makeCamp(wk,seed,podNames){
  var days=['Monday','Tuesday','Wednesday','Thursday','Friday'].map(function(n){return {name:n,theme:''}});
  var seeded=seed?campSeedDays():null;
  var names=(podNames&&podNames.length)?podNames:['Evan & Lindsay'];
  return {id:uid(),name:'Camp',kind:'camp',title:'Camp Schedule'+(wk&&wk!=='No week label'?' (Week of '+wk+')':''),
    tStart:480,tEnd:1020,days:days,trips:blankTrips(5),bt:[],
    pods:names.map(function(n,i){
      return {id:uid(),name:n,players:'',program:'',campers:[],
        cells:days.map(function(d,j){return {tags:[],weather:'',cards:(seeded&&i===0)?seeded[j]:[]}})};
    })};
}
function addCamp(){
  var wk=weekOf(cur());
  mutate(function(){
    [{cat:'other',title:'LUNCH/REST',details:'',dur:75,zones:[]},{cat:'specialist',title:'Core Mental',details:'',dur:45,zones:[]}].forEach(function(t){
      if(!state.templates.some(function(x){return x.title===t.title}))state.templates.push(t);
    });
    var c=makeCamp(wk,true);state.sessions.push(c);state.active=c.id;
  },'Camp added to this week. The events are a starting point from your sample camp schedule.');
}
function removeCamp(){
  var s=cur();if(!isCamp(s))return;
  if(weekSessions(weekOf(s)).length<2){toast('This week has no other tab, so Camp can’t be removed. Delete the week instead.');return}
  var wk=weekOf(s);
  askConfirm('Remove Camp from '+weekLabel(wk)+'? Its events, campers and Breakthroughs are deleted. You can press Undo right after.',function(){
    mutate(function(){
      state.sessions=state.sessions.filter(function(x){return x!==s&&x.id!==s.id});
      state.active=weekSessions(wk)[0].id;
    },'Camp removed from this week.');
  },'Remove Camp');
}
function campStudents(s){
  var o=[];s.pods.forEach(function(p){(p.campers||[]).forEach(function(c){var n=String(c.name||'').trim();if(n&&o.indexOf(n)<0)o.push(n)})});
  return o;
}
function studentOptions(s,sel){
  var list=campStudents(s);if(sel&&list.indexOf(sel)<0)list=[sel].concat(list);
  return '<option value="">Choose camper…</option>'+list.map(function(n){return '<option'+(n===sel?' selected':'')+'>'+esc(n)+'</option>'}).join('');
}
function hhmmText(v){return v?fmtT(fromHHMM(v),true):''}
/* Coach names in a camp group, e.g. "Evan & Lindsay" -> Evan, Lindsay */
function podCoachDisplay(p){
  var o=[];
  String(p.name||'').replace(/\(.*?\)/g,' ').split(/\s*(?:&|,|\band\b)\s*/i).forEach(function(x){
    x=x.trim();if(x&&!o.some(function(y){return normName(y)===normName(x)}))o.push(x);
  });
  return o;
}
/* every camper table uses the same column widths, so a column lines up from one group to the next */
var CAMP_W={name:230,opp:105,mf:58,age:56,scoring:80,country:100,email:210,pkg:150,arrival:100,departure:100,owner:130,note:190,coach:130,x:38};
function campCols(ro,split){
  var ws=CAMP_COLS.map(function(c){return CAMP_W[c[0]]||110});
  if(split&&!ro)ws.push(CAMP_W.coach);
  if(!ro)ws.push(CAMP_W.x);
  var tot=ws.reduce(function(a,b){return a+b},0);
  return {tot:tot,html:'<colgroup>'+ws.map(function(w){return '<col style="width:'+(w/tot*100).toFixed(2)+'%">'}).join('')+'</colgroup>'};
}
function campTable(p,i,ks,ro,split,cs){
  var span=CAMP_COLS.length+(ro?0:1)+(split&&!ro?1:0);
  var cc=campCols(ro,split);
  var h='<div class="teescroll"><table class="teetbl camptbl cgt" style="min-width:'+cc.tot+'px">'+cc.html+'<thead><tr>'+CAMP_COLS.map(function(c){return '<th>'+c[1]+'</th>'}).join('')+(split&&!ro?'<th>Coach</th>':'')+(ro?'':'<th></th>')+'</tr></thead><tbody>';
  if(!ks.length)h+='<tr><td colspan="'+span+'" class="nempty">No campers yet.</td></tr>';
  ks.forEach(function(k){
    var c=p.campers[k];
    h+='<tr>'+CAMP_COLS.map(function(f){
      var v=c[f[0]]||'',path='pods.'+i+'.campers.'+k+'.'+f[0];
      if(ro)return '<td'+(f[0]==='name'&&c.vip?' class="vip"':'')+'>'+esc(f[0]==='pkg'&&c.pkgFull?c.pkgFull:v)+'</td>';
      if(f[0]==='pkg')return '<td><select class="campin" data-cp="'+path+'" aria-label="Package/Product">'+['','Core','Total Athlete','Game Changer','Breakthrough'].concat(v&&PKGS.indexOf(v)<0?[v]:[]).map(function(o){return '<option'+(o===v?' selected':'')+'>'+esc(o)+'</option>'}).join('')+'</select>'+(c.pkgFull&&c.pkgFull!==v?'<small class="pkgfull">'+esc(c.pkgFull)+'</small>':'')+'</td>';
      if(f[0]==='name')return '<td class="campnamecell"><span class="cgrip" draggable="true" data-ci="'+i+'" data-ck="'+k+'" title="Drag to another group or coach" aria-label="Drag to move this camper">⠿</span><button class="vipbtn'+(c.vip?' on':'')+'" data-act="vip" data-i="'+i+'" data-k="'+k+'" title="VIP: shows this name in red for everyone" aria-label="Mark as VIP">★</button><input class="campin campname'+(c.vip?' vip':'')+'" data-cp="'+path+'" value="'+esc(v)+'" aria-label="Name"></td>';
      if(f[0]==='mf')return '<td><select class="campin" data-cp="'+path+'" aria-label="M/F">'+['','M','F'].map(function(o){return '<option'+(o===v?' selected':'')+'>'+o+'</option>'}).join('')+'</select></td>';
      return '<td><input class="campin'+(f[0]==='name'?' campname':'')+'" data-cp="'+path+'" value="'+esc(v)+'" aria-label="'+f[1]+'"></td>';
    }).join('')+
    (split&&!ro?'<td><select class="campin" data-cp="pods.'+i+'.campers.'+k+'.coach" aria-label="Coach"><option value="">Unassigned</option>'+
      cs.concat(c.coach&&!cs.some(function(n){return normName(n)===normName(c.coach)})?[c.coach]:[]).map(function(n){return '<option'+(normName(n)===normName(c.coach)?' selected':'')+'>'+esc(n)+'</option>'}).join('')+'</select></td>':'')+
    (ro?'':'<td><button class="x" data-act="delcamper" data-i="'+i+'" data-k="'+k+'" aria-label="Remove camper">×</button></td>')+'</tr>';
  });
  return h+'</tbody></table></div>';
}
/* ---- paste campers from Excel ---- */
var HDR_KEYS={'name':'name','camper':'name','student':'name','opportunity':'opp','opportunity#':'opp','opp#':'opp','mf':'mf','m/f':'mf','gender':'mf','age':'age','scoring':'scoring','score':'scoring','country':'country','customere-mail':'email','customeremail':'email','email':'email','e-mail':'email','package/product':'pkg','package':'pkg','product':'pkg','arrival':'arrival','departure':'departure','opp.owner':'owner','oppowner':'owner','owner':'owner'};
function normPkg(v){
  var t=String(v||'').toLowerCase();
  if(/game\s*changer/.test(t))return 'Game Changer';
  if(/breakthrough/.test(t))return 'Breakthrough';
  if(/total\s*athlete/.test(t))return 'Total Athlete';
  if(/^core\b/.test(t.trim()))return 'Core';
  return String(v||'').trim();
}
function parsePaste(text,pod,forced){
  var cs=podCoachDisplay(pod),split=cs.length>1;
  var rows=String(text||'').replace(/\r/g,'').split('\n').map(function(l){return l.split('\t')});
  var cols=CAMP_COLS.map(function(c){return c[0]}),coach=forced||'',out=[],skipped=0,headings=0,unknownPkg=[];
  rows.forEach(function(cells){
    var vals=cells.map(function(x){return String(x).trim().replace(/^"(.*)"$/,'$1')});
    var ne=vals.filter(Boolean);
    if(!ne.length)return;
    var hm=vals.map(function(v){return HDR_KEYS[v.toLowerCase().replace(/\s+/g,'')]||null});
    if(hm.filter(Boolean).length>=3){cols=hm;return}
    if(ne.length===1){
      var hit=cs.filter(function(n){return normName(n)===normName(ne[0])})[0];
      if(hit){if(!forced&&split){coach=hit;headings++}return}
    }
    var c={id:uid()};
    cols.forEach(function(f,ix){if(f&&vals[ix]!==undefined&&c[f]===undefined)c[f]=vals[ix]});
    if(!String(c.name||'').trim()){skipped++;return}
    c.name=c.name.trim();
    if(c.pkg){c.pkg=normPkg(c.pkg);if(PKGS.indexOf(c.pkg)<0&&unknownPkg.indexOf(c.pkg)<0)unknownPkg.push(c.pkg)}
    if(c.mf){var m=String(c.mf).trim().charAt(0).toUpperCase();c.mf=(m==='M'||m==='F')?m:''}
    if(split&&coach)c.coach=coach;
    out.push(c);
  });
  return {out:out,skipped:skipped,headings:headings,unknownPkg:unknownPkg,split:split};
}
var pcTarget=null;
function pcPreview(){
  var s=cur(),p=s.pods[pcTarget.i],r=parsePaste($('#pctext').value,p,pcTarget.coach);
  var msg='';
  if(!$('#pctext').value.trim())msg='<div class="btm">Copy the camper rows in Excel, then paste them above.</div>';
  else if(!r.out.length)msg='<div class="btm bad">⚠ No campers found. Each row needs a name.</div>';
  else{
    var by={};r.out.forEach(function(c){var k=c.coach||(r.split?'Unassigned':'');by[k]=(by[k]||0)+1});
    msg='<div class="btm ok">✓ '+r.out.length+' camper'+(r.out.length===1?'':'s')+' found'+(r.split?': '+Object.keys(by).map(function(k){return esc(k)+' '+by[k]}).join(', '):'')+'.</div>';
    if(r.split&&!pcTarget.coach&&!r.headings)msg+='<div class="btm warn">No coach name rows found, so everyone goes under Unassigned. You can move them with the Coach column.</div>';
    if(r.skipped)msg+='<div class="btm warn">'+r.skipped+' row'+(r.skipped===1?'':'s')+' skipped for having no name.</div>';
    if(r.unknownPkg.length)msg+='<div class="btm warn">Package not recognized: '+r.unknownPkg.map(esc).join(', ')+'. Only Game Changer and Breakthrough can have Breakthroughs.</div>';
  }
  $('#pcinfo').innerHTML=msg;$('#pcgo').disabled=!r.out.length;
}
function openPaste(i,coach){
  var p=cur().pods[i];pcTarget={i:i,coach:coach||null};
  $('#pctitle').textContent='Paste campers'+(coach?' for '+coach:' for '+p.name);
  $('#pcwarn').textContent=coach?'This replaces '+coach+'’s current list.':'This replaces the current camper list for '+p.name+'.';
  $('#pctext').value='';pcPreview();$('#pcdlg').showModal();$('#pctext').focus();
}
$('#pctext').addEventListener('input',pcPreview);
$('#pcgo').onclick=function(){
  var s=cur(),p=s.pods[pcTarget.i],r=parsePaste($('#pctext').value,p,pcTarget.coach),forced=pcTarget.coach;
  if(!r.out.length)return;
  $('#pcdlg').close();
  mutate(function(){
    var keep=forced?(p.campers||[]).filter(function(c){return normName(c.coach)!==normName(forced)}):[];
    if(forced&&r.split)r.out.forEach(function(c){c.coach=forced});
    p.campers=keep.concat(r.out);
  },'Pasted '+r.out.length+' camper'+(r.out.length===1?'':'s')+'.');
};
$('#pccancel').onclick=function(){$('#pcdlg').close()};
$('#pcdlg').addEventListener('mousedown',function(e){if(e.target===this)this.close()});
function renderCamp(full){
  var w=$('#campwrap'),s=cur();
  if(!isCamp(s)){w.innerHTML='';return}
  /* Holiday and Summer camps keep the camper list on a Campers tab (it still prints with the camp page) */
  var roster=!s.season||campView||!!full;
  var ro=mode==='coach';
  s.bt=s.bt||[];
  var h='<div class="sect"><h2 class="display">Campers</h2></div>'+(ro?'':'<div class="campbar"><button class="btn primary" data-act="pastecw" title="Paste the whole camp list. Colors, leads and red names come along.">Paste camp list from Excel</button><span class="note">Replaces every pod and camper for this week. Schedule blocks stay with the pods that match by color.</span></div>')+'<div class="campsec">',shown=0;
  s.pods.forEach(function(p,i){
    if(ro&&coachFilter&&!podVisibleFor(p))return;
    shown++;p.campers=p.campers||[];
    var cs=podCoachDisplay(p),split=cs.length>1;
    h+='<div class="campgrp" data-pod="'+i+'"><div class="campgh"'+(p.color?' style="background:'+esc(p.color)+'"':'')+'><b>'+esc(p.name)+'</b><span class="sp"></span>'+(ro?'':(split?'':'<button class="btn" data-act="addcamper" data-i="'+i+'">+ Add camper</button>')+'<button class="btn" data-act="pastecamp" data-i="'+i+'">Paste from Excel</button><button class="btn" data-act="addcoach" data-i="'+i+'">+ Add coach</button>')+'</div>';
    if(!split)h+=campTable(p,i,p.campers.map(function(c,k){return k}),ro,false,cs);
    else{
      var secs=cs.map(function(n){return {n:n,k:[]}}),extra={},un=[];
      p.campers.forEach(function(c,k){
        var cn=String(c.coach||'').trim();
        if(!cn){un.push(k);return}
        var sec=secs.filter(function(x){return normName(x.n)===normName(cn)})[0];
        if(sec)sec.k.push(k);else(extra[cn]=extra[cn]||[]).push(k);
      });
      Object.keys(extra).forEach(function(n){secs.push({n:n,k:extra[n]})});
      if(un.length)secs.unshift({n:'',k:un});
      secs.forEach(function(sec){
        h+='<div class="cgsec" data-coach="'+esc(sec.n)+'"><div class="campsub"><span><b>'+esc(sec.n||'Unassigned')+'</b> <small>'+sec.k.length+' camper'+(sec.k.length===1?'':'s')+'</small></span><span class="sp"></span>'+
          (ro||!sec.n?'':'<button class="btn" data-act="addcamper" data-i="'+i+'" data-coach="'+esc(sec.n)+'">+ Add camper</button><button class="btn" data-act="pastecamp" data-i="'+i+'" data-coach="'+esc(sec.n)+'">Paste</button><button class="btn" data-act="rmcoach" data-i="'+i+'" data-coach="'+esc(sec.n)+'" title="Remove this coach from the group">Remove coach</button>')+'</div>'+
          campTable(p,i,sec.k,ro,true,cs)+'</div>';
      });
    }
    h+='</div>';
  });
  if(!shown)h+='<p class="note">No campers to show.</p>';
  h+='</div>';
  if(!roster)h='';
  /* Holiday and Summer camps keep their Breakthroughs on a tab of their own */
  if(!s.season)h+='<div class="sect"><h2 class="display">Breakthroughs</h2></div><div class="campsec"><div class="campgrp">'+
    '<div class="campgh"><span class="note">1-on-1 lessons: Full Swing, Short Game and Putting, 45 minutes each. WIB is set up with Mike.</span><span class="sp"></span>'+
    (ro?'':'<label class="btdrive">Drive time after a course <input type="number" id="btdrive" min="0" max="90" step="5" value="'+(state.driveMin==null?20:state.driveMin)+'"> min</label>')+'</div>'+
    (ro?'':'<div class="btcoaches"><label>Breakthrough coaches <input type="text" id="btcoachlist" value="'+esc(btCoachList().join(', '))+'" aria-label="Breakthrough coaches, separated by commas"></label></div>')+
    '<div class="teescroll" id="btgrid"></div><div id="btload" class="btload"></div></div></div>';
  if(!ro&&!(s.season&&campView)){
    var hasFull=weekSessions(weekOf(s)).some(function(x){return !isCamp(x)});
    h+='<div class="campfoot"><label class="btdrive">Camp type <select id="campseason" aria-label="Camp type">'+[['','Regular camp'],['Holiday','Holiday camp'],['Summer','Summer camp']].map(function(o){return '<option value="'+o[0]+'"'+((s.season||'')===o[0]?' selected':'')+'>'+o[1]+'</option>'}).join('')+'</select></label>'+
      (s.season&&!hasFull?'<button class="btn" data-act="addfulltime" title="For the rare week that runs full-time next to camp">+ Add full-time AM and PM</button>':'')+
      '<span class="sp"></span><button class="btn danger" data-act="delcamp">Remove Camp from this week</button></div>'+
      '<datalist id="btcoaches">'+btCoachList().map(function(n){return '<option value="'+esc(n)+'">'}).join('')+'</datalist>';
  }
  w.innerHTML=h;
  renderBTGrid();
}

/* ---- Breakthroughs: 1-on-1 lessons, checked against the camper's and the coach's schedules ---- */
var PKGS=['Core','Total Athlete','Game Changer','Breakthrough'];
/* Coaches who can give 1-on-1 Breakthroughs. Matt H joins once the functional feature is added. */
function btCoachList(){
  if(!state.btCoaches)state.btCoaches=['Malcolm','Charlotta','Matt F','Karyn','Brad','Kev Collins','Matt H','Whitney','Jim'];
  return state.btCoaches;
}
/* Holiday and Summer weeks pick their own Breakthrough coaches (summer coaches included); other weeks use the standing list. */
function btCoachListFor(s){return (s&&s.season&&s.btCoachesWeek)?s.btCoachesWeek:btCoachList()}
/* everyone who can be ticked: the staff list, the standing Breakthrough list, this week's picks and the coaches in this week's pods */
function btPool(s){
  var o=[];
  function add(n){n=String(n||'').trim();if(n&&!o.some(function(x){return normName(x)===normName(n)}))o.push(n)}
  btCoachListFor(s).forEach(add);btCoachList().forEach(add);coachListNames().forEach(add);
  weekSessions(weekOf(s)).forEach(function(x){x.pods.forEach(function(p){podCoachDisplay(p).forEach(add)})});
  return o;
}
/* Coach gender (F or M, set with the small button beside a ticked coach) is only used to pair girls with a female coach when auto-building. */
function coachGender(n){return (state.coachGender||{})[normName(n)]||''}
function btGender(n){
  mutate(function(){
    state.coachGender=state.coachGender||{};
    var k=normName(n),g=state.coachGender[k]||'';
    var nx=g===''?'F':(g==='F'?'M':'');
    if(nx)state.coachGender[k]=nx;else delete state.coachGender[k];
  });
}
/* 'F' for a girl, unless the Notes column says otherwise ("male coach", "any coach" and so on) */
function genderPref(s,stu){
  var c=camperRec(s,stu);if(!c)return '';
  var n=String(c.note||'').toLowerCase();
  if(/\b(any|either|no preference)\b/.test(n))return '';
  if(/\b(female|woman|girl|lady)\b/.test(n))return 'F';
  if(/\b(male|man|boy|guy)\b/.test(n))return 'M';
  return c.mf==='F'?'F':'';
}
/* the first start and last end of a camper's program on a day, lunch left out */
function progBounds(s,stu,j){
  var p=camperPod(s,stu),a=null,b=null;
  if(p&&p.cells[j])p.cells[j].cards.forEach(function(c){
    if(isLunchCard(c))return;
    if(a==null||c.start<a)a=c.start;
    if(b==null||c.end>b)b=c.end;
  });
  return a==null?null:{a:a,b:b};
}
function beyondProgram(s,stu,j,st,en){var pb=progBounds(s,stu,j);return !!pb&&(en<=pb.a||st>=pb.b)}
function btPick(n){
  var s=cur(),key=normName(n),list=btCoachListFor(s).slice(),ix=-1;
  list.forEach(function(x,i){if(normName(x)===key)ix=i});
  if(ix>=0&&s.bt.some(function(r){return r.session!=='WIB'&&normName(r.coach)===key})){toast(n+' already has Breakthroughs this week. Move or delete them first.');return}
  mutate(function(){if(ix>=0)list.splice(ix,1);else list.push(n);s.btCoachesWeek=list});
}
function btEligiblePkg(v){return /game\s*changer|breakthrough/i.test(String(v||''))}
function camperPkg(s,student){
  for(var i=0;i<s.pods.length;i++){var c=(s.pods[i].campers||[]).filter(function(x){return String(x.name||'').trim()===student})[0];if(c)return c.pkg||''}
  return '';
}
var BT_TYPES=['Full Swing','Short Game','Putting','WIB'];
var BT_LEN=45,BT_EARLY=480,BT_LATE=990,BT_PROGRAM_END=960,BT_GAP=5,BT_GAP_WANT=15,BT_LUNCH_MIN=20;
var btMemo=null;
/* used while auto-building: how far the preferences may bend (0 none, 1 more than two of a type at once, 3 also the coach row limit)
   and whether any 5-minute start may be used instead of the board's time slots */
var btRelax=0,btFree=false,btGaps={id:null,list:[]};
function normName(n){return String(n||'').replace(/\(.*?\)/g,' ').replace(/\s+/g,' ').trim().toLowerCase()}
function podCoachNames(p){return String(p.name||'').replace(/\(.*?\)/g,' ').split(/\s*(?:&|,|\band\b)\s*/i).map(function(x){return x.trim().toLowerCase()}).filter(Boolean)}
function isLunchCard(c){return /lunch/i.test(c.title||'')}
function driveMin(){return state.driveMin==null?20:state.driveMin}
/* When is a coach tied up on this day? Lunch and S&C leave a coach free. Collins follows the Putting Specialist group. */
function coachBusy(wk,j,coach){
  var key='c|'+wk+'|'+j+'|'+normName(coach);
  if(btMemo&&btMemo[key])return btMemo[key];
  var cn=normName(coach),col=/collins/.test(cn),list=[],found=col,drive=driveMin(),seas=!!seasonCamp(wk);
  weekSessions(wk).forEach(function(sx){sx.pods.forEach(function(p){
    var cell=p.cells[j];if(!cell)return;
    /* in a camp week a Breakthrough coach does only Breakthroughs, so Collins is not tied to the Putting Specialist group */
    var match=col?(!seas&&(cell.tags||[]).indexOf('Putting Specialist')>=0):(podCoachNames(p).indexOf(cn)>=0);
    if(!match)return;
    found=true;
    cell.cards.forEach(function(c){
      if(isLunchCard(c))return;
      var trip=!!catOf(c.cat).trip;
      /* Holiday and Summer weeks: only S&C, mental and course trips tie a coach up. Normal program time is fine. */
      if(seas){if(!(c.cat==='sc'||trip||/mental/i.test(c.title||'')))return}
      else if(c.cat==='sc')return;
      list.push({a:c.start-BT_GAP,b:c.end+(trip?drive:BT_GAP),end:c.end,trip:trip,why:c.title+' ('+fmtRange(c.start,c.end)+')'+(trip?' plus the drive back':'')});
    });
  })});
  var res={found:found,col:col,list:list};
  if(btMemo)btMemo[key]=res;
  return res;
}
function camperPod(s,student){
  for(var i=0;i<s.pods.length;i++){if((s.pods[i].campers||[]).some(function(c){return String(c.name||'').trim()===student}))return s.pods[i]}
  return null;
}
function camperBusy(s,j,student){
  var key='k|'+s.id+'|'+j+'|'+student;
  if(btMemo&&btMemo[key])return btMemo[key];
  var p=camperPod(s,student),list=[],lunch=[],drive=driveMin(),seas=!!seasonCamp(weekOf(s));
  if(p&&p.cells[j])p.cells[j].cards.forEach(function(c){
    if(isLunchCard(c)){lunch.push({a:c.start,b:c.end});return}
    var trip=!!catOf(c.cat).trip;
    /* Holiday and Summer camps: a Breakthrough can share time with practice at the facility. It can't overlap a course trip, S&C, core, mental or APD specializations. */
    if(seas&&!(trip||c.cat==='sc'||c.cat==='specialist'||/core|mental|apd|specializ/i.test(c.title||'')))return;
    list.push({a:trip?c.start-BT_GAP:c.start,b:c.end+(trip?drive:0),why:c.title+' ('+fmtRange(c.start,c.end)+')'+(trip?' plus the drive back':''),leave:trip});
  });
  var res={found:!!p,list:list,lunch:lunch};
  if(btMemo)btMemo[key]=res;
  return res;
}
/* A coach's sessions that day run in stretches: 4 in a row at most, or 5 when lunch falls inside the stretch.
   A break of 30 minutes or more ends a stretch, and so does anything after a lunch gap that already used the extra one. */
function coachRunTooLong(others,coach,a,b){
  var key=normName(coach),cand={start:a,end:b};
  var list=others.filter(function(r){return r.session!=='WIB'&&normName(r.coach)===key}).map(function(r){return {start:r.start,end:r.end}}).concat([cand]);
  list.sort(function(x,y){return x.start-y.start});
  var runs=[],run=[list[0]],lunch=false;
  for(var i=1;i<list.length;i++){
    var p=list[i-1],n=list[i],gap=n.start-p.end;
    var lg=Math.min(n.start,780)-Math.max(p.end,720)>=20;
    if(gap>=30&&!lg){runs.push({items:run,l:lunch});run=[];lunch=false}
    else if(lg)lunch=true;
    run.push(n);
  }
  runs.push({items:run,l:lunch});
  return runs.some(function(x){return x.items.indexOf(cand)>=0&&x.items.length>(x.l?5:4)});
}
function validateBT(s,bt,ex,pool){
  var E=[],W=[],a=bt.start,b=bt.end,j=+bt.day,wk=weekOf(s),gapShort=null;
  if(!bt.student){E.push('Choose a camper.');return {E:E,W:W,paid:false}}
  var pk=camperPkg(s,bt.student);
  if(!btEligiblePkg(pk))E.push(pk?bt.student+' has the '+pk+' package. Breakthroughs are only for Game Changer or Breakthrough.':'Set '+bt.student+'’s package first. Breakthroughs are only for Game Changer or Breakthrough.');
  if(a==null||isNaN(a)||b==null){E.push('Choose a start time.');return {E:E,W:W,paid:false}}
  if(/game\s*changer/i.test(pk)&&a<540&&b>480)E.push(bt.student+' has the APD specialization from 7 to 8am, so 8:00 to 9:00am stays free for breakfast.');
  if(a<BT_EARLY)E.push('The earliest start is 8:00am.');
  if(b>BT_LATE)E.push('It has to end by 4:30pm.');else if(b>BT_PROGRAM_END)W.push('This runs past the 4:00pm end of program.');
  var others=(pool||s.bt||[]).filter(function(r){return r.id!==ex&&r.start!=null&&+r.day===j});
  var mine=others.filter(function(r){return r.student===bt.student});
  var wib=bt.session==='WIB',seas=!!seasonCamp(wk),gp=seas?0:BT_GAP;
  var mineBT=mine.filter(function(r){return r.session!=='WIB'});
  var hasW=mine.some(function(r){return r.session==='WIB'});
  if(!wib){
    if(mineBT.length>=2)E.push(bt.student+' already has two Breakthroughs this day.');
    else if(hasW&&mineBT.length>=1)E.push(bt.student+' has WITB that day, so only one other Breakthrough fits.');
    else if(mineBT.length===1)W.push('That is two on one day. Spreading them across the week is preferred.');
  }else if(mineBT.length>=2)E.push(bt.student+' already has two Breakthroughs that day, so WITB goes on another day.');
  mine.forEach(function(r){if(a<r.end&&r.start<b)E.push(bt.student+' already has '+r.session+' at '+fmtRange(r.start,r.end)+'.')});
  /* Bay 1 is only needed for a camper's first week of Full Swing. Weeks 2 and 3 can overlap. */
  if(bt.session==='Full Swing'&&(!seas||campWeekNo(s,bt.student)<=1))others.forEach(function(r){if(r.session==='Full Swing'&&(!seas||campWeekNo(s,r.student)<=1)&&a<r.end&&r.start<b)E.push('Full Swing needs Bay 1, and it is in use at '+fmtRange(r.start,r.end)+'.')});
  /* camp weeks: at most two of one lesson type at the same time, so coaches are not all doing Full Swing at 8:00 */
  if(seas&&!wib){
    var sameT=others.filter(function(r){return r.session===bt.session&&a<r.end&&r.start<b}).length;
    if(sameT>=2){var msg='There are already '+sameT+' '+bt.session+' sessions at this time. Two is the most.';if(ex==='tmp'&&btRelax<1)E.push(msg);else W.push(msg)}
  }
  var cb=camperBusy(s,j,bt.student);
  if(!cb.found)W.push(bt.student+' is not in a camp group, so their program was not checked.');
  cb.list.forEach(function(x){if(a<x.b&&x.a<b)E.push(bt.student+(x.leave&&b>x.a&&b<=x.a+BT_GAP?' would be leaving for a course (needs 5 minutes): ':' is in ')+x.why+'.')});
  cb.lunch.forEach(function(L){
    if(!(a<L.b&&L.a<b))return;
    var ivs=mine.map(function(r){return [Math.max(L.a,r.start),Math.min(L.b,r.end)]}).concat([[Math.max(L.a,a),Math.min(L.b,b)]]).filter(function(v){return v[1]>v[0]}).sort(function(x,y){return x[0]-y[0]});
    var used=0,end=-1;ivs.forEach(function(v){var st=Math.max(v[0],end);if(v[1]>st)used+=v[1]-st;end=Math.max(end,v[1])});
    if((L.b-L.a)-used<BT_LUNCH_MIN)E.push('That leaves '+bt.student+' under '+BT_LUNCH_MIN+' minutes for lunch.');
  });
  var coach=String(bt.coach||'').trim();
  if(wib){
    /* What's in the bag: 30 minutes with Mike, the club fitter. 8:00 to 11:30, then 1:00 to 3:00 until everyone is done. */
    if(b-a!==30)W.push('WITB sessions are 30 minutes.');
    if(!((a>=480&&a<=690)||(a>=780&&a<=900)))W.push('Mike usually runs WITB from 8:00 to 11:30 and 1:00 to 3:00.');
    others.forEach(function(r){if(r.session==='WIB'&&a<r.end&&r.start<b)E.push('Mike already has '+r.student+' at '+fmtRange(r.start,r.end)+'.')});
    return {E:E,W:W,paid:!E.length,gap:null};
  }
  if(!coach)E.push('Choose a coach.');
  else if(!btCoachListFor(s).some(function(n){return normName(n)===normName(coach)}))E.push(coach+' is not on the Breakthrough coaches list'+(s.season?' for this week':'')+'.');
  else{
    var other=(pool||s.bt||[]).filter(function(r){return r.id!==ex&&r.student===bt.student&&r.session!=='WIB'&&r.coach&&normName(r.coach)!==normName(coach)})[0];
    if(other){
      /* camp weeks: a camper stays with their Breakthrough coach for every lesson (WITB with Mike aside) */
      if(seas&&!ex)E.push(bt.student+' is with '+other.coach+' for Breakthroughs, so keep the same coach.');
      else W.push('Keep the same coach for all three if you can. '+bt.student+' also has '+other.coach+'.');
    }
    if(seas&&coachRunTooLong(others,coach,a,b)){
      var rm=coach+' would have too many Breakthroughs in a row (4 at most, or 5 with lunch in between). Leave a break.';
      if(btRelax>=3)W.push(rm);else E.push(rm);
    }
    others.forEach(function(r){if(r.session!=='WIB'&&normName(r.coach)===normName(coach)&&a<r.end+gp&&r.start-gp<b)E.push(coach+' has another session at '+fmtRange(r.start,r.end)+(gp?' and needs a '+gp+' minute gap.':'.'))});
    (s.btOff||[]).forEach(function(o){if(normName(o.coach)===normName(coach)&&+o.day===j&&a<o.b&&o.a<b)E.push(coach+' has time off then.')});
    var kb=coachBusy(wk,j,coach);
    kb.list.forEach(function(x){
      if(a<x.b&&x.a<b){E.push(coach+' is busy with '+x.why+'.');return}
      /* 15 minutes after the coach's program is preferred. 10 or 5 works when time is tight. */
      var gap=a-x.end;
      if(!seas&&!x.trip&&gap>=0&&gap<BT_GAP_WANT){
        W.push('Only '+gap+' minutes after '+x.why+'. '+BT_GAP_WANT+' is preferred.');
        if(gapShort==null||gap<gapShort)gapShort=gap;
      }
    });
    if(seas){
      /* camp weeks: a coach picked for Breakthroughs does only Breakthroughs */
      if(kb.found&&!kb.col)W.push(coach+' also has a group this week. Breakthrough coaches normally have none.');
    }else if(!kb.found)W.push('No schedule found for '+coach+', so only their other Breakthroughs were checked.');
    else if(kb.col&&!kb.list.length)W.push(coach+' has no Putting Specialist group on this day, so he is free.');
  }
  return {E:E,W:W,paid:!E.length&&!!coach,gap:gapShort};
}
/* Campers who can have Breakthroughs (Game Changer or Breakthrough package). */
function btCamperList(s){
  var o=[];s.pods.forEach(function(p){(p.campers||[]).forEach(function(c){var n=String(c.name||'').trim();if(n&&btEligiblePkg(c.pkg)&&o.indexOf(n)<0)o.push(n)})});
  return o;
}
function btLabel(t){return t==='WIB'?'WITB':t}
function btTypeClass(t){return {'Full Swing':'t-fs','Putting':'t-pt','Short Game':'t-sg','WIB':'t-wib'}[t]||'t-other'}
function btNormalize(s){
  s.bt=(s.bt||[]).filter(function(r){return r&&typeof r==='object'});
  s.bt.forEach(function(r){
    r.day=+r.day||0;
    if(typeof r.start==='string')r.start=r.start?fromHHMM(r.start):null;
    if(typeof r.end==='string')r.end=r.end?fromHHMM(r.end):null;
  });
}
function renderBTGrid(){
  var g=$('#btgrid'),s=cur();if(!g||!isCamp(s))return;
  var ro=mode==='coach';btNormalize(s);
  (function(){
    var rows=btCoachList().map(function(n){
      var mine=s.bt.filter(function(r){return normName(r.coach)===normName(n)&&r.start!=null});
      return {n:n,c:mine.length,m:mine.reduce(function(a,r){return a+(r.end-r.start)},0)};
    }).filter(function(x){return !ro||x.c});
    $('#btload').innerHTML=rows.length?'<span class="note">Sessions this week:</span> '+rows.map(function(x){return '<span class="btl'+(x.c?'':' none')+'">'+esc(x.n)+' <b>'+x.c+'</b>'+(x.c?' · '+x.m+' min':'')+'</span>'}).join(''):'';
  })();
  var names=btCamperList(s);
  s.bt.forEach(function(r){if(r.student&&names.indexOf(r.student)<0)names.push(r.student)});
  var total=0;s.pods.forEach(function(p){total+=(p.campers||[]).filter(function(c){return String(c.name||'').trim()}).length});
  if(!names.length){g.innerHTML='<p class="note" style="padding:8px">'+(total?'No campers have the Game Changer or Breakthrough package yet. Set it in the Package/Product column above.':'Add campers above first. Breakthroughs are only for Game Changer and Breakthrough packages.')+'</p>';return}
  var h='<table class="teetbl camptbl btt"><thead><tr><th>Camper</th>'+s.days.map(function(d){return '<th>'+esc(d.name)+'</th>'}).join('')+'<th>Sessions</th></tr></thead><tbody>';
  names.forEach(function(n){
    if(ro&&coachFilter){var cp=camperPod(s,n);if(!cp||!podVisibleFor(cp))return}
    var mine=s.bt.filter(function(r){return r.student===n});
    h+='<tr><td class="btname"><b>'+esc(n)+'</b>'+(ro?'':'<br><button class="btn" data-act="autobt" data-stu="'+esc(n)+'">Auto-build</button>')+'</td>';
    s.days.forEach(function(d,j){
      var items=mine.filter(function(r){return +r.day===j}).sort(function(x,y){return x.start-y.start});
      h+='<td class="btcell">'+items.map(function(r){
        var v=validateBT(s,r,r.id),bad=v.E.length;
        var txt=fmtRange(r.start,r.end)+' '+esc(r.session||'')+(r.coach?' · '+esc(r.coach):'');
        var tip=bad?v.E.join(' '):(v.paid?'Paid (outside the coach’s program). ':'')+v.W.join(' ');
        return '<'+(ro?'div':'button')+' class="btchip '+btTypeClass(r.session)+' '+(bad?'bad':(v.W.length?'warn':'ok'))+'"'+(ro?'':' data-act="editbt" data-id="'+r.id+'"')+' title="'+esc(tip)+'">'+(bad?'⚠ ':'')+txt+(v.paid?' <i>Paid</i>':'')+'</'+(ro?'div':'button')+'>';
      }).join('')+(ro?'':'<button class="btadd" data-act="addbt" data-stu="'+esc(n)+'" data-day="'+j+'" aria-label="Add a Breakthrough for '+esc(n)+' on '+esc(d.name)+'">+</button>')+'</td>';
    });
    h+='<td class="btcount">'+mine.length+'</td></tr>';
  });
  g.innerHTML=h+'</tbody></table>';
}
var btEdit=null;
function btFromForm(){
  var st=fromHHMM($('#btstart').value||'0:00'),has=!!$('#btstart').value;
  return {id:btEdit||'new',day:+$('#btday').value,start:has?st:null,end:has?st+(+$('#btlen').value):null,student:$('#btstu').value,coach:$('#btsess').value==='WIB'?'Mike':$('#btcoach').value.trim(),session:$('#btsess').value};
}
function btCheck(src){
  var s=cur();
  /* WITB is always with Mike, 30 minutes */
  if(src&&src.target&&src.target.id==='btsess'){
    if($('#btsess').value==='WIB'){$('#btcoach').value='Mike';$('#btlen').value='30'}
    else if($('#btcoach').value.trim()==='Mike')$('#btcoach').value='';
  }
  var bt=btFromForm(),v=validateBT(s,bt,btEdit),seas=!!seasonCamp(weekOf(s));
  $('#btmsgs').innerHTML=v.E.map(function(m){return '<div class="btm bad">⚠ '+esc(m)+'</div>'}).join('')+v.W.map(function(m){return '<div class="btm warn">'+esc(m)+'</div>'}).join('')+
    (v.paid?'<div class="btm ok">✓ Fits both schedules.'+(seas||bt.session==='WIB'?'':' Paid, since it is outside '+esc(bt.coach)+'’s program.')+'</div>':'');
  $('#btsave').disabled=!!v.E.length;
}
function openBT(id,stu,day,pre){
  var s=cur();btNormalize(s);
  var r=id?s.bt.filter(function(x){return x.id===id})[0]:null;
  btEdit=r?r.id:null;
  $('#bttitle').textContent=r?'Edit Breakthrough':'Add Breakthrough';
  $('#btstu').innerHTML=btCamperList(s).map(function(n){return '<option'+((r?r.student:stu)===n?' selected':'')+'>'+esc(n)+'</option>'}).join('');
  $('#btday').innerHTML=s.days.map(function(d,i){return '<option value="'+i+'"'+(+(r?r.day:day)===i?' selected':'')+'>'+esc(d.name)+'</option>'}).join('');
  $('#btsess').innerHTML=BT_TYPES.map(function(t){return '<option value="'+t+'"'+(r&&r.session===t?' selected':'')+'>'+btLabel(t)+'</option>'}).join('');
  $('#btstart').value=r&&r.start!=null?toHHMM(r.start):'';
  $('#btlen').value=String(r&&r.end!=null&&r.start!=null?r.end-r.start:BT_LEN);
  if($('#btlen').value===''){$('#btlen').value=String(BT_LEN)}
  $('#btcoach').value=r?r.coach||'':'';
  if(pre&&!r){
    if(pre.start!=null)$('#btstart').value=toHHMM(pre.start);
    if(pre.len)$('#btlen').value=String(pre.len);
    if(pre.session)$('#btsess').value=pre.session;
    if(pre.coach!=null)$('#btcoach').value=pre.coach;
  }
  $('#btdel').style.display=r?'':'none';
  btCheck();
  $('#btdlg').showModal();
}
function saveBT(){
  var s=cur(),bt=btFromForm();
  if(validateBT(s,bt,btEdit).E.length)return;
  $('#btdlg').close();
  mutate(function(){
    btNormalize(s);
    if(btEdit){var r=s.bt.filter(function(x){return x.id===btEdit})[0];if(r){r.day=bt.day;r.start=bt.start;r.end=bt.end;r.student=bt.student;r.coach=bt.coach;r.session=bt.session}}
    else s.bt.push({id:uid(),day:bt.day,start:bt.start,end:bt.end,student:bt.student,coach:bt.coach,session:bt.session});
  });
}
['btstu','btday','btstart','btlen','btsess','btcoach'].forEach(function(id){$('#'+id).addEventListener('input',btCheck);$('#'+id).addEventListener('change',btCheck)});
$('#btsave').onclick=saveBT;
$('#btcancel').onclick=function(){$('#btdlg').close()};
$('#btdel').onclick=function(){var id=btEdit;$('#btdlg').close();mutate(function(){var s=cur();s.bt=s.bt.filter(function(x){return x.id!==id})},'Breakthrough removed.')};
$('#btdlg').addEventListener('mousedown',function(e){if(e.target===this)this.close()});
/* Breakthrough time slots: the same rows every day, with an extra one added now and then. */
var BT_SLOTS=[480,555,615,660,765,810,870,915];
var WITB_STARTS=[480,510,540,570,600,630,660,690,780,810,840,870,900];
function btSlots(s){return (s.btSlots&&s.btSlots.length?s.btSlots:BT_SLOTS).slice().sort(function(a,b){return a-b})}
function btStarts(s){
  if(seasonCamp(weekOf(s))&&!btFree)return btSlots(s).filter(function(t){return t+BT_LEN<=BT_LATE});
  var o=[];for(var st=BT_EARLY;st+BT_LEN<=BT_LATE;st+=5)o.push(st);return o;
}
/* the slot row a booking sits in: the latest slot that starts at or before it */
function slotFor(slots,t){var r=slots[0];slots.forEach(function(x){if(x<=t)r=x});return r}
/* Week number and last coach, for a camper who was here in an earlier week. */
function btHist(s,stu){
  var t=weekTime(weekOf(s)),n=1,prev='',pt=-1,seen={};
  state.sessions.forEach(function(x){
    if(x===s||!isCamp(x)||!x.bt)return;
    var w=weekOf(x),tw=weekTime(w);
    if(tw==null||t==null||tw>=t)return;
    var rows=x.bt.filter(function(r){return r&&r.student===stu&&r.session!=='WIB'&&r.coach});
    if(!rows.length)return;
    if(!seen[w]){seen[w]=1;n++}
    if(tw>pt){pt=tw;prev=rows[0].coach}
  });
  return {n:n,prev:prev};
}
/* WITB with Mike: the earliest open 30 minute spot, on the day that has the fewest so far */
function autoWitb(s,stu,pool){
  var best=null,starts=WITB_STARTS;
  if(btFree){starts=[];for(var q=480;q<=900;q+=15)if(q<=690||q>=780)starts.push(q)}
  for(var d=0;d<s.days.length;d++)for(var i=0;i<starts.length;i++){
    var st=starts[i],c={id:'tmp',day:d,start:st,end:st+30,student:stu,coach:'Mike',session:'WIB'};
    var v=validateBT(s,c,'tmp',pool);if(v.E.length)continue;
    /* stack WITB as early in the week as possible so Mike is free for the last days */
    var score=d*10000+st+(v.W.length?50000:0);
    if(!best||score<best.score)best={score:score,c:c};
  }
  return best?{day:best.c.day,start:best.c.start,end:best.c.end,student:stu,coach:'Mike',session:'WIB'}:null;
}
/* the three lessons plus WITB when this is a Holiday or Summer week */
function autoPickAll(s,stu,chosen){
  var r=autoPick(s,stu,chosen);
  if(seasonCamp(weekOf(s))&&!s.bt.some(function(x){return x.student===stu&&x.session==='WIB'})){
    btMemo={};
    var w=autoWitb(s,stu,s.bt.concat(r.out));
    btMemo=null;
    if(w)r.out.push(w);else r.miss.push('WIB');
  }
  return r;
}
/* Auto-build: three 45 minute lessons for one camper with one coach. */
var btProposed=[];
function autoBuildBT(s,stu,coach){
  var types=['Full Swing','Short Game','Putting'].filter(function(t){return !s.bt.some(function(r){return r.student===stu&&r.session===t})});
  var pool=s.bt.slice(),out=[],miss=[],starts=btStarts(s),seas=!!seasonCamp(weekOf(s));
  btMemo={};
  types.forEach(function(t){
    var best=null,minC=1e9;
    /* the coach's lightest day so far, so their sessions even out across the week */
    for(var dd=0;dd<s.days.length;dd++){
      var nn=pool.filter(function(x){return x.session!=='WIB'&&+x.day===dd&&normName(x.coach)===normName(coach)}).length;
      if(nn<minC)minC=nn;
    }
    for(var d=0;d<s.days.length;d++)for(var si=0;si<starts.length;si++){
      var st=starts[si];
      var c={id:'tmp',day:d,start:st,end:st+BT_LEN,student:stu,coach:coach,session:t};
      var v=validateBT(s,c,'tmp',pool);if(v.E.length)continue;
      var perDay=pool.filter(function(x){return x.student===stu&&+x.day===d}).length;
      var coachDay=pool.filter(function(x){return normName(x.coach)===normName(coach)&&+x.day===d}).length;
      var score=perDay*1000+(c.end>BT_PROGRAM_END?500:0)+coachDay*50+st/10+(v.gap!=null?(BT_GAP_WANT-v.gap)*40:0);
      /* camp weeks: share the time. Two lessons can sit before or after program and two inside it, but not three of one kind. */
      if(seas){
        /* a coach does mostly one lesson type per day, and the sessions spread across the day instead of piling into the morning */
        var slotLoad=pool.filter(function(x){return x.session!=='WIB'&&x.start!=null&&+x.day===d&&x.start<c.end&&c.start<x.end}).length;
        var sameT=0,otherT=0;
        pool.forEach(function(x){if(x.session==='WIB'||+x.day!==d||normName(x.coach)!==normName(coach))return;if(x.session===t)sameT++;else otherT++});
        score+=slotLoad*90+(coachDay-minC)*130-st/10*0.9+(sameT?-150:(otherT?200:0));
        /* first week of Full Swing: Breakthrough-package campers get 8:00am (Game Changer campers can't start before 9:00),
           and these stay off the last day of the week when there is room */
        if(t==='Full Swing'&&campWeekNo(s,stu)<=1){
          var pk0=camperPkg(s,stu);
          if(/breakthrough/i.test(pk0)&&!/game\s*changer/i.test(pk0)&&c.start===480)score-=600;
          if(d>=4)score+=500;
        }
        var cntOut=0,cntIn=0,outNow=beyondProgram(s,stu,d,c.start,c.end);
        pool.forEach(function(x){if(x.student!==stu||x.session==='WIB'||x.start==null)return;if(beyondProgram(s,stu,+x.day,x.start,x.end))cntOut++;else cntIn++});
        if((outNow&&cntOut>=2)||(!outNow&&cntIn>=2))score+=700;
      }
      if(!best||score<best.score)best={score:score,c:c};
    }
    if(best){pool.push(best.c);out.push({day:best.c.day,start:best.c.start,end:best.c.end,student:stu,coach:coach,session:t})}
    else miss.push(t);
  });
  btMemo=null;
  return {out:out,miss:miss};
}
/* No coach chosen: keep the camper with the coach they already have, otherwise try the least busy coach first. */
function autoPick(s,stu,chosen){
  if(chosen){var r0=autoBuildBT(s,stu,chosen);r0.coach=chosen;return r0}
  var load={};btCoachListFor(s).forEach(function(n){load[normName(n)]=0});
  s.bt.forEach(function(r){var k=normName(r.coach);if(k in load)load[k]++});
  var seas=!!seasonCamp(weekOf(s)),pref=seas?genderPref(s,stu):'';
  /* fewest sessions first; in camp weeks a girl is paired with a female coach (and a boy with a male coach when asked for), if that coach's gender is set */
  function mismatch(n){var g=coachGender(n);return (pref&&g&&g!==pref)?1:0}
  var list=btCoachListFor(s).slice().sort(function(a,b){return mismatch(a)-mismatch(b)||load[normName(a)]-load[normName(b)]});
  var ex=s.bt.filter(function(r){return r.student===stu&&r.session!=='WIB'&&r.coach})[0];
  if(ex)list=seas?[ex.coach]:[ex.coach].concat(list.filter(function(n){return normName(n)!==normName(ex.coach)}));
  var best=null;
  for(var i=0;i<list.length;i++){
    var r=autoBuildBT(s,stu,list[i]);r.coach=list[i];
    if(!r.miss.length)return r;
    if(!best||r.out.length>best.out.length)best=r;
  }
  return best||{out:[],miss:['Full Swing','Short Game','Putting'],coach:''};
}
function openAuto(stu){
  var s=cur();
  $('#atstu').innerHTML=btCamperList(s).map(function(n){return '<option'+(n===stu?' selected':'')+'>'+esc(n)+'</option>'}).join('');
  $('#atcoach').value='';$('#atres').innerHTML='';btProposed=[];$('#atadd').disabled=true;
  $('#atdlg').showModal();$('#atcoach').focus();
}
function runAuto(){
  var s=cur(),stu=$('#atstu').value,coach=$('#atcoach').value.trim();
  btNormalize(s);
  var r=autoPickAll(s,stu,coach);btProposed=r.out;coach=r.coach||coach;
  $('#atres').innerHTML=(r.coach&&r.out.length?'<div class="btm">Coach: <b>'+esc(r.coach)+'</b>'+(r.miss.filter(function(t){return t!=='WIB'}).length?' (no coach could fit all three)':'')+'</div>':'')+r.out.map(function(x){return '<div class="btm ok">✓ '+esc(s.days[x.day].name)+' '+fmtRange(x.start,x.end)+' · '+esc(btLabel(x.session))+(x.session==='WIB'?' with Mike':'')+'</div>'}).join('')+
    r.miss.map(function(t){return '<div class="btm bad">⚠ No opening found for '+esc(btLabel(t))+(coach&&t!=='WIB'?' with '+esc(coach):'')+'.</div>'}).join('')+
    (!r.out.length&&!r.miss.length?'<div class="btm warn">Everything is already scheduled for this camper.</div>':'');
  $('#atadd').disabled=!r.out.length;
}
$('#atbuild').onclick=runAuto;
$('#atadd').onclick=function(){
  var list=btProposed.slice(),s=cur();$('#atdlg').close();
  mutate(function(){list.forEach(function(x){s.bt.push({id:uid(),day:x.day,start:x.start,end:x.end,student:x.student,coach:x.coach,session:x.session})})},'Added '+list.length+' Breakthrough'+(list.length>1?'s':'')+'.');
};
$('#atclose').onclick=function(){$('#atdlg').close()};
$('#atdlg').addEventListener('mousedown',function(e){if(e.target===this)this.close()});
document.addEventListener('change',function(e){
  if(e.target.id==='campseason'){
    var cs=cur(),v=e.target.value;
    mutate(function(){if(v)cs.season=v;else delete cs.season},v?'This week is now a '+v+' camp. Breakthroughs have their own tab.':'Back to a regular camp tab.');
    return;
  }
  if(e.target.id==='btcoachlist'){
    var l=e.target.value.split(',').map(function(x){return x.trim()}).filter(Boolean);
    if(l.length){state.btCoaches=l;save();var dl=$('#btcoaches');if(dl)dl.innerHTML=l.map(function(n){return '<option value="'+esc(n)+'">'}).join('');renderBTGrid();if(btView)renderBTPage(cur())}
    return;
  }
  if(e.target.id==='btdrive'){state.driveMin=Math.max(0,+e.target.value||0);save();renderBTGrid();if(btView)renderBTPage(cur())}
});
/* ---- Breakthroughs tab for Holiday and Summer camps: a board per day, coaches across and time slots down, plus WITB with Mike ---- */
function camperRec(s,stu){
  for(var i=0;i<s.pods.length;i++){var c=(s.pods[i].campers||[]).filter(function(x){return String(x.name||'').trim()===stu})[0];if(c)return c}
  return null;
}
function parseSheetDate(v){
  var m=/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(String(v||'').trim());if(!m)return null;
  var y=+m[3];if(y<100)y+=2000;return new Date(y,+m[1]-1,+m[2]);
}
/* the Monday of the camp week a date belongs to: a Saturday or Sunday arrival counts for the week that follows */
function mondayOfCamp(d){var x=new Date(d.getFullYear(),d.getMonth(),d.getDate()),w=x.getDay();x.setDate(x.getDate()+(w===0?1:(w===6?2:1-w)));return x}
/* which week of camp this is for the camper: from the Arrival date when there is one, otherwise from earlier weeks in the planner */
function campWeekNo(s,stu){
  var c=camperRec(s,stu),a=c&&parseSheetDate(c.arrival),dp=c&&parseSheetDate(c.departure),ws=weekStart(weekOf(s));
  if(c&&c.btWeek)return +c.btWeek;
  if(a&&ws){
    var n=Math.max(1,Math.round((mondayOfCamp(ws)-mondayOfCamp(a))/604800000)+1);
    /* camp stays are a few weeks. A long stay (a full-time student's arrival) is not a camp week count. */
    var span=dp?Math.round((mondayOfCamp(dp)-mondayOfCamp(a))/604800000):0;
    if(n<=6&&span<=7)return n;
  }
  var h=btHist(s,stu).n;
  return h<=6?h:1;
}
/* "Wk 2" on a camper's card. Click it to set the week yourself: 2, 3, 4, 1, then back to automatic. */
function btWeekBadge(s,stu,ro){
  var c=camperRec(s,stu),n=campWeekNo(s,stu),set=!!(c&&c.btWeek),h=btHist(s,stu);
  var tip=(set?'Set by you. ':'Worked out from the Arrival date or earlier weeks. ')+(h.prev?'Last Breakthrough coach: '+h.prev+'. ':'')+(ro?'':'Click to change.');
  if(ro)return n>1?'<small class="btwk" title="'+esc(tip)+'">Wk '+n+'</small>':'';
  return '<button class="btwk'+(set?' set':'')+(n>1?' ret':'')+'" data-act="btweek" data-stu="'+esc(stu)+'" title="'+esc(tip)+'">Wk '+n+'</button>';
}
function hadEarlierBT(s,name){
  var t=weekTime(weekOf(s));
  return state.sessions.some(function(x){
    if(x===s||!isCamp(x)||!x.bt)return false;
    var tw=weekTime(weekOf(x));if(tw==null||t==null||tw>=t)return false;
    return x.bt.some(function(r){return r&&r.student===name&&r.session!=='WIB'});
  });
}
function isFinalWeek(s,stu){
  var c=camperRec(s,stu),dp=c&&parseSheetDate(c.departure),ws=weekStart(weekOf(s));
  if(!dp||!ws)return false;
  var mon=mondayOfCamp(ws);return dp>=mon&&dp<new Date(mon.getFullYear(),mon.getMonth(),mon.getDate()+7);
}
function isVip(s,stu){var c=camperRec(s,stu);return !!(c&&c.vip)}
function btName(s,stu){var n=campWeekNo(s,stu);return stu+(n>1?' ('+n+')':'')}
function btBoardHtml(s,ro){
  var wk=weekOf(s),slots=btSlots(s),all=btCoachListFor(s),coaches=all;
  /* a Breakthrough coach picked in the dropdown sees just their own column; Mike sees just the WITB list */
  var onlyCoach=false,onlyMike=false;
  if(ro&&coachFilter){
    var f=all.filter(function(n){return nameFz(n)===nameFz(coachFilter)});
    if(f.length){coaches=f;onlyCoach=true}
    else if(/^mike\b/i.test(String(coachFilter).trim()))onlyMike=true;
  }
  var h='',busyMemo={};
  function busyAt(j,n,t){
    var k=j+'|'+normName(n);
    if(!busyMemo[k])busyMemo[k]=coachBusy(wk,j,n);
    return busyMemo[k].list.filter(function(x){return t<x.b&&x.a<t+BT_LEN})[0]||null;
  }
  var mobBT=isMobile(),mdBT=mobBT?mobDay(s):-1;
  s.days.forEach(function(d,j){
    if(mobBT&&j!==mdBT)return;
    h+='<section class="btday"><h3><span>'+esc(d.name)+(rangeDateLabel(wk,j)?', '+esc(rangeDateLabel(wk,j)):'')+'</span></h3><div class="btflex btcard">'+(onlyMike?'<div class="teescroll" hidden><table class="bbt"><thead><tr><th></th>':'<div class="teescroll"><table class="bbt" style="width:'+(78+coaches.length*130)+'px"><thead><tr><th></th>')+
      coaches.map(function(n){return '<th class="bbh"><span>'+esc(n)+'</span>'+(ro?'':'<button class="bdayoff" data-act="bday" data-day="'+j+'" data-coach="'+esc(n)+'" title="Mark '+esc(n)+' off all day, or clear it">off</button>')+'</th>'}).join('')+'</tr></thead><tbody>';
    slots.forEach(function(t){
      h+='<tr><th class="bbtime">'+fmtT(t,true)+(ro?'':'<button class="x" data-act="bslotdel" data-t="'+t+'" title="Remove this time slot" aria-label="Remove this time slot">×</button>')+'</th>';
      coaches.forEach(function(n){
        var key=normName(n);
        var bks=s.bt.filter(function(r){return r.session!=='WIB'&&r.start!=null&&+r.day===j&&normName(r.coach)===key&&slotFor(slots,r.start)===t});
        var off=(s.btOff||[]).some(function(o){return +o.day===j&&normName(o.coach)===key&&o.a===t});
        var act=ro?'':' data-act="bcell" data-day="'+j+'" data-coach="'+esc(n)+'" data-t="'+t+'"';
        var dp=ro?'':' data-dd="'+j+'" data-dc="'+esc(n)+'" data-dt="'+t+'"';
        if(bks.length){
          h+='<td class="bbc"'+dp+'>'+bks.map(function(r){
            var v=validateBT(s,r,r.id),bad=v.E.length;
            var tip=btName(s,r.student)+'\n'+btLabel(r.session)+' · '+fmtRange(r.start,r.end)+(bad?'\n'+v.E.join('\n'):(v.W.length?'\n'+v.W.join('\n'):''));
            return '<'+(ro?'div':'button')+' class="bbk '+btTypeClass(r.session)+(isVip(s,r.student)?' vip':'')+(bad?' bad':(v.W.length?' warn':''))+'"'+(ro?'':' data-act="editbt" draggable="true" data-id="'+r.id+'"')+' title="'+esc(tip)+'"><span class="bbn">'+(bad?'⚠ ':'')+esc(btName(s,r.student))+'</span>'+(r.start!==t?'<small>'+fmtT(r.start,true)+'</small>':'')+'</'+(ro?'div':'button')+'>';
          }).join('')+'</td>';
        }else if(off){
          h+='<td class="bbc off"'+act+dp+' title="Time off"></td>';
        }else{
          var bz=busyAt(j,n,t);
          if(bz)h+='<td class="bbc blk"'+dp+' title="'+esc(n+' is busy: '+bz.why)+'"></td>';
          else h+='<td class="bbc emp"'+act+dp+'>'+(ro?'':'<span>+</span>')+'</td>';
        }
      });
      h+='</tr>';
    });
    h+='</tbody></table></div>';
    /* WITB with Mike for this day */
    var wr=s.bt.filter(function(r){return r.session==='WIB'&&r.start!=null&&+r.day===j}),times=WITB_STARTS.slice();
    wr.forEach(function(r){if(times.indexOf(r.start)<0)times.push(r.start)});
    times.sort(function(a,b){return a-b});
    h+='<div class="teescroll"'+(onlyCoach?' hidden':'')+'><table class="bbt bbw"><thead><tr><th colspan="2">WITB with Mike</th><th>Last BT coach</th></tr></thead><tbody>';
    var shown=0;
    times.forEach(function(t){
      var items=wr.filter(function(r){return r.start===t});
      if(!items.length&&ro)return;
      shown++;
      h+='<tr'+(t===780?' class="bbgap"':'')+'><th class="bbtime">'+fmtT(t,true)+'</th>';
      var wdp=ro?'':' data-dd="'+j+'" data-dt="'+t+'" data-dw="1"';
      if(items.length){
        h+='<td class="bbwn"'+wdp+'>'+items.map(function(r){
          var v=validateBT(s,r,r.id),bad=v.E.length;
          return '<'+(ro?'div':'button')+' class="bbk t-wib'+(isVip(s,r.student)?' vip':'')+(bad?' bad':(v.W.length?' warn':''))+'"'+(ro?'':' data-act="editbt" draggable="true" data-id="'+r.id+'"')+' title="'+esc(btName(s,r.student)+'\n'+fmtRange(r.start,r.end)+(bad?'\n'+v.E.join('\n'):''))+'"><span class="bbn">'+(bad?'⚠ ':'')+esc(btName(s,r.student))+'</span></'+(ro?'div':'button')+'>';
        }).join('')+'</td><td class="bbprev">'+items.map(function(r){return esc(btHist(s,r.student).prev)}).join('')+'</td>';
      }else h+='<td class="bbc emp"'+(ro?'':' data-act="addwitb" data-day="'+j+'" data-t="'+t+'"')+wdp+'>'+(ro?'':'<span>+</span>')+'</td><td></td>';
      h+='</tr>';
    });
    if(!shown)h+='<tr><td colspan="3" class="nempty">No WITB sessions yet.</td></tr>';
    h+='</tbody></table></div></div></section>';
  });
  return h;
}
function renderBTPage(s){
  var el=$('#btpage'),ro=mode==='coach';
  if(!s){el.innerHTML='';return}
  btNormalize(s);
  s.btOff=s.btOff||[];
  var names=btCamperList(s);
  s.bt.forEach(function(r){if(r.student&&names.indexOf(r.student)<0)names.push(r.student)});
  var h='<div class="btp">'+
    '<div class="btbar"><span class="note">'+esc(s.season||'')+' camp, '+esc(weekLabel(weekOf(s)))+'</span><span class="sp"></span>'+
    (ro?'':'<button class="btn danger" data-act="btreset" title="Removes every Breakthrough and WITB session this week so you can build them again">Reset Breakthroughs</button><button class="btn primary" data-act="btall" title="Fills in Full Swing, Short Game, Putting and WITB for every camper who still needs them">Auto-build everyone</button>')+'</div>';
  if(!ro){
    h+='<div class="btbar"><label class="btdrive">Drive time after a course <input type="number" id="btdrive" min="0" max="90" step="5" value="'+driveMin()+'"> min</label>'+
      '<span class="sp"></span>'+
      '<label class="btdrive">New time slot <input type="time" id="btslotin" step="300"></label><button class="btn" data-act="bslotadd">Add slot</button></div>'+
      '<div class="btbar btpick"><span class="note">Coaches doing Breakthroughs this week:</span>'+
      btPool(s).map(function(n){var on=btCoachListFor(s).some(function(x){return normName(x)===normName(n)});return '<span class="btpg"><button class="btpk'+(on?' on':'')+'" data-act="btpick" data-n="'+esc(n)+'" aria-pressed="'+on+'">'+esc(n)+'</button>'+(on?'<button class="btg" data-act="btgender" data-n="'+esc(n)+'" title="Coach gender, used to pair girls with a female coach. Click to change.">'+(coachGender(n)||'?')+'</button>':'')+'</span>'}).join('')+'</div>'+
      '<datalist id="btcoaches">'+btCoachListFor(s).map(function(n){return '<option value="'+esc(n)+'">'}).join('')+'</datalist>';
  }
  h+='<div class="btbar btleg"><span class="btlg t-fs">Full Swing</span><span class="btlg t-sg">Short Game</span><span class="btlg t-pt">Putting</span><span class="btlg t-wib">WITB (Mike)</span>'+
    '<span class="btlg blkk">Coach busy with S&amp;C, mental or a course</span><span class="btlg offk">Time off</span><span class="note">(2) means the camper’s second week.</span></div>';
  if(!ro&&btGaps.id===s.id&&btGaps.list.length){
    h+='<div class="btgaps"><b>Could not place ('+btGaps.list.length+')</b><ul>'+btGaps.list.map(function(g){
      return '<li><b>'+esc(g.n)+'</b>: '+esc(btLabel(g.t))+(g.why.length?' <small>Mostly blocked by: '+g.why.map(esc).join(' · ')+'</small>':'')+'</li>';
    }).join('')+'</ul><span class="note">Add a time slot, tick another coach, or place these by hand with the + on a cell.</span></div>';
  }
  /* who still needs what (coaches go straight to the days) */
  if(ro){
  }else if(!names.length){
    h+='<p class="note" style="padding:8px">'+(campStudents(s).length?'No campers have the Game Changer or Breakthrough package yet. Set it in the Package/Product column on the Camp tab.':'Add campers on the Camp tab first. Breakthroughs are only for Game Changer and Breakthrough packages.')+'</p>';
  }else{
    h+='<div class="btcampers">'+names.map(function(n){
      if(ro&&coachFilter){var cp=camperPod(s,n);if(!cp||!podVisibleFor(cp))return ''}
      var mine=s.bt.filter(function(r){return r.student===n}),co=mine.filter(function(r){return r.session!=='WIB'&&r.coach})[0];
      var cpod=camperPod(s,n);
      return '<div class="btcp"'+(cpod&&cpod.color?' style="border-left:5px solid '+esc(cpod.color)+'"':'')+'><b'+(isVip(s,n)?' class="vip"':'')+'>'+esc(btName(s,n))+'</b>'+btWeekBadge(s,n,ro)+(isFinalWeek(s,n)&&campWeekNo(s,n)>1?'<small>last week</small>':'')+(co?'<small>'+esc(co.coach)+'</small>':'')+
        '<span class="btdots">'+BT_TYPES.map(function(t){return '<i class="'+btTypeClass(t)+(mine.some(function(r){return r.session===t})?' on':'')+'" title="'+esc(btLabel(t))+'"></i>'}).join('')+'</span>'+
        (ro?'':'<button class="btn" data-act="autobt" data-stu="'+esc(n)+'">Auto-build</button>')+'</div>';
    }).join('')+'</div>';
  }
  h+=btBoardHtml(s,ro);
  /* sessions per coach */
  var rows=btCoachListFor(s).map(function(n){
    var mine=s.bt.filter(function(r){return r.session!=='WIB'&&normName(r.coach)===normName(n)&&r.start!=null});
    return {n:n,c:mine.length,m:mine.reduce(function(a,r){return a+(r.end-r.start)},0)};
  }).filter(function(x){return !ro||x.c});
  /* the sessions-per-coach summary is for the person building the week, not the coach view */
  h+=(ro?'':'<div class="btload">'+(rows.length?'<span class="note">Sessions this week:</span> '+rows.map(function(x){return '<span class="btl'+(x.c?'':' none')+'">'+esc(x.n)+' <b>'+x.c+'</b>'+(x.c?' · '+x.m+' min':'')+'</span>'}).join(''):'')+'</div>')+'</div>';
  el.innerHTML=h;
}
/* drag a Breakthrough (or a WITB) to another cell; it only lands if it passes the same checks as adding one by hand */
var btdrag=null;
$('#btpage').addEventListener('dragstart',function(e){
  var c=e.target.closest&&e.target.closest('.bbk[data-id]');if(!c||mode!=='edit')return;
  btdrag={id:c.dataset.id};
  e.dataTransfer.effectAllowed='move';
  try{e.dataTransfer.setData('text/plain','breakthrough')}catch(x){}
});
$('#btpage').addEventListener('dragover',function(e){
  if(!btdrag)return;
  var td=e.target.closest&&e.target.closest('[data-dt]');if(!td)return;
  e.preventDefault();e.dataTransfer.dropEffect='move';
  cdropClear();td.classList.add('cdrop');
});
$('#btpage').addEventListener('dragend',function(){btdrag=null;cdropClear()});
$('#btpage').addEventListener('drop',function(e){
  if(!btdrag)return;
  var td=e.target.closest&&e.target.closest('[data-dt]'),id=btdrag.id;btdrag=null;cdropClear();
  if(!td)return;
  e.preventDefault();
  var s=cur();btNormalize(s);
  var r=s.bt.filter(function(x){return x.id===id})[0];if(!r)return;
  var isW=r.session==='WIB',toW=td.dataset.dw==='1';
  if(isW!==toW){toast(isW?'WITB goes in the WITB list.':'Lessons go in a coach’s column.',false,true);return}
  var len=r.end-r.start,st=+td.dataset.dt;
  var nd={id:r.id,day:+td.dataset.dd,start:st,end:st+len,student:r.student,coach:isW?'Mike':td.dataset.dc,session:r.session};
  if(nd.day===+r.day&&nd.start===r.start&&normName(nd.coach)===normName(r.coach))return;
  var v=validateBT(s,nd,r.id);
  if(v.E.length){toast('Can’t move it there: '+v.E[0],false,true);return}
  mutate(function(){r.day=nd.day;r.start=nd.start;r.end=nd.end;r.coach=nd.coach},'Moved '+(r.student.split(/\s+/)[0]||'it')+' to '+s.days[nd.day].name+' '+fmtT(nd.start,true)+(isW?'':' with '+nd.coach)+'.'+(v.W.length?' '+v.W[0]:''));
});
/* a cell on the board: add a Breakthrough, or mark time off */
var bcT=null;
function openBCell(day,coach,t){
  var s=cur(),off=(s.btOff||[]).some(function(o){return +o.day===day&&normName(o.coach)===normName(coach)&&o.a===t});
  bcT={day:day,coach:coach,t:t,off:off};
  $('#bctitle').textContent=coach+' · '+s.days[day].name+' · '+fmtT(t,true);
  $('#bcsub').textContent=off?'This slot is marked as time off.':'Add a Breakthrough here, or mark the slot as time off.';
  $('#bcadd').style.display=off?'none':'';
  $('#bcoff').textContent=off?'Clear time off':'Mark time off';
  $('#bcdlg').showModal();
}
$('#bcadd').onclick=function(){var x=bcT;$('#bcdlg').close();openBT(null,'',x.day,{start:x.t,coach:x.coach,session:'Full Swing',len:BT_LEN})};
$('#bcoff').onclick=function(){
  var x=bcT,s=cur(),key=normName(x.coach);$('#bcdlg').close();
  mutate(function(){
    s.btOff=s.btOff||[];
    if(x.off)s.btOff=s.btOff.filter(function(o){return !(+o.day===x.day&&normName(o.coach)===key&&o.a===x.t)});
    else s.btOff.push({coach:x.coach,day:x.day,a:x.t,b:x.t+BT_LEN});
  });
};
$('#bcx').onclick=function(){$('#bcdlg').close()};
$('#bcdlg').addEventListener('mousedown',function(e){if(e.target===this)this.close()});
function toggleCoachDay(day,coach){
  var s=cur(),slots=btSlots(s),key=normName(coach);
  mutate(function(){
    s.btOff=s.btOff||[];
    var mine=s.btOff.filter(function(o){return +o.day===day&&normName(o.coach)===key});
    if(mine.length>=slots.length)s.btOff=s.btOff.filter(function(o){return !(+o.day===day&&normName(o.coach)===key)});
    else slots.forEach(function(t){if(!mine.some(function(o){return o.a===t}))s.btOff.push({coach:coach,day:day,a:t,b:t+BT_LEN})});
  });
}
function addBtSlot(){
  var v=$('#btslotin').value;if(!v){$('#btslotin').focus();return}
  var t=fromHHMM(v),s=cur();
  if(btSlots(s).indexOf(t)>=0){toast('That time slot is already there.');return}
  mutate(function(){s.btSlots=btSlots(s);s.btSlots.push(t);s.btSlots.sort(function(a,b){return a-b})});
}
function delBtSlot(t){
  var s=cur(),slots=btSlots(s);
  if(slots.length<2){toast('Keep at least one time slot.');return}
  if(s.bt.some(function(r){return r.session!=='WIB'&&r.start!=null&&slotFor(slots,r.start)===t})){toast('That slot has Breakthroughs in it. Move or delete them first.');return}
  mutate(function(){s.btSlots=slots.filter(function(x){return x!==t});s.btOff=(s.btOff||[]).filter(function(o){return o.a!==t})});
}
function resetBT(){
  var s=cur();btNormalize(s);
  if(!s.bt.length){toast('There are no Breakthroughs to reset.');return}
  askConfirm('Remove all '+s.bt.length+' Breakthrough and WITB sessions for this week? Your campers, coach picks, time off and time slots are kept. You can press Undo right after.',function(){
    mutate(function(){s.bt=[];btGaps={id:null,list:[]}},'Breakthroughs reset. Press Auto-build everyone to redo them.');
  },'Reset');
}
function autoBuildAll(){
  var s=cur();btNormalize(s);
  var names=btCamperList(s);
  if(!names.length){toast('No campers have the Game Changer or Breakthrough package yet.');return}
  /* Breakthrough-package campers go first so they get the 8:00am Full Swing, which leaves the later spots for Game Changer campers */
  names=names.slice().sort(function(a,b){
    function rank(n){var p=camperPkg(s,n);return (/breakthrough/i.test(p)&&!/game\s*changer/i.test(p))?0:1}
    return rank(a)-rank(b);
  });
  var before=s.bt.length,total=0,gaps=[];
  mutate(function(){
    /* 1. the normal build, with every preference */
    names.forEach(function(n){btAdd(s,btTry(s,n,'',0,false).out)});
    /* 2. anyone still short: start that camper over with a different coach, with the same rules and the same time slots */
    names.forEach(function(n){
      if(!btNeeds(s,n).filter(function(t){return t!=='WIB'}).length)return;
      var saved=s.bt;
      s.bt=saved.filter(function(r){return !(r.student===n&&r.session!=='WIB')});
      var r=btTry(s,n,'',0,false);
      if(!r.miss.some(function(t){return t!=='WIB'}))btAdd(s,r.out);
      else s.bt=saved;
    });
    total=s.bt.length-before;
    /* 4. whatever is left: say why */
    names.forEach(function(n){btNeeds(s,n).forEach(function(t){gaps.push({n:n,t:t,why:explainMiss(s,n,t)})})});
    btGaps={id:s.id,list:gaps};
  });
  toast((total?'Added '+total+' session'+(total===1?'':'s')+'.':'Nothing new could be added.')+
    (gaps.length?' '+gaps.length+' could not be placed. See the list on this tab.':(total?' Everyone is fully scheduled.':'')),true,gaps.length>0);
}
function btNeeds(s,n){
  var o=['Full Swing','Short Game','Putting'].filter(function(t){return !s.bt.some(function(r){return r.student===n&&r.session===t})});
  if(!s.bt.some(function(r){return r.student===n&&r.session==='WIB'}))o.push('WIB');
  return o;
}
function btCoachOf(s,n){var r=s.bt.filter(function(x){return x.student===n&&x.session!=='WIB'&&x.coach})[0];return r?r.coach:''}
function btAdd(s,out){out.forEach(function(x){s.bt.push({id:uid(),day:x.day,start:x.start,end:x.end,student:x.student,coach:x.coach,session:x.session})});return out.length}
function btTry(s,n,coach,relax,free){
  btRelax=relax;btFree=free;
  try{return autoPickAll(s,n,coach)}finally{btRelax=0;btFree=false}
}
/* the rules that most often blocked a lesson, so a gap can be fixed by hand */
function explainMiss(s,stu,t){
  var co=btCoachOf(s,stu),wib=t==='WIB',len=wib?30:BT_LEN,coaches=wib?['Mike']:(co?[co]:btCoachListFor(s)),cnt={};
  btMemo={};btFree=true;
  try{
    coaches.forEach(function(cn){
      for(var d=0;d<s.days.length;d++)for(var st=480;st+len<=BT_LATE;st+=15){
        var c={id:'tmp',day:d,start:st,end:st+len,student:stu,coach:cn,session:t};
        validateBT(s,c,'tmp',s.bt).E.forEach(function(m){
          var k=m.replace(/\(.*?\)/g,'').replace(/\d{1,2}:\d{2}(am|pm)?/g,'').replace(/[–-]\s*/g,'').replace(/\s+/g,' ').trim();
          cnt[k]=(cnt[k]||0)+1;
        });
      }
    });
  }finally{btMemo=null;btFree=false}
  return Object.keys(cnt).sort(function(a,b){return cnt[b]-cnt[a]}).slice(0,2);
}
/* ---- paste the whole camp list: coach bars (with their fill colors) and the campers under them ---- */
function normColor(c){
  c=String(c||'').trim().toLowerCase();
  if(!c||c==='transparent'||c==='none'||c==='auto'||c==='windowtext'||c==='inherit'||c==='initial')return '';
  var m=/^#([0-9a-f]{3})$/.exec(c);
  if(m)c='#'+m[1].split('').map(function(x){return x+x}).join('');
  m=/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(c);
  if(m)c='#'+[m[1],m[2],m[3]].map(function(x){return ('0'+(+x).toString(16)).slice(-2)}).join('');
  var nm={red:'#ff0000',black:'#000000',white:'#ffffff',blue:'#0000ff',green:'#008000',yellow:'#ffff00'};
  return nm[c]||c;
}
function isWhiteFill(c){return !c||c==='#ffffff'}
function isRedText(c){
  var m=/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(c||'');if(!m)return false;
  return parseInt(m[1],16)>=170&&parseInt(m[2],16)<=90&&parseInt(m[3],16)<=90;
}
function cssBits(str){
  var o={},m=/(?:^|;)\s*background(?:-color)?\s*:\s*([^;]+)/i.exec(str||'');
  if(m)o.bg=normColor(m[1].trim().split(/\s+/)[0]);
  m=/(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(str||'');
  if(m)o.fg=normColor(m[1].trim());
  return o;
}
/* Excel puts its fills in classes inside a style block, so read both those and the cells' own styles */
function htmlRows(html){
  var doc=new DOMParser().parseFromString(html,'text/html'),cls={};
  Array.prototype.forEach.call(doc.querySelectorAll('style'),function(st){
    String(st.textContent||'').replace(/\.([\w-]+)\s*\{([^}]*)\}/g,function(all,name,body){cls[name]=cssBits(body)});
  });
  var rows=[];
  Array.prototype.forEach.call(doc.querySelectorAll('tr'),function(tr){
    var cells=[];
    Array.prototype.forEach.call(tr.children,function(td){
      if(!/^t[dh]$/i.test(td.tagName))return;
      var bg='',fg='';
      String(td.className||'').split(/\s+/).forEach(function(k){if(cls[k]){if(cls[k].bg!==undefined)bg=cls[k].bg;if(cls[k].fg!==undefined)fg=cls[k].fg}});
      var own=cssBits(td.getAttribute('style'));
      if(own.bg!==undefined)bg=own.bg;if(own.fg!==undefined)fg=own.fg;
      if(td.getAttribute('bgcolor'))bg=normColor(td.getAttribute('bgcolor'));
      var f=td.querySelector('font[color]');if(f)fg=normColor(f.getAttribute('color'));
      var sp=td.querySelector('[style*="color"]');if(sp){var sb=cssBits(sp.getAttribute('style'));if(sb.fg)fg=sb.fg}
      var cell={t:String(td.textContent||'').replace(/[\s ]+/g,' ').trim(),bg:bg,fg:fg};
      var n=Math.max(1,Math.min(60,+td.getAttribute('colspan')||1));
      for(var i=0;i<n;i++)cells.push(i?{t:'',bg:bg,fg:fg}:cell);
    });
    rows.push({cells:cells});
  });
  return rows;
}
function textRows(text){
  return String(text||'').replace(/\r/g,'').split('\n').map(function(l){return {cells:l.split('\t').map(function(x){return {t:x.trim().replace(/^"(.*)"$/,'$1'),bg:'',fg:''}})}});
}
/* "Davis, Hayes" or "HUR, YESEO" becomes "Hayes Davis" or "Yeseo Hur" */
function niceName(n){
  n=String(n||'').trim();
  var i=n.indexOf(',');
  if(i>0)n=n.slice(i+1).trim()+' '+n.slice(0,i).trim();
  return n.replace(/[A-Za-z]+/g,function(x){return x.length>1&&x===x.toUpperCase()?x.charAt(0)+x.slice(1).toLowerCase():x});
}
var CW_KEYS=['opp','mf','age','scoring','country','email'];
function campFromCells(cells,fg){
  var vals=cells.map(function(c){return c.t}),ni=0;
  while(ni<vals.length&&!vals[ni])ni++;
  var c={id:uid(),name:niceName(vals[ni])};
  if(isRedText(cells[ni].fg))c.vip=true;
  var pi=-1,i;
  for(i=ni+1;i<vals.length;i++)if(/^(core|total\s*athlete|game\s*changer|gamechanger|breakthrough)/i.test(vals[i])){pi=i;break}
  if(pi<0)pi=ni+7;
  for(i=0;i<CW_KEYS.length;i++){var v=vals[ni+1+i];if(ni+1+i<pi&&v)c[CW_KEYS[i]]=v}
  if(c.mf){var m=String(c.mf).trim().charAt(0).toUpperCase();c.mf=(m==='M'||m==='F')?m:''}
  var full=vals[pi]||'';
  if(full){c.pkg=normPkg(full);if(c.pkg!==full)c.pkgFull=full}
  var dates=[],last=-1;
  for(i=pi+1;i<vals.length;i++){
    if(/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(vals[i])){if(dates.length<2)dates.push(vals[i]);last=i}
  }
  if(dates[0])c.arrival=dates[0];
  if(dates[1])c.departure=dates[1];
  for(i=vals.length-1;i>last&&i>pi;i--)if(vals[i]){c.owner=vals[i];break}
  return c;
}
/* Rows become coach bars and campers. Bars with the same fill color share a pod. */
function parseCampSheet(rows){
  var anyFill=rows.some(function(r){return r.cells.some(function(c){return c.t&&!isWhiteFill(c.bg)})});
  var coaches=[],curC=null,skipped=0,hdr=0;
  rows.forEach(function(r){
    var ne=r.cells.filter(function(c){return c.t});
    if(!ne.length)return;
    if(ne.length>=3&&r.cells.filter(function(c){return HDR_KEYS[c.t.toLowerCase().replace(/\s+/g,'')]}).length>=3){hdr++;return}
    var bar=ne.length===1&&(anyFill?!isWhiteFill(ne[0].bg):true)&&!/^\d/.test(ne[0].t);
    if(bar){
      var t=ne[0].t;
      curC={name:t.replace(/\(.*?\)/g,'').replace(/\s+/g,' ').trim(),lead:/\(\s*l(?:ead)?\s*\)/i.test(t),color:anyFill?ne[0].bg:'',campers:[]};
      if(curC.name)coaches.push(curC);else curC=null;
      return;
    }
    if(!curC){skipped++;return}
    var c=campFromCells(r.cells);
    if(!c.name){skipped++;return}
    c.coach=curC.name;
    curC.campers.push(c);
  });
  /* same color = one pod; no colors at all means every coach is on their own */
  var pods=[];
  coaches.forEach(function(co){
    var pod=co.color?pods.filter(function(p){return p.color===co.color})[0]:null;
    if(!pod){pod={color:co.color,coaches:[],campers:[]};pods.push(pod)}
    pod.coaches.push(co);
  });
  pods.forEach(function(p){
    var ordered=p.coaches.filter(function(c){return c.lead}).concat(p.coaches.filter(function(c){return !c.lead}));
    var names=ordered.map(function(c){return c.name+(c.lead?' (L)':'')});
    p.name=names.length>1?names.slice(0,-1).join(', ')+' & '+names[names.length-1]:(names[0]||'New group');
    p.coachNames=p.coaches.map(function(c){return c.name});
    p.coaches.forEach(function(c){c.campers.forEach(function(k){p.campers.push(k)})});
  });
  return {pods:pods,skipped:skipped,header:hdr,colored:anyFill};
}
var cwHtml='',cwText='',cwPlan=null;
function cwMatch(s,plan){
  var old=s.pods,claimed={};
  plan.pods.forEach(function(pp){
    pp.keep=-1;
    if(pp.color)for(var k=0;k<old.length;k++)if(!claimed[k]&&old[k].color===pp.color){pp.keep=k;claimed[k]=1;break}
  });
  plan.pods.forEach(function(pp,i){if(pp.keep<0&&i<old.length&&!claimed[i]&&!old[i].color){pp.keep=i;claimed[i]=1}});
}
function cwRender(){
  var s=cur(),info=$('#cwinfo'),go=$('#cwgo');
  if(!cwPlan||!cwPlan.pods.length){
    info.innerHTML=(cwPlan?'<div class="btm bad">⚠ No coach names found. A coach is a row with one name filled in with a color.</div>':'');
    go.disabled=true;return;
  }
  var total=0,vip=0,newC=[];
  cwPlan.pods.forEach(function(pp){
    total+=pp.campers.length;pp.campers.forEach(function(c){if(c.vip)vip++});
    pp.coachNames.forEach(function(n){if(!coachListNames().some(function(x){return normName(x)===normName(n)})&&newC.indexOf(n)<0)newC.push(n)});
  });
  var h='<div class="btm ok">✓ '+cwPlan.pods.length+' pod'+(cwPlan.pods.length===1?'':'s')+' and '+total+' camper'+(total===1?'':'s')+' found'+(vip?', '+vip+' VIP (red)':'')+'.</div>';
  if(!cwPlan.colored)h+='<div class="btm warn">No colors came through, so each coach is their own pod. Copy straight from Excel, not from another program.</div>';
  if(cwPlan.skipped)h+='<div class="btm warn">'+cwPlan.skipped+' row'+(cwPlan.skipped===1?'':'s')+' skipped (no coach bar above them).</div>';
  if(cwPlan.header)h+='<div class="btm">A header row was found and ignored.</div>';
  var ret=[];
  cwPlan.pods.forEach(function(pp){pp.campers.forEach(function(c){if(hadEarlierBT(s,c.name))ret.push(c.name.split(/\s+/)[0])})});
  if(ret.length)h+='<div class="btm warn">'+ret.length+' camper'+(ret.length===1?'':'s')+' had Breakthroughs in an earlier week, so they are returning: <b>'+ret.map(esc).join(', ')+'</b>. They show as Wk 2 or higher on the Breakthroughs tab.</div>';
  if(newC.length)h+='<div class="btm">New coaches added to your coach list: <b>'+newC.map(esc).join(', ')+'</b></div>';
  h+='<div class="cwpods">'+cwPlan.pods.map(function(pp,i){
    return '<div class="cwpod"><span class="cwsw" style="background:'+esc(pp.color||'#ccc')+'"></span><div class="cwpn"><b>'+esc(pp.name)+'</b><small>'+pp.campers.length+' camper'+(pp.campers.length===1?'':'s')+'</small></div>'+
      '<label>Keep the schedule from <select data-cwk="'+i+'"><option value="-1"'+(pp.keep<0?' selected':'')+'>Start blank</option>'+
      s.pods.map(function(o,k){return '<option value="'+k+'"'+(pp.keep===k?' selected':'')+'>'+esc(o.name)+'</option>'}).join('')+'</select></label></div>';
  }).join('')+'</div>';
  var dropped=s.pods.filter(function(o,k){return !cwPlan.pods.some(function(pp){return pp.keep===k})});
  if(dropped.length)h+='<div class="btm warn">These current pods are not used and will be removed: '+dropped.map(function(o){return esc(o.name)}).join(', ')+'. Undo brings them back.</div>';
  info.innerHTML=h;go.disabled=false;
}
function cwBuild(){
  var rows=/<tr[\s>]/i.test(cwHtml)?htmlRows(cwHtml):textRows(cwText);
  cwPlan=parseCampSheet(rows);
  cwMatch(cur(),cwPlan);
  cwRender();
}
function openCW(){
  cwHtml='';cwText='';cwPlan=null;
  $('#cwbox').textContent='';$('#cwinfo').innerHTML='<div class="btm">Copy the camper rows in Excel, then paste them in the box above.</div>';$('#cwgo').disabled=true;
  $('#cwdlg').showModal();$('#cwbox').focus();
}
$('#cwbox').addEventListener('paste',function(e){
  var cd=e.clipboardData||window.clipboardData;if(!cd)return;
  e.preventDefault();
  cwHtml=cd.getData('text/html')||'';cwText=cd.getData('text/plain')||'';
  this.textContent='Pasted. Check the pods below.';
  cwBuild();
});
$('#cwbox').addEventListener('keydown',function(e){if(!(e.ctrlKey||e.metaKey)&&e.key.length===1)e.preventDefault()});
$('#cwinfo').addEventListener('change',function(e){
  var i=e.target.dataset&&e.target.dataset.cwk;if(i===undefined||!cwPlan)return;
  cwPlan.pods[+i].keep=+e.target.value;cwRender();
});
function cloneCells(cells){var c=clone(cells);c.forEach(function(x){(x.cards||[]).forEach(function(cd){cd.id=uid()})});return c}
$('#cwgo').onclick=function(){
  if(!cwPlan||!cwPlan.pods.length)return;
  var s=cur(),plan=cwPlan;$('#cwdlg').close();
  mutate(function(){
    var old=s.pods,used={};
    s.pods=plan.pods.map(function(pp){
      var o=pp.keep>=0?old[pp.keep]:null,cells;
      if(o){cells=used[pp.keep]?cloneCells(o.cells):o.cells;used[pp.keep]=1}
      else cells=s.days.map(function(){return {tags:[],weather:'',cards:[]}});
      return {id:uid(),name:pp.name,players:o?o.players:'',program:o?o.program:'',color:pp.color||undefined,campers:pp.campers,cells:cells};
    });
    plan.pods.forEach(function(pp){pp.coachNames.forEach(function(n){if(!coachListNames().some(function(x){return normName(x)===normName(n)}))coachListNames().push(n)})});
  },'Pasted '+plan.pods.length+' pod'+(plan.pods.length===1?'':'s')+'. Pick this week’s Breakthrough coaches on the Breakthroughs tab.');
};
$('#cwcancel').onclick=function(){$('#cwdlg').close()};
$('#cwdlg').addEventListener('mousedown',function(e){if(e.target===this)this.close()});
/* drag a camper by the grip to another group, or to another coach inside a group */
var cdrag=null;
function cdropTarget(e){
  var g=e.target.closest&&e.target.closest('.campgrp');if(!g)return null;
  return {grp:g,sec:e.target.closest('.cgsec')};
}
function cdropClear(){Array.prototype.forEach.call(document.querySelectorAll('.cdrop'),function(n){n.classList.remove('cdrop')})}
$('#campwrap').addEventListener('dragstart',function(e){
  var gr=e.target.closest&&e.target.closest('.cgrip');if(!gr||mode!=='edit')return;
  cdrag={i:+gr.dataset.ci,k:+gr.dataset.ck};
  e.dataTransfer.effectAllowed='move';
  try{e.dataTransfer.setData('text/plain','camper')}catch(x){}
});
$('#campwrap').addEventListener('dragover',function(e){
  if(!cdrag)return;
  var t=cdropTarget(e);if(!t)return;
  e.preventDefault();e.dataTransfer.dropEffect='move';
  cdropClear();(t.sec||t.grp).classList.add('cdrop');
});
$('#campwrap').addEventListener('dragend',function(){cdrag=null;cdropClear()});
$('#campwrap').addEventListener('drop',function(e){
  if(!cdrag)return;
  var t=cdropTarget(e),from=cdrag;cdrag=null;cdropClear();
  if(!t)return;
  e.preventDefault();
  var s=cur(),ti=+t.grp.dataset.pod,src=s.pods[from.i],dst=s.pods[ti];
  if(!src||!dst)return;
  var c=(src.campers||[])[from.k];if(!c)return;
  var split=podCoachDisplay(dst).length>1;
  var coach=t.sec?t.sec.dataset.coach:(split?'':(podCoachDisplay(dst)[0]||''));
  if(from.i===ti&&normName(c.coach)===normName(coach))return;
  var hasBT=(s.bt||[]).some(function(r){return r.student===String(c.name||'').trim()});
  mutate(function(){
    src.campers.splice(from.k,1);
    if(coach)c.coach=coach;else delete c.coach;
    (dst.campers=dst.campers||[]).push(c);
  },'Moved '+(String(c.name||'').trim().split(/\s+/)[0]||'camper')+' to '+dst.name+(coach?' · '+coach:'')+'.'+(hasBT?' Check their Breakthroughs against the new group.':''));
});
var campPre=null;
$('#campwrap').addEventListener('focusin',function(e){if(e.target.dataset&&e.target.dataset.cp)campPre=JSON.stringify(state)});
$('#campwrap').addEventListener('input',function(e){
  var t=e.target,p=t.dataset&&t.dataset.cp;if(!p)return;
  setPath(cur(),p,t.value);touch();save();
});
$('#campwrap').addEventListener('change',function(e){
  var t=e.target,p=t.dataset&&t.dataset.cp;if(!p)return;
  setPath(cur(),p,t.value);touch();save();
  if(campPre!==null){var now=JSON.stringify(state);if(now!==campPre)pushHist(campPre);campPre=null}
  if(/\.coach$/.test(p)){renderCamp();return}
  if(t.classList.contains('campname')||/\.pkg$/.test(p))renderBTGrid();
});
var DEFAULT_DRIVERS=['Pete','Gerard','Susan','Rick','Gary'];
function drivers(){
  if(!state.drivers)state.drivers=DEFAULT_DRIVERS.map(function(n){return {name:n,phone:''}});
  return state.drivers;
}
function driverInfo(n){return drivers().filter(function(d){return d.name===n})[0]||null}
var drDraft=[];
function drawDrivers(){
  $('#drlist').innerHTML=drDraft.map(function(d,i){
    return '<div class="drrow"><input data-di="'+i+'" data-df="name" value="'+esc(d.name)+'" placeholder="Name" aria-label="Driver name"><input data-di="'+i+'" data-df="phone" type="tel" value="'+esc(d.phone)+'" placeholder="Phone number" aria-label="Phone number"><button class="x" data-drdel="'+i+'" aria-label="Remove driver">×</button></div>';
  }).join('');
}
function openDrivers(){
  drDraft=drivers().map(function(d){return {name:d.name,phone:d.phone||'',old:d.name}});
  drawDrivers();$('#drdlg').showModal();
}
function saveDrivers(){
  var list=drDraft.filter(function(d){return d.name.trim()}),ren={};
  list.forEach(function(d){if(d.old&&d.old!==d.name.trim())ren[d.old]=d.name.trim()});
  $('#drdlg').close();
  mutate(function(){
    state.drivers=list.map(function(d){return {name:d.name.trim(),phone:d.phone.trim()}});
    state.sessions.forEach(function(s){s.pods.forEach(function(p){p.cells.forEach(function(c){c.cards.forEach(function(cd){if(cd.driver&&ren[cd.driver])cd.driver=ren[cd.driver]})})})});
  });
}
$('#drlist').addEventListener('input',function(e){var t=e.target,d=drDraft[+t.dataset.di];if(d&&t.dataset.df)d[t.dataset.df]=t.value});
$('#drlist').addEventListener('click',function(e){var b=e.target.closest('[data-drdel]');if(!b)return;drDraft.splice(+b.dataset.drdel,1);drawDrivers()});
$('#dradd').onclick=function(){drDraft.push({name:'',phone:'',old:null});drawDrivers();var r=$('#drlist').querySelectorAll('input[data-df="name"]');if(r.length)r[r.length-1].focus()};
$('#drsave').onclick=saveDrivers;$('#drcancel').onclick=function(){$('#drdlg').close()};
$('#drdlg').addEventListener('mousedown',function(e){if(e.target===this)this.close()});
document.addEventListener('change',function(e){
  var bk=e.target;
  if(bk.classList&&bk.classList.contains('tripbook')){
    var bids=bk.dataset.ids.split(','),on=bk.checked;
    mutate(function(){bids.forEach(function(id){var f=findCard(id);if(f){if(on)f.card.booked=true;else delete f.card.booked}})},on?'Marked as booked.':'');
    return;
  }
});
document.addEventListener('change',function(e){
  var t=e.target;if(!t.classList||!t.classList.contains('tripdrv'))return;
  if(t.value==='__edit__'){render();openDrivers();return}
  var ids=t.dataset.ids.split(','),v=t.value;
  mutate(function(){ids.forEach(function(id){var f=findCard(id);if(f){if(v)f.card.driver=v;else delete f.card.driver}})});
});
function renderTrips(){
  var s=cur(),t=s.trips,nd=s.days.length,ro=mode==='coach';
  var days=computeTrips(state,s),nt=0;
  if(ro&&coachFilter)days=days.map(function(d,j){return d.filter(function(g){return g.pods.some(function(n){if(isSpecCoach(coachFilter)){return s.pods.some(function(p){return p.name===n&&hasSpecTag(p.cells[j])})}return s.pods.some(function(p){return p.name===n&&podVisibleFor(p)})})})});
  days.forEach(function(d){nt=Math.max(nt,d.length)});
  var h='<div class="gridin" style="--nd:'+nd+'"><div class="trh">'+(ro?'<span class="tlabel">'+esc(t.label)+'</span>':'<input class="tlabel" data-p="trips.label" value="'+esc(t.label)+'" aria-label="Transportation heading">')+'<div></div>';
  t.dates.forEach(function(d,i){h+=ro?'<span class="tdate">'+esc(d)+'</span>':'<input class="tdate" data-p="trips.dates.'+i+'" value="'+esc(d)+'" placeholder="Date" aria-label="Trip date">'});
  h+='</div>';
  if(!nt)h+='<div class="empty">No bus trips yet. Add an On course event and its trip appears here.</div>';
  for(var k=0;k<nt;k++){
    h+='<div class="trow"><div class="podh"><span class="pname">Trip '+(k+1)+'</span></div><div></div>';
    days.forEach(function(d){
      var g=d[k];
      if(!g){h+='<div class="tcell"></div>';return}
      var tees=g.tees.slice().sort(function(a,b){return a-b}).map(function(x){return fmtT(x,true)}).join(' / ');
      var dv=g.driver?driverInfo(g.driver):null,ph=dv&&dv.phone?dv.phone:'';
      var drv;
      if(ro)drv=g.driver?'<div class="tdrv"><small>Driver</small><b>'+esc(g.driver)+'</b>'+(ph?'<a href="tel:'+esc(ph.replace(/[^\d+]/g,''))+'">'+esc(ph)+'</a>':'')+'</div>':'';
      else drv='<div class="tdrv"><small>Driver</small><select class="tripdrv" data-ids="'+g.ids.join(',')+'" aria-label="Driver"><option value="">Choose…</option>'+
        drivers().map(function(d){return '<option'+(d.name===g.driver?' selected':'')+'>'+esc(d.name)+'</option>'}).join('')+
        (g.driver&&!dv?'<option selected>'+esc(g.driver)+'</option>':'')+
        '<option value="__edit__">Edit drivers…</option></select>'+(ph?'<span class="tph">'+esc(ph)+'</span>':'')+'</div>';
      h+='<div class="tcell'+((!ro&&g.booked)?' booked':'')+'">'+(ro?'':'<label class="tbook" title="Tick this once the trip is booked"><input type="checkbox" class="tripbook" data-ids="'+g.ids.join(',')+'"'+(g.booked?' checked':'')+'> Booked</label>')+'<div class="tloc">'+esc(g.course)+'</div>'+
        (ro?'<div class="tload">'+esc(g.load)+'</div>':'<input class="tripload" data-ids="'+g.ids.join(',')+'" value="'+esc(g.load)+'" placeholder="Students, vehicle" aria-label="Students and vehicle">')+
        '<div class="tbody"><div class="tlines">'+
        '<div class="tline"><span>Depart</span>'+fmtT(g.start,true)+'</div>'+
        (tees?'<div class="tline"><span>'+(g.label==='Shotgun'?'Shotgun':'Tee')+'</span>'+tees+'</div>':'')+
        '<div class="tline"><span>Pick up</span>'+fmtT(g.end,true)+'</div></div>'+drv+'</div>'+
        (function(){var f=findCard(g.ids[0]),jt=f?joinText(s,f.card,f.j):'';return jt?'<div class="tjoin"><i></i>'+esc(jt)+'</div>':''})()+
        '<small class="tpods">'+esc(g.pods.join(', '))+'</small></div>';
    });
    h+='</div>';
  }
  if(!ro)h+='<p class="note">Course, departure, tee time and pick up come from the On course events above. Type the students and vehicle in each box.</p>';
  h+='</div>';
  $('#trips').innerHTML=h;
}
function autosize(t){t.style.height='auto';t.style.height=(t.scrollHeight+2)+'px'}
function initPodSort(){
  if(typeof Sortable==='undefined'||mode==='coach')return;
  var pods=$('#pods');
  if(!pods)return;
  Sortable.create(pods,{group:'pods',handle:'.grip',draggable:'.pod',animation:160,onEnd:function(){
    var ids=Array.prototype.map.call(pods.children,function(x){return x.dataset.id});
    var s=cur(),before=JSON.stringify(state);
    s.pods.sort(function(a,b){return ids.indexOf(a.id)-ids.indexOf(b.id)});
    if(JSON.stringify(state)!==before)pushHist(before);
    save();render();
  }});
}

/* ---- finding cards ---- */
function findCard(id){
  var s=cur();
  for(var i=0;i<s.pods.length;i++)for(var j=0;j<s.pods[i].cells.length;j++){
    var cs=s.pods[i].cells[j].cards;
    for(var k=0;k<cs.length;k++)if(cs[k].id===id)return {i:i,j:j,k:k,card:cs[k]};
  }
  return null;
}
function nextFreeStart(cell,dur){
  var s=cur(),st=s.tStart;
  cell.cards.forEach(function(c){st=Math.max(st,c.end)});
  return Math.max(s.tStart,Math.min(st,s.tEnd-dur));
}

/* ---- drag (move, resize, insert from library) ---- */
var D=null,justDragged=false;
function locked(){return !unlocked||(mode==='coach'&&!!state.coachLocked)}
/* only a logged-in staff member can change the schedule. For anyone else the schedule area ignores typing, dragging, double-clicks and every button except the tabs. */
(function(){
  var AREA='#boardwrap,#btpage,.lib,#sesstitle,#rvbody',OK={tab:1,camptab:1,bttab:1,fullday:1};
  function inArea(e){var t=e.target;return !!(t&&t.closest&&t.closest(AREA))}
  ['input','change','dblclick','dragstart','drop','dragover','paste','cut','keydown'].forEach(function(n){
    window.addEventListener(n,function(e){
      if(unlocked||!inArea(e))return;
      if(n==='keydown'&&e.key!=='Enter'&&e.key.length>1)return;
      e.preventDefault();e.stopImmediatePropagation();
    },true);
  });
  window.addEventListener('click',function(e){
    if(unlocked||!inArea(e))return;
    var b=e.target.closest('[data-act],[data-rh]');
    if(b&&(b.dataset.rh||!OK[b.dataset.act])){e.preventDefault();e.stopImmediatePropagation()}
  },true);
})();
document.addEventListener('pointerdown',function(e){
  if(e.pointerType==='mouse'&&e.button!==0)return;
  if(locked()||D)return;
  if(e.target.closest('.cact')||e.target.closest('.ghostc')||e.target.closest('.libgrip')||e.target.closest('.rangeview'))return;
  var rs=e.target.closest('.rs'),card=e.target.closest('.card'),chip=e.target.closest('.libchip');
  var el=rs?card:(card||chip);
  if(!el)return;
  var r=el.getBoundingClientRect();
  D={kind:rs?'resize':(chip?'new':'move'),el:el,id:el.dataset.id,idx:el.dataset.tpl,x0:e.clientX,y0:e.clientY,
    offY:chip?12:e.clientY-r.top,offX:chip?20:e.clientX-r.left,w:r.width,h:r.height,active:false,armed:e.pointerType!=='touch',pt:e.pointerType,lx:e.clientX,ly:e.clientY};
  if(e.pointerType==='touch')D.timer=setTimeout(function(){if(D){D.armed=true;if(navigator.vibrate)navigator.vibrate(10)}},220);
});
document.addEventListener('touchmove',function(e){if(D&&D.armed&&D.pt==='touch'&&e.cancelable)e.preventDefault()},{passive:false});
document.addEventListener('pointermove',function(e){
  if(!D)return;
  D.lx=e.clientX;D.ly=e.clientY;
  if(!D.active){
    var dist=Math.hypot(e.clientX-D.x0,e.clientY-D.y0);
    if(D.pt==='touch'&&!D.armed){if(dist>8){clearTimeout(D.timer);D=null}return}
    if(dist<4)return;
    startDrag();
  }
  if(e.cancelable)e.preventDefault();
  updateDrag();
});
function startDrag(){
  D.active=true;
  document.body.classList.add('dragactive');
  if(D.kind!=='resize'){
    var g=D.el.cloneNode(true);
    g.classList.add('ghostcard');g.classList.remove('dragging','warn');
    g.style.width=Math.max(D.w,120)+'px';g.style.height=(D.kind==='new'?'auto':D.h+'px');
    g.style.left=D.lx+'px';g.style.top=D.ly+'px';
    document.body.appendChild(g);D.ghost=g;
    D.el.classList.add('dragging');
  }
  D.scroll=setInterval(function(){
    if(!D)return;
    var topT=mode==='edit'?($('.lib').getBoundingClientRect().bottom+36):90,dy=0,dx=0;
    if(D.ly<topT)dy=-16;else if(D.ly>innerHeight-80)dy=16;
    var gw=$('.gridwrap'),r=gw.getBoundingClientRect();
    if(D.lx<r.left+70)dx=-16;else if(D.lx>r.right-70)dx=16;
    if(dy)window.scrollBy(0,dy);
    if(dx)gw.scrollLeft+=dx;
    if(dx||dy)updateDrag();
  },30);
}
function hitTl(x,y){
  var els=document.elementsFromPoint(x,y);
  for(var i=0;i<els.length;i++)if(els[i].classList&&els[i].classList.contains('tl'))return els[i];
  return null;
}
function clearInd(){document.querySelectorAll('.dropind').forEach(function(n){n.remove()})}
function updateDrag(){
  if(!D||!D.active)return;
  var s=cur();
  if(D.ghost){D.ghost.style.left=(D.lx-D.offX)+'px';D.ghost.style.top=(D.ly-D.offY)+'px'}
  if(D.kind==='resize'){
    var f=findCard(D.id);if(!f)return;
    var tl=D.el.parentNode,r=tl.getBoundingClientRect();
    var m=snap(s.tStart+(D.ly-r.top)/PPH*60);
    m=Math.max(f.card.start+15,Math.min(s.tEnd,m));
    D.end=m;
    D.el.style.height=Math.max(24,(m-f.card.start)*PPH/60)+'px';
    var cm=D.el.querySelector('.cm');if(cm)cm.textContent=fmtRange(f.card.start,m);
    return;
  }
  clearInd();
  var tl2=hitTl(D.lx,D.ly);
  D.target=null;
  if(!tl2)return;
  var dur;
  if(D.kind==='move'){var f2=findCard(D.id);if(!f2)return;dur=f2.card.end-f2.card.start}
  else dur=(state.templates[+D.idx]||{dur:60}).dur;
  /* an event longer than the tab (a 36 hole day) keeps its length and may run past the bottom */
  var longEv=dur>s.tEnd-s.tStart;
  if(!longEv)dur=Math.min(dur,s.tEnd-s.tStart);
  var r2=tl2.getBoundingClientRect();
  var st=snap(s.tStart+(D.ly-D.offY-r2.top)/PPH*60);
  st=Math.max(s.tStart,Math.min(longEv?s.tEnd-60:s.tEnd-dur,st));
  var ind=document.createElement('div');
  ind.className='dropind';
  ind.style.top=((st-s.tStart)*PPH/60)+'px';ind.style.height=Math.max(24,Math.min(dur,s.tEnd-st)*PPH/60)+'px';
  ind.innerHTML='<em>'+fmtRange(st,st+dur)+'</em>';
  tl2.appendChild(ind);
  D.target={i:+tl2.dataset.i,j:+tl2.dataset.j,start:st,dur:dur};
}
function cleanupDrag(d){
  clearInterval(d.scroll);clearTimeout(d.timer);
  if(d.ghost)d.ghost.remove();
  clearInd();
  d.el.classList.remove('dragging');
  document.body.classList.remove('dragactive');
}
function finishDrag(){
  if(!D)return;
  var d=D;D=null;
  if(!d.active){clearTimeout(d.timer);return}
  cleanupDrag(d);
  justDragged=true;setTimeout(function(){justDragged=false},80);
  var s=cur();
  if(d.kind==='resize'){
    var f=findCard(d.id);
    if(!f||d.end==null||d.end===f.card.end){render();return}
    mutate(function(){f.card.end=d.end});
    alertCard(d.id);return;
  }
  if(!d.target){render();return}
  var tg=d.target;
  if(d.kind==='move'){
    var f2=findCard(d.id);if(!f2)return;
    if(f2.i===tg.i&&f2.j===tg.j&&f2.card.start===tg.start){render();return}
    mutate(function(){
      var c=f2.card;s.pods[f2.i].cells[f2.j].cards.splice(f2.k,1);
      var delta=tg.start-c.start;
      if(c.segments)c.segments.forEach(function(g){g.start+=delta;g.end+=delta});
      c.start=tg.start;c.end=tg.start+tg.dur;
      if(c.tee!=null)c.tee+=delta;
      s.pods[tg.i].cells[tg.j].cards.push(c);
    });
    alertCard(d.id);
  }else{
    var t=state.templates[+d.idx];if(!t){render();return}
    var nc={id:uid(),cat:t.cat,title:t.title,details:t.details,zones:(t.zones||[]).slice(),start:tg.start,end:tg.start+tg.dur,tee:(catOf(t.cat).trip&&t.teeOff!=null)?tg.start+t.teeOff:null,teeLabel:'Tee time',load:''};
    if(t.color)nc.color=t.color;
    if(t.holes){nc.holes=t.holes;nc.course=t.course||'';nc.title=courseTitle(t.holes,nc.course)}
    mutate(function(){s.pods[tg.i].cells[tg.j].cards.push(nc)});
    if(t.holes&&!nc.course){setTimeout(function(){var f=findCard(nc.id);if(f)openEditor({kind:'card',id:nc.id},f.card)},0)}
    else alertCard(nc.id);
  }
}
document.addEventListener('pointerup',finishDrag);
document.addEventListener('pointercancel',function(){if(D){var d=D;D=null;if(d.active){cleanupDrag(d);render()}else clearTimeout(d.timer)}});
document.addEventListener('keydown',function(e){if(e.key==='Escape'&&D&&D.active){var d=D;D=null;cleanupDrag(d);render()}});

/* ---- editor ---- */
var EV_LATEST=1140;
var tplColor=null;
var dcatPrev='';
function fillCats(val){
  dcatPrev=val;
  $('#dcat').innerHTML=state.categories.map(function(c){return '<option value="'+esc(c.id)+'"'+(c.id===val?' selected':'')+'>'+esc(c.name)+'</option>'}).join('')+'<option value="__new__">+ New type…</option>';
}
/* Add an event type (like Recovery or Nutrition) straight from the event editor. */
function newTypeFromEditor(){
  askText('New event type','Name for the new type, for example Recovery or Nutrition.','Type name',function(n){
    var ex=state.categories.filter(function(c){return String(c.name).trim().toLowerCase()===n.toLowerCase()})[0],id;
    if(ex)id=ex.id;
    else{
      var cols=['#C2477F','#1FA6A0','#7B61D9','#D1913C','#3C8DAD','#8AA03A','#C75B4A','#4F7CAC'];
      pushHist(JSON.stringify(state));
      id='c'+uid();
      state.categories.splice(state.categories.length-1,0,{id:id,name:n,color:cols[state.categories.length%cols.length],zones:false});
      save();
    }
    fillCats(id);syncCat();
  },function(){$('#dcat').value=dcatPrev;syncCat()});
}
/* pick other pods to get a copy of this event (like everyone going to a 36 hole day) */
var eppods=[];
function editOwnPod(){
  if(!edit||edit.kind!=='card')return -1;
  if(edit.id){var f=findCard(edit.id);return f?f.i:-1}
  return edit.i==null?-1:edit.i;
}
/* only for "Play 36 holes": the list holds every coach in the AM and PM tabs, by name */
function podPickList(){
  var s=cur(),own=editOwnPod(),ownName=own>=0?String(s.pods[own].name||'').trim().toLowerCase():'',m={},order=[];
  weekSessions(weekOf(s)).filter(function(x){return !isCamp(x)}).sort(function(a,b){return a.tStart-b.tStart}).forEach(function(x){
    x.pods.forEach(function(p){
      var k=String(p.name||'').trim().toLowerCase();if(!k||k===ownName)return;
      if(!m[k]){m[k]={key:k,name:p.name,tabs:[]};order.push(k)}
      if(m[k].tabs.indexOf(x.name)<0)m[k].tabs.push(x.name);
    });
  });
  return order.map(function(k){return m[k]});
}
function drawPodPick(){
  var show=!!(edit&&edit.kind==='card'&&tripCat()&&$('#dholes').value==='36');
  $('#dpodrow').style.display=show?'':'none';
  if(!show){$('#dpp').innerHTML='';return}
  var list=podPickList();
  eppods=eppods.filter(function(k){return list.some(function(x){return x.key===k})});
  $('#dpp').innerHTML=list.map(function(x){
    return '<button type="button" class="zchip pdchip" data-pk="'+esc(x.key)+'" aria-pressed="'+(eppods.indexOf(x.key)>=0)+'">'+esc(x.name)+' <small>'+esc(x.tabs.join(' & '))+'</small></button>';
  }).join('')||'<span class="note">No other pods yet.</span>';
  $('#dpsum').textContent=eppods.length?'Also adding to '+eppods.map(function(k){return (list.filter(function(x){return x.key===k})[0]||{}).name}).join(', '):'Just this pod';
}
/* A copy goes into each chosen coach's earliest tab (AM). PM shows the continuation. A coach only in PM gets the part from 12:30. */
function addEventCopies(d,j){
  if(!(d.holes===36))return;
  var week=weekSessions(weekOf(cur())).filter(function(x){return !isCamp(x)}).sort(function(a,b){return a.tStart-b.tStart});
  eppods.forEach(function(k){
    for(var n=0;n<week.length;n++){
      var s2=week[n],p2=s2.pods.filter(function(p){return String(p.name||'').trim().toLowerCase()===k})[0],cell=p2&&p2.cells[j];
      if(!cell)continue;
      var c=Object.assign(clone(d),{id:uid()});
      if(c.start<s2.tStart){c.start=s2.tStart;if(c.tee!=null&&c.tee<c.start)c.tee=c.start}
      cell.cards.push(c);
      break;
    }
  });
}
function drawZones(){
  $('#dzp').innerHTML=state.zones.map(function(z){return '<button type="button" class="zchip" data-z="'+esc(z)+'" aria-pressed="'+(ezones.indexOf(z)>=0)+'">'+esc(/^\d+$/.test(z)?z:z)+'</button>'}).join('');
  $('#dzsum').textContent=ezones.length?zoneText(ezones):'No zones';
}
function zoneRowVisible(){return !!catOf($('#dcat').value).zones}
function tripCat(){return !!catOf($('#dcat').value).trip}
function syncCat(){
  var isTpl=edit&&edit.kind==='tpl',trip=tripCat();
  if(trip&&segOn){segOn=false;$('#dsegon').checked=false;drawSegs()}
  $('#dsegrow').style.display=(!isTpl&&zoneRowVisible()&&!trip)?'':'none';
  $('#dzrow').style.display=(zoneRowVisible()&&!segOn)?'':'none';
  $('#dtimes').style.display=(isTpl||(segOn&&segmentsActive()))?'none':'';
  $('#dteerow').style.display=(!isTpl&&trip)?'':'none';
  $('#dteeoffrow').style.display=(isTpl&&trip)?'':'none';
  syncCourse();
  $('#dslab').textContent=trip?'Bus departs':'Start';
  $('#delab').textContent=trip?'Pick up':'End';
  updateWarn();drawPodPick();
}
function courseOpts(holes,sel){
  var list=(holes>=18?state.courses18:state.courses9)||[];
  var o='<option value="">Choose a course\u2026</option>'+list.map(function(c){return '<option'+(c===sel?' selected':'')+'>'+esc(c)+'</option>'}).join('');
  if(sel&&list.indexOf(sel)<0)o+='<option selected>'+esc(sel)+'</option>';
  return o+'<option value="__other__">Other (type it)\u2026</option>';
}
function syncCourse(){
  var trip=tripCat(),isTpl=edit&&edit.kind==='tpl',struct=trip&&$('#dholes').value!=='0';
  $('#dcourserow').style.display=trip?'':'none';
  $('#dcourselab').style.display=(struct&&!isTpl)?'':'none';
  $('#dcourserow').style.gridTemplateColumns=(struct&&!isTpl)?'':'1fr';
  $('#dtitrow').style.display=struct?'none':'';
  $('#dcoursetxtrow').style.display=(struct&&!isTpl&&$('#dcourse').value==='__other__')?'':'none';
}
function rebuildCourses(){
  var v=$('#dcourse').value,cur=v==='__other__'?$('#dcoursetxt').value.trim():v;
  $('#dcourse').innerHTML=courseOpts(+$('#dholes').value,cur);
  syncCourse();drawPodPick();
}
function syncZoneRow(){syncCat()}
/* ---- split a range session into time blocks with their own zones ---- */
var esegs=[],segOn=false;
function parseZoneText(t){return String(t||'').split(/[,\s]+/).map(function(x){return x.trim()}).filter(Boolean)}
function cleanSegs(){
  return esegs.filter(function(g){return g.start!=null&&g.end!=null&&g.end>g.start}).map(function(g){return {start:g.start,end:g.end,zones:(g.zones||[]).slice()}}).sort(function(a,b){return a.start-b.start});
}
function segmentsActive(){return !!(segOn&&edit&&edit.kind==='card'&&zoneRowVisible()&&!tripCat())}
function drawSegs(){
  $('#dsegbox').hidden=!segOn;
  $('#dsegs').innerHTML=esegs.map(function(g,i){
    return '<div class="segrow"><input type="time" step="300" data-sg="'+i+'" data-f="start" value="'+(g.start!=null?toHHMM(g.start):'')+'" aria-label="Block start"><input type="time" step="300" data-sg="'+i+'" data-f="end" value="'+(g.end!=null?toHHMM(g.end):'')+'" aria-label="Block end"><input type="text" data-sg="'+i+'" data-f="zones" value="'+esc((g.zones||[]).join(', '))+'" placeholder="Zones, like 5, 7, 11" aria-label="Zones for this block"><button type="button" class="x" data-sgdel="'+i+'" aria-label="Remove block">×</button></div>';
  }).join('');
}
function updateWarn(){
  var box=$('#dwarn');box.classList.remove('on');box.textContent='';
  if(!edit||edit.kind!=='card'||!zoneRowVisible())return;
  var cand,j=edit.id?(findCard(edit.id)||{}).j:edit.j;if(j==null)return;
  if(segmentsActive()){
    var cs=cleanSegs();if(!cs.length)return;
    cand={segments:cs};
  }else{
    if(!ezones.length)return;
    var s=$('#dstart').value,e=$('#dend').value;if(!s||!e)return;
    var a=fromHHMM(s),b=fromHHMM(e);if(b<=a)return;
    cand={start:a,end:b,zones:ezones};
  }
  var l=findConf(cur(),j,cand,edit.id);
  if(l.length){box.textContent='\u26A0 '+confText(l)+'. You can still save.';box.classList.add('on')}
}
function openEditor(ctx,data){
  edit=ctx;
  var isTpl=ctx.kind==='tpl',sess=cur();
  tplColor=(isTpl&&data.color)?data.color:null;
  $('#dcolrow').style.display=isTpl?'':'none';
  $('#dcolor').value=tplColor||catOf(data.cat).color;
  $('#dtitle').textContent=isTpl?(ctx.idx==null?'New library event':'Edit library event'):(ctx.id?'Edit event':'New event');
  fillCats(data.cat);
  $('#dtit').value=data.title;$('#ddet').value=data.details||'';
  ezones=(data.zones||[]).slice();
  esegs=(data.segments||[]).map(function(g){return {start:g.start,end:g.end,zones:(g.zones||[]).slice()}});
  segOn=esegs.length>0;$('#dsegon').checked=segOn;drawSegs();
  $('#dtimes').style.display=isTpl?'none':'';
  $('#ddurrow').style.display=isTpl?'':'none';
  var opts='';for(var m=15;m<=660;m+=15)opts+='<option value="'+m+'">'+(m<60?m+' min':(Math.floor(m/60)+'h'+(m%60?' '+m%60+'m':'')))+'</option>';
  $('#ddur').innerHTML=opts;$('#ddur').value=String(data.dur||60);
  var to='<option value="">No tee time</option>';[15,30,45,60,90,120].forEach(function(m){to+='<option value="'+m+'">'+m+' min</option>'});
  $('#dteeoff').innerHTML=to;$('#dteeoff').value=data.teeOff==null?'':String(data.teeOff);
  $('#dtee').value=data.tee!=null?toHHMM(data.tee):'';
  $('#dteelab').value=data.teeLabel==='Shotgun'?'Shotgun':'Tee time';
  $('#dholes').value=String(data.holes==null?9:data.holes);
  $('#dcourse').innerHTML=courseOpts(+$('#dholes').value,data.course||'');
  $('#dcoursetxt').value='';
  if(!isTpl){
    ['dstart','dend'].forEach(function(id){$('#'+id).min=toHHMM(sess.tStart);$('#'+id).max=toHHMM(Math.max(sess.tEnd,EV_LATEST))});
    $('#dstart').value=toHHMM(data.start);$('#dend').value=toHHMM(data.end);
  }
  $('#ddel').style.display=(isTpl?ctx.idx!=null:!!ctx.id)?'':'none';
  $('#dtpl').style.display=isTpl?'none':'';
  $('#dz').open=false;
  eppods=[];$('#dpods').open=false;drawPodPick();
  drawZones();syncZoneRow();
  $('#dlg').showModal();$('#dtit').focus();$('#dtit').select();
}
function readEditor(){
  var d={cat:$('#dcat').value,title:$('#dtit').value.trim(),details:$('#ddet').value.replace(/\s+$/,''),zones:zoneRowVisible()?ezones.slice():[]};
  var s=cur();
  if(tripCat()&&$('#dholes').value!=='0'){
    var hl=+$('#dholes').value,cs='';
    if(edit.kind!=='tpl')cs=$('#dcourse').value==='__other__'?$('#dcoursetxt').value.trim():$('#dcourse').value;
    d.holes=hl;d.course=cs;d.title=courseTitle(hl,cs);
  }else if(tripCat()){d.holes=0;d.course=''}
  if(edit.kind==='tpl'){d.dur=+$('#ddur').value;d.teeOff=tripCat()&&$('#dteeoff').value!==''?+$('#dteeoff').value:null;if(tplColor)d.color=tplColor;return d}
  var segs=segmentsActive()?cleanSegs():[];
  if(segs.length){
    $('#dstart').value=toHHMM(segs[0].start);
    $('#dend').value=toHHMM(segs.reduce(function(m,g){return Math.max(m,g.end)},0));
    var un=[];segs.forEach(function(g){g.zones.forEach(function(z){if(un.indexOf(z)<0)un.push(z)})});
    d.zones=un.sort(function(x,y){return state.zones.indexOf(x)-state.zones.indexOf(y)});
  }
  d.segments=segs.length?segs:null;
  var a=fromHHMM($('#dstart').value||toHHMM(s.tStart)),b=fromHHMM($('#dend').value||toHHMM(a+60));
  a=Math.max(s.tStart,Math.min(a,s.tEnd-15));
  /* an event can run past the end of its tab, up to 7:00pm, so a 36 hole day fits */
  b=Math.max(a+15,Math.min(b,Math.max(s.tEnd,EV_LATEST)));
  d.start=a;d.end=b;
  if(tripCat()&&$('#dtee').value){d.tee=Math.max(s.tStart,Math.min(fromHHMM($('#dtee').value),Math.max(s.tEnd,EV_LATEST)));d.teeLabel=$('#dteelab').value}
  else{d.tee=null;d.teeLabel='Tee time'}
  return d;
}
function saveEditor(){
  var d=readEditor();
  if(!d.title){$('#dtit').focus();return}
  var e=edit,newId=null;
  $('#dlg').close();
  if(e.kind==='tpl'){
    mutate(function(){if(e.idx==null)state.templates.push(d);else state.templates[e.idx]=d});
  }else if(e.id){
    mutate(function(){var f=findCard(e.id);if(f){Object.assign(f.card,d);autoFunctionalTag(d,f.i,f.j);addEventCopies(d,f.j)}});
    alertCard(e.id);
  }else{
    newId=uid();
    mutate(function(){var c=Object.assign({id:newId},d);cur().pods[e.i].cells[e.j].cards.push(c);autoFunctionalTag(d,e.i,e.j);addEventCopies(d,e.j)});
    alertCard(newId);
  }
}
/* An event using the Functional zone adds the Functional tag to that coach's day. */
function autoFunctionalTag(d,i,j){
  if((d.zones||[]).indexOf('Functional')<0)return;
  if(!state.tags.some(function(t){return t.name==='Functional'}))state.tags.push({name:'Functional',color:'#1FA6A0'});
  var cell=cur().pods[i].cells[j];
  cell.tags=cell.tags||[];
  if(cell.tags.indexOf('Functional')<0)cell.tags.push('Functional');
}
/* ---- Assign zones: fills in the zones of Practice and Cross sport events for a whole week, with a preview you can change before applying ---- */
var ZP_DEF={sets:['9,10,12','5,7,11','2,6,8'],pairs:['2,12'],prefer:['2','12'],avoid:['11'],front:[],back:[]};
function zpCfg(){
  var c=state.zoneCfg=state.zoneCfg||{};
  Object.keys(ZP_DEF).forEach(function(k){if(!Array.isArray(c[k]))c[k]=ZP_DEF[k].slice()});
  return c;
}
function zpList(t){return String(t||'').split(/[,\s&]+/).map(function(x){return x.trim()}).filter(Boolean)}
function zpSort(zs){return zs.slice().sort(function(a,b){return state.zones.indexOf(a)-state.zones.indexOf(b)})}
function zpHash(str){var h=0;str=String(str);for(var i=0;i<str.length;i++)h=(h*31+str.charCodeAt(i))|0;return Math.abs(h)}
var zpSeed=0,zpRows=[],zpTrain=[],zpOcc=[],zpWk=null;
function zpConflict(occ,j,start,end,zones,exceptId){
  for(var k=0;k<occ.length;k++){
    var o=occ[k];
    if(o.j!==j||o.id===exceptId||!(start<o.end&&o.start<end))continue;
    for(var q=0;q<zones.length;q++)if(o.zones.indexOf(zones[q])>=0)return true;
  }
  return false;
}
/* what each pod used in the earlier weeks (about a semester), so zones are spread evenly over time */
function zpHistory(wk){
  var t0=weekTime(wk),h={};
  var weeks=allWeeks().filter(function(w){return w!==wk&&(t0==null||weekTime(w)==null||weekTime(w)<t0)}).sort(function(a,b){return (weekTime(a)||0)-(weekTime(b)||0)}).slice(-18);
  state.sessions.forEach(function(s){
    if(isCamp(s)||weeks.indexOf(weekOf(s))<0)return;
    s.pods.forEach(function(p){
      var key=coachKey(p.name);if(!key)return;
      var e=h[key]=h[key]||{z:{},sig:{}};
      p.cells.forEach(function(cell){cell.cards.forEach(function(c){
        if(c.cat!=='practice'&&c.cat!=='cross')return;
        var zs=(c.zones||[]).filter(function(z){return z!=='Functional'});
        if(!zs.length)return;
        zs.forEach(function(z){e.z[z]=(e.z[z]||0)+1});
        var sg=zpSort(zs).join(',');e.sig[sg]=(e.sig[sg]||0)+1;
      })});
    });
  });
  return h;
}
function zpCombos(arr,n){
  var out=[];
  (function rec(st,cu){
    if(cu.length===n){out.push(cu.slice());return}
    for(var i=st;i<arr.length;i++){cu.push(arr[i]);rec(i+1,cu);cu.pop()}
  })(0,[]);
  return out;
}
/* the zone groups a pod can be given: your sets for Practice, pairs from those sets for Cross sport; with Functional one zone is swapped for it */
function zpCands(t,cfg){
  var sets=cfg.sets.map(zpList).filter(function(a){return a.length}),out=[],seen={};
  function add(zs){
    zs=zpSort(zs.filter(function(z){return state.zones.indexOf(z)>=0}));
    var k=zs.join(',');if(!zs.length||seen[k])return;seen[k]=1;out.push(zs);
  }
  if(t.cat==='cross'){
    sets.forEach(function(st){for(var a=0;a<st.length;a++)for(var b=a+1;b<st.length;b++){var pr=[st[a],st[b]];add(t.func?pr.concat('Functional'):pr)}});
    cfg.pairs.forEach(function(p){var pr=zpList(p);if(pr.length===2)add(t.func?pr.concat('Functional'):pr)});
  }else{
    sets.forEach(function(st){
      if(!t.func){add(st);return}
      st.forEach(function(d,di){add(st.filter(function(z,k){return k!==di}).concat('Functional'))});
    });
  }
  return out;
}
function zpBuild(wk,opts){
  var cfg=zpCfg(),seed=zpSeed,hist=zpHistory(wk),targets=[],occ=[],weekUse={},keyEv={},funcDone={},dayLoad={};
  weekSessions(wk).forEach(function(s){
    s.pods.forEach(function(p,i){
      var key=coachKey(p.name);
      p.cells.forEach(function(cell,j){
        if(!isCamp(s))(cell.tags||[]).forEach(function(tg){if(tg==='Functional'){funcDone[key]=1;dayLoad[j]=(dayLoad[j]||0)+1}});
        cell.cards.forEach(function(c){
          var pc2=(c.cat==='practice'||c.cat==='cross')&&!isCamp(s);
          var elig=pc2&&!(c.segments&&c.segments.length)&&(opts.replace||!(c.zones&&c.zones.length));
          if(elig){targets.push({sid:s.id,i:i,j:j,id:c.id,cat:c.cat,start:c.start,end:c.end,key:key,pod:p,title:c.title,func:false});return}
          pieces(c).forEach(function(pc){
            if(!pc.zones.length)return;
            occ.push({j:j,start:pc.start,end:pc.end,zones:pc.zones,id:c.id,key:key});
            if(pc2){
              if(pc.zones.indexOf('Functional')>=0){funcDone[key]=1;dayLoad[j]=(dayLoad[j]||0)+1}
              var zs=pc.zones.filter(function(z){return z!=='Functional'});
              zs.forEach(function(z){weekUse[z]=(weekUse[z]||0)+1});
              (keyEv[key]=keyEv[key]||[]).push({j:j,zones:zs,sig:zpSort(zs).join(',')});
            }
          });
        });
      });
    });
  });
  var keys=[];targets.forEach(function(t){if(keys.indexOf(t.key)<0)keys.push(t.key)});
  keys.sort();
  var r0=keys.length?seed%keys.length:0;keys=keys.slice(r0).concat(keys.slice(0,r0));
  /* Functional once a week for each pod: COMPETE pods use the Functional zone, TRAIN pods get the Functional coach on the range that day */
  var funcSlots=[],trainTags=[];
  keys.forEach(function(key){
    if(funcDone[key])return;
    var mine=targets.filter(function(t){return t.key===key});
    var prog=mine.map(function(t){return String(t.pod.program||'')}).join(' ').toUpperCase();
    if(prog.indexOf('COMPETE')>=0){
      var best=null;
      mine.forEach(function(t){
        if(zpConflict(occ,t.j,t.start,t.end,['Functional'],t.id))return;
        if(funcSlots.some(function(f){return f.j===t.j&&t.start<f.end&&f.start<t.end}))return;
        var sc=(dayLoad[t.j]||0)*100+zpHash(key+t.id+seed)%17;
        if(!best||sc<best.sc)best={sc:sc,t:t};
      });
      if(best){best.t.func=true;funcSlots.push(best.t);dayLoad[best.t.j]=(dayLoad[best.t.j]||0)+1}
    }else if(prog.indexOf('TRAIN')>=0){
      var bt=null;
      mine.forEach(function(t){var sc=(dayLoad[t.j]||0)*100+zpHash(key+t.j+seed)%17;if(!bt||sc<bt.sc)bt={sc:sc,t:t}});
      if(bt){trainTags.push({sid:bt.t.sid,i:bt.t.i,j:bt.t.j,pod:bt.t.pod.name});dayLoad[bt.t.j]=(dayLoad[bt.t.j]||0)+1}
    }
  });
  /* day by day, in time order; the pod order turns with each try */
  var order={};keys.forEach(function(k,ix){order[k]=ix});
  targets.sort(function(a,b){return a.j-b.j||a.start-b.start||order[a.key]-order[b.key]});
  var allZ=state.zones.filter(function(z){return z!=='Functional'});
  var rows=[];
  targets.forEach(function(t){
    var cands=zpCands(t,cfg),pref=t.pod.zonePref||'',prefZ=pref==='front'?cfg.front:(pref==='back'?cfg.back:[]);
    var H=hist[t.key]||{z:{},sig:{}},prior=keyEv[t.key]||[];
    function score(zs){
      var plain=zs.filter(function(z){return z!=='Functional'}),sg=zpSort(plain).join(','),sc=0;
      plain.forEach(function(z){
        if(cfg.prefer.indexOf(z)>=0)sc-=25;
        if(cfg.avoid.indexOf(z)>=0)sc+=60;
        if(prefZ.indexOf(z)>=0)sc-=30;
        sc+=(H.z[z]||0)*4+(weekUse[z]||0)*5;
      });
      sc+=(H.sig[sg]||0)*20;
      prior.forEach(function(e){
        var n=0;plain.forEach(function(z){if(e.zones.indexOf(z)>=0)n++});
        sc+=n*45;
        if(e.sig===sg){sc+=250;if(e.j===t.j-1)sc+=150}
      });
      return sc+zpHash(t.key+t.id+sg+seed)%9;
    }
    var feas=cands.filter(function(zs){return !zpConflict(occ,t.j,t.start,t.end,zs,t.id)});
    var pickFrom=feas;
    if(!pickFrom.length){
      var n=(t.cat==='cross'?2:3)-(t.func?1:0);
      pickFrom=zpCombos(allZ.filter(function(z){return !zpConflict(occ,t.j,t.start,t.end,[z],t.id)}),n).map(function(zs){return t.func?zs.concat('Functional'):zs});
      pickFrom=pickFrom.filter(function(zs){return !zpConflict(occ,t.j,t.start,t.end,zs,t.id)}).map(zpSort);
    }
    var best=null;
    pickFrom.forEach(function(zs){var sc=score(zs);if(!best||sc<best.sc)best={sc:sc,zs:zs}});
    var zones=best?best.zs:[];
    if(zones.length){
      occ.push({j:t.j,start:t.start,end:t.end,zones:zones,id:t.id,key:t.key});
      var plain=zones.filter(function(z){return z!=='Functional'});
      plain.forEach(function(z){weekUse[z]=(weekUse[z]||0)+1});
      (keyEv[t.key]=keyEv[t.key]||[]).push({j:t.j,zones:plain,sig:zpSort(plain).join(',')});
    }
    var opts2=cands.slice();
    if(zones.length&&!opts2.some(function(c){return c.join(',')===zones.join(',')}))opts2.push(zones);
    rows.push({sid:t.sid,i:t.i,j:t.j,id:t.id,key:t.key,pod:t.pod.name,prog:t.pod.program||'',cat:t.cat,title:t.title,start:t.start,end:t.end,func:t.func,zones:zones,cands:opts2});
  });
  /* the existing events stay as the fixed background for the live conflict check in the preview */
  var base=occ.filter(function(o){return !rows.some(function(r){return r.id===o.id})});
  return {rows:rows,trainTags:trainTags,base:base};
}
function zpGen(){
  var r=zpBuild(zpWk,{replace:$('#zprep').checked});
  zpRows=r.rows;zpTrain=r.trainTags;zpOcc=r.base;zpRender();
}
function zpRowBad(r){
  if(!r.zones.length)return false;
  if(zpConflict(zpOcc,r.j,r.start,r.end,r.zones,r.id))return true;
  return zpRows.some(function(o){
    return o!==r&&o.zones.length&&o.j===r.j&&r.start<o.end&&o.start<r.end&&o.zones.some(function(z){return r.zones.indexOf(z)>=0});
  });
}
function zpRender(){
  var cfg=zpCfg(),s0=weekSessions(zpWk)[0]||cur(),bad=0,none=0,n=0;
  var rows=zpRows.slice().sort(function(a,b){return a.j-b.j||a.start-b.start||a.pod.localeCompare(b.pod)});
  var h='';
  if(!rows.length&&!zpTrain.length)h='<p class="empty">No Practice or Cross sport events need zones this week. Tick "Replace zones I’ve already set" to redo them.</p>';
  else{
    h+='<div class="teescroll"><table class="teetbl zptbl"><thead><tr><th>Day</th><th>Time</th><th>Pod</th><th>Event</th><th>Zones</th><th></th></tr></thead><tbody>';
    rows.forEach(function(r){
      var ix=zpRows.indexOf(r),b=zpRowBad(r);
      if(b)bad++;if(!r.zones.length)none++;else n++;
      h+='<tr'+(b||!r.zones.length?' class="zpbad"':'')+'><td>'+esc(dayName(s0,r.j))+'</td><td>'+esc(fmtRange(r.start,r.end))+'</td><td><b>'+esc(r.pod)+'</b>'+(r.prog?' <small>'+esc(r.prog)+'</small>':'')+'</td><td>'+esc(r.title||catOf(r.cat).name)+'</td>'+
        '<td><select data-zr="'+ix+'" aria-label="Zones">'+['<option value="">No zones</option>'].concat(r.cands.map(function(c){var v=c.join(',');return '<option value="'+esc(v)+'"'+(v===r.zones.join(',')?' selected':'')+'>'+esc(zoneText(c))+'</option>'})).join('')+'</select></td>'+
        '<td class="zpst">'+(!r.zones.length?'No free zones':(b?'Zone clash':(r.func?'Functional':'')))+'</td></tr>';
    });
    h+='</tbody></table></div>';
    if(zpTrain.length)h+='<h3 class="zph">Functional coach on the range (TRAIN pods)</h3><div class="zptrain">'+zpTrain.map(function(t){return '<span class="btl">'+esc(dayName(s0,t.j))+' · '+esc(t.pod)+'</span>'}).join(' ')+'</div>';
    var keys=[],seen={};zpRows.forEach(function(r){if(!seen[r.key]){seen[r.key]=1;keys.push(r)}});
    if((cfg.front.length||cfg.back.length)&&keys.length)h+='<h3 class="zph">Front or back range</h3><div class="zppref">'+keys.map(function(r){
      var pod=weekSessions(zpWk).reduce(function(f,s){return f||s.pods.filter(function(p){return coachKey(p.name)===r.key})[0]},null);
      var v=(pod&&pod.zonePref)||'';
      return '<label>'+esc(r.key)+' <select data-zpk="'+esc(r.key)+'"><option value="">Any</option><option value="front"'+(v==='front'?' selected':'')+'>Front range</option><option value="back"'+(v==='back'?' selected':'')+'>Back range</option></select></label>';
    }).join('')+'</div>';
  }
  $('#zpbody').innerHTML=h;
  $('#zpnote').textContent=n+' event'+(n===1?'':'s')+' will get zones'+(none?'; '+none+' could not be placed without a clash':'')+(bad?'; '+bad+' clash'+(bad===1?'':'es')+' to fix':'')+'. Change any row before you apply.';
  $('#zpgo').disabled=!(n||zpTrain.length);
}
function zpTag(s,i,j){
  if(!state.tags.some(function(t){return t.name==='Functional'}))state.tags.push({name:'Functional',color:'#1FA6A0'});
  var cell=s.pods[i]&&s.pods[i].cells[j];if(!cell)return;
  cell.tags=cell.tags||[];
  if(cell.tags.indexOf('Functional')<0)cell.tags.push('Functional');
}
function zpCfgFill(){
  var c=zpCfg();
  $('#zpsets').value=c.sets.join('\n');$('#zppairs').value=c.pairs.join('\n');
  $('#zpprefer').value=c.prefer.join(', ');$('#zpavoid').value=c.avoid.join(', ');
  $('#zpfront').value=c.front.join(', ');$('#zpback').value=c.back.join(', ');
}
function openZP(){
  zpWk=weekOf(cur());zpSeed=0;$('#zprep').checked=false;zpCfgFill();$('#zpcfg').hidden=true;
  zpGen();$('#zpdlg').showModal();
}
$('#zprep').onchange=zpGen;
$('#zpagain').onclick=function(){zpSeed++;zpGen()};
$('#zpset').onclick=function(){$('#zpcfg').hidden=!$('#zpcfg').hidden};
$('#zpcfg').addEventListener('change',function(){
  var c=zpCfg(),lines=function(id){return $(id).value.split(/[\n;]+/).map(function(x){return x.trim()}).filter(Boolean)};
  c.sets=lines('#zpsets');c.pairs=lines('#zppairs');
  c.prefer=zpList($('#zpprefer').value);c.avoid=zpList($('#zpavoid').value);
  c.front=zpList($('#zpfront').value);c.back=zpList($('#zpback').value);
  save();zpGen();
});
$('#zpbody').addEventListener('change',function(e){
  var t=e.target;
  if(t.dataset.zr!==undefined){var r=zpRows[+t.dataset.zr];if(r){r.zones=t.value?t.value.split(','):[];zpRender()}}
  else if(t.dataset.zpk!==undefined){
    weekSessions(zpWk).forEach(function(s){s.pods.forEach(function(p){if(coachKey(p.name)===t.dataset.zpk)p.zonePref=t.value||undefined})});
    save();zpGen();
  }
});
$('#zpcancel').onclick=function(){$('#zpdlg').close()};
$('#zpdlg').addEventListener('mousedown',function(e){if(e.target===this)this.close()});
$('#zpgo').onclick=function(){
  var rows=zpRows.filter(function(r){return r.zones.length}),tags=zpTrain.slice();
  $('#zpdlg').close();
  mutate(function(){
    rows.forEach(function(r){
      var s=state.sessions.filter(function(x){return x.id===r.sid})[0];if(!s)return;
      var c=s.pods[r.i].cells[r.j].cards.filter(function(x){return x.id===r.id})[0];if(!c)return;
      c.zones=zpSort(r.zones);
      if(r.zones.indexOf('Functional')>=0)zpTag(s,r.i,r.j);
    });
    tags.forEach(function(t){var s=state.sessions.filter(function(x){return x.id===t.sid})[0];if(s)zpTag(s,t.i,t.j)});
  },'Zones assigned to '+rows.length+' event'+(rows.length===1?'':'s')+'. Undo puts the old ones back.');
};
function deleteEditor(){
  var e=edit;$('#dlg').close();
  if(e.kind==='tpl')mutate(function(){state.templates.splice(e.idx,1)},'Library event removed.');
  else mutate(function(){var f=findCard(e.id);if(f)cur().pods[f.i].cells[f.j].cards.splice(f.k,1)},'Event deleted.');
}

/* ---- weather safety overlap ---- */
function normW(v){return String(v||'').trim().toLowerCase().replace(/\s+/g,' ')}
function wxMap(s){
  var courses={};(state.courses9||[]).concat(state.courses18||[]).forEach(function(c){courses[normW(c)]=1});
  var res={};
  for(var j=0;j<s.days.length;j++){
    var by={};
    s.pods.forEach(function(p,i){
      var c=p.cells[j];if(!c)return;
      var n=normW(c.weather);if(!n||courses[n])return;
      (by[n]=by[n]||[]).push(i);
    });
    Object.keys(by).forEach(function(n){
      if(by[n].length>1)by[n].forEach(function(i){res[i+'|'+j]=by[n].filter(function(x){return x!==i}).map(function(x){return s.pods[x].name})});
    });
  }
  return res;
}
function wxDatalist(s){
  var seen={},o='';
  state.sessions.forEach(function(x){x.pods.forEach(function(p){p.cells.forEach(function(c){var n=normW(c.weather);if(n&&!seen[n]){seen[n]=1;o+='<option value="'+esc(c.weather.trim())+'">'}})})});
  return '<datalist id="wxlist">'+o+'</datalist>';
}
function refreshWx(){
  var s=cur(),m=wxMap(s);
  document.querySelectorAll('label.wx[data-wi]').forEach(function(el){
    var k=el.dataset.wi+'|'+el.dataset.wj,w=m[k],val=s.pods[+el.dataset.wi].cells[+el.dataset.wj].weather;
    el.classList.toggle('warn',!!w);
    el.title=w?val+' is also the weather safety spot for '+w.join(', '):'';
  });
}
function weatherAlert(path){
  var mm=/^pods\.(\d+)\.cells\.(\d+)\.weather$/.exec(path);if(!mm)return;
  var s=cur(),w=wxMap(s)[mm[1]+'|'+mm[2]];
  if(w)toast('Heads up: '+s.pods[+mm[1]].cells[+mm[2]].weather+' is also the weather safety spot for '+w.join(', ')+' in the '+s.name+' session on '+s.days[+mm[2]].name+'. You can keep it.',false,true);
}

/* ---- news & PTO ---- */
var nedit=null,ndays=[],nhalf={};
function dayShort(n){return String(n||'').slice(0,3)}
function ptoLabel(it,s){
  var idx=(it.days&&it.days.length)?it.days.filter(function(i){return i<s.days.length}):s.days.map(function(d,i){return i});
  var half=it.half||{},anyHalf=idx.some(function(i){return half[i]});
  return it.coach+' out '+(idx.length===s.days.length&&!anyHalf?'all week':idx.map(function(i){return dayShort(s.days[i].name)+(half[i]?' ('+half[i]+' only)':'')}).join(', '));
}
var DAYNAMES=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
function dayName(s,i){if(i<0)return DAYNAMES[((i%7)+7)%7];return (s.days[i]&&s.days[i].name)||DAYNAMES[i]}
function parsePeople(t){return String(t||'').split(/\s*(?:,|&|;|\n|\band\b)\s*/i).map(function(x){return x.trim()}).filter(Boolean)}
function peopleOfPod(p){
  var out=[],lead=coachKey(p.name);
  if(lead)out.push(lead);
  /* a group like "Evan & Lindsay" counts for each coach in it */
  if(lead&&/[&,]|\band\b/i.test(lead))podCoachDisplay(p).forEach(function(n){if(out.indexOf(n)<0)out.push(n)});
  parsePeople(p.players).forEach(function(n){out.push(n)});
  return out;
}
/* the master list of coaches: used for PTO, coverage, weekend notes and the first screen, even for coaches without a pod */
function coachListNames(){
  if(!state.coachList)state.coachList=['Malcolm','Ryan','Whitney','Jinyu','Evan','Lindsay','Brad','Charlotta','Larry','Kip','Matt F','Matt H','Karyn','Kev Collins','Jim'];
  return state.coachList;
}
function staffIndex(){
  var m={},order=[];
  state.sessions.forEach(function(x){x.pods.forEach(function(p){
    if(isCamp(x)){
      /* camp groups are not lead coaches: each coach in the group is listed under Camp */
      podCoachDisplay(p).forEach(function(n){
        var k=n.toLowerCase();
        if(!m[k]){m[k]={name:n,lead:false,under:[]};order.push(k)}
        if(m[k].under.indexOf('Camp')<0)m[k].under.push('Camp');
      });
      return;
    }
    var lead=coachKey(p.name);
    peopleOfPod(p).forEach(function(n){
      var k=n.toLowerCase();
      if(!m[k]){m[k]={name:n,lead:n===lead,under:[]};order.push(k)}
      if(n===lead)m[k].lead=true;
      else if(lead&&m[k].under.indexOf(lead)<0)m[k].under.push(lead);
    });
  })});
  coachListNames().forEach(function(n){
    var k=String(n).toLowerCase();
    if(!m[k]){m[k]={name:n,lead:false,under:[]};order.push(k)}
  });
  return order.map(function(k){return m[k]});
}
function ptoNames(s,p,j){
  var wk=weekOf(s),ppl=peopleOfPod(p).map(function(n){return n.toLowerCase()}),out=[];
  (state.news||[]).forEach(function(it){
    if(it.kind!=='pto'||it.week!==wk)return;
    var idx=(it.days&&it.days.length)?it.days:s.days.map(function(d,i){return i});
    if(idx.indexOf(j)<0)return;
    var hd=it.half&&it.half[j];
    if(hd&&hd!==String(s.name).trim().toUpperCase())return;
    if(ppl.indexOf(String(it.coach||'').toLowerCase())>=0&&out.indexOf(it.coach)<0)out.push(it.coach);
  });
  return out;
}
/* News and PTO belong to the whole week, so AM, PM and Camp share them. */
function newsInSession(it,s){return it.kind==='news'}
function initials(n){return String(n||'').replace(/\(.*?\)/g,' ').trim().split(/\s+/).map(function(w){return w.charAt(0)}).join('').slice(0,2).toUpperCase()}
function ptoDays(it,s){
  var idx=(it.days&&it.days.length)?it.days.filter(function(i){return i<s.days.length}):s.days.map(function(d,i){return i});
  var half=it.half||{},anyHalf=idx.some(function(i){return half[i]});
  return idx.length===s.days.length&&!anyHalf?'all week':idx.map(function(i){return dayShort(s.days[i].name)+(half[i]?' '+half[i]:'')}).join(', ');
}
function covFlags(c,wk,s){
  /* who is out or double-booked for a coverage event */
  var flags={},cov=(state.coverage||[]).filter(function(x){return x.week===wk});
  (c.coaches||[]).forEach(function(n){
    var key=normName(n),out=false,dbl=null;
    (state.news||[]).forEach(function(it){
      if(it.kind!=='pto'||it.week!==wk||normName(it.coach)!==key)return;
      var idx=(it.days&&it.days.length)?it.days:s.days.map(function(d,i){return i});
      for(var i=+c.start;i<=+c.end;i++)if(idx.indexOf(i)>=0)out=true;
    });
    cov.forEach(function(o){
      if(o.id===c.id||(o.coaches||[]).map(normName).indexOf(key)<0)return;
      if(+o.start<=+c.end&&+c.start<=+o.end)dbl=o.name;
    });
    if(out||dbl)flags[n]={out:out,dbl:dbl};
  });
  return flags;
}
function renderNewsPage(){
  var s=cur(),ed=unlocked,wk=weekOf(s),w0=weekStart(wk),all=(state.news||[]).filter(function(n){return n.week===wk});
  var today=new Date();today.setHours(0,0,0,0);
  var news=all.filter(function(n){return newsInSession(n,s)}),pto=all.filter(function(n){return n.kind==='pto'});
  var covOn=!!(state.coverageOn&&state.coverageOn[wk]),cov=(state.coverage||[]).filter(function(x){return x.week===wk});
  function dateOf(i){return w0?new Date(w0.getFullYear(),w0.getMonth(),w0.getDate()+i):null}
  function dlabel(i){var d=dateOf(i);return d?MONTHS[d.getMonth()].slice(0,3)+' '+d.getDate():''}
  function isToday(i){var d=dateOf(i);return !!d&&d.getTime()===today.getTime()}
  var out={};pto.forEach(function(it){out[normName(it.coach)]=1});
  var h='<div class="nhero"><div><h2 class="display">News &amp; PTO</h2><span class="wk">'+esc(weekLabel(wk))+'</span></div><div class="nsum">'+
    '<span class="npill"><b>'+news.length+'</b> news</span><span class="npill"><b>'+Object.keys(out).length+'</b> out</span>'+(covOn?'<span class="npill"><b>'+cov.length+'</b> coverage</span>':'')+'</div></div>';
  function dayCard(i,wkend){
    var items=news.filter(function(n){return (n.day||0)===i});
    var c='<div class="nday2'+(wkend?' wkend':'')+(items.length?'':' idle')+(isToday(i)?' today':'')+'"><div class="ndh2"><div><b>'+esc(dayName(s,i))+'</b><small>'+esc(dlabel(i))+'</small></div>'+(isToday(i)?'<span class="ntoday">Today</span>':'')+(ed?'<button class="nplus" data-act="addnews" data-kind="news" data-day="'+i+'" aria-label="Add news for '+esc(dayName(s,i))+'">+</button>':'')+'</div>';
    if(!items.length)c+='<div class="nempty">'+(ed?'Nothing yet':'No news')+'</div>';
    items.forEach(function(it){c+='<div class="ncard'+(ed?' edit':'')+'"'+(ed?' data-act="editnews" data-id="'+it.id+'"':'')+'>'+esc(it.text)+'</div>'});
    return c+'</div>';
  }
  h+='<div class="nsec"><h3>This week</h3></div><div class="ndays">';
  for(var i=0;i<5;i++)h+=dayCard(i,false);
  /* this weekend: sticky notes for tournaments and who is traveling */
  var trav=(state.trav||[]).filter(function(x){return x.week===wk}),legacy=news.filter(function(n){return (n.day||0)>=5});
  h+='</div><div class="nsec"><h3>This weekend</h3><span class="note">Tournaments and who is traveling</span><span class="sp"></span>'+(ed?'<button class="btn" data-act="addtv">+ Add note</button>':'')+'</div>';
  if(!trav.length&&!legacy.length)h+='<p class="note">Nothing planned for the weekend.'+(ed?' Click + Add note.':'')+'</p>';
  else h+='<div class="snotes">'+trav.map(function(x,k){
    return '<div class="snote r'+(k%3)+(ed?' edit':'')+'"'+(ed?' data-act="edittv" data-id="'+x.id+'"':'')+'><span class="stape"></span><div class="sname">'+esc(x.name)+'</div>'+
      (x.dates?'<div class="sdates">'+esc(x.dates)+'</div>':'')+
      ((x.coaches||[]).length?'<div class="slab">Coaches traveling</div><div class="sco">'+x.coaches.map(function(n){return '<span>'+esc(n)+'</span>'}).join('')+'</div>':'')+
      (x.note?'<div class="snt">'+esc(x.note)+'</div>':'')+'</div>';
  }).join('')+legacy.map(function(it,k){
    return '<div class="snote r'+((trav.length+k)%3)+(ed?' edit':'')+'"'+(ed?' data-act="editnews" data-id="'+it.id+'"':'')+'><span class="stape"></span><div class="sdates">'+esc(dayName(s,it.day||5))+'</div><div class="snt">'+esc(it.text)+'</div></div>';
  }).join('')+'</div>';
  /* who's out */
  h+='<div class="nsec"><h3>Who’s out</h3>'+(ed?'<button class="btn" data-act="addnews" data-kind="pto">+ Add PTO</button>':'')+'</div>';
  if(!pto.length)h+='<p class="note">No one is out this week.</p>';
  else{
    h+='<div class="nout">'+pto.map(function(it){
      var mine=coachFilter&&coachKey(it.coach)===coachFilter;
      return '<div class="opill'+(ed?' edit':'')+(mine?' mine':'')+'"'+(ed?' data-act="editnews" data-id="'+it.id+'"':'')+'><span class="oav">'+esc(initials(it.coach))+'</span><div><b>'+esc(it.coach)+'</b><small>'+esc(ptoDays(it,s))+(it.text?' · '+esc(it.text):'')+'</small></div></div>';
    }).join('')+'</div>';
    var names=[];pto.forEach(function(it){if(names.indexOf(it.coach)<0)names.push(it.coach)});
    h+='<div class="nmat"><table><thead><tr><th></th>'+s.days.slice(0,5).map(function(d,i){return '<th>'+esc(dayShort(d.name))+'<small>'+esc(dlabel(i))+'</small></th>'}).join('')+'</tr></thead><tbody>'+
      names.map(function(n){
        return '<tr><th>'+esc(n)+'</th>'+s.days.slice(0,5).map(function(d,i){
          var cell='';
          pto.forEach(function(it){
            if(normName(it.coach)!==normName(n))return;
            var idx=(it.days&&it.days.length)?it.days:s.days.map(function(x,k){return k});
            if(idx.indexOf(i)<0)return;
            var hf=it.half&&it.half[i];
            cell=hf?'<span class="ocell half">'+hf+'</span>':'<span class="ocell">Out</span>';
          });
          return '<td>'+cell+'</td>';
        }).join('')+'</tr>';
      }).join('')+'</tbody></table></div>';
  }
  /* coverage */
  if(covOn||ed){
    h+='<div class="nsec"><h3>Coverage</h3><span class="note">Who is covering which course or event</span><span class="sp"></span>'+
      (ed?(covOn?'<button class="btn" data-act="addcov">+ Add event</button><button class="btn" data-act="covoff">Remove coverage</button>':'<button class="btn" data-act="covon">+ Add coverage</button>'):'')+'</div>';
    if(covOn){
      if(!cov.length)h+='<p class="note">No coverage events yet.'+(ed?' Click + Add event.':'')+'</p>';
      else h+='<div class="ncov">'+cov.map(function(c){
        var fl=covFlags(c,wk,s),a=+c.start,b=+c.end;
        var days=a===b?dayName(s,a)+' '+dlabel(a):dayShort(dayName(s,a))+' '+dlabel(a)+' – '+dayShort(dayName(s,b))+' '+dlabel(b);
        return '<div class="cvcard'+(ed?' edit':'')+'"'+(ed?' data-act="editcov" data-id="'+c.id+'"':'')+'><div class="cvh"><b>'+esc(c.name)+'</b><small>'+esc(days)+'</small></div><div class="cvc">'+
          ((c.coaches||[]).length?(c.coaches||[]).map(function(n){
            var f=fl[n];
            return '<span class="cvp'+(f&&f.out?' out':(f?' dbl':''))+'" title="'+esc(f?(f.out?n+' is out on PTO for part of this event.':n+' is also covering '+f.dbl+' on overlapping days.'):'')+'">'+(f?'⚠ ':'')+esc(n)+'</span>';
          }).join(''):'<span class="nempty">No coaches yet</span>')+'</div>'+(c.note?'<div class="cvn">'+esc(c.note)+'</div>':'')+'</div>';
      }).join('')+'</div>';
    }
  }
  $('#newspage').innerHTML=h;
}
/* ---- weekend sticky notes ---- */
var tvEdit=null,tvSel=[];
function drawTvChips(){
  var st=staffIndex();
  var names=st.filter(function(x){return x.lead}).concat(st.filter(function(x){return !x.lead})).map(function(x){return x.name});
  tvSel.forEach(function(n){if(names.indexOf(n)<0)names.push(n)});
  $('#tvchips').innerHTML=names.map(function(n){return '<button type="button" class="cvchip" data-n="'+esc(n)+'" aria-pressed="'+(tvSel.indexOf(n)>=0)+'">'+esc(n)+'</button>'}).join('')||'<span class="note">Add pods first so coaches can be picked.</span>';
}
function openTv(id){
  var x=id?(state.trav||[]).filter(function(t){return t.id===id})[0]:null;
  tvEdit=x?x.id:null;tvSel=x?(x.coaches||[]).slice():[];
  $('#tvtitle').textContent=x?'Edit weekend note':'Add weekend note';
  $('#tvname').value=x?x.name:'';$('#tvdates').value=x?x.dates||'':'';$('#tvnote').value=x?x.note||'':'';
  $('#tvdel').style.display=x?'':'none';
  drawTvChips();$('#tvdlg').showModal();if(!x)$('#tvname').focus();
}
function saveTv(){
  var name=$('#tvname').value.trim();
  if(!name){$('#tvname').focus();return}
  var it={id:tvEdit||uid(),week:weekOf(cur()),name:name,dates:$('#tvdates').value.trim(),coaches:tvSel.slice(),note:$('#tvnote').value.trim()};
  $('#tvdlg').close();
  mutate(function(){
    state.trav=state.trav||[];
    var ix=-1;state.trav.forEach(function(x,k){if(x.id===it.id)ix=k});
    if(ix>=0){it.week=state.trav[ix].week;state.trav[ix]=it}else state.trav.push(it);
  });
}
$('#tvchips').addEventListener('click',function(e){
  var b=e.target.closest('.cvchip');if(!b)return;
  var n=b.dataset.n,ix=tvSel.indexOf(n);if(ix>=0)tvSel.splice(ix,1);else tvSel.push(n);
  b.setAttribute('aria-pressed',ix<0);
});
$('#tvsave').onclick=saveTv;
$('#tvcancel').onclick=function(){$('#tvdlg').close()};
$('#tvdel').onclick=function(){var id=tvEdit;$('#tvdlg').close();mutate(function(){state.trav=(state.trav||[]).filter(function(x){return x.id!==id})},'Note removed.')};
$('#tvdlg').addEventListener('mousedown',function(e){if(e.target===this)this.close()});
function isoOf(d){return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2)}
/* ---- coverage events ---- */
var cvEdit=null,cvSel=[];
function drawCvChips(){
  var st=staffIndex();
  var leads=st.filter(function(x){return x.lead}),others=st.filter(function(x){return !x.lead});
  var names=leads.concat(others).map(function(x){return x.name});
  cvSel.forEach(function(n){if(names.indexOf(n)<0)names.push(n)});
  $('#cvchips').innerHTML=names.map(function(n){return '<button type="button" class="cvchip" data-n="'+esc(n)+'" aria-pressed="'+(cvSel.indexOf(n)>=0)+'">'+esc(n)+'</button>'}).join('')||'<span class="note">Add pods first so coaches can be picked.</span>';
}
function openCoverage(id){
  var s=cur(),c=id?(state.coverage||[]).filter(function(x){return x.id===id})[0]:null;
  cvEdit=c?c.id:null;cvSel=c?(c.coaches||[]).slice():[];
  $('#cvtitle').textContent=c?'Edit coverage':'Add coverage';
  $('#cvname').value=c?c.name:'';
  var opts=DAYNAMES.map(function(n,i){return '<option value="'+i+'">'+esc(dayName(s,i))+'</option>'}).join('');
  $('#cvstart').innerHTML=opts;$('#cvend').innerHTML=opts;
  $('#cvstart').value=String(c?c.start:0);$('#cvend').value=String(c?c.end:0);
  /* pick the dates on a calendar (limited to this week); weeks without a date fall back to day names */
  var w0=weekStart(weekOf(s));
  $('#cvdaterow').hidden=!w0;$('#cvdayrow').hidden=!!w0;
  if(w0){
    var at=function(i){return isoOf(new Date(w0.getFullYear(),w0.getMonth(),w0.getDate()+i))};
    $('#cvfrom').min=$('#cvto').min=at(-7);$('#cvfrom').max=$('#cvto').max=at(6);
    $('#cvfrom').value=at(c?c.start:0);
    $('#cvto').value=(c&&c.end!==c.start)?at(c.end):'';
  }
  $('#cvnote').value=c?c.note||'':'';
  $('#cvdel').style.display=c?'':'none';
  drawCvChips();
  $('#cvdlg').showModal();if(!c)$('#cvname').focus();
}
function saveCoverage(){
  var name=$('#cvname').value.trim();
  if(!name){$('#cvname').focus();return}
  var a=+$('#cvstart').value,b=+$('#cvend').value;
  var w0=weekStart(weekOf(cur()));
  if(w0){
    var toIdx=function(v){var p=v.split('-'),d=new Date(+p[0],+p[1]-1,+p[2]);return Math.max(-7,Math.min(6,Math.round((d.getTime()-w0.getTime())/86400000)))};
    if(!$('#cvfrom').value){$('#cvfrom').focus();return}
    a=toIdx($('#cvfrom').value);b=$('#cvto').value?toIdx($('#cvto').value):a;
  }
  if(b<a){var t=a;a=b;b=t}
  var it={id:cvEdit||uid(),week:weekOf(cur()),name:name,start:a,end:b,coaches:cvSel.slice(),note:$('#cvnote').value.trim()};
  $('#cvdlg').close();
  mutate(function(){
    state.coverage=state.coverage||[];
    var ix=-1;state.coverage.forEach(function(x,k){if(x.id===it.id)ix=k});
    if(ix>=0){it.week=state.coverage[ix].week;state.coverage[ix]=it}else state.coverage.push(it);
  });
}
$('#cvchips').addEventListener('click',function(e){
  var b=e.target.closest('.cvchip');if(!b)return;
  var n=b.dataset.n,ix=cvSel.indexOf(n);if(ix>=0)cvSel.splice(ix,1);else cvSel.push(n);
  b.setAttribute('aria-pressed',ix<0);
});
$('#cvsave').onclick=saveCoverage;
$('#cvcancel').onclick=function(){$('#cvdlg').close()};
$('#cvdel').onclick=function(){var id=cvEdit;$('#cvdlg').close();mutate(function(){state.coverage=(state.coverage||[]).filter(function(x){return x.id!==id})},'Coverage removed.')};
$('#cvdlg').addEventListener('mousedown',function(e){if(e.target===this)this.close()});
function drawNDays(){
  $('#ndays').innerHTML=cur().days.map(function(d,i){return '<button type="button" class="dchip" data-d="'+i+'" aria-pressed="'+(ndays.indexOf(i)>=0)+'">'+esc(dayShort(d.name))+'</button>'}).join('');
  var sel=ndays.slice().sort(function(a,b){return a-b}),s=cur();
  $('#nhalf').innerHTML=sel.map(function(i){
    var v=nhalf[i]||'';
    return '<label>'+esc(dayShort(dayName(s,i)))+'<select data-hd="'+i+'"><option value=""'+(v?'':' selected')+'>Full day</option><option value="AM"'+(v==='AM'?' selected':'')+'>AM only</option><option value="PM"'+(v==='PM'?' selected':'')+'>PM only</option></select></label>';
  }).join('');
}
function syncNews(){
  var pto=$('#nkind').value==='pto';
  $('#ncoachrow').style.display=pto?'':'none';$('#ndaysrow').style.display=pto?'':'none';$('#ndayrow').style.display=pto?'none':'';
  $('#nhint').textContent=pto?'optional':'';
}
function openNews(id,kind,day){
  var it=id?(state.news||[]).filter(function(n){return n.id===id})[0]:null;
  nedit=it?it.id:null;
  $('#nkind').value=it?it.kind:(kind==='pto'?'pto':'news');
  var isPto=$('#nkind').value==='pto';
  $('#ntitle').textContent=(it?'Edit ':'Add ')+(isPto?'PTO':'news');
  $('#nday').innerHTML=DAYNAMES.map(function(n,i){return '<option value="'+i+'">'+esc(dayName(cur(),i))+'</option>'}).join('');
  $('#nday').value=String(it?(it.day||0):(+day||0));
  nhalf=it&&it.half?Object.assign({},it.half):{};
  var st=staffIndex(),leads=st.filter(function(x){return x.lead}),others=st.filter(function(x){return !x.lead}),sel=it?it.coach:'';
  var known=st.some(function(x){return x.name===sel});
  $('#ncoach').innerHTML=(sel&&!known?'<option selected>'+esc(sel)+'</option>':'')+
    '<optgroup label="Lead coaches">'+leads.map(function(x){return '<option'+(x.name===sel?' selected':'')+'>'+esc(x.name)+'</option>'}).join('')+'</optgroup>'+
    (others.length?'<optgroup label="Coaches under a lead coach, or in Camp">'+others.map(function(x){return '<option value="'+esc(x.name)+'"'+(x.name===sel?' selected':'')+'>'+esc(x.name)+(x.under.length?' (with '+esc(x.under.join(', '))+')':'')+'</option>'}).join('')+'</optgroup>':'');
  ndays=it?(it.days||[]).slice():[];
  drawNDays();
  $('#ntext').value=it?it.text:'';
  $('#ndel').style.display=it?'':'none';
  syncNews();
  $('#ndlg').showModal();
  if(!it)$('#ntext').focus();
}
function saveNews(){
  var kind=$('#nkind').value,text=$('#ntext').value.trim();
  if(kind==='news'&&!text){$('#ntext').focus();return}
  if(kind==='pto'&&!$('#ncoach').value){return}
  var half={};ndays.forEach(function(i){if(nhalf[i])half[i]=nhalf[i]});
  var it={id:nedit||uid(),week:weekOf(cur()),kind:kind,text:text,coach:kind==='pto'?$('#ncoach').value:'',days:kind==='pto'?ndays.slice().sort(function(a,b){return a-b}):[]};
  if(kind==='pto')it.half=half;else{it.day=+$('#nday').value||0}
  $('#ndlg').close();
  mutate(function(){
    state.news=state.news||[];
    var ix=-1;state.news.forEach(function(n,k){if(n.id===it.id)ix=k});
    if(ix>=0){it.week=state.news[ix].week;state.news[ix]=it}else state.news.push(it);
  });
}
function deleteNews(){
  var id=nedit;$('#ndlg').close();
  mutate(function(){state.news=(state.news||[]).filter(function(n){return n.id!==id})},'Removed.');
}
$('#nkind').addEventListener('change',syncNews);
$('#nhalf').addEventListener('change',function(e){var t=e.target;if(t.dataset&&t.dataset.hd!==undefined)nhalf[t.dataset.hd]=t.value});
$('#nsave').onclick=saveNews;$('#ndel').onclick=deleteNews;$('#ncancel').onclick=function(){$('#ndlg').close()};
$('#ndlg').addEventListener('mousedown',function(e){if(e.target===this)this.close()});

/* ---- tee time requests (staff only) ---- */
var MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
var teeRows=[];
function ordinal(n){var t=n%100;if(t>=11&&t<=13)return n+'th';return n+(['th','st','nd','rd'][n%10]||'th')}
function weekStart(wk){
  var m=/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(wk);if(!m)return null;
  return new Date(m[3].length===2?2000+(+m[3]):+m[3],+m[1]-1,+m[2]);
}
function podLabel(p){
  var pl=String(p.players||'').trim();
  return pl?coachKey(p.name)+' - '+pl:p.name;
}
function buildTeeRows(){
  var wk=weekOf(cur()),w0=weekStart(wk),tc={},rows=[],map={};
  state.categories.forEach(function(c){if(c.trip)tc[c.id]=1});
  state.sessions.forEach(function(s){
    if(weekOf(s)!==wk)return;
    s.days.forEach(function(d,j){
      s.pods.forEach(function(p){
        var cell=p.cells[j];if(!cell)return;
        cell.cards.forEach(function(c){
          if(!tc[c.cat])return;
          var course=courseOf(c),tee=(c.tee==null?null:c.tee);
          var sl=isCamp(s)?(c.start<720?'AM':'PM'):s.name;
          var key=[sl,j,course.toLowerCase(),tee==null?'b'+c.start:tee].join('|');
          var r=map[key];
          if(!r){
            var dt=w0?new Date(w0.getFullYear(),w0.getMonth(),w0.getDate()+j):null;
            r=map[key]={key:wk+'|'+key,sess:sl,j:j,course:course,tee:tee,holes:0,groups:[],
              month:dt?MONTHS[dt.getMonth()]:'',date:dt?ordinal(dt.getDate()):'',day:dayName(s,j),sort:dt?dt.getTime():j};
            rows.push(r);
          }
          if(!r.holes&&c.holes)r.holes=c.holes;
          var lb=podLabel(p);if(r.groups.indexOf(lb)<0)r.groups.push(lb);
        });
      });
    });
  });
  rows.sort(function(a,b){return a.course.localeCompare(b.course)||a.sess.localeCompare(b.sess)||a.sort-b.sort||((a.tee==null?1e9:a.tee)-(b.tee==null?1e9:b.tee))});
  return rows;
}
var TEE_COLS=['Month','Date','Day','AM/PM','Holes','Starting Time','# of times','Group','Course','Status'];
var TEE_STATUS=[['','⚪ Not requested'],['req','🟠 Requested'],['ok','🟢 Confirmed']];
function teeVals(r){
  var sv=(state.tee||{})[r.key]||{};
  return [r.month,r.date,r.day,r.sess,r.holes||'',r.tee==null?'':fmtT(r.tee,true).toUpperCase(),sv.n||'',r.groups.join(' / '),r.course,sv.s||''];
}
function renderTeePage(){
  var s=cur(),wk=weekOf(s);
  teeRows=buildTeeRows();
  var h='<div class="newsh"><h2 class="display">Tee Time Requests</h2><span class="wk">Week of '+esc(wk)+'</span><span class="sp"></span>'+(teeRows.length?'<button class="btn" data-act="teecopy" data-c="*">Copy all</button>':'')+'</div>';
  if(!teeRows.length)h+='<p class="note">No course days scheduled for this week yet.</p>';
  var blocks=[],bm={};
  teeRows.forEach(function(r,i){var k=r.course.toLowerCase();if(!bm[k]){bm[k]={course:r.course,rows:[]};blocks.push(bm[k])}bm[k].rows.push(i)});
  blocks.forEach(function(b,bi){
    h+='<div class="teeblock"><div class="teeh"><b>'+esc(b.course)+'</b><span class="sp"></span><select class="teeall" data-c="'+bi+'" aria-label="Set status for every time at '+esc(b.course)+'"><option value="">Set all…</option>'+TEE_STATUS.map(function(o){return '<option value="'+(o[0]||'none')+'">'+o[1]+'</option>'}).join('')+'</select><button class="btn" data-act="teecopy" data-c="'+bi+'">Copy</button></div><div class="teescroll"><table class="teetbl"><thead><tr>'+TEE_COLS.map(function(c){return '<th>'+c+'</th>'}).join('')+'</tr></thead><tbody>';
    b.rows.forEach(function(i){
      var v=teeVals(teeRows[i]);
      h+='<tr>'+v.map(function(x,ci){
        if(ci===6)return '<td><input class="teein" data-r="'+i+'" data-f="n" value="'+esc(x)+'" aria-label="# of times"></td>';
        if(ci===9)return '<td><select class="teein" data-r="'+i+'" data-f="s" aria-label="Status">'+TEE_STATUS.map(function(o){return '<option value="'+o[0]+'"'+(o[0]===x?' selected':'')+'>'+o[1]+'</option>'}).join('')+'</select></td>';
        return '<td>'+esc(x)+'</td>';
      }).join('')+'</tr>';
    });
    h+='</tbody></table></div></div>';
  });
  $('#teepage').innerHTML=h;
  $('#teepage').teeBlocks=blocks;
}
function copyTee(c){
  var blocks=$('#teepage').teeBlocks||[],sel=(c==='*')?blocks:[blocks[+c]];
  var box=document.createElement('div');
  box.style.cssText='position:fixed;left:-9999px;top:0';
  box.innerHTML=sel.filter(Boolean).map(function(b){
    return '<table border="1" cellspacing="0" cellpadding="4"><tr>'+TEE_COLS.slice(0,7).map(function(x){return '<th>'+x+'</th>'}).join('')+'</tr>'+
      b.rows.map(function(i){return '<tr>'+teeVals(teeRows[i]).slice(0,7).map(function(x){return '<td>'+esc(x)+'</td>'}).join('')+'</tr>'}).join('')+'</table>';
  }).join('<br>');
  document.body.appendChild(box);
  var rg=document.createRange();rg.selectNodeContents(box);
  var sl=window.getSelection();sl.removeAllRanges();sl.addRange(rg);
  var ok=false;try{ok=document.execCommand('copy')}catch(e){}
  sl.removeAllRanges();document.body.removeChild(box);
  toast(ok?'Copied. Paste it into Excel or an email.':'Copy failed. Try again.');
}
document.addEventListener('change',function(e){
  var t=e.target;
  if(t.classList&&t.classList.contains('teeall')){
    var b=($('#teepage').teeBlocks||[])[+t.dataset.c],v=t.value==='none'?'':t.value;
    if(!b||!t.value)return;
    state.tee=state.tee||{};
    b.rows.forEach(function(i){var k=teeRows[i].key;(state.tee[k]=state.tee[k]||{}).s=v});
    save();renderTeePage();return;
  }
  if(!t.classList||!t.classList.contains('teein'))return;
  var r=teeRows[+t.dataset.r];if(!r)return;
  state.tee=state.tee||{};
  var o=state.tee[r.key]=state.tee[r.key]||{};
  o[t.dataset.f]=t.value.trim();save();
});

/* ---- analytics ---- */
function weekOf(x){var m=/week of\s*([\d\/\.\-]+)/i.exec(x.title||'');return m?m[1]:'No week label'}
function bumpWeek(t){
  return String(t||'').replace(/(week of\s*)(\d{1,2})\/(\d{1,2})\/(\d{2,4})/i,function(m,a,mo,d,y){
    var full=y.length===2?2000+(+y):+y,dt=new Date(full,+mo-1,+d+7);
    return a+(dt.getMonth()+1)+'/'+dt.getDate()+'/'+(y.length===2?String(dt.getFullYear()).slice(2):dt.getFullYear());
  });
}
function heat(n,max){return n?'background:color-mix(in srgb,var(--focus) '+(12+Math.round(48*n/max))+'%,transparent)':''}
function periodOf(x){return (String(x.name||'').replace(/\s*copy\s*\d*$/i,'').trim())||x.name}
var anLayout='together';
var anBoxes={all:{week:'all',group:'players',per:'*'},a:{week:'all',group:'players',per:''},b:{week:'all',group:'players',per:''}};
function renderAnalytics(){
  var weeks=[],periods=[];
  state.sessions.forEach(function(x){var w=weekOf(x);if(weeks.indexOf(w)<0)weeks.push(w);var pr=periodOf(x);if(periods.indexOf(pr)<0)periods.push(pr)});
  var h='<div class="anbar"><h2 class="display">Analytics</h2>'+
    '<label>Layout<select data-an="layout"><option value="together"'+(anLayout==='together'?' selected':'')+'>One box, AM and PM together</option><option value="separate"'+(anLayout==='separate'?' selected':'')+'>AM and PM in their own boxes</option></select></label></div>';
  if(anLayout==='together')h+=anBox('all',periods,weeks);
  else h+=anBox('a',periods,weeks)+anBox('b',periods,weeks);
  $('#analytics').innerHTML=h;
}
function anBox(id,periods,weeks){
  var o=anBoxes[id];
  if(o.week!=='all'&&weeks.indexOf(o.week)<0)o.week='all';
  if(o.per!=='*'&&periods.indexOf(o.per)<0)o.per=(id==='b'?periods[1]:periods[0])||'*';
  var groups=[],gmap={},courseTot={},zoneTot={},zevTot=0,tot18=0,totTrips=0,max18=1;
  state.sessions.forEach(function(x){
    var wk=weekOf(x),per=periodOf(x);
    if(o.week!=='all'&&wk!==o.week)return;
    if(o.per!=='*'&&per!==o.per)return;
    x.pods.forEach(function(p){
      var pl=(p.players||'').replace(/\s*\n\s*/g,', ').trim();
      var byPl=(o.group==='players'&&pl);
      var key=(byPl?'pl:':'nm:')+(byPl?pl.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim():coachKey(p.name).toLowerCase());
      var g=gmap[key];
      if(!g){g=gmap[key]={label:byPl?pl:(coachKey(p.name)||p.name),coaches:[],courses:{},zones:{},zev:0,r18:0,r9:0,trips:0,weeks:{}};groups.push(g)}
      var ck=coachKey(p.name);if(ck&&g.coaches.indexOf(ck)<0)g.coaches.push(ck);
      var wd=g.weeks[wk]||(g.weeks[wk]={trips:0,r18:0});
      p.cells.forEach(function(cell){cell.cards.forEach(function(c){
        if(catOf(c.cat).trip){
          var course=courseOf(c),holes=c.holes||0;
          if(!holes){var hm=/(\d+)\s*holes?/i.exec(c.title);holes=hm?+hm[1]:0}
          var cc=g.courses[course]||(g.courses[course]={n:0,r18:0});
          cc.n++;g.trips++;wd.trips++;courseTot[course]=(courseTot[course]||0)+1;
          if(holes===18){cc.r18++;g.r18++;wd.r18++}else if(holes===9)g.r9++;
        }
        if((c.zones||[]).length){
          g.zev++;zevTot++;
          c.zones.forEach(function(z){g.zones[z]=(g.zones[z]||0)+1;zoneTot[z]=(zoneTot[z]||0)+1});
        }
      })});
    });
  });
  var courses=Object.keys(courseTot).sort(function(a,b){return courseTot[b]-courseTot[a]||a.localeCompare(b)});
  var zl=state.zones.filter(function(z){return zoneTot[z]}).concat(Object.keys(zoneTot).filter(function(z){return state.zones.indexOf(z)<0}));
  groups.forEach(function(g){tot18+=g.r18;totTrips+=g.trips;max18=Math.max(max18,g.r18)});
  var avg=groups.length?tot18/groups.length:0;
  var behind=groups.filter(function(g){return g.r18<avg-0.001}).map(function(g){return g.label});
  var opt=function(v,cur,t){return '<option value="'+esc(v)+'"'+(v===cur?' selected':'')+'>'+esc(t)+'</option>'};
  var title=o.per==='*'?'AM and PM together':o.per;
  var h='<div class="anbox"><div class="anboxh"><h2 class="display">'+esc(title)+'</h2>'+
    '<label>Schedule<select data-an="per" data-box="'+id+'">'+opt('*',o.per,'AM and PM together')+periods.map(function(x){return opt(x,o.per,x)}).join('')+'</select></label>'+
    '<label>Week<select data-an="week" data-box="'+id+'">'+opt('all',o.week,'All weeks')+weeks.map(function(w){return opt(w,o.week,'Week of '+w)}).join('')+'</select></label>'+
    '<label>Group by<select data-an="group" data-box="'+id+'">'+opt('players',o.group,'Players')+opt('name',o.group,'Coach / pod name')+'</select></label></div>';
  if(!groups.length){return h+'<div class="empty">Nothing here yet for this selection.</div></div>'}
  h+='<div class="anpanel"><div class="ansum"><div><b>'+groups.length+'</b><span>groups</span></div><div><b>'+totTrips+'</b><span>course trips</span></div><div><b>'+tot18+'</b><span>18-hole rounds</span></div><div><b>'+zevTot+'</b><span>sessions in a zone</span></div></div>'+
    (tot18&&behind.length?'<p class="sub" style="margin:14px 0 0">Below the average for 18-hole rounds: <b>'+behind.map(esc).join('</b>, <b>')+'</b></p>':'')+'</div>';
  h+='<div class="anpanel"><h3>18-hole rounds by group</h3><p class="sub">Is every group getting a fair shot at 18 holes? Counted from On course events set to 18 holes.</p>';
  groups.forEach(function(g){
    h+='<div class="rbar"><div class="rl">'+esc(g.label)+(g.coaches.length?'<small>'+esc(g.coaches.join(' / '))+'</small>':'')+'</div>'+
      '<div class="rtrack"><div class="rfill" style="width:'+Math.round(100*g.r18/max18)+'%"></div></div>'+
      '<div class="rnum"><b>'+g.r18+'</b> \u00D7 18 \u00B7 '+g.r9+' \u00D7 9'+((!g.r18&&tot18)?' \u00B7 <em>no 18-hole round</em>':'')+'</div></div>';
  });
  h+='</div>';
  var cmax=1;groups.forEach(function(g){courses.forEach(function(c){if(g.courses[c])cmax=Math.max(cmax,g.courses[c].n)})});
  h+='<div class="anpanel"><h3>Course visits</h3><p class="sub">Trips to each course. The small number is how many were 18-hole rounds.</p>';
  if(!courses.length)h+='<p class="sub">No On course events yet.</p>';
  else{
    h+='<table class="antable"><thead><tr><th class="rowh">Group</th>'+courses.map(function(c){return '<th>'+esc(c)+'</th>'}).join('')+'<th>Total</th></tr></thead><tbody>';
    groups.forEach(function(g){
      h+='<tr><th class="rowh">'+esc(g.label)+'</th>'+courses.map(function(c){var v=g.courses[c];return v?'<td style="'+heat(v.n,cmax)+'">'+v.n+(v.r18?'<small>'+v.r18+' \u00D7 18</small>':'')+'</td>':'<td class="zero">0</td>'}).join('')+'<td class="tot">'+g.trips+'</td></tr>';
    });
    h+='<tr class="tot"><th class="rowh">All groups</th>'+courses.map(function(c){var r=0;groups.forEach(function(g){if(g.courses[c])r+=g.courses[c].r18});return '<td>'+courseTot[c]+(r?'<small>'+r+' \u00D7 18</small>':'')+'</td>'}).join('')+'<td>'+totTrips+'</td></tr></tbody></table>';
  }
  h+='</div>';
  var zmax=1;groups.forEach(function(g){zl.forEach(function(z){if(g.zones[z])zmax=Math.max(zmax,g.zones[z])})});
  h+='<div class="anpanel"><h3>Zone use</h3><p class="sub">How many sessions each group has in each zone. A session on zones 2, 6 and 8 counts once in each of those zones. The total counts every session once.</p>';
  if(!zl.length)h+='<p class="sub">No zones booked yet.</p>';
  else{
    h+='<table class="antable"><thead><tr><th class="rowh">Group</th>'+zl.map(function(z){return '<th>'+esc(/^\d+$/.test(z)?'Zone '+z:z)+'</th>'}).join('')+'<th>Sessions</th></tr></thead><tbody>';
    groups.forEach(function(g){
      h+='<tr><th class="rowh">'+esc(g.label)+'</th>'+zl.map(function(z){var v=g.zones[z];return v?'<td style="'+heat(v,zmax)+'">'+v+'</td>':'<td class="zero">0</td>'}).join('')+'<td class="tot">'+g.zev+'</td></tr>';
    });
    h+='<tr class="tot"><th class="rowh">All groups</th>'+zl.map(function(z){return '<td>'+zoneTot[z]+'</td>'}).join('')+'<td>'+zevTot+'</td></tr></tbody></table>';
  }
  h+='</div>';
  if(o.week==='all'){
    h+='<div class="anpanel"><h3>Week by week</h3><p class="sub">Course trips for each group, with 18-hole rounds underneath. A new week appears when you Copy a schedule in Customize.</p>'+
      '<table class="antable"><thead><tr><th class="rowh">Group</th>'+weeks.map(function(w){return '<th>'+esc(w)+'</th>'}).join('')+'</tr></thead><tbody>';
    groups.forEach(function(g){
      h+='<tr><th class="rowh">'+esc(g.label)+'</th>'+weeks.map(function(w){var v=g.weeks[w];return v?'<td>'+v.trips+'<small>'+v.r18+' \u00D7 18</small></td>':'<td class="zero">\u2013</td>'}).join('')+'</tr>';
    });
    h+='</tbody></table></div>';
  }
  return h+'</div>';
}
document.addEventListener('change',function(e){
  var a=e.target.dataset&&e.target.dataset.an;
  if(!a)return;
  var v=e.target.value,o=anBoxes[e.target.dataset.box];
  if(a==='layout')anLayout=v;
  else if(o){if(a==='week')o.week=v;else if(a==='group')o.group=v;else if(a==='per')o.per=v}
  renderAnalytics();
});
document.addEventListener('change',function(e){
  var a=e.target.dataset&&e.target.dataset.an;
  if(!a)return;
  if(a==='week')anWeek=e.target.value;else if(a==='split')anSplit=e.target.value==='separate';else anGroup=e.target.value;
  renderAnalytics();
});

/* ---- customize ---- */
function openCustom(){renderCustom();$('#cdlg').showModal()}
function renderCustom(){
  var s=cur(),si=state.sessions.indexOf(s);
  var h='<h2 class="display">Customize</h2>';
  h+='<h3>Day tags</h3><p class="note">These appear in the tag dropdown at the top of each day.</p>';
  state.tags.forEach(function(t,i){
    h+='<div class="crow"><input type="color" data-ck="tags.'+i+'.color" value="'+esc(t.color)+'" aria-label="Tag color"><input type="text" data-ck="tags.'+i+'.name" value="'+esc(t.name)+'" aria-label="Tag name"><button class="x" data-cact="deltag" data-i="'+i+'" aria-label="Delete tag">\u00D7</button></div>';
  });
  h+='<div class="dact"><button class="btn" data-cact="addtag">+ Add tag</button></div>';
  h+='<h3>Programs</h3><p class="note">The program chips on each pod. Change a color or name, or remove one. Pods using a removed program are left without one.</p>';
  programList().forEach(function(n,i){
    h+='<div class="crow"><input type="color" data-pcol="'+i+'" value="'+esc(chipColor(n))+'" aria-label="Color for '+esc(n)+'"><input type="text" data-pname="'+i+'" value="'+esc(n)+'" aria-label="Program name"><button class="x" data-cact="delprog" data-i="'+i+'" aria-label="Remove program">×</button></div>';
  });
  h+='<div class="dact"><button class="btn" data-cact="addprog">+ Add program</button></div>';
  h+='<h3>Coaches</h3><p class="note">Everyone on staff, separated by commas. These names fill the PTO, coverage, weekend notes and first-screen lists, even for coaches who do not lead a pod.</p><textarea data-ck="coachList" data-kind="zones" rows="3" style="width:100%" aria-label="Coach list">'+esc(coachListNames().join(', '))+'</textarea>';
  h+='<h3>Zones</h3><p class="note">Separate with commas. These fill the zone dropdown.</p><input type="text" data-ck="zones" data-kind="zones" value="'+esc(state.zones.join(', '))+'" aria-label="Zone list">';
  h+='<h3>Courses</h3><p class="note">These fill the course dropdown on On course events. Separate with commas.</p><label class="note">9-hole courses<input type="text" data-ck="courses9" data-kind="zones" value="'+esc((state.courses9||[]).join(', '))+'" aria-label="9-hole courses"></label><label class="note">18-hole courses<input type="text" data-ck="courses18" data-kind="zones" value="'+esc((state.courses18||[]).join(', '))+'" aria-label="18-hole courses"></label>';
  h+='<h3>Event types</h3><p class="note">Each type has its own color. Tick Zones to show the zone dropdown, and Bus trip to feed the Transportation table.</p>';
  state.categories.forEach(function(c,i){
    h+='<div class="crow"><input type="color" data-ck="categories.'+i+'.color" value="'+esc(c.color)+'" aria-label="Color for '+esc(c.name)+'"><input type="text" data-ck="categories.'+i+'.name" value="'+esc(c.name)+'" aria-label="Type name">'+
      '<label class="chk"><input type="checkbox" data-ck="categories.'+i+'.zones"'+(c.zones?' checked':'')+'> Zones</label><label class="chk"><input type="checkbox" data-ck="categories.'+i+'.trip"'+(c.trip?' checked':'')+'> Bus trip</label>'+
      (c.id==='other'?'':'<button class="x" data-cact="delcat" data-i="'+i+'" aria-label="Delete type">\u00D7</button>')+'</div>';
  });
  h+='<div class="dact"><button class="btn" data-cact="addcat">+ Add type</button></div>';
  h+='<h3>This schedule: '+esc(s.name)+'</h3><div class="row2"><label>Timeline starts<input type="time" step="900" data-ck="sessions.'+si+'.tStart" data-kind="time" value="'+toHHMM(s.tStart)+'"></label><label>Timeline ends<input type="time" step="900" data-ck="sessions.'+si+'.tEnd" data-kind="time" value="'+toHHMM(s.tEnd)+'"></label></div>'+
    '<p class="note">'+s.days.length+' days.</p><div class="dact"><button class="btn" data-cact="addday">+ Add day</button><button class="btn" data-cact="delday"'+(s.days.length<2?' disabled':'')+'>Remove last day</button></div>';
  h+='<h3>Schedules</h3><p class="note">Rename a tab, or copy a schedule to start next week from this one.</p>';
  state.sessions.forEach(function(x,i){
    h+='<div class="crow"><input type="text" data-ck="sessions.'+i+'.name" value="'+esc(x.name)+'" aria-label="Schedule tab name"><button class="btn" data-cact="dupsess" data-i="'+i+'">Copy</button>'+
      (state.sessions.length>1?'<button class="x" data-cact="delsess" data-i="'+i+'" aria-label="Delete schedule">\u00D7</button>':'')+'</div>';
  });
  h+='<div class="dact"><button class="btn" data-cact="addsess">+ Add blank schedule</button></div>';
  h+='<h3>Analytics PIN</h3><p class="note">Asks for a PIN before Analytics opens, so coaches can\u2019t browse it. It is a simple lock, not strong security.</p>'+
    (state.analyticsPin?'<input type="password" id="pinold" placeholder="Current PIN" autocomplete="off" style="border:1px solid var(--line);background:var(--bg);border-radius:7px;padding:7px 9px;width:100%">':'')+
    '<input type="password" id="pinnew" placeholder="'+(state.analyticsPin?'New PIN':'Choose a PIN (4 or more characters)')+'" autocomplete="off" style="border:1px solid var(--line);background:var(--bg);border-radius:7px;padding:7px 9px;width:100%">'+
    '<div class="dact"><button class="btn" data-cact="setpin">'+(state.analyticsPin?'Change PIN':'Set PIN')+'</button>'+(state.analyticsPin?'<button class="btn danger" data-cact="rmpin">Remove PIN</button>':'')+'</div>'+(pinMsg?'<p class="note">'+esc(pinMsg)+'</p>':'');
  h+='<h3>Coach view</h3><label class="crow chk" style="font-size:13px"><input type="checkbox" data-ck="coachLocked"'+(state.coachLocked?' checked':'')+'> Make Coach view view-only (coaches can\u2019t move events)</label>';
  h+='<h3>Start over</h3><div class="dact">'+(SAMPLE?'<button class="btn" data-cact="sample">Load the sample schedule</button>':'')+'<button class="btn danger" data-cact="blank">Clear everything</button></div>';
  h+='<div class="dact"><span class="sp"></span><button class="btn primary" data-cact="close">Done</button></div>';
  $('#cbody').innerHTML=h;
}
function customAction(a,i){
  var s=cur();
  if(a==='close'){pinMsg='';$('#cdlg').close();return}
  if(a==='setpin'||a==='rmpin'){
    var oldv=$('#pinold')?$('#pinold').value:'',nv=$('#pinnew')?$('#pinnew').value:'';
    if(state.analyticsPin&&pinHash(oldv)!==state.analyticsPin)pinMsg='The current PIN didn\u2019t match.';
    else if(a==='rmpin'){delete state.analyticsPin;save();pinMsg='PIN removed. Analytics is open to anyone.'}
    else if(nv.length<4)pinMsg='Use at least 4 characters.';
    else{state.analyticsPin=pinHash(nv);save();pinMsg='PIN saved.'}
    renderCustom();return;
  }
  if(a==='addprog')mutate(function(){var l=programList(),n='New program',k=2;while(l.indexOf(n)>=0)n='New program '+(k++);l.push(n)});
  if(a==='delprog')mutate(function(){
    var l=programList(),nm=l[i];l.splice(i,1);
    if(state.programColors)delete state.programColors[String(nm).toUpperCase()];
    state.sessions.forEach(function(x){x.pods.forEach(function(p){if(p.program===nm)p.program=''})});
  });
  if(a==='addtag')mutate(function(){state.tags.push({name:'New tag',color:'#C2477F'})});
  if(a==='deltag')mutate(function(){var nm=state.tags[i].name;state.tags.splice(i,1);state.sessions.forEach(function(x){x.pods.forEach(function(p){p.cells.forEach(function(c){c.tags=(c.tags||[]).filter(function(t){return t!==nm})})})})});
  if(a==='addcat')mutate(function(){state.categories.splice(state.categories.length-1,0,{id:'c'+uid(),name:'New type',color:'#C2477F',zones:false})});
  if(a==='delcat')mutate(function(){var id=state.categories[i].id;state.categories.splice(i,1);state.sessions.forEach(function(x){x.pods.forEach(function(p){p.cells.forEach(function(c){c.cards.forEach(function(cd){if(cd.cat===id)cd.cat='other'})})})});state.templates.forEach(function(t){if(t.cat===id)t.cat='other'})});
  if(a==='addsess')mutate(function(){var n=blankSession('New '+(state.sessions.length+1),s.days.length),wk=weekOf(s);if(wk!=='No week label')n.title=n.name+' Schedule (Week of '+wk+')';state.sessions.push(n);state.active=n.id});
  if(a==='dupsess')mutate(function(){var c=clone(state.sessions[i]);c.id=uid();c.name+=' copy';c.title=bumpWeek(c.title);c.pods.forEach(function(p){p.id=uid();p.cells.forEach(function(x){x.cards.forEach(function(cd){cd.id=uid()})})});state.sessions.splice(i+1,0,c);state.active=c.id});
  if(a==='delsess')mutate(function(){state.sessions.splice(i,1)},'Schedule deleted.');
  if(a==='addday')mutate(function(){s.days.push({name:'New day',theme:''});s.pods.forEach(function(p){p.cells.push({tags:[],weather:'',cards:[]})});s.trips.dates.push('')});
  if(a==='delday')mutate(function(){s.days.pop();s.pods.forEach(function(p){p.cells.pop()});s.trips.dates.pop()},'Last day removed.');
  if(a==='sample')mutate(function(){var pn=state.analyticsPin;state=clone(SAMPLE);if(pn)state.analyticsPin=pn},'Sample schedule loaded.');
  if(a==='blank')mutate(function(){var pn=state.analyticsPin;state=blankState();if(pn)state.analyticsPin=pn},'Everything cleared.');
  renderCustom();
}

/* ---- import / export ---- */
function importFile(file){
  if(typeof XLSX==='undefined'){toast('The Excel library did not load. Check your connection and refresh.');return}
  var rd=new FileReader();
  rd.onload=function(){
    try{
      var wb=XLSX.read(new Uint8Array(rd.result),{type:'array'});
      var st=parseWorkbook(XLSX,wb);
      if(!st){toast('No schedule found. The sheet needs a "Coach / Players" header row.');return}
      var fromApp=!!st.fromApp;
      var impWeeks=[];st.sessions.forEach(function(x){var w=weekOf(x);if(impWeeks.indexOf(w)<0)impWeeks.push(w)});
      var have=allWeeks(),clash=impWeeks.filter(function(w){return have.indexOf(w)>=0});
      var runImport=function(){
      mutate(function(){
        if(clash.length){
          state.sessions=state.sessions.filter(function(x){return clash.indexOf(weekOf(x))<0});
          if(fromApp)state.news=(state.news||[]).filter(function(n){return clash.indexOf(n.week)<0});
        }
        (st.tags||[]).forEach(function(t){if(!state.tags.some(function(x){return x.name===t.name}))state.tags.push(t)});
        if(fromApp){
          (st.categories||[]).forEach(function(c){if(!state.categories.some(function(x){return x.id===c.id}))state.categories.push(c)});
          (st.zones||[]).forEach(function(z){if(state.zones.indexOf(z)<0)state.zones.push(z)});
          state.news=(state.news||[]).concat((st.news||[]).filter(function(n){return impWeeks.indexOf(n.week)>=0&&!(state.news||[]).some(function(x){return x.id===n.id})}));
        }
        st.sessions.forEach(function(x){state.sessions.push(x)});
        state.active=st.sessions[0].id;
      },'Added '+impWeeks.length+' week'+(impWeeks.length>1?'s':'')+' from '+file.name+'. Your other weeks were kept.');
      };
      if(clash.length)askConfirm('You already have '+clash.map(function(w){return w==='No week label'?'a schedule with no week label':'the week of '+w}).join(', ')+'. Replace '+(clash.length>1?'those weeks':'that week')+' with this file? Other weeks are not touched.',runImport,'Replace');
      else runImport();
    }catch(err){toast('That file could not be read.')}
  };
  rd.readAsArrayBuffer(file);
}
function exportFile(all){
  if(typeof XLSX==='undefined'){toast('The Excel library did not load. Check your connection and refresh.');return}
  try{
    var wk=weekOf(cur()),coachCopy=(all==='coach')||!unlocked;
    var sess=(all===true&&unlocked)?state.sessions:weekSessions(wk);
    var ws=sess.map(weekOf),part=Object.assign({},state,{sessions:sess,news:(state.news||[]).filter(function(n){return ws.indexOf(n.week)>=0})});
    var nm=all===true?'All_Weeks_Schedule.xlsx':'Work_Schedule.xlsx';
    if(coachCopy){
      /* the coach copy has one sheet per coach and no hidden data sheet */
      var only=(!unlocked&&coachFilter)?coachFilter:'';
      nm=(only?only.replace(/[^\w\-]+/g,'_')+'_Schedule.xlsx':'Coach_Schedules.xlsx');
      XLSX.writeFile(buildWorkbook(XLSX,part,{coach:true,only:only}),nm);
    }else XLSX.writeFile(buildWorkbook(XLSX,part,{btx:xlBT}),nm);
    toast('Exported '+nm)}
  catch(err){toast('Export failed. Try again.')}
}

/* what the Excel export needs to draw a camp's Breakthroughs board (the same names, slots and busy times as the Breakthroughs tab) */
function xlBT(sess){
  btNormalize(sess);
  var wk=weekOf(sess);
  return {
    coaches:btCoachListFor(sess).slice(),
    slots:btSlots(sess),
    slotFor:slotFor,
    day:function(j){var l=rangeDateLabel(wk,j);return String((sess.days[j]||{}).name||'').toUpperCase()+(l?', '+l.toUpperCase():'')},
    name:function(stu){return btName(sess,stu)},
    vip:function(stu){return isVip(sess,stu)},
    week:function(stu){return campWeekNo(sess,stu)},
    prev:function(stu){return btHist(sess,stu).prev},
    off:function(j,coach,t){return (sess.btOff||[]).some(function(o){return +o.day===j&&normName(o.coach)===normName(coach)&&o.a===t})},
    busy:function(j,coach,t){return coachBusy(wk,j,coach).list.some(function(x){return t<x.b&&x.a<t+BT_LEN})},
    witb:function(j){
      var t=WITB_STARTS.slice();
      sess.bt.forEach(function(r){if(r.session==='WIB'&&+r.day===j&&r.start!=null&&t.indexOf(r.start)<0)t.push(r.start)});
      return t.sort(function(a,b){return a-b});
    }
  };
}
/* ---- events ---- */
document.addEventListener('focusin',function(e){if(e.target.classList&&e.target.classList.contains('tripload'))pre=JSON.stringify(state);else if(e.target.dataset&&e.target.dataset.p)pre=JSON.stringify(state)});
document.addEventListener('input',function(e){
  var el=e.target;
  if(el.classList&&el.classList.contains('tripload')){
    el.dataset.ids.split(',').forEach(function(id){var f=findCard(id);if(f)f.card.load=el.value});touch();
    save();return;
  }
  var p=el.dataset&&el.dataset.p;
  if(!p||el.value==='__edit__'||el.value==='__newprog__')return;
  setPath(cur(),p,el.value);touch();
  if(el.classList.contains('chipin')){el.setAttribute('style',chipStyle(el.value));el.classList.toggle('empty',!el.value)}
  else if(el.tagName==='SELECT'){el.setAttribute('style','--chip:'+tagColor(el.value));el.classList.toggle('empty',!el.value)}
  if(el.classList.contains('players'))autosize(el);
  save();
  if(/\.weather$/.test(p))refreshWx();
});
document.addEventListener('change',function(e){
  var el=e.target;
  if(el.classList&&el.classList.contains('tagadd')){
    var v=el.value,ti=+el.dataset.i,tj=+el.dataset.j;
    if(v==='__edit__'){render();openCustom();return}
    if(v)mutate(function(){var c=cur().pods[ti].cells[tj];c.tags=c.tags||[];if(c.tags.indexOf(v)<0)c.tags.push(v)});
    else render();
    return;
  }
  if(el.classList&&el.classList.contains('tripload')){
    if(pre!==null){var nw=JSON.stringify(state);if(nw!==pre)pushHist(pre);pre=nw}
    return;
  }
  if(el.dataset&&el.dataset.p){
    if(el.value==='__edit__'){render();openCustom();return}
    if(el.value==='__newprog__'){newProgramFor(el.dataset.p);return}
    if(pre!==null){var now=JSON.stringify(state);if(now!==pre)pushHist(pre);pre=now}
    if(/\.weather$/.test(el.dataset.p))weatherAlert(el.dataset.p);
  }
  if(el.dataset&&el.dataset.pcol!==undefined){
    var pn=programList()[+el.dataset.pcol],pcv=el.value;
    if(pn)mutate(function(){state.programColors=state.programColors||{};state.programColors[String(pn).toUpperCase()]=pcv});
    return;
  }
  if(el.dataset&&el.dataset.pname!==undefined){
    var pi=+el.dataset.pname,pl=programList(),oldn=pl[pi],newn=el.value.trim();
    if(!newn||newn===oldn||pl.some(function(x,k){return k!==pi&&String(x).toLowerCase()===newn.toLowerCase()})){renderCustom();return}
    mutate(function(){
      var col=state.programColors&&state.programColors[String(oldn).toUpperCase()];
      pl[pi]=newn;
      if(state.programColors&&col!==undefined){delete state.programColors[String(oldn).toUpperCase()];state.programColors[newn.toUpperCase()]=col}
      state.sessions.forEach(function(x){x.pods.forEach(function(p){if(p.program===oldn)p.program=newn})});
    });
    renderCustom();return;
  }
  if(el.dataset&&el.dataset.ck){
    var path=el.dataset.ck,k=el.dataset.kind,v=el.type==='checkbox'?el.checked:el.value;
    if(k==='time'){if(!el.value)return;v=fromHHMM(el.value)}
    if(k==='zones')v=el.value.split(',').map(function(x){return x.trim()}).filter(Boolean);
    var m=/^tags\.(\d+)\.name$/.exec(path);
    mutate(function(){
      if(m){var old=state.tags[+m[1]].name;state.sessions.forEach(function(s){s.pods.forEach(function(p){p.cells.forEach(function(c){c.tags=(c.tags||[]).map(function(t){return t===old?v:t})})})})}
      setPath(state,path,v);
    });
  }
});
document.addEventListener('click',function(e){
  var dc=e.target.closest('.dchip');
  if(dc){
    var di=+dc.dataset.d,dx=ndays.indexOf(di);
    if(dx>=0)ndays.splice(dx,1);else ndays.push(di);
    drawNDays();return;
  }
  var pc=e.target.closest('.pdchip');
  if(pc){
    var pk=pc.dataset.pk,px=eppods.indexOf(pk);
    if(px>=0)eppods.splice(px,1);else eppods.push(pk);
    drawPodPick();return;
  }
  var zc=e.target.closest('.zchip');
  if(zc){
    var z=zc.dataset.z,ix=ezones.indexOf(z);
    if(ix>=0)ezones.splice(ix,1);else ezones.push(z);
    ezones.sort(function(a,b){return state.zones.indexOf(a)-state.zones.indexOf(b)});
    drawZones();updateWarn();return;
  }
  var cb=e.target.closest('[data-cact]');
  if(cb){customAction(cb.dataset.cact,+cb.dataset.i);return}
  if(justDragged)return;
  var b=e.target.closest('[data-act]');
  if(!b)return;
  var a=b.dataset.act,s=cur();
  if(a==='teecopy'){if(unlocked)copyTee(b.dataset.c);return}
  if(a==='addnews'){if(unlocked)openNews(null,b.dataset.kind,b.dataset.day);return}
  if(a==='editnews'){if(unlocked)openNews(b.dataset.id);return}
  if(a==='tab'){state.active=b.dataset.id;btView=false;campView=false;fullDay=false;save();render();return}
  if(a==='mday'){mDay=+b.dataset.j;render();return}
  if(a==='fullday'){
    var fl=weekSessions(weekOf(cur())).filter(function(x){return !isCamp(x)});
    if(isCamp(cur())&&fl.length)state.active=fl[0].id;
    fullDay=true;btView=false;campView=false;save();render();return;
  }
  if(a==='bttab'){var sc1=seasonCamp(weekOf(cur()));if(sc1){state.active=sc1.id;btView=true;campView=false;save();render()}return}
  if(a==='camptab'){var sc2=seasonCamp(weekOf(cur()));if(sc2){state.active=sc2.id;campView=true;btView=false;save();render()}return}
  if(a==='addfulltime'){if(mode==='edit')addFulltime();return}
  if(a==='bcell'){if(mode==='edit')openBCell(+b.dataset.day,b.dataset.coach,+b.dataset.t);return}
  if(a==='bday'){if(mode==='edit')toggleCoachDay(+b.dataset.day,b.dataset.coach);return}
  if(a==='bslotdel'){if(mode==='edit')delBtSlot(+b.dataset.t);return}
  if(a==='bslotadd'){if(mode==='edit')addBtSlot();return}
  if(a==='btall'){if(mode==='edit')autoBuildAll();return}
  if(a==='btreset'){if(mode==='edit')resetBT();return}
  if(a==='btweek'){
    if(mode!=='edit')return;
    var wc=camperRec(s,b.dataset.stu);if(!wc)return;
    var ord=[0,2,3,4,1],nx=ord[(ord.indexOf(+wc.btWeek||0)+1)%ord.length];
    mutate(function(){if(nx)wc.btWeek=nx;else delete wc.btWeek});
    return;
  }
  if(a==='btpick'){if(mode==='edit')btPick(b.dataset.n);return}
  if(a==='btgender'){if(mode==='edit')btGender(b.dataset.n);return}
  if(a==='pastecw'){if(mode==='edit')openCW();return}
  if(a==='vip'){if(mode==='edit')mutate(function(){var c=s.pods[+b.dataset.i].campers[+b.dataset.k];if(c)c.vip=!c.vip});return}
  if(a==='addwitb'){if(mode==='edit')openBT(null,'',+b.dataset.day,{start:+b.dataset.t,coach:'Mike',session:'WIB',len:30});return}
  if(a==='addsess'){customAction('addsess');return}
  if(a==='edit'){
    if(e.target.closest('.cact')||locked())return;
    var f=findCard(b.dataset.id);
    if(f)openEditor({kind:'card',id:f.card.id},f.card);
    return;
  }
  if(a==='dup'||a==='del'){
    var card=e.target.closest('.card'),f2=findCard(card.dataset.id);
    if(!f2)return;
    if(a==='dup'){
      var nid=uid();
      mutate(function(){var c=clone(f2.card);c.id=nid;s.pods[f2.i].cells[f2.j].cards.splice(f2.k+1,0,c)});
      alertCard(nid);
    }else mutate(function(){s.pods[f2.i].cells[f2.j].cards.splice(f2.k,1)},'Event deleted.');
    return;
  }
  if(a==='add'){
    var i=+b.dataset.i,j=+b.dataset.j,st=nextFreeStart(s.pods[i].cells[j],60);
    openEditor({kind:'card',id:null,i:i,j:j},{cat:state.categories[0].id,title:'',details:'',zones:[],start:st,end:st+60});return;
  }
  if(a==='edittpl'){if(locked())return;var idx=+b.dataset.tpl;openEditor({kind:'tpl',idx:idx},state.templates[idx]);return}
  if(a==='zoneplan'){openZP();return}
  if(a==='newtpl'){openEditor({kind:'tpl',idx:null},{cat:state.categories[0].id,title:'',details:'',zones:[],dur:60,teeOff:null});return}
  if(a==='rmtag'){mutate(function(){var c=s.pods[+b.dataset.i].cells[+b.dataset.j];c.tags=(c.tags||[]).filter(function(x){return x!==b.dataset.n})});return}
  if(a==='delghost'){
    if(mode!=='edit')return;
    var gid=b.dataset.src;
    askConfirm('Delete this event? It was entered in the AM tab, so deleting it removes the AM part and this continuation.',function(){
      mutate(function(){
        state.sessions.forEach(function(sx){sx.pods.forEach(function(p){p.cells.forEach(function(cell){cell.cards=cell.cards.filter(function(cd){return cd.id!==gid})})})});
      },'Event deleted.');
    },'Delete event');
    return;
  }
  if(a==='addtv'){if(unlocked)openTv(null);return}
  if(a==='edittv'){if(unlocked)openTv(b.dataset.id);return}
  if(a==='addcov'){if(unlocked)openCoverage(null);return}
  if(a==='editcov'){if(unlocked)openCoverage(b.dataset.id);return}
  if(a==='covon'){if(unlocked){var wk1=weekOf(s);mutate(function(){state.coverageOn=state.coverageOn||{};state.coverageOn[wk1]=true})}return}
  if(a==='covoff'){if(unlocked){var wk2=weekOf(s);askConfirm('Remove coverage from this week? The events are kept, so adding coverage back brings them back.',function(){mutate(function(){if(state.coverageOn)delete state.coverageOn[wk2]})},'Remove coverage')}return}
  if(a==='addcamp'){addCamp();return}
  if(a==='delcamp'){removeCamp();return}
  if(a==='addcamper'){mutate(function(){var p=s.pods[+b.dataset.i],c={id:uid()};if(b.dataset.coach)c.coach=b.dataset.coach;(p.campers=p.campers||[]).push(c)});return}
  if(a==='addcoach'){
    if(mode!=='edit')return;
    var np=s.pods[+b.dataset.i];
    askText('Add a coach','Coach to add to '+np.name+'.','Coach name',function(nn){
      if(podCoachDisplay(np).some(function(n){return normName(n)===normName(nn)})){toast(nn+' is already in this group.');return}
      mutate(function(){np.name=np.name+' & '+nn},nn+' added to the group.');
    });
    return;
  }
  if(a==='rmcoach'){
    if(mode!=='edit')return;
    var rp=s.pods[+b.dataset.i],rn=b.dataset.coach,left=podCoachDisplay(rp).filter(function(n){return normName(n)!==normName(rn)});
    if(!left.length){toast('A group needs at least one coach.');return}
    askConfirm('Remove '+rn+' from '+rp.name+'? Their campers move to Unassigned.',function(){
      mutate(function(){
        rp.name=left.join(' & ');
        (rp.campers||[]).forEach(function(c){if(normName(c.coach)===normName(rn))c.coach=''});
      },rn+' removed from the group.');
    },'Remove coach');
    return;
  }
  if(a==='pastecamp'){if(mode==='edit')openPaste(+b.dataset.i,b.dataset.coach||null);return}
  if(a==='delcamper'){mutate(function(){s.pods[+b.dataset.i].campers.splice(+b.dataset.k,1)});return}
  if(a==='addbt'){if(mode==='edit')openBT(null,b.dataset.stu,+b.dataset.day);return}
  if(a==='editbt'){if(mode==='edit')openBT(b.dataset.id);return}
  if(a==='autobt'){if(mode==='edit')openAuto(b.dataset.stu);return}
  if(a==='addpod'){mutate(function(){s.pods.push({id:uid(),name:'New pod',players:'',program:isCamp(s)?'':'TRAIN',cells:s.days.map(function(){return {tags:[],weather:'',cards:[]}})})});return}
  if(a==='delpod'){mutate(function(){s.pods.splice(+b.dataset.i,1)},'Pod deleted.');return}
  if(a==='addtrip'){mutate(function(){s.trips.rows.push({label:'Trip '+(s.trips.rows.length+1),tag:s.name,cells:s.days.map(function(){return {loc:'',load:'',dep:'',tee:'',teeLabel:'Tee Time',pick:''}})})});return}
  if(a==='deltrip'){mutate(function(){s.trips.rows.splice(+b.dataset.i,1)},'Trip deleted.');return}
});
document.addEventListener('dblclick',function(e){
  if(mode!=='edit')return;
  var tl=e.target.classList&&e.target.classList.contains('tl')?e.target:null;
  if(!tl)return;
  var s=cur(),r=tl.getBoundingClientRect();
  var st=snap(s.tStart+(e.clientY-r.top)/PPH*60);
  st=Math.max(s.tStart,Math.min(s.tEnd-60,st));
  openEditor({kind:'card',id:null,i:+tl.dataset.i,j:+tl.dataset.j},{cat:state.categories[0].id,title:'',details:'',zones:[],start:st,end:st+60});
});
$('#dsegon').addEventListener('change',function(){
  segOn=this.checked;
  if(segOn&&!esegs.length){
    var a=fromHHMM($('#dstart').value||'09:00'),b=fromHHMM($('#dend').value||'11:00'),mid=a+Math.round((b-a)/2/15)*15;
    esegs=[{start:a,end:mid,zones:ezones.slice()},{start:mid,end:b,zones:[]}];
  }
  drawSegs();syncCat();
});
$('#dsegadd').addEventListener('click',function(){
  var last=esegs[esegs.length-1],a=last&&last.end!=null?last.end:fromHHMM($('#dstart').value||'09:00');
  esegs.push({start:a,end:a+60,zones:[]});drawSegs();updateWarn();
});
$('#dsegs').addEventListener('input',function(e){
  var t=e.target,i=t.dataset&&t.dataset.sg;if(i===undefined)return;
  var g=esegs[+i];if(!g)return;
  if(t.dataset.f==='zones')g.zones=parseZoneText(t.value);
  else g[t.dataset.f]=t.value?fromHHMM(t.value):null;
  updateWarn();
});
$('#dsegs').addEventListener('click',function(e){
  var b=e.target.closest('[data-sgdel]');if(!b)return;
  esegs.splice(+b.dataset.sgdel,1);if(!esegs.length){segOn=false;$('#dsegon').checked=false}
  drawSegs();syncCat();
});
$('#dcolor').addEventListener('input',function(){tplColor=this.value});
$('#dcolreset').onclick=function(){tplColor=null;$('#dcolor').value=catOf($('#dcat').value).color};
$('#dcat').addEventListener('change',function(){
  if(this.value==='__new__')newTypeFromEditor();
  else{dcatPrev=this.value;if(!tplColor)$('#dcolor').value=catOf(this.value).color;syncCat()}
});
$('#dholes').addEventListener('change',rebuildCourses);
$('#dcourse').addEventListener('change',syncCourse);
$('#dstart').addEventListener('input',updateWarn);
$('#dend').addEventListener('input',updateWarn);
$('#dsave').onclick=saveEditor;
$('#ddel').onclick=deleteEditor;
$('#dcancel').onclick=function(){$('#dlg').close()};
$('#dtpl').onclick=function(){
  var d=readEditor();
  if(!d.title){$('#dtit').focus();return}
  var t={cat:d.cat,title:d.title,details:d.details,zones:d.zones,dur:Math.max(15,d.end-d.start),teeOff:d.tee!=null?d.tee-d.start:null};
  if(d.holes!==undefined){t.holes=d.holes;t.course=d.course}
  mutate(function(){state.templates.push(t)});
  toast('Added to the event library.');
};
$('#dlg').addEventListener('keydown',function(e){if((e.metaKey||e.ctrlKey)&&e.key==='Enter')saveEditor();else if(e.key==='Enter'&&e.target.id==='dtit')saveEditor()});
['dlg','cdlg'].forEach(function(id){$('#'+id).addEventListener('mousedown',function(e){if(e.target===this)this.close()})});
$('#bImport').onclick=function(){$('#file').click()};
$('#file').onchange=function(){if(this.files[0])importFile(this.files[0]);this.value=''};
/* exporting to Excel is for staff only */
$('#bExport').onclick=function(){if(unlocked)exportFile(false)};
$('#bExportAll').onclick=function(){if(unlocked)exportFile(true)};
$('#bExportCoach').onclick=function(){if(unlocked)exportFile('coach')};
$('#weeksel').addEventListener('change',function(){
  if(this.value==='__new__'){renderWeekBar(visibleWeeks());openNewWeek();return}
  switchWeek(this.value);
});
$('#bDelWeek').onclick=deleteWeek;
$('#bPub').onclick=function(){
  var w=weekOf(cur());state.published=state.published||{};
  if(state.published[w])delete state.published[w];else state.published[w]=true;
  save();render();
  toast(isPublished(w)?'Week of '+w+' is published to general staff (and range staff).':(isRangePub(w)?'Week of '+w+' is hidden from general staff. Range staff can still see it.':'Week of '+w+' is hidden from coaches.'));
};
$('#bPubRange').onclick=function(){
  var w=weekOf(cur());if(isPublished(w))return;
  state.publishedRange=state.publishedRange||{};
  if(state.publishedRange[w])delete state.publishedRange[w];else state.publishedRange[w]=true;
  save();render();
  toast(isRangePub(w)?'Week of '+w+' is published to range staff. You can keep editing, then publish to general staff.':'Week of '+w+' is hidden from range staff.');
};
/* ---- print: what a coach is printing, or (staff) everything at once ---- */
function openPrint(){
  var mine=!!coachFilter;
  $('#prmine').style.display=mine?'':'none';
  var want=document.querySelector('input[name="prsc"][value="'+(mine?'mine':'tab')+'"]');if(want)want.checked=true;
  $('#prnews').checked=false;
  $('#prdlg').showModal();
}
/* part: 'sched', 'campers' or 'bt' prints just that piece of a Holiday or Summer camp; leave it out for everything */
function printPage(s,filter,part){
  state.active=s.id;mode='coach';coachFilter=filter;
  renderGrid();renderTrips();renderCamp(true);
  var seas=isCamp(s)&&!!s.season;
  if(seas)btNormalize(s);
  function clean(html){
    var tmp=document.createElement('div');tmp.innerHTML=html;
    tmp.querySelectorAll('.nowline,.todaytag').forEach(function(n){n.remove()});
    tmp.querySelectorAll('.today').forEach(function(n){n.classList.remove('today')});
    /* typed boxes print as plain text so long names are never cut off */
    tmp.querySelectorAll('input.campin').forEach(function(i){
      var sp=document.createElement('span');sp.className='campval'+(i.classList.contains('vip')?' vip':'');sp.textContent=i.getAttribute('value')||'';i.parentNode.replaceChild(sp,i);
    });
    tmp.querySelectorAll('select.campin').forEach(function(sel){
      var o=sel.querySelector('option[selected]'),sp=document.createElement('span');sp.className='campval';sp.textContent=o?o.textContent:'';sel.parentNode.replaceChild(sp,sel);
    });
    return tmp.innerHTML;
  }
  function sec(sub,body){
    return '<section class="pp"><div class="pph"><img src="img/img-logo-white.png" alt=""><div><b>Golf - Weekly Schedule</b><span>'+esc(s.title||s.name)+(sub?' · '+esc(sub):'')+(filter?' · '+esc(filter):'')+'</span></div></div><div class="ppg'+(seas?' seasonal':'')+'">'+clean(body)+'</div></section>';
  }
  var sched=$('#grid').innerHTML+'<div class="ppt">'+$('#trips').innerHTML+'</div>';
  if(!seas)return sec('',sched+(isCamp(s)?$('#campwrap').innerHTML:''));
  /* a camp week prints as separate pages: the schedule, the campers, then the Breakthroughs */
  var out='';
  if(!part||part==='sched')out+=sec('',sched);
  if(!part||part==='campers')out+=sec('Campers',$('#campwrap').innerHTML);
  if((!part||part==='bt')&&(part==='bt'||(s.bt||[]).length))out+=sec('Breakthroughs','<div class="btp">'+btBoardHtml(s,true)+'</div>');
  return out;
}
function printNow(scope,withNews){
  var saved={a:state.active,m:mode,f:coachFilter,u:unlocked,fd:fullDay},wk=weekOf(cur()),sess=weekSessions(wk),pages=[];
  /* a coach prints their whole day as one page; printing everyone's schedules goes tab by tab */
  var oneDay=fdCan()&&((scope==='tab'&&!isCamp(cur()))||scope==='mine');
  fdOff=!oneDay;
  try{
    if(oneDay){var c1=cur();if(isCamp(c1))state.active=sess.filter(function(x){return !isCamp(x)})[0].id;pages.push(printPage(cur(),coachFilter))}
    else
    if(scope==='tab'){
      var cs0=cur(),seas0=isCamp(cs0)&&!!cs0.season;
      pages.push(printPage(cs0,coachFilter,seas0?(btView?'bt':(campView?'campers':'sched')):undefined));
    }
    else if(scope==='mine'){
      sess.forEach(function(s){if(s.pods.some(function(p){return podVisibleFor(p,saved.f)}))pages.push(printPage(s,saved.f))});
    }else if(scope==='all'){
      sess.forEach(function(s){pages.push(printPage(s,''))});
    }else if(scope==='coaches'){
      allCoaches().forEach(function(n){sess.forEach(function(s){if(s.pods.some(function(p){return coachKey(p.name)===n}))pages.push(printPage(s,n))})});
    }
    if(withNews){
      unlocked=false;state.active=sess[0].id;renderNewsPage();
      var nt=document.createElement('div');nt.innerHTML=$('#newspage').innerHTML;
      nt.querySelectorAll('.nplus,.btn').forEach(function(n){n.remove()});
      pages.push('<section class="pp"><div class="pph"><img src="img/img-logo-white.png" alt=""><div><b>Golf - Weekly Schedule</b><span>'+esc(weekLabel(wk))+'</span></div></div><div class="ppg npage">'+nt.innerHTML+'</div></section>');
    }
  }finally{
    fdOff=false;state.active=saved.a;mode=saved.m;coachFilter=saved.f;unlocked=saved.u;fullDay=saved.fd;
    render();
  }
  runPrint(pages);
}
function runPrint(pages){
  if(!pages.length){toast('Nothing to print for that choice.');return}
  /* the VS Code preview (and any framed page) cannot print, and used to leave the screen blank: say so instead */
  var framed=false;try{framed=window.self!==window.top||/\bCode\/|Electron/i.test(navigator.userAgent)}catch(e){framed=true}
  if(framed){toast('Printing does not work in this preview. Open index.html in Microsoft Edge (right-click the file, Open with, Edge) and print from there.',false,true);return}
  $('#printroot').innerHTML=pages.join('');
  document.body.classList.add('printing');
  var done=function(){document.body.classList.remove('printing');$('#printroot').innerHTML='';window.removeEventListener('afterprint',done)};
  window.addEventListener('afterprint',done);
  setTimeout(function(){try{window.print()}catch(e){done()}},60);
}
/* ---- Range staff: their own simple view (zones by time), opened from the first screen with a password ---- */
var RANGE_PW='1234',RANGE_KEY='wp-range',rangeOpen=false,rangeWk=null,rangeSess=null,rangeDay=null,rangeLay='group',rangeTab='S';
function rangeWeeks(){
  var all=allWeeks().filter(function(w){return !isArchived(w)&&weekTime(w)!=null&&(unlocked||isRangePub(w))});
  all.sort(function(a,b){return weekTime(a)-weekTime(b)});
  return all.slice(0,2);
}
function rangeDateLabel(wk,j){
  var w0=weekStart(wk);if(!w0)return '';
  var d=new Date(w0.getFullYear(),w0.getMonth(),w0.getDate()+j);
  return MONTHS[d.getMonth()].slice(0,3)+' '+d.getDate();
}
/* the range view shows the normal schedule, tightened: no tags, weather spots, trips or camper details */
function rangeSessionHtml(s,onlyDay){
  /* the normal schedule, tightened and turned: coaches across the top, the days down the left.
     Camp groups are added to AM and PM, with their events cut at the tab's window (12:30 between AM and PM). */
  var saved=PPH;PPH=34;
  var H=(s.tEnd-s.tStart)/60*PPH,off=((60-s.tStart%60)%60)/60*PPH,conf=confMap(s),nd=Math.min(5,s.days.length),today=todayCol(s);
  var camp=weekSessions(weekOf(s)).filter(isCamp)[0];
  var cols=s.pods.map(function(p){return {name:p.name,players:p.players,cards:function(j){return ((p.cells[j]||{cards:[]}).cards).concat(ghostsFor(s,p,j))}}});
  if(camp&&!camp.season&&!isCamp(s)){
    camp.pods.forEach(function(p){
      var clip=function(j){
        return ((p.cells[j]||{cards:[]}).cards).map(function(c){
          var st=Math.max(c.start,s.tStart),en=Math.min(c.end,s.tEnd);
          if(!(en>st))return null;
          var cc=Object.assign({},c,{start:st,end:en});
          if(cc.segments&&cc.segments.length)cc.segments=cc.segments.map(function(g){return {start:Math.max(g.start,st),end:Math.min(g.end,en),zones:g.zones}}).filter(function(g){return g.end>g.start});
          var cl=findConf(camp,j,cc,c.id);
          if(cl.length)conf[c.id]=cl;
          return cc;
        }).filter(Boolean);
      },any=false;
      for(var j0=0;j0<nd;j0++)if(clip(j0).length)any=true;
      if(any)cols.push({name:p.name,players:'Camp',cards:clip});
    });
  }
  var np=cols.length;
  var axl='';
  for(var t=Math.ceil(s.tStart/60)*60;t<s.tEnd;t+=60)if(t>s.tStart)axl+='<span style="top:'+((t-s.tStart)/60*PPH)+'px">'+hourLabel(t/60)+'</span>';
  var h='<div class="rt" style="--np:'+Math.max(np,1)+';--pph:'+PPH+'px"><div class="rt-c"></div><div class="rt-c"></div>'+
    cols.map(function(c){return '<div class="rt-h"><b>'+esc(c.name)+'</b>'+(c.players?'<small>'+esc(c.players)+'</small>':'')+'</div>'}).join('');
  for(var j=0;j<nd;j++){
    if(onlyDay!=null&&j!==onlyDay)continue;
    h+='<div class="rt-d'+(j===today?' today':'')+'"><b>'+esc(dayName(s,j))+'</b><small>'+esc(rangeDateLabel(weekOf(s),j))+'</small></div><div class="rt-ax"><div class="axl" style="height:'+H+'px">'+axl+'</div></div>';
    cols.forEach(function(c){
      h+='<div class="rt-cell"><div class="tl" style="height:'+H+'px;background-position:0 '+off+'px">'+
        layout(c.cards(j)).map(function(x){return cardHtml(x,s,conf,true,j).replace(' data-act="edit"','')}).join('')+'</div></div>';
    });
  }
  PPH=saved;
  return h+'</div>';
}
function rangeSessions(wk){
  /* AM and PM only: camp is shown inside them */
  return weekSessions(wk).filter(function(x){return !isCamp(x)||x.season}).sort(function(a,b){return a.tStart-b.tStart});
}function renderRange(){
  var el=$('#rangeview');el.classList.toggle('on',rangeOpen);
  if(!rangeOpen)return;
  var wks=rangeWeeks();
  if(isMobile())rangeTab='S';
  if(!wks.length){
    $('#rvweeks').innerHTML='';$('#rvsess').innerHTML='';$('#rvdays').innerHTML='';
    $('#rvbody').innerHTML='<p class="rv-empty">No schedule has been published yet. Check back soon.</p>';return;
  }
  if(wks.indexOf(rangeWk)<0){rangeWk=wks[0];rangeSess=null}
  $('#rvweeks').innerHTML=wks.map(function(w,i){return '<button data-rw="'+esc(w)+'" aria-pressed="'+(w===rangeWk)+'">'+(i===0?'This week':'Next week')+' <small>'+esc(rangeDateLabel(w,0))+'</small></button>'}).join('');
  var ss=rangeSessions(rangeWk);
  if(!ss.some(function(x){return x.id===rangeSess})){
    var n=new Date(),want=(n.getHours()*60+n.getMinutes()<750)?'am':'pm';
    var pick=ss.filter(function(x){return !isCamp(x)&&String(x.name).trim().toLowerCase()===want})[0]||ss[0];
    rangeSess=pick?pick.id:null;
  }
  var cs=ss.filter(function(x){return x.id===rangeSess})[0];
  $('#rvsess').innerHTML=ss.map(function(x){return '<button data-rs="'+x.id+'" aria-pressed="'+(x.id===rangeSess)+'"><b>'+esc(tabLabel(x))+'</b></button>'}).join('');
  $('#rvsess').style.display=rangeTab==='S'?'':'none';
  $('#rvweeks').style.display=rangeTab==='S'?'':'none';
  var days=cs?cs.days.slice(0,5):[];
  if(rangeDay==null||rangeDay<0||rangeDay>=days.length){var tj=todayCol(cs||{title:'Week of '+rangeWk,days:days});rangeDay=(tj>=0&&tj<5)?tj:0}
  $('#rvdays').innerHTML=days.map(function(d,j){return '<button data-rd="'+j+'" aria-pressed="'+(j===rangeDay)+'"><b>'+esc(dayShort(d.name))+'</b><small>'+esc(rangeDateLabel(rangeWk,j))+'</small></button>'}).join('');
  $('#rvdays').style.display=(isMobile()&&rangeTab==='S')?'':'none';
  $('#rvlay').style.display='none';
  Array.prototype.forEach.call($('#rvlay').querySelectorAll('button'),function(b){b.setAttribute('aria-pressed',b.dataset.lay===rangeLay)});
  $('#rvtabS').setAttribute('aria-selected',rangeTab==='S');$('#rvtabH').setAttribute('aria-selected',rangeTab==='H');
  var body;
  if(rangeTab!=='S')body=rangeHoursAll(unlocked);
  else if(!cs)body='<p class="rv-empty">Nothing scheduled.</p>';
  else body=rangeSessionHtml(cs,isMobile()?rangeDay:null);
  $('#rvbody').innerHTML=body;
}function openRange(){
  rangeOpen=true;try{sessionStorage.setItem(RANGE_KEY,'1')}catch(e){}
  var wks=rangeWeeks();rangeWk=wks[0]||null;rangeSess=null;rangeTab='S';
  renderRange();render();
}
function closeRange(){
  rangeOpen=false;try{sessionStorage.removeItem(RANGE_KEY)}catch(e){}
  renderRange();render();
}
function printRange(){
  if(!rangeWk)return;
  var pages=[];
  function page(s,sub,body){return '<section class="pp"><div class="pph"><img src="img/img-logo-white.png" alt=""><div><b>Range Staff</b><span>'+esc(s.name)+(sub?' \u00B7 '+esc(sub):'')+' \u00B7 '+esc(weekLabel(rangeWk))+'</span></div></div><div class="ppg">'+body+'</div></section>'}
  rangeSessions(rangeWk).forEach(function(s){
    if(rangeLay==='zone'){
      s.days.slice(0,5).forEach(function(d,j){
        var has=s.pods.some(function(p){return p.cells[j]&&p.cells[j].cards.length});
        if(has)pages.push(page(s,d.name+' '+rangeDateLabel(rangeWk,j),rangeZoneHtml(s,j)));
      });
    }else pages.push(page(s,'',rangeSessionHtml(s)));
  });
  if(hoursWeeks().length)pages.push('<section class="pp"><div class="pph"><img src="img/img-logo-white.png" alt=""><div><b>Range Staff</b><span>Hourly schedule</span></div></div><div class="ppg">'+rangeHoursAll(false)+'</div></section>');
  runPrint(pages);
}
/* ---- range staff hourly schedule: a grid like the Excel one; paste it in or drag hours between boxes ---- */
var HC_COLORS=['','b','r','k'];
function hoursData(wk,create){
  state.rangeHours=state.rangeHours||{};
  if(!state.rangeHours[wk]&&create)state.rangeHours[wk]={rows:[]};
  return state.rangeHours[wk]||null;
}
function newHoursRow(name){
  var cells=[];for(var i=0;i<7;i++)cells.push({t:'',c:i===6?'k':''});
  return {id:uid(),name:name||'',cells:cells,total:''};
}
function hcClass(c){
  var k=c.c;
  if(!k&&/^\s*off\s*$/i.test(c.t))k='b';
  return k?'hk-'+k:'';
}
function rangeHoursHtml(wk,ed){
  var d=hoursData(wk,false),rows=d?d.rows:[],days=['M','T','W','T','F','S','S'];
  var h='<div class="hrs" data-wk="'+esc(wk)+'">';
  h+='<div class="hrs-wk">Week of '+esc(rangeDateLabel(wk,0))+'</div><div class="teescroll"><table class="hrt"><thead><tr><th></th>'+
    days.map(function(x,i){return '<th>'+x+'<small>'+esc(rangeDateLabel(wk,i))+'</small></th>'}).join('')+'<th>TOTAL</th>'+(ed?'<th></th>':'')+'</tr></thead><tbody>';
  if(!rows.length)h+='<tr><td colspan="'+(ed?10:9)+'" class="hrs-none">'+(ed?'No hours yet for this week. Use Paste from Excel or + Add person.':'The hourly schedule for this week has not been added yet.')+'</td></tr>';
  rows.forEach(function(r,ri){
    h+='<tr><th class="hn">'+(ed?'<input class="hin" data-hn="'+ri+'" value="'+esc(r.name)+'" aria-label="Name" placeholder="Name">':esc(r.name))+'</th>';
    r.cells.forEach(function(c,ci){
      h+='<td class="hc '+hcClass(c)+'" data-r="'+ri+'" data-c="'+ci+'">'+(ed?
        '<span class="hgrip" draggable="true" data-r="'+ri+'" data-c="'+ci+'" title="Drag to move these hours">⠿</span><input class="hin" data-hr="'+ri+'" data-hcc="'+ci+'" value="'+esc(c.t)+'" aria-label="Hours"><button class="hdot" data-rh="color" data-r="'+ri+'" data-c="'+ci+'" title="Change color" aria-label="Change color"></button>'
        :esc(c.t))+'</td>';
    });
    h+='<td class="ht">'+(ed?'<input class="hin" data-hr="'+ri+'" data-htot="1" value="'+esc(r.total)+'" aria-label="Total hours">':esc(r.total))+'</td>'+(ed?'<td><button class="x" data-rh="del" data-r="'+ri+'" aria-label="Remove person">×</button></td>':'')+'</tr>';
  });
  return h+'</tbody></table></div></div>';
}
function rangeHoursAll(ed){
  var wks=hoursWeeks(),h='';
  if(ed)h+='<div class="hrs-tools"><button class="btn" data-rh="add">+ Add person</button><button class="btn" data-rh="paste">Paste from Excel</button><span class="note">Drag a \u283F grip to move hours to another box, even into the other week. Click the small dot in a box to change its color.</span></div>';
  if(!wks.length)return h+'<p class="rv-empty">'+(ed?'No hourly schedule yet. Click Paste from Excel to add the current week, next week and the week after.':'The hourly schedule has not been added yet.')+'</p>';
  return h+wks.map(function(w){return rangeHoursHtml(w,ed)}).join('<div class="hrs-gap"></div>');
}
function rangeHoursAction(b){
  if(!unlocked)return;
  var act=b.dataset.rh,ri=+b.dataset.r,ci=+b.dataset.c,box=b.closest('.hrs'),wk=box?box.dataset.wk:rangeWk;
  if(act==='paste'){openHoursPaste();return}
  mutate(function(){
    var d=hoursData(wk,true);
    if(act==='add'){var sw=hoursWeeks();if(!sw.length)sw=[rangeWk];sw.forEach(function(w){hoursData(w,true).rows.push(newHoursRow(''))})}
    else if(act==='del')d.rows.splice(ri,1);
    else if(act==='color'){var c=d.rows[ri].cells[ci],cur0=c.c||(/^\s*off\s*$/i.test(c.t)?'b':''),ix=HC_COLORS.indexOf(cur0);c.c=HC_COLORS[(ix+1)%HC_COLORS.length]}
  });
}
function parseHoursPaste(text){
  var blocks=[],cur0=null;
  String(text||'').replace(/\r/g,'').split('\n').forEach(function(line){
    var cells=line.split('\t').map(function(x){return x.trim()});
    if(!cells.some(Boolean))return;
    var wm=/week of\s*\(?\s*(\d{1,2})\s*\/\s*(\d{1,2})/i.exec(cells[0]);
    if(wm){cur0={m:+wm[1],d:+wm[2],rows:[]};blocks.push(cur0);return}
    if(/^m$/i.test(cells[1]||'')&&/^t$/i.test(cells[2]||''))return;
    if(!cells[0]||/^total$/i.test(cells[0]))return;
    if(!cur0){cur0={m:null,d:null,rows:[]};blocks.push(cur0)}
    var r=newHoursRow(cells[0]);
    for(var i=0;i<7;i++){r.cells[i].t=cells[1+i]||'';r.cells[i].c=''}
    r.total=cells[8]||'';
    cur0.rows.push(r);
  });
  /* a Sunday column that is empty for everyone is a closed (black) day */
  blocks.forEach(function(bk){
    if(bk.rows.length&&bk.rows.every(function(r){return !r.cells[6].t}))bk.rows.forEach(function(r){r.cells[6].c='k'});
  });
  return blocks;
}
/* the hourly schedule keeps its own weeks: the date is whatever was pasted, with the year that is closest to today */
function mdLabel(m,d){
  if(!(m>=1&&m<=12&&d>=1&&d<=31))return null;
  var now=new Date(),best=null,y=now.getFullYear();
  [y-1,y,y+1].forEach(function(yy){var diff=Math.abs(new Date(yy,m-1,d).getTime()-now.getTime());if(best===null||diff<best.diff)best={y:yy,diff:diff}});
  return m+'/'+d+'/'+String(best.y).slice(2);
}
function hoursWeeks(){
  var rh=state.rangeHours||{};
  return Object.keys(rh).filter(function(w){return rh[w]&&rh[w].rows&&rh[w].rows.length&&weekTime(w)!=null&&!isArchived(w)}).sort(function(a,b){return weekTime(a)-weekTime(b)}).slice(0,3);
}
function weekForMD(m,d){
  return allWeeks().filter(function(w){var p=String(w).split('/');return +p[0]===m&&+p[1]===d})[0]||null;
}
function hoursPastePlan(text){
  var blocks=parseHoursPaste(text),plan=[],lost=[];
  blocks.forEach(function(bk){
    var wk=(bk.m==null)?(hoursWeeks()[0]||rangeWk):mdLabel(bk.m,bk.d);
    if(wk)plan.push({wk:wk,rows:bk.rows});else lost.push(bk.m+'/'+bk.d);
  });
  return {plan:plan,lost:lost};
}
function openHoursPaste(){$('#hptext').value='';hoursPasteInfo();$('#hpdlg').showModal();$('#hptext').focus()}
function hoursPasteInfo(){
  var t=$('#hptext').value,r=hoursPastePlan(t),m='';
  if(!t.trim())m='<div class="btm">Copy the schedule in Excel, then paste it above.</div>';
  else if(!r.plan.length)m='<div class="btm bad">⚠ No matching weeks found. A "Week of (11/2)" row has to match a week in the planner.</div>';
  else m=r.plan.map(function(p){return '<div class="btm ok">✓ '+esc(weekLabel(p.wk))+': '+p.rows.length+' people</div>'}).join('');
  if(r.lost.length)m+='<div class="btm warn">Not in the planner yet, so skipped: '+r.lost.map(esc).join(', ')+'.</div>';
  $('#hpinfo').innerHTML=m;$('#hpgo').disabled=!r.plan.length;
}
$('#hptext').addEventListener('input',hoursPasteInfo);
$('#hpgo').onclick=function(){
  var r=hoursPastePlan($('#hptext').value);if(!r.plan.length)return;
  $('#hpdlg').close();
  mutate(function(){r.plan.forEach(function(p){hoursData(p.wk,true).rows=p.rows})},'Hourly schedule pasted.');
};
$('#hpcancel').onclick=function(){$('#hpdlg').close()};
$('#hpdlg').addEventListener('mousedown',function(e){if(e.target===this)this.close()});
$('#rvbody').addEventListener('input',function(e){
  var t=e.target;if(!t.classList||!t.classList.contains('hin')||!unlocked)return;
  var hb=t.closest('.hrs'),d=hoursData(hb?hb.dataset.wk:rangeWk,true);
  if(t.dataset.hn!==undefined){d.rows[+t.dataset.hn].name=t.value}
  else if(t.dataset.htot){d.rows[+t.dataset.hr].total=t.value}
  else if(t.dataset.hcc!==undefined){
    var c=d.rows[+t.dataset.hr].cells[+t.dataset.hcc];c.t=t.value;
    var td=t.closest('td');if(td)td.className='hc '+hcClass(c);
  }
  touch();save();
});
$('#rvbody').addEventListener('dragstart',function(e){
  var g=e.target.closest&&e.target.closest('.hgrip');if(!g||!unlocked)return;
  e.dataTransfer.setData('text/plain',g.closest('.hrs').dataset.wk+'|'+g.dataset.r+'|'+g.dataset.c);e.dataTransfer.effectAllowed='move';
});
$('#rvbody').addEventListener('dragover',function(e){if(e.target.closest&&e.target.closest('td.hc')){e.preventDefault()}});
$('#rvbody').addEventListener('drop',function(e){
  var td=e.target.closest&&e.target.closest('td.hc');if(!td||!unlocked)return;
  e.preventDefault();
  var from=(e.dataTransfer.getData('text/plain')||'').split('|');
  var fwk=from[0],fr=+from[1],fc=+from[2],twk=td.closest('.hrs').dataset.wk,tr=+td.dataset.r,tc=+td.dataset.c;
  if(!fwk||isNaN(fr)||isNaN(fc)||(fwk===twk&&fr===tr&&fc===tc))return;
  mutate(function(){
    var da=hoursData(fwk,true),db=hoursData(twk,true),a=da.rows[fr].cells[fc],b=db.rows[tr].cells[tc],x={t:a.t,c:a.c};
    a.t=b.t;a.c=b.c;b.t=x.t;b.c=x.c;
  });
});
$('#rangeview').addEventListener('click',function(e){
  var b=e.target.closest('button');if(!b)return;
  if(b.dataset.rw){rangeWk=b.dataset.rw;renderRange();return}
  if(b.dataset.rs){rangeSess=b.dataset.rs;renderRange();return}
  if(b.dataset.rd!==undefined){rangeDay=+b.dataset.rd;renderRange();return}
  if(b.dataset.lay){rangeLay=b.dataset.lay==='group'?'group':'zone';renderRange();return}
  if(b.id==='rvtabS'){rangeTab='S';renderRange();return}
  if(b.id==='rvtabH'){rangeTab='H';renderRange();return}
  if(b.dataset.rh){rangeHoursAction(b);return}
  if(b.id==='rvprint'){printRange();return}
  if(b.id==='rvexit'){closeRange();return}
});
$('#lrange').addEventListener('click',function(e){
  e.preventDefault();
  askOpen({title:'Range staff',msg:'Enter the range staff password.',input:true,password:true,ok:'Open',onOk:function(v){
    if(v===RANGE_PW)openRange();else toast('That password didn’t match.');
  }});
});
$('#bRangeView').addEventListener('click',function(){menuOpen(false);openRange()});
$('#bPrint').onclick=openPrint;
$('#prgo').onclick=function(){
  var sc=(document.querySelector('input[name="prsc"]:checked')||{}).value||'tab';
  $('#prdlg').close();printNow(sc,$('#prnews').checked);
};
$('#prcancel').onclick=function(){$('#prdlg').close()};
$('#prdlg').addEventListener('mousedown',function(e){if(e.target===this)this.close()});
$('#bUndo').onclick=undo;
$('#tundo').onclick=undo;
$('#bCustom').onclick=openCustom;
function pinHash(x){var h=5381,t='wp|'+x;for(var i=0;i<t.length;i++)h=((h<<5)+h+t.charCodeAt(i))|0;return String(h)}
function showPin(){$('#pin').value='';$('#pinerr').classList.remove('on');$('#pdlg').showModal();$('#pin').focus()}
/* log in: the database checks the PIN, then staff load everything (including unpublished weeks) */
var PIN_BAD='That PIN didn’t match. Try again.',PIN_NET='Couldn’t reach the shared schedule. Check your connection and try again.';
function staffLogin(pin,onBad,onOk){
  if(!pin){onBad(PIN_BAD);return}
  SYNC.verify(pin).then(function(ok){
    if(!ok){onBad(PIN_BAD);return}
    unlocked=true;staffPin=pin;
    try{sessionStorage.setItem(UNLOCK_KEY,'1');sessionStorage.setItem(PIN_KEY,pin)}catch(e){}
    return remoteRefresh(false).then(onOk);
  }).catch(function(){onBad(PIN_NET)});
}
function tryPin(){
  var e=$('#pinerr');
  staffLogin($('#pin').value,function(msg){e.textContent=msg;e.classList.add('on');$('#pin').select()},function(){
    $('#pdlg').close();mode='edit';syncHash();render();window.scrollTo(0,0);
  });
}
/* the three-line menu: log in or out, Print and Export Excel */
var loginOpen=false;
function menuOpen(v){
  $('#menu').hidden=!v;$('#bMenu').setAttribute('aria-expanded',String(!!v));
  if(v){$('#mpinerr').classList.remove('on')}
  else if(loginOpen){loginOpen=false;$('#mlogin').hidden=true;$('#mloginopen').hidden=unlocked;$('#mpin').value=''}
}
$('#mloginopen').onclick=function(e){
  e.stopPropagation();
  loginOpen=true;$('#mlogin').hidden=false;$('#mloginopen').hidden=true;
  setTimeout(function(){$('#mpin').focus()},0);
};
function menuLogin(){
  var e=$('#mpinerr');
  staffLogin($('#mpin').value,function(msg){e.textContent=msg;e.classList.add('on');$('#mpin').select()},function(){
    $('#mpin').value='';menuOpen(false);mode='edit';syncHash();render();window.scrollTo(0,0);
  });
}
$('#lstaff').onclick=function(){chooseWho('staff')};
$('#bWho').onclick=function(){setWho(null);whoApplied=true;coachFilter='';menuOpen(false);render()};
$('#bMenu').onclick=function(e){e.stopPropagation();menuOpen($('#menu').hidden)};
$('#mgo').onclick=menuLogin;
$('#mpin').addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();menuLogin()}});
$('#mlogout').onclick=function(){
  /* send any edit still waiting to be saved before locking */
  var oldPin=staffPin,pending=unlocked&&oldPin&&!pushBlocked&&remoteLoaded?SYNC.push(state,oldPin).catch(function(){}):Promise.resolve();
  clearTimeout(pushT);
  unlocked=false;anOK=false;staffPin='';try{sessionStorage.removeItem(UNLOCK_KEY);sessionStorage.removeItem(PIN_KEY)}catch(e){}
  menuOpen(false);setMode('coach');
  /* back to the coach view: drop unpublished weeks and staff-only data from memory */
  pending.then(function(){remoteRefresh(false)});
};
$('#menu').addEventListener('click',function(e){if(e.target.closest('.mitem'))menuOpen(false)});
document.addEventListener('click',function(e){if(!$('#menu').hidden&&!e.target.closest('.menuwrap'))menuOpen(false)});
document.addEventListener('keydown',function(e){if(e.key==='Escape'&&!$('#menu').hidden)menuOpen(false)});
$('#pgo').onclick=tryPin;
$('#pcancel').onclick=function(){$('#pdlg').close()};
$('#pin').addEventListener('keydown',function(e){if(e.key==='Enter')tryPin()});
$('#pdlg').addEventListener('mousedown',function(e){if(e.target===this)this.close()});
function afterRender(){if(pinPrompt){pinPrompt=false;syncHash();showPin()}}
function hashFor(){return mode==='coach'?'#coach'+(coachFilter?'='+encodeURIComponent(coachFilter):''):(mode==='analytics'?'#analytics':(mode==='news'?'#news':(mode==='tee'?'#tee':'')))}
function syncHash(){try{history.replaceState(null,'',hashFor()||(location.pathname+location.search))}catch(e){}}
$('#podfilter').onchange=function(){coachFilter=this.value;fullDay=!!coachFilter&&!isSpecCoach(coachFilter);syncHash();render()};
$('#lwho').addEventListener('change',function(){if(this.value)chooseWho('c:'+this.value)});
$('#wkPrev').onclick=function(){wkStep(-1)};
$('#wkNext').onclick=function(){wkStep(1)};
$('#bNewsM').onclick=function(){$(mode==='news'?'#mCoach':'#mNews').click()};
/* phone menu: the header buttons live in the menu on a small screen */
document.addEventListener('click',function(e){
  var b=e.target.closest&&e.target.closest('[data-proxy]');if(!b)return;
  menuOpen(false);
  var t=document.getElementById(b.dataset.proxy);if(t&&!t.disabled)t.click();
});
/* phone: swipe left or right on the schedule to change the day */
(function(){
  var sx=0,sy=0,on=false;
  document.addEventListener('touchstart',function(e){
    on=false;
    if(!isMobile()||e.touches.length!==1||$('#daybar').hidden)return;
    var t=e.target;if(!t.closest||!t.closest('#grid,#btpage'))return;
    if(t.closest('input,select,textarea'))return;
    var sc=t.closest('.teescroll');if(sc&&sc.scrollWidth>sc.clientWidth+4)return;
    if(mode==='edit'&&t.closest('.card'))return;
    sx=e.touches[0].clientX;sy=e.touches[0].clientY;on=true;
  },{passive:true});
  document.addEventListener('touchend',function(e){
    if(!on)return;on=false;
    if(D)return;
    var t=e.changedTouches[0],dx=t.clientX-sx,dy=t.clientY-sy;
    if(Math.abs(dx)>60&&Math.abs(dx)>Math.abs(dy)*1.8)mobStep(dx<0?1:-1);
  },{passive:true});
})();
/* edit the names on the first screen (staff only) */
$('#bHomeNames').onclick=function(){
  if(!unlocked)return;
  menuOpen(false);
  $('#hntext').value=homeNames().join('\n');
  $('#hnnote').textContent=(state.homeNames&&state.homeNames.length)?'This is your own list.':'Right now the list follows the schedule. Saving makes it your own list.';
  $('#hndlg').showModal();
};
$('#hngo').onclick=function(){
  if(!unlocked)return;
  var seen={},out=[];
  $('#hntext').value.split(/[\n,;]+/).forEach(function(n){n=n.trim();var k=nameFz(n);if(n&&!seen[k]){seen[k]=1;out.push(n)}});
  state.homeNames=out;save();$('#hndlg').close();render();
  toast('The first screen now lists '+out.length+' name'+(out.length===1?'':'s')+'.');
};
$('#hnauto').onclick=function(){
  if(!unlocked)return;
  delete state.homeNames;save();$('#hndlg').close();render();
  toast('The first screen follows the schedule again.');
};
$('#hncancel').onclick=function(){$('#hndlg').close()};
$('#hndlg').addEventListener('mousedown',function(e){if(e.target===this)this.close()});
function setMode(m){
  if(!unlocked&&m!=='coach'&&m!=='news'){showPin();return}
  if(m==='analytics'&&state.analyticsPin&&!anOK&&!unlocked){showPin();return}
  if(mode==='analytics'&&m!=='analytics')anOK=false;
  mode=m;syncHash();render();window.scrollTo(0,0);
}
$('#mEdit').onclick=function(){setMode('edit')};
$('#layoutseg').addEventListener('click',function(e){
  var b=e.target.closest('[data-lay]');if(!b)return;
  layoutMode=b.dataset.lay==='day'?'day':'coach';
  try{localStorage.setItem('wp-layout',layoutMode)}catch(err){}
  render();
});
$('#mCoach').onclick=function(){setMode('coach')};
$('#mNews').onclick=function(){setMode('news')};
$('#mTee').onclick=function(){setMode('tee')};
$('#mAnalytics').onclick=function(){setMode('analytics')};
window.addEventListener('hashchange',function(){parseHash();render();afterRender()});
document.addEventListener('keydown',function(e){
  var tg=e.target&&e.target.tagName;
  if((e.metaKey||e.ctrlKey)&&!e.shiftKey&&e.key.toLowerCase()==='z'&&tg!=='INPUT'&&tg!=='TEXTAREA'&&tg!=='SELECT'){e.preventDefault();undo()}
});
var dragDepth=0;
function hasFiles(e){return e.dataTransfer&&Array.prototype.indexOf.call(e.dataTransfer.types,'Files')>=0}
document.addEventListener('dragenter',function(e){if(hasFiles(e)){dragDepth++;$('#veil').classList.add('on')}});
document.addEventListener('dragleave',function(e){if(dragDepth>0&&--dragDepth===0)$('#veil').classList.remove('on')});
document.addEventListener('dragover',function(e){if(hasFiles(e))e.preventDefault()});
document.addEventListener('drop',function(e){
  if(e.dataTransfer&&e.dataTransfer.files&&e.dataTransfer.files.length){e.preventDefault();dragDepth=0;$('#veil').classList.remove('on');if(mode==='edit'&&unlocked)importFile(e.dataTransfer.files[0])}
});

/* rearrange the event library by dragging a chip's grip */
if(typeof Sortable!=='undefined'){
  new Sortable($('#libchips'),{
    handle:'.libgrip',animation:150,ghostClass:'libghost',
    onEnd:function(){
      var order=Array.prototype.map.call($('#libchips').children,function(n){return +n.dataset.tpl});
      justDragged=true;setTimeout(function(){justDragged=false},120);
      var old=state.templates.slice();
      if(order.length!==old.length||order.some(function(i,k){return i!==k})===false)return;
      mutate(function(){state.templates=order.map(function(i){return old[i]})});
    }
  });
}
/* ---- shared schedule (Supabase): coaches read, staff save ---- */
var remoteSig='',remoteLoaded=false,pushBlocked=false,pushT,pushing=false,pushAgain=false;
function pushSoon(){
  if(!unlocked||!staffPin||pushBlocked||!remoteLoaded)return;
  clearTimeout(pushT);pushT=setTimeout(doPush,600);
}
function doPush(){
  if(pushing){pushAgain=true;return}
  if(!unlocked||!staffPin||pushBlocked||!remoteLoaded)return;
  pushing=true;
  SYNC.push(state,staffPin).catch(function(e){
    if(e.code==='40001'){toast('Someone else saved this week first. Loaded the latest version; please redo your last change.',false,true);remoteRefresh(false)}
    else if(e.code==='28000'){lockOut('The staff PIN was changed. Please log in again.')}
    else{toast('Couldn’t save to the shared schedule. Trying again…',false,true);setTimeout(doPush,10000)}
  }).then(function(){pushing=false;if(pushAgain){pushAgain=false;doPush()}});
}
function lockOut(msg){
  unlocked=false;anOK=false;staffPin='';try{sessionStorage.removeItem(UNLOCK_KEY);sessionStorage.removeItem(PIN_KEY)}catch(e){}
  setMode('coach');remoteRefresh(false);if(msg)toast(msg,false,true);
}
/* the library chips and settings that older saves don't have yet (added once) */
function postLoad(){
  /* the library gets a "Play 36 holes" chip (7:00am to 5:30pm when dropped at 7:00am) */
  if(!state.templates.some(function(t){return t.holes===36}))state.templates.push({cat:'course',title:'Play 36 holes',details:'',dur:630,zones:[],teeOff:30,holes:36});
  /* Cross sport events get the zone picker (turned on once; you can switch it off in Customize) */
  if(!state.crossZones){
    state.crossZones=true;
    var crossCat=state.categories.filter(function(c){return c.id==='cross'})[0];
    if(crossCat)crossCat.zones=true;
    save();
  }
  /* Athletic Recovery and Nutrition come back as event types with a library chip each (added once) */
  if(!state.seedRecNut){
    state.seedRecNut=true;
    [['Athletic Recovery','recovery','#1FA6A0',60],['Nutrition','nutrition','#8AA03A',45]].forEach(function(d){
      var cat=state.categories.filter(function(c){return String(c.name).trim().toLowerCase()===d[0].toLowerCase()})[0];
      if(!cat){cat={id:d[1],name:d[0],color:d[2],zones:false};state.categories.splice(Math.max(0,state.categories.length-1),0,cat)}
      if(!state.templates.some(function(t){return String(t.title).trim().toLowerCase()===d[0].toLowerCase()}))
        state.templates.push({cat:cat.id,title:d[0],details:'',dur:d[3],zones:[]});
    });
    save();
  }
}
/* swap in what the database holds */
function applyRemote(f,first){
  var prev=state&&state.active;
  applying=true;
  try{
    var st=SYNC.compose(f.rows,f.settings,f.priv,blankState());
    if(!st.sessions.length)st.sessions=blankState().sessions;
    st.active=prev;
    state=migrateState(st);
    if(!state.sessions.some(function(s){return s.id===state.active}))state.active=state.sessions[0].id;
    postLoad();
    SYNC.remember(f.rows,f.settings,f.priv,state);
  }finally{applying=false}
  remoteSig=SYNC.signature(f);remoteLoaded=true;pushBlocked=false;
  defaultWeek();
  if(first&&!unlocked)coachDefaultView();
  render();if(first)afterRender();
}
/* first time staff log in and the shared schedule is empty: offer to upload what this browser has */
function offerUpload(){
  var local=null;
  try{if(bootLocal){var o=JSON.parse(bootLocal);if(o&&o.sessions&&o.sessions.length)local=migrateState(o)}}catch(e){}
  applying=true;
  try{state=local||blankState();postLoad()}finally{applying=false}
  SYNC.remember([],null,null,state);
  remoteLoaded=true;remoteSig='';
  defaultWeek();render();
  if(local&&confirm('The shared schedule is empty.\n\nUpload the schedule saved in this browser so every coach sees it?')){
    pushBlocked=false;doPush();toast('Uploading this browser’s schedule to the shared database…');
  }else if(local){
    pushBlocked=true;toast('Not uploaded. Changes made here stay in this browser only.',false,true);
  }else{pushBlocked=false}
}
function remoteRefresh(first){
  var staff=unlocked&&!!staffPin;
  return (staff?SYNC.fetchAll(staffPin):SYNC.fetchPublic()).then(function(f){
    if(staff&&SYNC.isEmpty(f))offerUpload();
    else applyRemote(f,first);
  }).catch(function(e){
    if(staff&&e&&e.code==='28000'){lockOut('The staff PIN was changed. Please log in again.');return}
    pushBlocked=true;
    toast(staff?'Couldn’t reach the shared schedule. Showing this browser’s copy; changes will not be shared until you reload.':'Couldn’t reach the shared schedule. Showing the last copy on this device.',false,true);
  });
}
/* coaches pick up the staff's changes on their own, every 30 seconds and whenever the page comes back to the front */
function pollRemote(){
  if(unlocked||document.hidden||!SYNC.enabled)return;
  SYNC.fetchPublic().then(function(f){if(!unlocked&&SYNC.signature(f)!==remoteSig)applyRemote(f,false)}).catch(function(){});
}
setInterval(pollRemote,30000);
document.addEventListener('visibilitychange',pollRemote);
window.addEventListener('online',pollRemote);

load();
/* coaches never start from a browser copy or the sample: they wait for the shared schedule (staff keep their copy until it loads) */
if(!unlocked){applying=true;state=migrateState(blankState());applying=false}
postLoad();
defaultWeek();
if(!unlocked)coachDefaultView();
render();afterRender();
remoteRefresh(true);
try{if(sessionStorage.getItem(RANGE_KEY)==='1')openRange()}catch(e){}
window.__planner={get state(){return state},render:render};
})();

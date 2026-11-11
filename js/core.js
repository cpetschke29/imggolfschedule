/* Week Planner core: data model, migrations, trip calculation, Excel export. */
//<core>
function uid(){return Math.random().toString(36).slice(2,9)}
function clone(o){return JSON.parse(JSON.stringify(o))}
var DEFAULT_CATS=[
  {id:'practice',name:'Practice',color:'#4E9F3D',zones:true},
  {id:'course',name:'On course',color:'#1C8FA8',zones:true,trip:true},
  {id:'sc',name:'S&C',color:'#3D6FE0',zones:false},
  {id:'specialist',name:'Specialist',color:'#8E5BD0',zones:false},
  {id:'cross',name:'Cross sport',color:'#E08A1E',zones:true},
  {id:'other',name:'Other',color:'#6F7C8E',zones:false}
];
var DEFAULT_TAGS=[{name:'MENTAL',color:'#2E9CCA'},{name:'MP FLOAT',color:'#E5568C'},{name:'Putting Specialist',color:'#8E5BD0'},{name:'GEARS',color:'#2FA67A'}];
var DEFAULT_COURSES9=['IMGCC','Manatee','Pinebrook','Peridia'];
var DEFAULT_COURSES18=['IMGCC','Manatee','Pinebrook','Peridia','Heritage Harbour','Azario','Calusa','Rosedale'];
var SPEC_COLORS={'Putting Specialist':'#8E5BD0','GEARS':'#2FA67A'};
var DEFAULT_ZONES=['2','5','6','7','8','9','10','11','12','Functional'];
var DEFAULT_TEMPLATES=[
  {cat:'practice',title:'Practice',details:'',dur:150,zones:[]},
  {cat:'course',title:'Play 9 holes',details:'',dur:210,zones:[],teeOff:30,holes:9},
  {cat:'course',title:'Play 18 holes',details:'',dur:330,zones:[],teeOff:30,holes:18},
  {cat:'sc',title:'S&C',details:'',dur:60,zones:[]},
  {cat:'cross',title:'Cross Sport',details:'',dur:150,zones:[]}
];
function winFor(name){
  if(/^camp/i.test(name||''))return {s:480,e:1020};
  return /pm/i.test(name||'')?{s:750,e:1140}:{s:360,e:750};
}
function isCamp(s){return !!s&&(s.kind==='camp'||/^camp$/i.test(s.name||''))}
function guessCat(t){
  t=(t||'').toLowerCase();
  if(/s&c|strength/.test(t))return 'sc';
  if(/play \d+|holes|shotgun|\bbus\b|tee time|round/.test(t))return 'course';
  if(/cross sport/.test(t))return 'cross';
  if(/putting|gears|specialist|mental/.test(t))return 'specialist';
  if(/practice|warm up|range|short game/.test(t))return 'practice';
  return 'other';
}
function hslHex(h,s,l){
  s/=100;l/=100;var k=function(n){return (n+h/30)%12},a=s*Math.min(l,1-l);
  var f=function(n){var v=l-a*Math.max(-1,Math.min(k(n)-3,Math.min(9-k(n),1)));return Math.round(255*v).toString(16).padStart(2,'0')};
  return '#'+f(0)+f(8)+f(4);
}
var CHIP={'MENTAL':'#2E9CCA','MP FLOAT':'#E5568C','MENTAL PERFORMANCE FLOAT':'#E5568C','PUTTING SPECIALIST':'#8E5BD0','GEARS':'#2FA67A','TRAIN':'#FFDE55','COMPETE':'#6C8EF5','TOURNAMENT':'#E8833A'};
var PROGRAM_COLORS={};
function chipColor(t){
  var k=(t||'').trim().toUpperCase();
  if(!k)return '#9AA5B5';
  if(PROGRAM_COLORS[k])return PROGRAM_COLORS[k];
  if(CHIP[k])return CHIP[k];
  var h=0;for(var i=0;i<k.length;i++)h=(h*31+k.charCodeAt(i))%360;
  return hslHex(h,55,52);
}
function tagColorOf(st,name){
  var t=(st.tags||[]).filter(function(x){return x.name===name})[0];
  return t?t.color:chipColor(name);
}
function mkCard(title,details){return {id:uid(),cat:guessCat(title),title:title,details:details||'',zones:[]}}
function cellText(XLSX,ws,r,c){
  var x=ws[XLSX.utils.encode_cell({r:r-1,c:c-1})];
  if(!x||x.v==null)return '';
  return String(x.w!=null?x.w:x.v).replace(/\r/g,'').trim();
}
function blankTrips(nd){return {label:'Transportation trips',dates:Array(nd).fill(''),rows:[]}}
function toHHMM(m){return ('0'+Math.floor(m/60)).slice(-2)+':'+('0'+m%60).slice(-2)}
function fromHHMM(v){var p=String(v).split(':');return (+p[0])*60+(+p[1]||0)}
function snap(m){return Math.round(m/15)*15}
function fmtT(m,suf){var h=Math.floor(m/60),mi=m%60;return (h%12||12)+':'+('0'+mi).slice(-2)+(suf?(h<12?'am':'pm'):'')}
function fmtRange(s,e){var ps=s<720,pe=e<720;return fmtT(s,ps!==pe)+'–'+fmtT(e,true)}
function courseOf(c){
  if(c.course)return String(c.course).trim();
  if(c.holes)return 'Course TBD';
  var m=/\bat\s+(.+)$/i.exec(c.title||'');return (m?m[1]:(c.title||'')).trim();
}
function courseTitle(holes,course){return 'Play '+holes+' holes'+(course?' at '+course:'')}
function splitTrip(details,win){
  var out={lines:[],tee:null,teeLabel:'Tee time'};
  String(details||'').split('\n').map(function(x){return x.trim()}).filter(Boolean).forEach(function(l){
    var m;
    if(/^bus departs/i.test(l)||/^pick ?up/i.test(l))return;
    if((m=/^(tee times?|shotgun)\s*(?:at|:)?\s*(.+)$/i.exec(l))){
      var t=parseT(m[2],win);
      if(t!=null){out.tee=t;out.teeLabel=/shotgun/i.test(m[1])?'Shotgun':'Tee time';return}
    }
    out.lines.push(l);
  });
  return out;
}
function computeTrips(state,sess){
  var tc={};state.categories.forEach(function(c){if(c.trip)tc[c.id]=1});
  var days=[];
  for(var j=0;j<sess.days.length;j++){
    var groups={};
    sess.pods.forEach(function(p){
      var cell=p.cells[j];if(!cell)return;
      cell.cards.forEach(function(c){
        if(!tc[c.cat])return;
        var key=courseOf(c).toLowerCase()+'|'+c.start+'|'+c.end;
        var g=groups[key]||(groups[key]={course:courseOf(c),start:c.start,end:c.end,tees:[],label:'',ids:[],load:'',driver:'',pods:[]});
        g.ids.push(c.id);
        if(!g.driver&&c.driver)g.driver=c.driver;
        if(c.booked)g.booked=true;
        if(c.tee!=null&&g.tees.indexOf(c.tee)<0)g.tees.push(c.tee);
        if(!g.label&&c.tee!=null)g.label=c.teeLabel||'Tee time';
        if(!g.load&&c.load)g.load=c.load;
        if(g.pods.indexOf(p.name)<0)g.pods.push(p.name);
      });
    });
    days.push(Object.keys(groups).map(function(k){return groups[k]}).sort(function(a,b){return a.start-b.start||a.course.localeCompare(b.course)}));
  }
  return days;
}

/* ---- time helpers ---- */
var RNG=/(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*[–—-]\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i;
function parseT(str,win,after){
  var m=String(str).trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if(!m)return null;
  var h=+m[1],mi=+(m[2]||0),ap=(m[3]||'').toLowerCase();
  if(ap)return (h%12+(ap==='pm'?12:0))*60+mi;
  var c=[(h%12)*60+mi,(h%12+12)*60+mi];
  var ok=c.filter(function(x){return x>=win.s-30&&x<=win.e+30&&(after==null||x>=after)});
  if(ok.length)return ok[0];
  var any=c.filter(function(x){return after==null||x>=after});
  return (any.length?any:c)[0];
}
function parseRange(str,win){
  var m=RNG.exec(str);if(!m)return null;
  var s=parseT(m[1],win),e=parseT(m[2],win,s==null?null:s+1);
  if(s==null||e==null)return null;
  return {s:s,e:e};
}
function migrateCard(c,win){
  c.zones=c.zones||[];
  if(c.start!=null&&c.end!=null)return true;
  var title=c.title||'',ts=null,te=null,dep=null,pickStr=null;
  var m=RNG.exec(title);
  if(m){
    var r0=parseRange(m[0],win);
    if(r0){ts=r0.s;te=r0.e;title=(title.slice(0,m.index)+' '+title.slice(m.index+m[0].length)).replace(/\s+/g,' ').trim()}
  }
  var keep=[];
  String(c.details||'').split('\n').map(function(x){return x.trim()}).filter(Boolean).forEach(function(l){
    if(/^\(?\s*zones?\b/i.test(l)){
      (l.match(/\d+|functional/gi)||[]).forEach(function(z){
        z=/^\d/.test(z)?z:'Functional';
        if(c.zones.indexOf(z)<0)c.zones.push(z);
      });
      return;
    }
    if(RNG.test(l)&&l.replace(RNG,'').replace(/[^A-Za-z0-9]/g,'')===''){
      var r2=parseRange(l,win);
      if(r2){if(ts==null){ts=r2.s;te=r2.e}else te=r2.e;return}
    }
    var d=/bus departs at\s*(.+)$/i.exec(l);if(d)dep=parseT(d[1],win);
    var p=/pick ?up at\s*(.+)$/i.exec(l);if(p)pickStr=p[1];
    keep.push(l);
  });
  if(ts==null&&dep!=null&&pickStr!=null){ts=dep;te=parseT(pickStr,win,dep+1)}
  c.title=title||c.title;
  c.details=keep.join('\n');
  if(ts!=null){
    if(te==null||te<=ts)te=ts+60;
    c.start=ts;c.end=te;return true;
  }
  return false;
}
function migrateSession(s){
  var w=winFor(s.name);
  if(s.tStart==null)s.tStart=w.s;
  if(s.tEnd==null)s.tEnd=w.e;
  var win={s:s.tStart,e:s.tEnd};
  s.pods.forEach(function(p){p.cells.forEach(function(cell){
    var untimed=[],latest=win.s;
    cell.cards.forEach(function(c){
      if(migrateCard(c,win))latest=Math.max(latest,c.end);else untimed.push(c);
    });
    untimed.forEach(function(c){
      var st=Math.min(latest,win.e-60);
      c.start=Math.max(win.s,st);c.end=c.start+60;latest=c.end;
    });
  })});
}
function migrateTpl(t){
  t.zones=t.zones||[];
  if(t.dur!=null)return;
  var tmp={title:t.title,details:t.details,zones:t.zones};
  var ok=migrateCard(tmp,{s:360,e:1140});
  t.title=tmp.title;t.details=tmp.details;t.zones=tmp.zones;
  t.dur=ok?Math.max(15,tmp.end-tmp.start):60;
}
function migrateV2(st){
  st.v=2;
  st.tags=st.tags||clone(DEFAULT_TAGS);
  st.zones=st.zones||DEFAULT_ZONES.slice();
  st.coachLocked=!!st.coachLocked;
  st.categories=st.categories||clone(DEFAULT_CATS);
  st.categories.forEach(function(c){if(c.zones===undefined)c.zones=(c.id==='practice'||c.id==='course')});
  st.sessions.forEach(migrateSession);
  st.sessions.forEach(function(s){s.pods.forEach(function(p){p.cells.forEach(function(c){
    if(c.tag&&!st.tags.some(function(t){return t.name===c.tag}))st.tags.push({name:c.tag,color:chipColor(c.tag)});
  })})});
  if(st.templates)st.templates.forEach(migrateTpl);
  return st;
}
function migrateV3(st){
  st.v=3;
  st.zones=(st.zones||DEFAULT_ZONES).filter(function(z){return z!=='3'&&z!=='4'});
  st.tags=st.tags||[];
  Object.keys(SPEC_COLORS).forEach(function(n){if(!st.tags.some(function(t){return t.name===n}))st.tags.push({name:n,color:SPEC_COLORS[n]})});
  st.categories.forEach(function(c){if(c.trip===undefined)c.trip=(c.id==='course')});
  var tripCat=function(id){return !!(st.categories.filter(function(c){return c.id===id})[0]||{}).trip};
  var specOnly=function(title){
    var parts=String(title||'').split(/\s*[;&,]\s*/).filter(Boolean);
    return parts.length&&parts.every(function(x){return /^(putting specialist|gears)$/i.test(x)})?parts:null;
  };
  st.sessions.forEach(function(s){
    var win={s:s.tStart,e:s.tEnd};
    s.pods.forEach(function(p){p.cells.forEach(function(cell){
      var tags=(cell.tags||[]).slice();
      if(cell.tag){cell.tag.split(',').forEach(function(x){x=x.trim();if(x&&tags.indexOf(x)<0)tags.push(x)})}
      delete cell.tag;
      var keep=[];
      cell.cards.forEach(function(c){
        c.zones=(c.zones||[]).filter(function(z){return z!=='3'&&z!=='4'});
        var sp=specOnly(c.title);
        if(sp){sp.forEach(function(x){var n=/^gears$/i.test(x)?'GEARS':'Putting Specialist';if(tags.indexOf(n)<0)tags.push(n)});return}
        if(tripCat(c.cat)){
          var r=splitTrip(c.details,win);
          c.details=r.lines.join('\n');
          if(c.tee===undefined||c.tee===null){c.tee=r.tee;c.teeLabel=r.teeLabel}
          c.load=c.load||'';
        }
        keep.push(c);
      });
      cell.cards=keep;cell.tags=tags;
      tags.forEach(function(n){if(!st.tags.some(function(t){return t.name===n}))st.tags.push({name:n,color:chipColor(n)})});
    })});
    var rows=(s.trips&&s.trips.rows)||[];
    rows.forEach(function(r){r.cells.forEach(function(tc,j){
      if(!tc.load)return;
      var loc=(tc.loc||'').toLowerCase(),dep=tc.dep?parseT(tc.dep,win):null,cand=[];
      s.pods.forEach(function(p){var cell=p.cells[j];if(cell)cell.cards.forEach(function(c){if(tripCat(c.cat)&&courseOf(c).toLowerCase()===loc)cand.push(c)})});
      var pref=cand.filter(function(c){return dep!=null&&c.start===dep});
      (pref.length?pref:cand).forEach(function(c){if(!c.load)c.load=tc.load});
    })});
    if(s.trips)s.trips.rows=[];
  });
  st.templates=(st.templates||[]).filter(function(t){return !specOnly(t.title)});
  st.templates.forEach(function(t){
    t.zones=(t.zones||[]).filter(function(z){return z!=='3'&&z!=='4'});
    if(tripCat(t.cat)){
      var tmp={details:t.details},r=splitTrip(t.details,{s:360,e:1140});
      t.details=r.lines.join('\n');
      if(t.teeOff===undefined)t.teeOff=30;
    }
  });
  return st;
}
function fixCourseTemplates(st){
  var tc={};st.categories.forEach(function(c){if(c.trip)tc[c.id]=1});
  var ts=(st.templates||[]).filter(function(t){return !(tc[t.cat]&&(t.holes||/^play\s+\d+\s+holes?/i.test(t.title)))});
  var cat=st.categories.filter(function(c){return c.id==='course'})[0]?'course':(st.categories.filter(function(c){return c.trip})[0]||{}).id;
  if(cat){
    ts.push({cat:cat,title:'Play 9 holes',details:'',dur:210,zones:[],teeOff:30,holes:9});
    ts.push({cat:cat,title:'Play 18 holes',details:'',dur:330,zones:[],teeOff:30,holes:18});
  }
  var order=st.categories.map(function(c){return c.id});
  st.templates=ts.map(function(t,i){return {t:t,i:i}}).sort(function(a,b){return order.indexOf(a.t.cat)-order.indexOf(b.t.cat)||a.i-b.i}).map(function(x){return x.t});
}
function migrateV4(st){
  st.v=4;
  st.courses9=st.courses9||DEFAULT_COURSES9.slice();
  st.courses18=st.courses18||DEFAULT_COURSES18.slice();
  var tc={};st.categories.forEach(function(c){if(c.trip)tc[c.id]=1});
  st.sessions.forEach(function(s){s.pods.forEach(function(p){p.cells.forEach(function(cell){cell.cards.forEach(function(c){
    if(!tc[c.cat]||c.holes!==undefined)return;
    var m=/^play\s+(\d+)\s+holes?(?:\s+at\s+(.+))?$/i.exec(String(c.title||'').trim());
    if(m){c.holes=+m[1];c.course=(m[2]||'').trim()}else c.holes=0;
  })})})});
  fixCourseTemplates(st);
  return st;
}
function migrateV5(st){st.v=5;st.news=st.news||[];return st}
function migrateState(st){
  if(!(st.v>=2))migrateV2(st);
  if(!(st.v>=3))migrateV3(st);
  if(!(st.v>=4))migrateV4(st);
  if(!(st.v>=5))migrateV5(st);
  return st;
}

function parseSheet(XLSX,ws,sheetName){
  var ref=XLSX.utils.decode_range(ws['!ref']||'A1:A1');
  var maxR=ref.e.r+1,maxC=ref.e.c+1;
  var T=function(r,c){return cellText(XLSX,ws,r,c)};
  var hdr=0,r,c,d;
  for(r=1;r<=maxR;r++){if(/^coach/i.test(T(r,1))){hdr=r;break}}
  if(!hdr)return null;
  var title='';
  for(r=1;r<hdr-1;r++){if(T(r,1)){title=T(r,1);break}}
  var nd=0;
  for(c=3;c<=maxC;c++){if(T(hdr,c))nd=c-2}
  if(!nd)nd=5;
  var days=[];
  for(d=0;d<nd;d++)days.push({name:T(hdr,3+d),theme:T(hdr-1,3+d)});
  var transRow=maxR+1;
  for(r=hdr+1;r<=maxR;r++){if(/^transport/i.test(T(r,1))){transRow=r;break}}
  var starts=[];
  for(r=hdr+1;r<transRow;r++){
    var a=T(r,1);
    if(a&&!/^(m|tu|w|th|f|notes):?$/i.test(a))starts.push(r);
  }
  var pods=starts.map(function(r0,k){
    var rEnd=k+1<starts.length?starts[k+1]-1:transRow-1;
    var parts=T(r0,1).split('\n');
    var pod={id:uid(),name:parts[0].trim(),players:parts.slice(1).join('\n').trim(),program:T(r0,2),cells:[]};
    for(var d=0;d<nd;d++){
      var col=3+d,tag='',weather='',cards=[],main=null;
      for(var rr=r0;rr<=rEnd;rr++){
        var o=rr-r0,t=T(rr,col);
        if(!t)continue;
        if(o===0){tag=t;continue}
        var wm=t.match(/^weather safety:?\s*(.*)$/i);
        if(wm){weather=wm[1];continue}
        if(o>=2&&o<=5){
          if(!main){main=mkCard(t,'');cards.push(main)}
          else main.details+=(main.details?'\n':'')+t;
          continue;
        }
        cards.push(mkCard(t,''));
      }
      pod.cells.push({tag:tag,weather:weather,cards:cards});
    }
    return pod;
  });
  var trips=blankTrips(nd);
  if(transRow<=maxR){
    trips.label=T(transRow,1)||trips.label;
    for(d=0;d<nd;d++)trips.dates[d]=T(transRow,3+d);
    var ts=[];
    for(r=transRow+1;r<=maxR;r++){if(T(r,1))ts.push(r)}
    ts.forEach(function(r0,k){
      var rEnd=k+1<ts.length?ts[k+1]-1:maxR;
      var row={label:T(r0,1),tag:T(r0,2),cells:[]};
      for(var d=0;d<nd;d++){
        var cell={loc:'',load:'',dep:'',tee:'',teeLabel:'Tee Time',pick:''},lines=[];
        for(var rr=r0;rr<=rEnd;rr++){var t=T(rr,3+d);if(t)lines.push(t)}
        if(lines.length){
          cell.loc=lines[0];
          lines.slice(1).forEach(function(t){
            var m;
            if((m=t.match(/^departure\s*:?\s*(.*)$/i)))cell.dep=m[1];
            else if((m=t.match(/^(tee times?)\s*:?\s*(.*)$/i))){cell.tee=m[2];cell.teeLabel=/times/i.test(m[1])?'Tee Times':'Tee Time'}
            else if((m=t.match(/^pick ?up\s*:?\s*(.*)$/i)))cell.pick=m[1];
            else cell.load+=(cell.load?', ':'')+t;
          });
        }
        row.cells.push(cell);
      }
      trips.rows.push(row);
    });
  }
  return {id:uid(),name:sheetName.replace(/\s*schedule$/i,'').trim()||sheetName,title:title||sheetName,days:days,pods:pods,trips:trips};
}
function deriveTemplates(sessions){
  var seen=new Map();
  sessions.forEach(function(s){s.pods.forEach(function(p){p.cells.forEach(function(c){c.cards.forEach(function(cd){
    var k=cd.title.toLowerCase().trim();
    if(k&&!seen.has(k))seen.set(k,{cat:cd.cat,title:cd.title,details:cd.details,dur:Math.max(15,cd.end-cd.start),zones:[],teeOff:cd.tee!=null?cd.tee-cd.start:null});
  })})})});
  var order=DEFAULT_CATS.map(function(c){return c.id});
  return Array.from(seen.values()).sort(function(a,b){return order.indexOf(a.cat)-order.indexOf(b.cat)}).slice(0,24);
}
function parseWorkbook(XLSX,wb){
  if(wb.SheetNames.indexOf('_app_data')>=0){
    var ws=wb.Sheets['_app_data'],txt='';
    for(var r=1;;r++){var t=cellText(XLSX,ws,r,1);if(!t)break;txt+=t}
    try{
      var st=JSON.parse(txt);
      if(st&&st.sessions&&st.sessions.length){migrateState(st);st.fromApp=true;return st}
    }catch(e){}
  }
  var sessions=[];
  wb.SheetNames.forEach(function(n){
    if(n.charAt(0)==='_')return;
    var s=parseSheet(XLSX,wb.Sheets[n],n);
    if(s)sessions.push(s);
  });
  if(!sessions.length)return null;
  var st2={categories:clone(DEFAULT_CATS),sessions:sessions,active:sessions[0].id};
  migrateState(st2);
  st2.templates=deriveTemplates(st2.sessions);
  fixCourseTemplates(st2);
  return st2;
}

/* ---- export ---- */
function lighten(hex,amt){
  var n=parseInt(hex.replace('#',''),16),r=n>>16,g=(n>>8)&255,b=n&255;
  var m=function(v){return Math.round(v+(255-v)*amt)};
  return [m(r),m(g),m(b)].map(function(x){return x.toString(16).padStart(2,'0')}).join('').toUpperCase();
}
function xT(m){var h=Math.floor(m/60),mi=m%60;return (h%12||12)+':'+('0'+mi).slice(-2)}
function xZones(z,order){
  z=(z||[]).slice().sort(function(a,b){return order.indexOf(a)-order.indexOf(b)});
  var nums=z.filter(function(x){return /^\d+$/.test(x)}),oth=z.filter(function(x){return !/^\d+$/.test(x)});
  var parts=[];
  if(nums.length)parts.push('Zone '+(nums.length>1?nums.slice(0,-1).join(', ')+' & '+nums[nums.length-1]:nums[0]));
  return parts.concat(oth).join(', ');
}
function buildWorkbook(XLSX,state,opts){
  opts=opts||{};
  var wb={SheetNames:[],Sheets:{}},used={};
  var stamp=state.updatedAt?'Updated '+new Date(state.updatedAt).toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}):'';
  var catOf=function(id){return state.categories.filter(function(c){return c.id===id})[0]||{color:'#6F7C8E'}};
  var thin={style:'thin',color:{rgb:'FFD3D9E3'}},bd={top:thin,bottom:thin,left:thin,right:thin};
  var NAVY='0A2A55';
  /* "#fce4d6" from a pasted pod color becomes "FCE4D6" */
  var hexOf=function(c){var m=/^#?([0-9a-f]{6})$/i.exec(String(c||'').trim());return m?m[1].toUpperCase():''};
  var BT_FILL={'Full Swing':'CDE2FA','Short Game':'FFDFC0','Putting':'D3EDC9','WIB':'FBCFDF'};
  var S=function(fill,o){
    o=o||{};
    var s={font:{name:'Calibri',sz:o.sz||10,bold:!!o.b,color:{rgb:'FF'+(o.color||'172337')}},
      alignment:{wrapText:true,vertical:o.v||'top',horizontal:o.h||'left'},border:bd};
    if(fill)s.fill={patternType:'solid',fgColor:{rgb:'FF'+fill}};
    return s;
  };
  var makeSheet=function(sess,mo){
    mo=mo||{};
    var ws={},merges=[],maxR=0,nd=sess.days.length,lastC=2+nd;
    var put=function(r,c,v,s){ws[XLSX.utils.encode_cell({r:r-1,c:c-1})]={v:v==null?'':String(v),t:'s',s:s};if(r>maxR)maxR=r};
    var merge=function(r1,c1,r2,c2){if(r1!==r2||c1!==c2)merges.push({s:{r:r1-1,c:c1-1},e:{r:r2-1,c:c2-1}})};
    if(stamp){put(1,1,stamp,S(null,{sz:8,color:'8A94A6',h:'right'}));merge(1,1,1,lastC)}
    put(2,1,sess.title,{b:1,sz:14,v:'center'});merge(2,1,2,lastC);
    put(4,1,'Pods',S('E9EEF6',{b:1,color:NAVY}));put(4,2,'Train / Comp',S('E9EEF6',{b:1,color:NAVY}));
    put(5,1,'Coach / Players',S(NAVY,{b:1,color:'FFFFFF'}));put(5,2,'Program',S(NAVY,{b:1,color:'FFFFFF'}));
    sess.days.forEach(function(d,i){put(4,3+i,d.theme,S('E9EEF6',{b:1,color:NAVY,h:'center'}));put(5,3+i,d.name,S(NAVY,{b:1,sz:11,color:'FFFFFF',h:'center',v:'center'}))});
    var r=6;
    sess.pods.forEach(function(p){
      var linesOf=function(cell){
        var out=[];
        cell.cards.slice().sort(function(a,b){return a.start-b.start}).forEach(function(cd){
          out.push({t:cd.title,cat:cd.cat});
          if(cd.start!=null)out.push({t:xT(cd.start)+'–'+xT(cd.end),cat:cd.cat});
          if(cd.segments&&cd.segments.length){
            cd.segments.forEach(function(g){
              var gz=xZones(g.zones,state.zones||[]);
              out.push({t:xT(g.start)+'–'+xT(g.end)+(gz?' ('+gz+')':''),cat:cd.cat});
            });
          }else{
            var z=xZones(cd.zones,state.zones||[]);
            if(z)out.push({t:'('+z+')',cat:cd.cat});
          }
          String(cd.details||'').split('\n').forEach(function(l){if(l.trim())out.push({t:l.trim(),cat:cd.cat})});
        });
        return out;
      };
      var mx=0;p.cells.forEach(function(c){mx=Math.max(mx,linesOf(c).length)});
      var content=Math.max(8,mx),h=content+2,r0=r;
      for(var rr=r0;rr<r0+h;rr++){for(var cc=1;cc<=lastC;cc++)put(rr,cc,'',S(null))}
      put(r0,1,p.name+(p.players?'\n'+p.players:''),S(hexOf(p.color)||'F9FBFE',{b:1,sz:11}));merge(r0,1,Math.min(r0+2,r0+h-1),1);
      put(r0,2,p.program,S(lighten(chipColor(p.program),/^train$/i.test(p.program||'')?0:0.55),{b:1,h:'center',v:'center'}));merge(r0,2,r0+h-1,2);
      p.cells.forEach(function(cell,j){
        var col=3+j;
        if(cell.tags&&cell.tags.length)put(r0,col,cell.tags.join(', '),S(lighten(tagColorOf(state,cell.tags[0]),0.6),{b:1,h:'center'}));
        var q=r0+1;
        linesOf(cell).forEach(function(l){put(q++,col,l.t,S(lighten(catOf(l.cat).color,0.82)))});
        if(cell.weather)put(r0+h-1,col,'Weather safety: '+cell.weather,S('F7FCFF',{color:'5D6B80',sz:9}));
      });
      r=r0+h;
    });
    var tr=r+2,t=sess.trips,tdays=computeTrips(state,sess);
    put(tr,1,t.label,S(NAVY,{b:1,color:'FFFFFF'}));put(tr,2,'',S(NAVY));
    t.dates.forEach(function(d,i){put(tr,3+i,d,S(NAVY,{b:1,color:'FFFFFF',h:'center'}))});
    var nt=0;tdays.forEach(function(d){nt=Math.max(nt,d.length)});
    for(var k=0;k<nt;k++){
      var b=tr+1+k*5;
      for(var rr=b;rr<b+5;rr++){for(var cc=1;cc<=lastC;cc++)put(rr,cc,'',S(null))}
      put(b,1,'Trip '+(k+1),S('F9FBFE',{b:1}));merge(b,1,b+4,1);
      put(b,2,sess.name,S('F9FBFE',{b:1,h:'center',v:'center'}));merge(b,2,b+4,2);
      tdays.forEach(function(d,j){
        var g=d[k];if(!g)return;
        var tees=g.tees.slice().sort(function(a,c){return a-c}).map(function(x){return fmtT(x,true)}).join(' / ');
        var dv=g.driver?(state.drivers||[]).filter(function(x){return x.name===g.driver})[0]:null;
        var dtxt=g.driver?'Driver: '+g.driver+(dv&&dv.phone?' '+dv.phone:''):'';
        var ls=[g.course,[g.load,dtxt].filter(Boolean).join(' | '),'Departure: '+fmtT(g.start,true),tees?(g.label==='Shotgun'?'Shotgun: ':'Tee Time: ')+tees:'','Pick Up: '+fmtT(g.end,true)];
        ls.forEach(function(l,i){put(b+i,3+j,l,S(i===0?'F0F8E7':null,{b:i===0}))});
      });
    }
    var wkm=/week of\s*([\d\/\.\-]+)/i.exec(sess.title||''),wkk=wkm?wkm[1]:'No week label';
    var nitems=(state.news||[]).filter(function(n){return n.week===wkk});
    if(nitems.length&&mo.news!==false){
      var nr=tr+2+nt*5;
      put(nr,1,'News & PTO',S(NAVY,{b:1,color:'FFFFFF'}));merge(nr,1,nr,lastC);
      nitems.forEach(function(it,k){
        var txt;
        if(it.kind==='pto'){
          var idx=(it.days&&it.days.length)?it.days:sess.days.map(function(d,i){return i});
          var hf=it.half||{},anyH=idx.some(function(i){return hf[i]});
          txt='PTO: '+it.coach+' out '+(idx.length===sess.days.length&&!anyH?'all week':idx.map(function(i){return (sess.days[i]||{name:''}).name.slice(0,3)+(hf[i]?' ('+hf[i]+' only)':'')}).join(', '))+(it.text?' - '+it.text:'');
        }else txt='News ('+['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'][it.day||0]+'): '+it.text;
        put(nr+1+k,1,txt,S(k%2?null:'F9FBFE'));merge(nr+1+k,1,nr+1+k,lastC);
      });
    }
    if(isCamp(sess)){
      /* camper roster and Breakthroughs */
      var X0=opts.btx?opts.btx(sess):null,cr=maxR+2;
      var nmKey=function(n){return String(n||'').replace(/\(.*?\)/g,' ').replace(/\s+/g,' ').trim().toLowerCase()};
      put(cr,1,'Campers',S(NAVY,{b:1,sz:12,color:'FFFFFF'}));merge(cr,1,cr,lastC);
      sess.pods.forEach(function(p){
        var cl=p.campers||[];
        if(!cl.length)return;
        cr++;put(cr,1,p.name+'  ('+cl.length+')',S(hexOf(p.color)||'E7E9EE',{b:1,sz:11}));merge(cr,1,cr,lastC);
        /* a group with several coaches is listed coach by coach, like the Campers tab */
        var pn=String(p.name||'').replace(/\(.*?\)/g,' ').split(/\s*(?:&|,|\band\b)\s*/i).map(function(x){return x.trim()}).filter(Boolean);
        var secs=[];
        if(pn.length>1){
          var un=cl.filter(function(c){return !String(c.coach||'').trim()});
          if(un.length)secs.push({n:'Unassigned',list:un});
          pn.forEach(function(n){secs.push({n:n,list:cl.filter(function(c){return nmKey(c.coach)===nmKey(n)})})});
          cl.forEach(function(c){var k=nmKey(c.coach);if(k&&!pn.some(function(n){return nmKey(n)===k})&&!secs.some(function(x){return nmKey(x.n)===k}))secs.push({n:c.coach,list:cl.filter(function(d){return nmKey(d.coach)===k})})});
        }else secs.push({n:'',list:cl});
        secs.forEach(function(sec){
          if(!sec.list.length)return;
          if(sec.n){cr++;put(cr,1,sec.n.toUpperCase()+'  ('+sec.list.length+')',S('E9EEF6',{b:1,color:NAVY}));merge(cr,1,cr,lastC)}
          cr++;
          [['Name',1],['Package',2],['Opp. # · M/F · Age',3],['Arrival',4],['Departure',5],['Country · Scoring · Notes',6],['E-mail · Opp. owner',7]].forEach(function(h){if(h[1]<=lastC)put(cr,h[1],h[0],S(NAVY,{b:1,color:'FFFFFF',sz:9}))});
          sec.list.forEach(function(c,ci){
            cr++;
            var wkn=X0&&c.name?X0.week(String(c.name).trim()):1,band=ci%2?'F6F8FB':null;
            put(cr,1,(c.name||'')+(wkn>1?' (Wk '+wkn+')':''),S(band,{b:1,color:c.vip?'C62020':'172337'}));
            put(cr,2,c.pkgFull||c.pkg||'',S(band));
            if(lastC>=3)put(cr,3,[c.opp,c.mf,c.age].filter(Boolean).join(' · '),S(band));
            if(lastC>=4)put(cr,4,c.arrival||'',S(band));
            if(lastC>=5)put(cr,5,c.departure||'',S(band));
            if(lastC>=6)put(cr,6,[c.country,c.scoring,c.note].filter(Boolean).join(' · '),S(band));
            if(lastC>=7)put(cr,7,[c.email,c.owner].filter(Boolean).join(' · '),S(band));
          });
        });
        cr++;
      });
      /* a Holiday or Summer camp has its own Breakthroughs sheet; other camps keep the simple list */
      if(!(sess.season&&opts.btx)){
        var bts=(sess.bt||[]).filter(function(r){return r&&r.start!=null});
        cr+=1;put(cr,1,'Breakthroughs',S(NAVY,{b:1,sz:12,color:'FFFFFF'}));merge(cr,1,cr,lastC);
        cr++;
        [['Student',1],['Day',2],['Time',3],['Coach',4],['Session',5]].forEach(function(h){if(h[1]<=lastC)put(cr,h[1],h[0],S(NAVY,{b:1,color:'FFFFFF',sz:9}))});
        if(!bts.length){cr++;put(cr,1,'None scheduled',S(null,{color:'8A94A6'}));merge(cr,1,cr,lastC)}
        bts.slice().sort(function(a,b){return (+a.day)-(+b.day)||a.start-b.start}).forEach(function(r){
          cr++;
          var dn=(sess.days[+r.day]||{name:''}).name;
          put(cr,1,r.student||'',S(null,{b:1}));put(cr,2,dn,S(null));
          if(lastC>=3)put(cr,3,xT(r.start)+'–'+xT(r.end),S(null));
          if(lastC>=4)put(cr,4,r.coach||'',S(null));
          if(lastC>=5)put(cr,5,r.session==='WIB'?'WITB':(r.session||''),S(null));
        });
      }
    }
    ws['!ref']=XLSX.utils.encode_range({s:{r:0,c:0},e:{r:Math.max(maxR,5)-1,c:lastC-1}});
    ws['!merges']=merges;
    ws['!cols']=[{wch:30},{wch:13}].concat(Array(nd).fill({wch:29}));
    return {ws:ws,maxR:maxR,lastC:lastC,nd:nd};
  };
  /* the Breakthroughs board for a Holiday or Summer camp: a block per day, coaches across, time slots down, WITB with Mike beside it */
  var makeBTSheet=function(sess,X){
    var ws={},merges=[],maxR=0,maxC=0,rows=[];
    var coaches=X.coaches,nc=coaches.length,w1=nc+3,lastC=nc+5;
    var put=function(r,c,v,s){ws[XLSX.utils.encode_cell({r:r-1,c:c-1})]={v:v==null?'':String(v),t:'s',s:s};if(r>maxR)maxR=r;if(c>maxC)maxC=c};
    var merge=function(r1,c1,r2,c2){if(r1!==r2||c1!==c2)merges.push({s:{r:r1-1,c:c1-1},e:{r:r2-1,c:c2-1}})};
    var bt=(sess.bt||[]).filter(function(r){return r&&r.start!=null});
    var low=function(x){return String(x||'').replace(/\(.*?\)/g,' ').replace(/\s+/g,' ').trim().toLowerCase()};
    put(1,1,sess.title||'Breakthroughs',{b:1,sz:14,v:'center'});merge(1,1,1,lastC-1);
    if(stamp)put(1,lastC,stamp,S(null,{sz:8,color:'8A94A6',h:'right'}));
    var leg=[['Full Swing','CDE2FA','172337'],['Short Game','FFDFC0','172337'],['Putting','D3EDC9','172337'],['WITB (Mike)','FBCFDF','172337'],['Coach busy','6B7686','FFFFFF'],['Time off','D5DAE1','172337']];
    leg.forEach(function(l,i){put(2,2+i,l[0],S(l[1],{b:1,h:'center',color:l[2],sz:9}))});
    var r=4;
    sess.days.forEach(function(d,j){
      put(r,1,X.day(j),S(NAVY,{b:1,sz:12,color:'FFFFFF',v:'center'}));merge(r,1,r,lastC);
      for(var c=2;c<=lastC;c++)put(r,c,'',S(NAVY));
      rows[r-1]=24;
      put(r+1,1,'',S('E9EEF6'));
      coaches.forEach(function(n,i){put(r+1,2+i,n,S('E9EEF6',{b:1,h:'center',color:NAVY}))});
      put(r+1,w1,'WITB with Mike',S('E9EEF6',{b:1,h:'center',color:NAVY}));put(r+1,w1+1,'',S('E9EEF6'));merge(r+1,w1,r+1,w1+1);
      put(r+1,w1+2,'Last BT coach',S('E9EEF6',{b:1,h:'center',color:NAVY}));
      var wt=X.witb(j),n=Math.max(X.slots.length,wt.length);
      for(var i=0;i<n;i++){
        var rr=r+2+i;rows[rr-1]=26;
        var t=X.slots[i];
        if(t!=null){
          put(rr,1,fmtT(t,true),S('F9FBFE',{b:1,h:'right',v:'center'}));
          coaches.forEach(function(cn,ci){
            var key=low(cn),bks=bt.filter(function(b){return b.session!=='WIB'&&+b.day===j&&low(b.coach)===key&&X.slotFor(X.slots,b.start)===t});
            if(bks.length){
              var b0=bks[0];
              put(rr,2+ci,bks.map(function(b){return X.name(b.student)}).join('\n'),S(BT_FILL[b0.session]||'E8ECF2',{h:'center',v:'center',b:1,color:X.vip(b0.student)?'C62020':'172337'}));
            }else if(X.off(j,cn,t))put(rr,2+ci,'',S('D5DAE1'));
            else if(X.busy(j,cn,t))put(rr,2+ci,'',S('6B7686'));
            else put(rr,2+ci,'',S(null));
          });
        }
        var wtm=wt[i];
        if(wtm!=null){
          put(rr,w1-1,'',S(null,{sz:8}));
          var it=bt.filter(function(b){return b.session==='WIB'&&+b.day===j&&b.start===wtm});
          put(rr,w1,fmtT(wtm,true)+(it.length?'':''),S('F9FBFE',{b:1,h:'right',v:'center',sz:9}));
          put(rr,w1+1,it.map(function(b){return X.name(b.student)}).join('\n'),S(it.length?BT_FILL.WIB:null,{h:'center',v:'center',b:1,color:it.length&&X.vip(it[0].student)?'C62020':'172337'}));
          put(rr,w1+2,it.map(function(b){return X.prev(b.student)}).filter(Boolean).join(', '),S(null,{h:'center',v:'center',sz:9}));
        }
      }
      r=r+2+n+1;
    });
    ws['!ref']=XLSX.utils.encode_range({s:{r:0,c:0},e:{r:Math.max(maxR,5)-1,c:Math.max(maxC,lastC)-1}});
    ws['!merges']=merges;
    ws['!cols']=[{wch:11}].concat(coaches.map(function(){return {wch:21}})).concat([{wch:3},{wch:9},{wch:27},{wch:16}]);
    ws['!rows']=rows.map(function(h){return h?{hpt:h}:undefined});
    return ws;
  };
  var uniqueName=function(raw){
    var nm=String(raw).replace(/[:\\\/?*\[\]]/g,'').slice(0,31)||'Sheet',base=nm,n=2;
    while(used[nm.toLowerCase()]){nm=base.slice(0,28)+' '+(n++)}
    used[nm.toLowerCase()]=1;return nm;
  };
  /* coach copy: one sheet per coach with their AM, PM and Camp stacked, and no hidden data sheet */
  if(opts.coach){
    var coachNames=function(p){return String(p.name||'').replace(/\(.*?\)/g,' ').split(/\s*(?:&|,|\band\b)\s*/i).map(function(x){return x.trim()}).filter(Boolean)};
    var low=function(x){return String(x||'').trim().toLowerCase()};
    var names=[];
    state.sessions.forEach(function(s){s.pods.forEach(function(p){coachNames(p).forEach(function(n){if(!names.some(function(y){return low(y)===low(n)}))names.push(n)})})});
    names.sort();
    if(opts.only)names=names.filter(function(n){return low(n)===low(opts.only)});
    names.forEach(function(name){
      var blocks=[];
      state.sessions.forEach(function(s){
        var ps=s.pods.filter(function(p){return coachNames(p).some(function(n){return low(n)===low(name)})});
        if(!ps.length)return;
        var pseudo=Object.assign({},s,{pods:ps});
        if(isCamp(s))pseudo.bt=(s.bt||[]).filter(function(r){return low(r.coach)===low(name)});
        blocks.push(pseudo);
      });
      if(!blocks.length)return;
      var out={},merges=[],off=0,maxC=0,rowEnd=0;
      blocks.forEach(function(pseudo,bi){
        var b=makeSheet(pseudo,{news:bi===blocks.length-1});
        Object.keys(b.ws).forEach(function(k){
          if(k.charAt(0)==='!')return;
          var a=XLSX.utils.decode_cell(k);a.r+=off;out[XLSX.utils.encode_cell(a)]=b.ws[k];
        });
        (b.ws['!merges']||[]).forEach(function(m){merges.push({s:{r:m.s.r+off,c:m.s.c},e:{r:m.e.r+off,c:m.e.c}})});
        maxC=Math.max(maxC,b.lastC);rowEnd=off+Math.max(b.maxR,5);
        off+=b.maxR+2;
      });
      out['!ref']=XLSX.utils.encode_range({s:{r:0,c:0},e:{r:rowEnd-1,c:maxC-1}});
      out['!merges']=merges;
      out['!cols']=[{wch:30},{wch:13}].concat(Array(maxC-2).fill({wch:29}));
      var nm=uniqueName(name);
      wb.SheetNames.push(nm);wb.Sheets[nm]=out;
    });
    wb.Workbook={Sheets:wb.SheetNames.map(function(){return {Hidden:0}})};
    return wb;
  }
  state.sessions.forEach(function(sess){
    var b=makeSheet(sess),nm=uniqueName(sess.name+' Schedule');
    wb.SheetNames.push(nm);wb.Sheets[nm]=b.ws;
    if(isCamp(sess)&&sess.season&&opts.btx){
      var bn=uniqueName(sess.name+' Breakthroughs');
      wb.SheetNames.push(bn);wb.Sheets[bn]=makeBTSheet(sess,opts.btx(sess));
    }
  });
  var json=JSON.stringify({v:5,news:state.news||[],courses9:state.courses9,courses18:state.courses18,categories:state.categories,tags:state.tags,zones:state.zones,coachLocked:state.coachLocked,templates:state.templates,sessions:state.sessions,active:state.active});
  var ds={},i=0;
  for(var p=0;p<json.length;p+=30000){ds['A'+(++i)]={v:json.slice(p,p+30000),t:'s'}}
  ds['!ref']='A1:A'+Math.max(i,1);
  wb.SheetNames.push('_app_data');wb.Sheets['_app_data']=ds;
  wb.Workbook={Sheets:wb.SheetNames.map(function(n){return {Hidden:n==='_app_data'?1:0}})};
  return wb;
}
//</core>

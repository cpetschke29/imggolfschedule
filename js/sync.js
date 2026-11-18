/* Week Planner sync: talks to Supabase over plain REST (no library needed).
   Coaches read published weeks with the public key. Staff save through PIN-checked functions. */
(function(){
var CFG={
  url:'https://dnjqtbnjpdpvydkbjxja.supabase.co',
  key:'sb_publishable_53E9xFSAwZtVkmoyldXY_A_SCAX6MVq'   /* public (publishable) key: safe in page code. Never put a secret/service key here. */
};
/* state keys that live in a week row, in the settings row, or in the staff-only row; anything else not listed is local-only */
var WEEK_KEYS=['sessions','news','coverage','trav','rangeHours','published','publishedRange'];
var PRIVATE_KEYS=['analyticsPin','tee','extraTrips','transMode'];   /* staff-only: coaches never download these */
var LOCAL_KEYS=['active','updatedAt','fromApp'];

function clone(o){return JSON.parse(JSON.stringify(o))}
function req(method,path,body){
  var h={apikey:CFG.key,'Content-Type':'application/json'};
  return fetch(CFG.url+path,{method:method,headers:h,body:body===undefined?undefined:JSON.stringify(body)}).then(function(r){
    return r.text().then(function(t){
      var j=null;try{j=t?JSON.parse(t):null}catch(e){}
      if(!r.ok){var err=new Error((j&&j.message)||('HTTP '+r.status));err.code=(j&&j.code)||String(r.status);throw err}
      return j;
    });
  });
}
function rpc(name,args){return req('POST','/rest/v1/rpc/'+name,args)}

function weekKeyOf(sess){var m=/week of\s*([\d\/\.\-]+)/i.exec(sess.title||'');return m?m[1]:'No week label'}
function weekStartIso(wk){
  var m=/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(wk);if(!m)return null;
  var y=+m[3];if(y<100)y+=2000;
  return y+'-'+('0'+m[1]).slice(-2)+'-'+('0'+m[2]).slice(-2);
}

/* Camper details: only these stay in the public schedule. Everything else about a camper lives in camper_private
   and is sent only to staff, or to a coach who enters the 4-digit camper code. */
var CAMP_PUBLIC=['id','name','coach','pkg','pkgFull'];
function eachCamper(sessions,fn){(sessions||[]).forEach(function(s){(s.pods||[]).forEach(function(p){(p.campers||[]).forEach(function(c){fn(c,s)})})})}
function ensureCamperIds(st){eachCamper(st.sessions,function(c){if(!c.id)c.id=Math.random().toString(36).slice(2,9)})}
function hasPrivateFields(sessions){
  var bad=false;
  eachCamper(sessions,function(c){Object.keys(c).forEach(function(k){if(CAMP_PUBLIC.indexOf(k)<0)bad=true})});
  return bad;
}
/* returns the session without private camper fields, and the removed fields keyed by camper id */
function splitCampers(s,priv){
  var has=false;
  (s.pods||[]).forEach(function(p){if(p.campers&&p.campers.length)has=true});
  if(!has)return s;
  var out=clone(s);
  (out.pods||[]).forEach(function(p){(p.campers||[]).forEach(function(c){
    var mine={};
    Object.keys(c).forEach(function(k){
      if(CAMP_PUBLIC.indexOf(k)>=0)return;
      if(c[k]!==''&&c[k]!==false&&c[k]!=null)mine[k]=c[k];
      delete c[k];
    });
    if(Object.keys(mine).length)priv[c.id]=mine;
  })});
  return out;
}
function mergeCampers(st,map){
  if(!map)return;
  (st.sessions||[]).forEach(function(s){
    var m=map[weekKeyOf(s)];if(!m)return;
    (s.pods||[]).forEach(function(p){(p.campers||[]).forEach(function(c){if(m[c.id])Object.assign(c,m[c.id])})});
  });
}
function hash(str){var h=5381;for(var i=0;i<str.length;i++)h=((h<<5)+h+str.charCodeAt(i))|0;return String(h)}

/* rows from the database -> the single state object the app already understands */
function compose(rows,settingsRow,privateRow,base,campers){
  var st=Object.assign(clone(base),clone((settingsRow&&settingsRow.data)||{}));
  st.sessions=[];st.news=[];st.coverage=[];st.trav=[];st.rangeHours={};st.published={};st.publishedRange={};
  var latest=0;
  (rows||[]).forEach(function(r){
    st.sessions=st.sessions.concat(clone(r.sessions||[]));
    st.news=st.news.concat(r.news||[]);
    st.coverage=st.coverage.concat(r.coverage||[]);
    st.trav=st.trav.concat(r.trav||[]);
    if(r.range_hours)st.rangeHours[r.week_key]=r.range_hours;
    if(r.published)st.published[r.week_key]=true;
    if(r.published_range)st.publishedRange[r.week_key]=true;
    var t=Date.parse(r.updated_at);if(t>latest)latest=t;
  });
  var pd=(privateRow&&privateRow.data)||{};
  PRIVATE_KEYS.forEach(function(k){if(pd[k]!==undefined)st[k]=pd[k]});
  mergeCampers(st,campers);
  if(latest)st.updatedAt=latest;
  return st;
}

/* the single state object -> what each table stores */
function decompose(st){
  var weeks={},camp={};
  function w(k){return weeks[k]||(weeks[k]={week_key:k,sessions:[],news:[],coverage:[],trav:[],range_hours:null,published:false,published_range:false})}
  ensureCamperIds(st);
  (st.sessions||[]).forEach(function(s){
    var k=weekKeyOf(s),priv={};
    w(k).sessions.push(splitCampers(s,priv));
    camp[k]=Object.assign(camp[k]||{},priv);
  });
  (st.news||[]).forEach(function(n){w(n.week||'No week label').news.push(n)});
  (st.coverage||[]).forEach(function(n){w(n.week||'No week label').coverage.push(n)});
  (st.trav||[]).forEach(function(n){w(n.week||'No week label').trav.push(n)});
  Object.keys(st.rangeHours||{}).forEach(function(k){if(weeks[k])weeks[k].range_hours=st.rangeHours[k]});
  Object.keys(st.published||{}).forEach(function(k){if(st.published[k]&&weeks[k])weeks[k].published=true});
  Object.keys(st.publishedRange||{}).forEach(function(k){if(st.publishedRange[k]&&weeks[k])weeks[k].published_range=true});
  var settings={},priv={},skip=WEEK_KEYS.concat(PRIVATE_KEYS,LOCAL_KEYS);
  Object.keys(st).forEach(function(k){
    if(skip.indexOf(k)>=0)return;
    settings[k]=st[k];
  });
  PRIVATE_KEYS.forEach(function(k){if(st[k]!==undefined)priv[k]=st[k]});
  return {weeks:weeks,settings:settings,priv:priv,camp:camp};
}

var versions={},sentWeeks={},sentCamp={},legacy=false,sentSettings=null,sentPriv=null,settingsSeen=null;
function remember(rows,settingsRow,privateRow,st){
  versions={};sentWeeks={};sentCamp={};legacy=false;
  (rows||[]).forEach(function(r){versions[r.week_key]=r.version});
  var d=decompose(st);
  /* a week saved before the camper lock still carries every camper detail in its public row: leave it "unsent" so the next save rewrites it clean */
  var old={};(rows||[]).forEach(function(r){if(hasPrivateFields(r.sessions)){old[r.week_key]=true;legacy=true}});
  Object.keys(d.weeks).forEach(function(k){
    if(versions[k]===undefined||old[k])return;
    sentWeeks[k]=JSON.stringify(d.weeks[k]);
    sentCamp[k]=JSON.stringify(d.camp[k]||{});
  });
  sentSettings=settingsRow&&settingsRow.data&&Object.keys(settingsRow.data).length?JSON.stringify(d.settings):null;
  sentPriv=privateRow&&privateRow.data&&Object.keys(privateRow.data).length?JSON.stringify(d.priv):null;
}

window.SYNC={
  enabled:true,
  /* coaches: published weeks + shared settings */
  fetchPublic:function(){
    return Promise.all([req('GET','/rest/v1/weeks?select=*&order=week_start.asc.nullslast'),req('GET','/rest/v1/planner_settings?select=*&id=eq.1')]).then(function(r){
      return {rows:r[0]||[],settings:(r[1]||[])[0]||null,priv:null};
    });
  },
  /* staff: everything, checked against the PIN on the server */
  fetchAll:function(pin){
    /* camper details come from their own function; if it fails the whole load fails, so a partial copy can never be saved over the real details */
    return Promise.all([rpc('staff_get_all',{p_pin:pin}),rpc('camper_staff_get',{p_pin:pin})]).then(function(a){
      var r=a[0];
      return {rows:(r&&r.weeks)||[],settings:(r&&r.settings)||null,priv:(r&&r.private)||null,campers:a[1]||{}};
    });
  },
  /* a coach with the 4-digit camper code: resolves {ok, locked, unset, data} (data = details of published weeks only) */
  fetchCampers:function(code){return rpc('camper_details',{p_code:String(code||'')})},
  /* true when some week still has camper details in its public row (saved before the lock existed); the next staff save cleans it */
  needsMigration:function(){return legacy},
  verify:function(pin){return rpc('staff_verify',{p_pin:pin}).then(function(ok){return ok===true})},
  compose:compose,
  remember:remember,
  isEmpty:function(f){return !(f.rows&&f.rows.length)&&!(f.settings&&f.settings.data&&Object.keys(f.settings.data).length)},
  /* a short fingerprint of what the server holds, so a refresh only redraws when something changed */
  signature:function(f){
    return (f.rows||[]).map(function(r){return r.week_key+':'+r.version+':'+(r.published?1:0)+(r.published_range?1:0)}).join('|')+'#'+((f.settings&&f.settings.version)||0)+'#'+((f.priv&&f.priv.version)||0)+'#'+(f.campers?hash(JSON.stringify(f.campers)):'');
  },
  /* send what changed since the last load/save. Resolves {saved:n}. Rejects with err.code '40001' (someone else saved) or '28000' (bad PIN). */
  push:function(st,pin){
    var d=decompose(st),jobs=[],keys=Object.keys(d.weeks);
    keys.forEach(function(k){
      /* camper details go first, so a week's public row is only cleaned once its private details are safely stored */
      var cj=JSON.stringify(d.camp[k]||{});
      if(cj!==sentCamp[k]&&!(cj==='{}'&&sentCamp[k]===undefined)){
        jobs.push(function(){return rpc('camper_staff_save',{p_pin:pin,p_week_key:k,p_data:d.camp[k]||{}}).then(function(){sentCamp[k]=cj})});
      }
      var js=JSON.stringify(d.weeks[k]);
      if(sentWeeks[k]===js)return;
      var w=d.weeks[k],exp=versions[k]!==undefined?versions[k]:0;
      jobs.push(function(){
        return rpc('staff_save_week',{p_pin:pin,p_week_key:k,p_week_start:weekStartIso(k),p_sessions:w.sessions,p_news:w.news,p_coverage:w.coverage,p_trav:w.trav,p_range_hours:w.range_hours,p_published:w.published,p_published_range:w.published_range,p_expected_version:exp}).then(function(v){versions[k]=v;sentWeeks[k]=js});
      });
    });
    /* a week removed in the app is removed from the database; never when nothing is left at all (that would be a bug, not a delete) */
    if(keys.length){
      Object.keys(versions).forEach(function(k){
        if(d.weeks[k])return;
        jobs.push(function(){return rpc('staff_delete_week',{p_pin:pin,p_week_key:k}).then(function(){return rpc('camper_staff_delete',{p_pin:pin,p_week_key:k})}).then(function(){delete versions[k];delete sentWeeks[k];delete sentCamp[k]})});
      });
    }
    var sj=JSON.stringify(d.settings);
    if(sj!==sentSettings)jobs.push(function(){return rpc('staff_save_settings',{p_pin:pin,p_data:d.settings}).then(function(){sentSettings=sj})});
    var pj=JSON.stringify(d.priv);
    if(pj!==sentPriv)jobs.push(function(){return rpc('staff_save_private',{p_pin:pin,p_data:d.priv}).then(function(){sentPriv=pj})});
    var n=0;
    return jobs.reduce(function(p,j){return p.then(j).then(function(){n++})},Promise.resolve()).then(function(){return {saved:n}});
  }
};
})();

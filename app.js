/* SSB Consecration — Travel & Stay. Vanilla JS + Supabase. */
const SUPABASE_URL='https://zbqetpvgipgagmmyupcn.supabase.co';
const SUPABASE_KEY='sb_publishable_9N-AtGZTNYsOLNAYj1W8AQ_ya6ccY6C';
const sb=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY);

const MODES=['Train','Flight','Bus (general, not organised)'];
const STATIONS=['KSR Bengaluru (SBC)','Yesvantpur Jn (YPR)','Bengaluru Cantt (BNC)','KR Puram (KJM)'];
const LASTMILE=['Isha shuttle bus (→ SSB)','Shared taxi with co-Isha travellers','Shared bus with co-Isha travellers',"I'll arrange my own"];
const REGIONS=['South India','North India','East India','West India','Central India','North East India','APAC','Middle East','North America','Europe','Other'];
const GENDERS=['Male','Female','Other'];
const AIRPORT='Kempegowda Intl, Bengaluru (BLR)';
const DEF_IN='2026-09-27', DEF_OUT='2026-10-02';

const REQ_COLS=['request_id','batch_id','created_at','created_by','requester_type','poc_name','poc_team','poc_phone','poc_email','traveller_type','name','role','age','gender','region','phone','email','check_in','check_out','travel_mode','from_location','to_location','train_name','train_number','flight_name','flight_number','bus_name','arrival','last_mile','id_token','id_type','id_number_masked','id_image_path','id_status','approval_status','approved_at','rejection_reason','stay_status','stay_location','stay_bed_no','stay_allocation','travel_status','travel_allocation','ticket_path','confirmed'].join(',');

const ROLE_LABEL={requester:'Requester',poc:'Team POC',coordinator:'Coordinator',travel_desk:'Travel Desk',accommodation_desk:'Accommodation Desk',admin:'Admin'};

const NAV=[
 {id:'request',label:'Raise Request',ico:'✍️',roles:['requester','poc','coordinator','admin']},
 {id:'mine',label:'My Requests',ico:'📄',roles:['requester','poc','coordinator','travel_desk','accommodation_desk','admin']},
 {id:'queue',label:'Coordinator Queue',ico:'🗂️',roles:['coordinator','admin']},
 {id:'stay',label:'Accommodation Desk',ico:'🛏️',roles:['accommodation_desk','admin']},
 {id:'travel',label:'Travel Desk',ico:'🚆',roles:['travel_desk','admin']},
 {id:'refs',label:'Reference Lists',ico:'📚',roles:['coordinator','admin']},
 {id:'users',label:'Users & Roles',ico:'👥',roles:['admin']}];

const S={session:null,profile:null,view:'request',requests:[],users:[],teams:[],stays:[],trains:[],flights:[],reqType:'core',form:{},pocRows:[],lastBatch:[],confId:null,filter:'All',msg:null,err:null,busy:false,authMode:'signin'};

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const MON=['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const fmt=d=>{if(!d)return '—';const p=String(d).split('-');return p.length===3?`${p[2]} ${MON[+p[1]]}`:d;};
const needsLastMile=m=>m==='Train'||m==='Flight'||m==='Bus (general, not organised)';
const travelDetailText=r=>r.travel_mode==='Train'?[r.train_name,r.train_number].filter(Boolean).join(' · '):r.travel_mode==='Flight'?[r.flight_name,r.flight_number].filter(Boolean).join(' · '):r.travel_mode==='Bus (general, not organised)'?(r.bus_name||''):'';
const mask=(n,t)=>{n=String(n||'');if(n.length<3)return n;return t==='Aadhaar'?'XXXX-XXXX-'+n.slice(-4):n.slice(0,2)+'••••'+n.slice(-2);};
const el=id=>document.getElementById(id);
const val=id=>(el(id)?.value||'').trim();
const idLink=token=>`${location.origin}${location.pathname}#/id/${token}`;
const diya=`<svg class="diya" viewBox="0 0 24 32"><path d="M12 2c3 5 6 7.5 6 12a6 6 0 0 1-12 0c0-4.5 3-7 6-12z" fill="#EE6A1F"/><path d="M12 9c1.6 2.6 3 4 3 6.4A3 3 0 0 1 9 15.4C9 13 10.4 11.6 12 9z" fill="#F9C846"/></svg>`;

function flash(ok,msg){S.msg=ok?msg:null;S.err=ok?null:msg;render();}
function go(v,arg){S.msg=S.err=null;if(v==='confirm')S.confId=arg;S.view=v;render();window.scrollTo({top:0,behavior:'smooth'});}
window.go=go;

async function boot(){
 if(location.hash.startsWith('#/id/'))return renderIdPage(location.hash.slice(5));
 window.addEventListener('hashchange',()=>{if(location.hash.startsWith('#/id/'))renderIdPage(location.hash.slice(5));});
 const {data:{session}}=await sb.auth.getSession();
 S.session=session;
 if(session)await loadAll();
 render();
 sb.auth.onAuthStateChange(async(_e,s)=>{const changed=(s?.user?.id)!==(S.session?.user?.id);S.session=s;if(changed){if(s)await loadAll();else S.profile=null;render();}});
}

async function loadAll(){
 const [p,t,sl,tr,fl]=await Promise.all([
  sb.from('mkn_profiles').select('*').eq('id',S.session.user.id).maybeSingle(),
  sb.from('mkn_teams').select('*').order('sort_order'),
  sb.from('mkn_stay_locations').select('*').order('sort_order'),
  sb.from('mkn_recommended_trains').select('*').order('sort_order'),
  sb.from('mkn_recommended_flights').select('*').order('sort_order')]);
 S.profile=p.data||{id:S.session.user.id,email:S.session.user.email,role:'requester'};
 S.teams=t.data||[];S.stays=sl.data||[];S.trains=tr.data||[];S.flights=fl.data||[];
 const allowed=NAV.filter(n=>n.roles.includes(S.profile.role));
 if(!allowed.find(n=>n.id===S.view))S.view=allowed[0]?.id||'mine';
 await loadRequests();
}

async function loadRequests(){
 const {data,error}=await sb.from('mkn_requests').select(REQ_COLS).order('created_at',{ascending:false});
 if(error){S.err=error.message;S.requests=[];return;}
 S.requests=data||[];
}

function render(){
 if(location.hash.startsWith('#/id/'))return;
 const app=el('app');
 if(!S.session){app.innerHTML=authView();wireAuth();return;}
 const role=S.profile?.role||'requester';
 const items=NAV.filter(n=>n.roles.includes(role));
 const counts=navCounts();
 app.innerHTML=`
 <aside class="side">
  <div class="side-brand">${diya}<div><h1>SSB Consecration</h1><p>Travel &amp; Stay · 28 Sep – 2 Oct 2026</p></div></div>
  <nav class="side-nav"><div class="side-sec">Menu</div>
   ${items.map(n=>`<button class="nav-item ${S.view===n.id?'on':''}" onclick="go('${n.id}')"><span class="ico">${n.ico}</span><span>${n.label}</span>${counts[n.id]?`<span class="ct">${counts[n.id]}</span>`:''}</button>`).join('')}
  </nav>
  <div class="side-user">
   <div class="nm">${esc(S.profile?.full_name||S.profile?.email)}</div>
   <div class="rl">${ROLE_LABEL[role]||role}${S.profile?.team?' · '+esc(S.profile.team):''}</div>
   <button class="btn-sm" onclick="signOut()">Sign out</button>
  </div>
 </aside>
 <main>
  ${S.err?`<div class="err">${esc(S.err)}</div>`:''}
  ${S.msg?`<div class="okmsg">${esc(S.msg)}</div>`:''}
  ${bodyFor(S.view)}
 </main>`;
 wireView();
}

function navCounts(){
 const c={};
 const pend=S.requests.filter(r=>r.approval_status==='Pending').length;
 if(pend)c.queue=pend;
 const st=S.requests.filter(r=>r.approval_status==='Approved'&&r.stay_status==='Pending').length;
 const tv=S.requests.filter(r=>r.approval_status==='Approved'&&r.travel_status==='Pending').length;
 if(st)c.stay=st;
 if(tv)c.travel=tv;
 return c;
}

function bodyFor(v){
 switch(v){
  case 'request':return requestView();
  case 'mine':return mineView();
  case 'queue':return queueView();
  case 'stay':return deskView('stay');
  case 'travel':return deskView('travel');
  case 'refs':return refsView();
  case 'users':return usersView();
  case 'share':return shareView();
  case 'confirm':return confirmView();
  default:return `<div class="empty">Unknown view.</div>`;
 }
}

function authView(){
 return `<div class="centred">
  <div class="public-head">${diya}<div><h1>SSB Consecration · Travel &amp; Stay</h1><p>Sadhguru Sannidhi Bengaluru · 28 Sep – 2 Oct 2026</p></div></div>
  <div class="card">
   ${S.err?`<div class="err">${esc(S.err)}</div>`:''}
   ${S.msg?`<div class="okmsg">${esc(S.msg)}</div>`:''}
   <div class="tabs">
    <button class="${S.authMode==='signin'?'on':''}" onclick="setAuthMode('signin')">Sign in</button>
    <button class="${S.authMode==='signup'?'on':''}" onclick="setAuthMode('signup')">Create account</button>
   </div>
   ${S.authMode==='signup'?`<div class="field"><label>Full name *</label><input type="text" id="au_name" placeholder="Your name"></div>`:''}
   <div class="field"><label>Email *</label><input type="email" id="au_email" placeholder="you@example.com"></div>
   <div class="field"><label>Password *</label><input type="password" id="au_pw" placeholder="At least 6 characters"></div>
   <button class="primary" id="au_go">${S.authMode==='signup'?'Create account':'Sign in'}</button>
   <p class="privacy">New accounts start as <b>Requester</b> — raise your own travel &amp; stay request. A coordinator or admin upgrades you to Team POC, Coordinator, Travel Desk or Accommodation Desk from <b>Users &amp; Roles</b>.</p>
  </div></div>`;
}
window.setAuthMode=m=>{S.authMode=m;S.err=S.msg=null;render();};

function wireAuth(){
 const btn=el('au_go');if(!btn)return;
 const submit=async()=>{
  const email=val('au_email'),pw=val('au_pw');
  if(!email||!pw)return flash(false,'Enter your email and password.');
  btn.disabled=true;btn.textContent='Please wait…';
  const r=S.authMode==='signup'
   ?await sb.auth.signUp({email,password:pw,options:{data:{full_name:val('au_name')||email.split('@')[0]}}})
   :await sb.auth.signInWithPassword({email,password:pw});
  if(r.error){btn.disabled=false;return flash(false,r.error.message);}
  S.session=r.data.session;
  if(!S.session)return flash(true,'Account created. Please sign in.');
  await loadAll();S.err=S.msg=null;render();
 };
 btn.onclick=submit;
 ['au_email','au_pw','au_name'].forEach(i=>el(i)&&(el(i).onkeydown=e=>{if(e.key==='Enter')submit();}));
}
window.signOut=async()=>{await sb.auth.signOut();S.profile=null;S.requests=[];render();};

function requestView(){
 const canBulk=['poc','coordinator','admin'].includes(S.profile.role);
 const types=[canBulk?{v:'poc',t:'Team POC (IYC)',s:'Raising for many team members / vendors'}:null,
  {v:'core',t:'Core volunteer',s:'Raising for myself'},
  {v:'poornanga',t:'Individual / Poornanga',s:'Raising for myself'}].filter(Boolean);
 if(!canBulk&&S.reqType==='poc')S.reqType='core';
 return `<div class="page-head"><h2>Raise a travel &amp; stay request</h2><div class="sub">For IYC teams, core volunteers, and individual Poornangas travelling to the SSB consecration.</div></div>
  <div class="card">
   <div class="grp-title">Who is raising this request?</div>
   <div class="segs">${types.map(x=>`<button class="seg ${S.reqType===x.v?'on':''}" onclick="pickType('${x.v}')"><span class="st">${x.t}</span><span class="ss">${x.s}</span></button>`).join('')}</div>
   ${!canBulk?`<p class="privacy">Bulk entry for a team is available to Team POCs. Ask an admin to set your role to <b>Team POC</b>.</p>`:''}
  </div>
  ${S.reqType==='poc'?pocForm():selfForm(S.reqType)}`;
}
window.pickType=t=>{S.reqType=t;S.form={};S.msg=S.err=null;if(t==='poc'&&!S.pocRows.length)S.pocRows=[blankRow(),blankRow(),blankRow()];render();};

function selfForm(type){
 const who=type==='core'?'core volunteer':'Poornanga';
 const f=S.form;
 return `<div class="card">
  <div class="grp-title">Your details</div>
  <div class="row">
   <div class="field"><label>Full name *</label><input type="text" id="name" placeholder="Your name" value="${esc(f.name||S.profile.full_name||'')}"></div>
   <div class="field"><label>Region</label><select id="region"><option value="">Select…</option>${REGIONS.map(r=>`<option ${f.region===r?'selected':''}>${r}</option>`).join('')}</select></div>
  </div>
  <div class="row">
   <div class="field"><label>Age</label><input type="number" id="age" min="1" max="120" placeholder="e.g. 34" value="${esc(f.age||'')}"></div>
   <div class="field"><label>Gender</label><select id="gender"><option value="">Select…</option>${GENDERS.map(g=>`<option ${f.gender===g?'selected':''}>${g}</option>`).join('')}</select></div>
  </div>
  <div class="row">
   <div class="field"><label>Phone</label><input type="tel" id="phone" placeholder="+91…" value="${esc(f.phone||'')}"></div>
   <div class="field"><label>Email</label><input type="email" id="email" placeholder="you@example.com" value="${esc(f.email||S.profile.email||'')}"></div>
  </div>
  <p class="privacy">Raising this as a ${who} — you'll upload your own ID below.</p>
  <div class="grp-title">Accommodation dates</div>
  <div class="row">
   <div class="field"><label>Check-in *</label><input type="date" id="checkIn" value="${f.checkIn||DEF_IN}"></div>
   <div class="field"><label>Check-out *</label><input type="date" id="checkOut" value="${f.checkOut||DEF_OUT}"></div>
  </div>
  <div class="grp-title">Travel to SSB</div>
  <div class="field"><label>How are you travelling? *</label>
   <div class="chips">${MODES.map(m=>`<button class="chip ${f.mode===m?'on':''}" onclick="setMode(this.dataset.v)" data-v="${esc(m)}">${esc(m)}</button>`).join('')}</div></div>
  ${travelDetail(f.mode)}
  <div class="grp-title">Your ID</div>
  ${idBlock('self',f)}
  <div class="grp-title">Departure</div>
  <div class="field"><label>Departure date &amp; time (optional)</label><input type="text" id="departTime" placeholder="e.g. 2 Oct · 21:15" value="${esc(f.departTime||'')}"></div>
  <button class="primary" id="submitSelf" ${S.busy?'disabled':''}>${S.busy?'Submitting…':'Raise request'}</button>
 </div>`;
}

function travelDetail(mode){
 if(!mode)return '';
 const f=S.form;
 if(mode==='Train'||mode==='Flight'){
  const isTrain=mode==='Train';
  return `
  <div class="row">
   <div class="field"><label>From *</label><input type="text" id="from" placeholder="Origin city" value="${esc(f.from||'')}"></div>
   <div class="field"><label>${isTrain?'To (destination station)':'To (arrival airport)'}</label>
    ${isTrain?`<select id="toPoint">${STATIONS.map(s=>`<option ${f.toPoint===s?'selected':''}>${s}</option>`).join('')}</select>`:`<input type="text" id="toPoint" class="locked" value="${AIRPORT}" disabled>`}</div>
  </div>
  <div class="row">
   <div class="field"><label>${isTrain?'Train name':'Flight name / airline'} *</label><input type="text" id="${isTrain?'trainName':'flightName'}" placeholder="${isTrain?'e.g. Bengaluru Mail':'e.g. IndiGo'}" value="${esc(f[isTrain?'trainName':'flightName']||'')}"></div>
   <div class="field"><label>${isTrain?'Train number':'Flight number'} *</label><input type="text" id="${isTrain?'trainNumber':'flightNumber'}" placeholder="${isTrain?'e.g. 12658':'e.g. 6E 204'}" value="${esc(f[isTrain?'trainNumber':'flightNumber']||'')}"></div>
  </div>
  <div class="field"><label>Preferred arrival date &amp; time (optional)</label><input type="text" id="arrivalTime" placeholder="e.g. 27 Sep · 06:30" value="${esc(f.arrivalTime||'')}"></div>
  <div class="hint">Coming into Bengaluru — choose how to reach SSB. Sharing with co-Isha travellers is encouraged. 🙏</div>
  <div class="field"><label>Getting from ${isTrain?'station':'airport'} to SSB *</label>
   <div class="chips">${LASTMILE.map(l=>`<button class="chip ${f.lastMile===l?'on':''}" onclick="setLastMile(this.dataset.v)" data-v="${esc(l)}">${esc(l)}</button>`).join('')}</div></div>`;
 }
 return `
  <div class="row">
   <div class="field"><label>From *</label><input type="text" id="from" placeholder="Origin city / boarding point" value="${esc(f.from||'')}"></div>
   <div class="field"><label>To *</label><input type="text" id="toPoint" placeholder="Arrival city / bus stand" value="${esc(f.toPoint||'')}"></div>
  </div>
  <div class="field"><label>Bus name / operator *</label><input type="text" id="busName" placeholder="e.g. KSRTC Airavat" value="${esc(f.busName||'')}"></div>
  <div class="field"><label>Preferred arrival date &amp; time (optional)</label><input type="text" id="arrivalTime" placeholder="e.g. 27 Sep · 06:30" value="${esc(f.arrivalTime||'')}"></div>
  <div class="hint">A general/public bus, not one organised by SSB or IYC — choose how to reach SSB from the drop point. 🙏</div>
  <div class="field"><label>Getting to SSB *</label>
   <div class="chips">${LASTMILE.map(l=>`<button class="chip ${f.lastMile===l?'on':''}" onclick="setLastMile(this.dataset.v)" data-v="${esc(l)}">${esc(l)}</button>`).join('')}</div></div>`;
}

function idBlock(p,f){
 const t=f[p+'IdType'];
 return `<div class="field"><label>ID type *</label><div class="chips">
   <button class="chip ${t==='Aadhaar'?'on':''}" onclick="setIdType('${p}','Aadhaar')">Aadhaar</button>
   <button class="chip ${t==='Passport'?'on':''}" onclick="setIdType('${p}','Passport')">Passport</button>
  </div></div>
  ${!t?'':`
  <div class="field"><label>${t} number *</label><input type="text" id="${p}_idNum" placeholder="${t==='Aadhaar'?'12-digit Aadhaar number':'Passport number'}" value="${esc(f[p+'IdNum']||'')}"></div>
  <div class="field"><label>${t} image *</label>
   <label class="upload ${f[p+'File']?'done':''}" id="${p}_idBox"><input type="file" id="${p}_idImg" accept="image/*,application/pdf"><span>📎</span><span class="u-txt">${f[p+'File']?'✓ '+esc(f[p+'File'].name):`Tap to upload your ${t} (JPG or PDF)`}</span></label></div>`}
  <p class="privacy">🔒 Your ID is used only for travel booking by the SSB coordination team, and is not shared elsewhere.</p>`;
}

window.setMode=m=>{captureSelf();S.form.mode=m;S.form.trainName=S.form.trainNumber=S.form.flightName=S.form.flightNumber=S.form.busName='';S.form.lastMile='';render();};
window.setLastMile=v=>{captureSelf();S.form.lastMile=v;render();};
window.setIdType=(p,t)=>{captureSelf();S.form[p+'IdType']=t;S.form[p+'IdNum']='';S.form[p+'File']=null;render();};

function captureSelf(){
 const f=S.form;
 ['name','region','age','gender','phone','email','checkIn','checkOut','from','toPoint','arrivalTime','departTime','trainName','trainNumber','flightName','flightNumber','busName'].forEach(k=>{if(el(k))f[k]=el(k).value;});
 ['self','up'].forEach(p=>{if(el(p+'_idNum'))f[p+'IdNum']=el(p+'_idNum').value;});
}

function wireView(){
 const box=el('self_idImg');
 if(box)box.onchange=e=>{captureSelf();S.form.selfFile=e.target.files[0]||null;render();};
 if(el('submitSelf'))el('submitSelf').onclick=submitSelf;
 if(el('submitPoc'))el('submitPoc').onclick=submitPoc;
}

async function submitSelf(){
 captureSelf();
 const f=S.form,miss=[];
 if(!f.name)miss.push('name');
 if(!f.mode)miss.push('travel mode');
 if(f.mode&&!f.from)miss.push('from');
 if(f.mode==='Bus (general, not organised)'&&!f.toPoint)miss.push('to');
 if(f.mode==='Train'&&(!f.trainName||!f.trainNumber))miss.push('train name & number');
 if(f.mode==='Flight'&&(!f.flightName||!f.flightNumber))miss.push('flight name & number');
 if(f.mode==='Bus (general, not organised)'&&!f.busName)miss.push('bus name');
 if(needsLastMile(f.mode)&&!f.lastMile)miss.push('station/airport/bus stand → SSB');
 if(!f.selfIdType||!f.selfIdNum||!f.selfFile)miss.push('ID type, number & image');
 if(miss.length)return flash(false,'Please complete: '+miss.join(', '));
 if(f.selfIdType==='Aadhaar'&&!/^\d{12}$/.test(f.selfIdNum.trim()))return flash(false,'Aadhaar must be 12 digits.');
 S.busy=true;render();
 try{
  const path=`ids/${S.session.user.id}-${Date.now()}-${f.selfFile.name.replace(/[^\w.\-]/g,'_')}`;
  const up=await sb.storage.from('mkn-ids').upload(path,f.selfFile);
  if(up.error)throw up.error;
  const to=f.mode==='Train'?(f.toPoint||STATIONS[0]):f.mode==='Flight'?AIRPORT:(f.toPoint||'');
  const row={requester_type:S.reqType,created_by:S.session.user.id,name:f.name,
   role:S.reqType==='core'?'Core volunteer':'Poornanga (IYC)',
   age:f.age?parseInt(f.age,10):null,gender:f.gender||null,region:f.region||null,
   phone:f.phone||null,email:f.email||null,
   check_in:f.checkIn||DEF_IN,check_out:f.checkOut||DEF_OUT,
   travel_mode:f.mode,from_location:f.from||'',to_location:to,
   train_name:f.mode==='Train'?f.trainName:null,train_number:f.mode==='Train'?f.trainNumber:null,
   flight_name:f.mode==='Flight'?f.flightName:null,flight_number:f.mode==='Flight'?f.flightNumber:null,
   bus_name:f.mode==='Bus (general, not organised)'?f.busName:null,
   arrival:f.arrivalTime||null,
   last_mile:needsLastMile(f.mode)?f.lastMile:null,
   id_type:f.selfIdType,id_number:f.selfIdNum.trim(),
   id_number_masked:mask(f.selfIdNum.trim(),f.selfIdType),
   id_image_path:path,id_status:'Received'};
  const ins=await sb.from('mkn_requests').insert(row).select('request_id').single();
  if(ins.error)throw ins.error;
  S.form={};S.busy=false;
  await loadRequests();
  S.view='mine';
  flash(true,`Request ${ins.data.request_id} raised 🙏 — a coordinator will review it, then the desks arrange stay and travel.`);
 }catch(e){S.busy=false;flash(false,e.message||String(e));}
}

const blankRow=()=>({name:'',forType:'Team member',age:'',gender:'',phone:'',email:'',mode:'',from:'',to:'',detailName:'',detailNumber:'',arrival:'',lastmile:'',checkIn:DEF_IN,checkOut:DEF_OUT});

function pocForm(){
 const f=S.form;
 const myTeam=f.pocTeam||S.profile.team||'';
 return `<div class="card">
  <div class="grp-title">Your details (POC)</div>
  <div class="row">
   <div class="field"><label>POC name *</label><input type="text" id="pocName" placeholder="Your name" value="${esc(f.pocName||S.profile.full_name||'')}"></div>
   <div class="field"><label>Team *</label><select id="pocTeam"><option value="">Select your team…</option>${S.teams.map(t=>`<option ${myTeam===t.name?'selected':''}>${esc(t.name)}</option>`).join('')}</select></div>
  </div>
  <div class="row">
   <div class="field"><label>Your phone</label><input type="tel" id="pocPhone" placeholder="+91…" value="${esc(f.pocPhone||'')}"></div>
   <div class="field"><label>Your email</label><input type="email" id="pocEmail" placeholder="you@example.com" value="${esc(f.pocEmail||S.profile.email||'')}"></div>
  </div>
  <div class="grp-title">Travellers (team members / vendors)</div>
  <div class="hint">Add a row for each traveller. Enter their train/flight/bus name &amp; number so the <b>travel desk</b> can book and track it — no ticket details needed here. After you submit, each traveller gets their own link to upload their Aadhaar / passport.</div>
  <div class="defaults">
   <div class="field"><label>Default mode</label><select id="defMode"><option value="">—</option>${MODES.map(m=>`<option>${esc(m)}</option>`).join('')}</select></div>
   <div class="field"><label>Default origin</label><input type="text" id="defFrom" placeholder="e.g. Hyderabad"></div>
   <div class="field"><label>Default check-in</label><input type="date" id="defIn" value="${DEF_IN}"></div>
   <div class="field"><label>Default check-out</label><input type="date" id="defOut" value="${DEF_OUT}"></div>
   <button class="btn-sm" onclick="pocApplyDefaults()">Apply to all rows</button>
  </div>
  <div id="pocTableWrap">${pocTableHTML()}</div>
  <button class="btn-add" onclick="pocAdd()">+ Add traveller</button>
  <div style="height:18px"></div>
  <button class="primary" id="submitPoc" ${S.busy?'disabled':''}>${S.busy?'Submitting…':'Raise requests for all travellers'}</button>
 </div>`;
}

function pocTableHTML(){
 const opts=(arr,sel,blank)=>(blank!==undefined?`<option value="">${blank}</option>`:'')+arr.map(o=>`<option ${sel===o?'selected':''}>${esc(o)}</option>`).join('');
 return `<div class="tbl-wrap"><table class="poc" style="min-width:1500px"><thead><tr>
  <th>#</th><th>Name</th><th>For</th><th>Age</th><th>Gender</th><th>Phone</th><th>Email</th><th>Mode</th><th>From</th><th>To</th><th>Train/flight/bus name</th><th>Number</th><th>Arrival</th><th>→ SSB</th><th>Check-in</th><th>Check-out</th><th></th>
  </tr></thead><tbody>
  ${S.pocRows.map((r,i)=>{
   const isTrain=r.mode==='Train',isFlight=r.mode==='Flight',isBus=r.mode==='Bus (general, not organised)';
   const lm=needsLastMile(r.mode);
   return `<tr>
    <td class="idx">${i+1}</td>
    <td><input type="text" placeholder="Full name" value="${esc(r.name)}" oninput="pocSet(${i},'name',this.value)"></td>
    <td><select onchange="pocSet(${i},'forType',this.value)">${opts(['Team member','Vendor'],r.forType)}</select></td>
    <td><input type="number" min="1" max="120" style="width:66px" value="${esc(r.age)}" oninput="pocSet(${i},'age',this.value)"></td>
    <td><select onchange="pocSet(${i},'gender',this.value)">${opts(GENDERS,r.gender,'—')}</select></td>
    <td><input type="tel" placeholder="+91…" value="${esc(r.phone)}" oninput="pocSet(${i},'phone',this.value)"></td>
    <td><input type="email" placeholder="email" value="${esc(r.email)}" oninput="pocSet(${i},'email',this.value)"></td>
    <td><select onchange="pocSetMode(${i},this.value)">${opts(MODES,r.mode,'—')}</select></td>
    <td><input type="text" placeholder="origin" value="${esc(r.from)}" oninput="pocSet(${i},'from',this.value)"></td>
    <td>${isFlight?`<input type="text" class="locked" value="${AIRPORT}" disabled>`:`<input type="text" placeholder="${isTrain?'destination station':isBus?'arrival city / bus stand':'—'}" value="${esc(r.to)}" ${r.mode?'':'disabled'} oninput="pocSet(${i},'to',this.value)">`}</td>
    <td><input type="text" placeholder="${isTrain?'Train name':isFlight?'Flight name':isBus?'Bus name':'—'}" value="${esc(r.detailName)}" ${r.mode?'':'disabled'} oninput="pocSet(${i},'detailName',this.value)"></td>
    <td><input type="text" placeholder="${isTrain?'Train no.':isFlight?'Flight no.':'—'}" value="${esc(r.detailNumber)}" ${(isTrain||isFlight)?'':'disabled'} oninput="pocSet(${i},'detailNumber',this.value)"></td>
    <td><input type="text" placeholder="27 Sep · 06:30" value="${esc(r.arrival)}" oninput="pocSet(${i},'arrival',this.value)"></td>
    <td><select ${lm?'':'disabled'} onchange="pocSet(${i},'lastmile',this.value)">${lm?opts(LASTMILE,r.lastmile,'—'):'<option>—</option>'}</select></td>
    <td><input type="date" value="${r.checkIn}" onchange="pocSet(${i},'checkIn',this.value)"></td>
    <td><input type="date" value="${r.checkOut}" onchange="pocSet(${i},'checkOut',this.value)"></td>
    <td><button class="rowdel" title="Remove" onclick="pocDel(${i})">✕</button></td></tr>`;
  }).join('')}
  </tbody></table></div>`;
}

function capturePoc(){['pocName','pocTeam','pocPhone','pocEmail'].forEach(k=>{if(el(k))S.form[k]=el(k).value;});}
window.pocSet=(i,k,v)=>{S.pocRows[i][k]=v;};
window.pocSetMode=(i,v)=>{S.pocRows[i].mode=v;S.pocRows[i].to='';S.pocRows[i].detailName='';S.pocRows[i].detailNumber='';S.pocRows[i].lastmile='';el('pocTableWrap').innerHTML=pocTableHTML();};
window.pocDel=i=>{S.pocRows.splice(i,1);if(!S.pocRows.length)S.pocRows=[blankRow()];el('pocTableWrap').innerHTML=pocTableHTML();};
window.pocAdd=()=>{const r=blankRow();if(val('defMode'))r.mode=val('defMode');if(val('defFrom'))r.from=val('defFrom');if(val('defIn'))r.checkIn=val('defIn');if(val('defOut'))r.checkOut=val('defOut');S.pocRows.push(r);el('pocTableWrap').innerHTML=pocTableHTML();};
window.pocApplyDefaults=()=>{const m=val('defMode'),fr=val('defFrom'),ci=val('defIn'),co=val('defOut');S.pocRows.forEach(r=>{if(m){r.mode=m;r.to='';r.detailName='';r.detailNumber='';r.lastmile='';}if(fr)r.from=fr;if(ci)r.checkIn=ci;if(co)r.checkOut=co;});el('pocTableWrap').innerHTML=pocTableHTML();};

async function submitPoc(){
 capturePoc();
 const f=S.form;
 if(!f.pocName||!f.pocTeam)return flash(false,'Please enter your POC name and team.');
 const rows=S.pocRows.filter(r=>r.name.trim()&&r.mode);
 if(!rows.length)return flash(false,'Please add at least one traveller with a name and travel mode.');
 const badLM=rows.find(r=>needsLastMile(r.mode)&&!r.lastmile);
 if(badLM)return flash(false,`Please choose how they reach SSB. Check: ${badLM.name}`);
 const badFrom=rows.find(r=>!r.from.trim());
 if(badFrom)return flash(false,`Please enter an origin for: ${badFrom.name}`);
 const badTo=rows.find(r=>r.mode==='Bus (general, not organised)'&&!r.to.trim());
 if(badTo)return flash(false,`Please enter an arrival point for: ${badTo.name}`);
 const badDetail=rows.find(r=>(r.mode==='Train'||r.mode==='Flight')?(!r.detailName.trim()||!r.detailNumber.trim()):r.mode==='Bus (general, not organised)'?!r.detailName.trim():false);
 if(badDetail)return flash(false,`Please enter the ${badDetail.mode==='Train'?'train':badDetail.mode==='Flight'?'flight':'bus'} name & number for: ${badDetail.name}`);
 S.busy=true;render();
 try{
  const batch='B-'+Date.now().toString(36).toUpperCase();
  const payload=rows.map(r=>({requester_type:'poc',batch_id:batch,created_by:S.session.user.id,
   poc_name:f.pocName,poc_team:f.pocTeam,poc_phone:f.pocPhone||null,poc_email:f.pocEmail||null,
   traveller_type:r.forType,name:r.name.trim(),role:r.forType,
   age:r.age?parseInt(r.age,10):null,gender:r.gender||null,
   phone:r.phone||null,email:r.email||null,
   check_in:r.checkIn,check_out:r.checkOut,travel_mode:r.mode,
   from_location:r.from.trim(),
   to_location:r.mode==='Train'?(r.to.trim()||'(station)'):r.mode==='Flight'?AIRPORT:r.to.trim(),
   train_name:r.mode==='Train'?r.detailName.trim():null,train_number:r.mode==='Train'?r.detailNumber.trim():null,
   flight_name:r.mode==='Flight'?r.detailName.trim():null,flight_number:r.mode==='Flight'?r.detailNumber.trim():null,
   bus_name:r.mode==='Bus (general, not organised)'?r.detailName.trim():null,
   arrival:r.arrival||null,
   last_mile:needsLastMile(r.mode)?r.lastmile:null,
   id_status:'Awaiting traveller'}));
  const ins=await sb.from('mkn_requests').insert(payload).select('request_id,name,id_token');
  if(ins.error)throw ins.error;
  S.lastBatch=ins.data;S.pocRows=[];S.busy=false;
  await loadRequests();
  go('share');
 }catch(e){S.busy=false;flash(false,e.message||String(e));}
}

function shareView(){
 const n=S.lastBatch.length;
 return `<div class="page-head"><h2>${n} request${n>1?'s':''} raised 🙏</h2><div class="sub">${esc(S.form.pocTeam||'')} · travel &amp; stay details are in. One step left: each traveller's ID.</div></div>
  <div class="card">
   <div class="hint">Send each traveller their own link to upload their Aadhaar / passport. Until they do, ID shows as <b>awaiting</b> in the queue. The <b>travel desk</b> will book each person's preferred train/flight.</div>
   ${S.lastBatch.map(r=>`<div class="linkrow"><span class="ln">${esc(r.name)}</span><input type="text" readonly value="${esc(idLink(r.id_token))}" onclick="this.select()"><button class="btn-sm" onclick="copyOne('${esc(idLink(r.id_token))}')">Copy</button></div>`).join('')}
   <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
    <button class="btn-sm acc" onclick="copyAll()">Copy all links</button>
    <button class="btn-sm" onclick="go('mine')">Go to my requests</button>
   </div></div>`;
}
window.copyOne=t=>navigator.clipboard.writeText(t).then(()=>flash(true,'Link copied.')).catch(()=>prompt('Copy this link:',t));
window.copyAll=()=>{const txt=S.lastBatch.map(r=>`${r.name}: ${idLink(r.id_token)}`).join('\n');navigator.clipboard.writeText(txt).then(()=>flash(true,'Links copied — paste into WhatsApp / email.')).catch(()=>prompt('Copy these links:',txt));};

function pills(r){
 const p=[];
 p.push(r.approval_status==='Approved'?'<span class="pill ok">✓ Approved</span>':r.approval_status==='Rejected'?'<span class="pill err">✕ Rejected</span>':'<span class="pill pend">• Awaiting approval</span>');
 p.push(r.id_status==='Received'?'<span class="pill ok">✓ ID received</span>':'<span class="pill pend">• ID awaiting</span>');
 p.push(r.stay_status==='Allocated'?'<span class="pill ok">✓ Stay</span>':'<span class="pill pend">• Stay</span>');
 p.push(r.travel_status==='Booked'?'<span class="pill ok">✓ Travel</span>':'<span class="pill pend">• Travel</span>');
 if(r.confirmed)p.push('<span class="pill ok">🙏 Confirmed</span>');
 return `<div class="pills">${p.join('')}</div>`;
}

function reqCard(r,opts={}){
 const line=(k,v)=>v?`<div><span class="k">${k}</span>${esc(v)}</div>`:'';
 return `<div class="req">
  <div class="req-top">
   <div><div class="req-name">${esc(r.name)}</div>
    <div class="id-tag">${esc(r.request_id)} · ${esc(r.role||r.requester_type)}${r.poc_name?` · raised by ${esc(r.poc_name)} (${esc(r.poc_team||'')})`:' · self-raised'}</div></div>
   ${pills(r)}
  </div>
  <div class="req-detail">
   ${line('Stay',`${fmt(r.check_in)} → ${fmt(r.check_out)}`)}
   ${line('Travel',`${r.travel_mode||'—'} · ${r.from_location||'—'} → ${r.to_location||'—'}`)}
   ${line(r.travel_mode==='Train'?'Train':r.travel_mode==='Flight'?'Flight':'Bus',travelDetailText(r))}
   ${line('Arrival',r.arrival)}
   ${line('To SSB',r.last_mile)}
   ${line('Contact',[r.phone,r.email].filter(Boolean).join(' · '))}
   ${line('Age / Gender',[r.age,r.gender].filter(Boolean).join(' · '))}
   <div><span class="k">ID</span>${r.id_status==='Received'?`${esc(r.id_type||'')} · ${esc(r.id_number_masked||'••••')}${r.id_image_path?` · <a href="#" onclick="viewFile(event,'mkn-ids','${esc(r.id_image_path)}')">📎 view</a>`:''}`:`<span style="color:var(--pend)">awaiting traveller upload</span>`}</div>
   ${r.stay_allocation?line('Allotted stay',r.stay_allocation):''}
   ${r.travel_allocation?line('Booking',r.travel_allocation):''}
   ${r.ticket_path?`<div><span class="k">Ticket</span><a href="#" onclick="viewFile(event,'mkn-tickets','${esc(r.ticket_path)}')">📎 view ticket</a></div>`:''}
   ${r.rejection_reason?line('Rejected because',r.rejection_reason):''}
  </div>
  ${opts.actions?opts.actions(r):''}
 </div>`;
}

window.viewFile=async(e,bucket,path)=>{
 e.preventDefault();
 const {data,error}=await sb.storage.from(bucket).createSignedUrl(path,300);
 if(error)return flash(false,error.message);
 window.open(data.signedUrl,'_blank');
};

function mineView(){
 const mine=S.requests.filter(r=>r.created_by===S.session.user.id);
 return `<div class="page-head"><h2>My requests</h2><div class="sub">Everything you have raised, and where each one has reached.</div></div>
  ${!mine.length?`<div class="empty">No requests yet.</div>`:mine.map(r=>reqCard(r,{actions:r=>`<div class="req-actions">${r.id_status!=='Received'?`<button class="btn-sm" onclick="copyOne('${esc(idLink(r.id_token))}')">Copy ID upload link</button>`:''}<button class="btn-sm" onclick="go('confirm','${esc(r.request_id)}')">View confirmation →</button></div>`})).join('')}`;
}

function queueView(){
 const FILTERS=['All','Awaiting approval','Approved','Rejected','ID awaiting','Stay pending','Travel pending','Confirmed'];
 const match=r=>({'All':true,'Awaiting approval':r.approval_status==='Pending','Approved':r.approval_status==='Approved','Rejected':r.approval_status==='Rejected','ID awaiting':r.id_status!=='Received','Stay pending':r.stay_status==='Pending','Travel pending':r.travel_status==='Pending','Confirmed':r.confirmed})[S.filter];
 const list=S.requests.filter(match);
 return `<div class="page-head"><h2>Coordinator queue</h2><div class="sub">Every request lands here. Approve it, then it routes to the two backend desks.</div></div>
  <div class="hint"><b>How the flow works:</b> Request (self, or POC row + traveller-uploaded ID) → <b>you approve</b> → <b>Accommodation</b> assigns stay &amp; <b>Travel desk</b> books the preferred train/flight and arranges the ride to SSB → once ID is received and both are done, the traveller is <b>confirmed</b>.</div>
  <div class="filters">${FILTERS.map(f=>`<button class="chip ${S.filter===f?'on':''}" onclick="setFilter(this.dataset.v)" data-v="${f}">${f}</button>`).join('')}</div>
  ${!list.length?`<div class="empty">Nothing here.</div>`:list.map(r=>reqCard(r,{actions:r=>`<div class="req-actions">${r.approval_status!=='Approved'?`<button class="btn-sm acc" onclick="approve('${esc(r.request_id)}','Approved')">Approve</button>`:''}${r.approval_status==='Pending'?`<button class="btn-sm danger" onclick="approve('${esc(r.request_id)}','Rejected')">Reject</button>`:''}${r.id_status!=='Received'?`<button class="btn-sm" onclick="copyOne('${esc(idLink(r.id_token))}')">Copy ID upload link</button>`:''}<button class="btn-sm" onclick="go('confirm','${esc(r.request_id)}')">View confirmation →</button></div>`})).join('')}`;
}
window.setFilter=f=>{S.filter=f;render();};
window.approve=async(id,decision)=>{
 let reason=null;
 if(decision==='Rejected'){reason=prompt('Reason for rejection (optional):')||null;}
 const {error}=await sb.rpc('mkn_approve',{p_request_id:id,p_decision:decision,p_reason:reason});
 if(error)return flash(false,error.message);
 await loadRequests();
 flash(true,`${id} ${decision.toLowerCase()}.`);
};

function deskView(team){
 const meta=team==='stay'?{t:'Accommodation desk',s:'Assign stay for the requested dates. Only approved requests appear here.'}:{t:'Travel desk',s:'Book the preferred train/flight, or confirm the bus, and arrange the ride to SSB. Only approved requests appear here.'};
 const done=S.filter==='Done';
 const list=S.requests.filter(r=>r.approval_status==='Approved').filter(r=>done?(team==='stay'?r.stay_status==='Allocated':r.travel_status==='Booked'):(team==='stay'?r.stay_status==='Pending':r.travel_status==='Pending'));
 return `<div class="page-head"><h2>${meta.t}</h2><div class="sub">${meta.s}</div></div>
  <div class="filters">${['Pending','Done'].map(f=>`<button class="chip ${(f==='Done')===done?'on':''}" onclick="setFilter(this.dataset.v)" data-v="${f}">${f}</button>`).join('')}</div>
  ${!list.length?`<div class="empty">Nothing to allocate.</div>`:list.map(r=>reqCard(r,{actions:r=>allocBlock(r,team)})).join('')}`;
}

function allocBlock(r,team){
 if(team==='stay'){
  if(r.stay_status==='Allocated')return `<div class="req-actions"><span class="alloc-done">✓ Allocated — ${esc(r.stay_allocation)}</span></div>`;
  return `<div class="alloc-row">
   <div class="field"><label>Stay location</label><select id="loc_${r.request_id}">${S.stays.map(s=>`<option>${esc(s.name)}</option>`).join('')}</select></div>
   <div class="field" style="max-width:150px"><label>Room / bed no. (1–200)</label><input type="number" min="1" max="200" id="bed_${r.request_id}" placeholder="1–200"></div>
   <button class="btn-sm acc" onclick="doStay('${esc(r.request_id)}')">Allocate</button></div>`;
 }
 if(r.travel_status==='Booked')return `<div class="req-actions"><span class="alloc-done">✓ Booked — ${esc(r.travel_allocation)}</span></div>`;
 return `<div class="alloc-row">
  <div class="field"><label>Booking reference (PNR / seat)</label><input type="text" id="alloc_${r.request_id}" placeholder="e.g. PNR 4821773 · Coach B4 · Seat 22"></div>
  <div class="field"><label>Ticket file (optional)</label><input type="file" id="tkt_${r.request_id}" accept="image/*,application/pdf" style="padding:8px"></div>
  <button class="btn-sm acc" onclick="doTravel('${esc(r.request_id)}')">Book / assign</button></div>`;
}

window.doStay=async id=>{
 const loc=el('loc_'+id)?.value,bed=parseInt(el('bed_'+id)?.value,10);
 if(!loc)return flash(false,'Choose a stay location.');
 if(!bed||bed<1||bed>200)return flash(false,'Enter a room/bed number between 1 and 200.');
 const {error}=await sb.rpc('mkn_set_stay',{p_request_id:id,p_location:loc,p_bed_no:bed});
 if(error)return flash(false,error.message);
 await loadRequests();flash(true,`${id} — stay allotted: ${loc} · Bed ${bed}.`);
};

window.doTravel=async id=>{
 const ref=(el('alloc_'+id)?.value||'').trim();
 const file=el('tkt_'+id)?.files[0];
 if(!ref&&!file)return flash(false,'Enter a booking reference (or attach the ticket).');
 let path=null;
 if(file){
  path=`tickets/${id}-${Date.now()}-${file.name.replace(/[^\w.\-]/g,'_')}`;
  const up=await sb.storage.from('mkn-tickets').upload(path,file);
  if(up.error)return flash(false,up.error.message);
 }
 const {error}=await sb.rpc('mkn_set_travel',{p_request_id:id,p_allocation:ref||'Booked',p_ticket_path:path});
 if(error)return flash(false,error.message);
 await loadRequests();flash(true,`${id} — travel booked.`);
};

function confirmView(){
 const r=S.requests.find(x=>x.request_id===S.confId);
 if(!r)return `<div class="empty">No request selected.</div>`;
 const ln=(k,done,v)=>`<div class="conf-line"><span>${done?'✅':'⏳'}</span><span class="cl-k">${k}</span><span class="cl-v">${esc(v||'Awaiting…')}</span></div>`;
 return `<div class="page-head"><h2>${esc(r.name)}'s confirmation</h2><div class="sub">${esc(r.role||'')} · ${esc(r.request_id)} · ${r.poc_name?`raised by POC ${esc(r.poc_name)}`:'self-raised'}</div></div>
  <div class="card">
   <div class="conf-status ${r.confirmed?'ok':'pend'}">${r.confirmed?'All set — confirmed 🙏':'In progress — some parts still being arranged'}</div>
   ${ln('Coordinator approval',r.approval_status==='Approved',r.approval_status==='Approved'?'Approved':r.approval_status)}
   ${ln('ID verification',r.id_status==='Received',r.id_status==='Received'?`${r.id_type} · ${r.id_number_masked}`:null)}
   ${ln('Accommodation',r.stay_status==='Allocated',r.stay_status==='Allocated'?`${fmt(r.check_in)} → ${fmt(r.check_out)} · ${r.stay_allocation}`:null)}
   ${ln('Travel to SSB',r.travel_status==='Booked',r.travel_status==='Booked'?`${r.travel_mode} · ${r.from_location} → ${r.to_location} · ${r.travel_allocation}`:null)}
   <div style="margin-top:16px"><button class="btn-sm" onclick="go('${['coordinator','admin'].includes(S.profile.role)?'queue':'mine'}')">← Back</button></div>
  </div>`;
}

function refsView(){
 const tbl=(title,rows,cols,table,keyCol,note)=>`
  <div class="card"><h3>${title}</h3>${note?`<p class="privacy">${note}</p>`:''}
   <div class="tbl-wrap" style="margin-top:12px"><table class="poc" style="min-width:auto"><thead><tr>${cols.map(c=>`<th>${c.label}</th>`).join('')}<th></th></tr></thead><tbody>
   ${rows.map(r=>`<tr>${cols.map(c=>`<td>${esc(r[c.k]??'')}</td>`).join('')}<td><button class="rowdel" onclick="refDel('${table}','${keyCol}','${esc(r[keyCol])}')">✕</button></td></tr>`).join('')}
   <tr>${cols.map(c=>`<td><input type="text" id="new_${table}_${c.k}" placeholder="${c.label}"></td>`).join('')}<td><button class="btn-sm acc" onclick="refAdd('${table}',${JSON.stringify(cols.map(c=>c.k)).replace(/"/g,'&quot;')})">Add</button></td></tr>
  </tbody></table></div></div>`;
 return `<div class="page-head"><h2>Reference lists</h2><div class="sub">Coordinators edit these without a code change — they feed the dropdowns in the request form and the desks.</div></div>
  ${tbl('Teams',S.teams,[{k:'name',label:'Team name'}],'mkn_teams','name')}
  ${tbl('Stay locations',S.stays,[{k:'name',label:'Location'}],'mkn_stay_locations','name','⚠️ Placeholders taken from the MKN block names. Replace them with the real stay locations once the accommodation team confirms the list.')}
  ${tbl('Recommended trains',S.trains,[{k:'train',label:'Train'},{k:'route',label:'Route'},{k:'arrival',label:'Arrival'}],'mkn_recommended_trains','train')}
  ${tbl('Recommended flights',S.flights,[{k:'flight',label:'Flight'},{k:'airline',label:'Airline'},{k:'arrival',label:'Arrival'}],'mkn_recommended_flights','flight')}`;
}
window.refAdd=async(table,keys)=>{
 const row={};keys.forEach(k=>row[k]=val(`new_${table}_${k}`));
 if(!row[keys[0]])return flash(false,'Enter a value first.');
 const {error}=await sb.from(table).insert(row);
 if(error)return flash(false,error.message);
 await loadAll();flash(true,'Added.');
};
window.refDel=async(table,keyCol,key)=>{
 if(!confirm(`Remove "${key}"?`))return;
 const {error}=await sb.from(table).delete().eq(keyCol,key);
 if(error)return flash(false,error.message);
 await loadAll();flash(true,'Removed.');
};

function usersView(){
 return `<div class="page-head"><h2>Users &amp; roles</h2><div class="sub">Everyone who creates an account starts as <b>Requester</b>. Promote them here.</div></div>
  <div class="card">
   <button class="btn-sm" onclick="loadUsers()">Refresh list</button>
   <div class="tbl-wrap" style="margin-top:14px"><table class="poc" style="min-width:720px"><thead><tr><th>Name</th><th>Email</th><th>Team</th><th>Role</th></tr></thead><tbody>
   ${S.users.map(u=>`<tr><td>${esc(u.full_name||'—')}</td><td>${esc(u.email||'')}</td>
    <td><select onchange="setTeam('${u.id}',this.value)"><option value="">—</option>${S.teams.map(t=>`<option ${u.team===t.name?'selected':''}>${esc(t.name)}</option>`).join('')}</select></td>
    <td><select onchange="setRole('${u.id}',this.value)">${Object.keys(ROLE_LABEL).map(r=>`<option value="${r}" ${u.role===r?'selected':''}>${ROLE_LABEL[r]}</option>`).join('')}</select></td></tr>`).join('')}
   </tbody></table></div>
   ${!S.users.length?`<p class="privacy">Click <b>Refresh list</b> to load accounts.</p>`:''}
  </div>`;
}
window.loadUsers=async()=>{
 const {data,error}=await sb.from('mkn_profiles').select('*').order('created_at');
 if(error)return flash(false,error.message);
 S.users=data||[];render();
};
window.setRole=async(uid,role)=>{
 const {error}=await sb.rpc('mkn_set_role',{p_user_id:uid,p_role:role});
 if(error)return flash(false,error.message);
 await loadUsers();flash(true,'Role updated.');
};
window.setTeam=async(uid,team)=>{
 const {error}=await sb.from('mkn_profiles').update({team:team||null}).eq('id',uid);
 if(error)return flash(false,error.message);
 await loadUsers();flash(true,'Team updated.');
};

const P={trip:null,idType:null,file:null,num:'',done:false,err:null,err2:null,busy:false};

async function renderIdPage(token){
 if(!P.trip&&!P.err){
  const {data,error}=await sb.rpc('mkn_get_trip_by_token',{p_token:token});
  if(error)P.err=error.message;
  else if(!data||!data.length)P.err='Link not found.';
  else P.trip=data[0];
 }
 const t=P.trip;
 const head=`<div class="public-head">${diya}<div><h1>SSB Consecration · Travel &amp; Stay</h1><p>Sadhguru Sannidhi Bengaluru · 28 Sep – 2 Oct 2026</p></div></div>`;
 if(P.err)return el('app').innerHTML=`<div class="public-wrap">${head}<div class="empty">${esc(P.err)}</div></div>`;
 if(P.done||t.id_status==='Received'){
  return el('app').innerHTML=`<div class="public-wrap">${head}<div class="card"><h2>ID received 🙏</h2>
   <p style="color:var(--clay);font-size:13.5px;margin-top:6px">Thank you, ${esc(t.name)}. Your ${esc(t.id_type||'ID')} has been received and your booking is being arranged.</p>
   <div class="conf-status ok" style="margin-top:16px">All done on your side — nothing more needed.</div></div></div>`;
 }
 const to=t.to_location==='(station)'?'destination station':t.to_location;
 el('app').innerHTML=`<div class="public-wrap">${head}
  <div class="card">
   <h2>Hello ${esc(t.name)} 🙏</h2>
   <p style="color:var(--clay);font-size:13.5px;margin:6px 0 14px">${esc(t.poc_name||'A coordinator')} has requested your travel to the SSB consecration. Please upload your ID to complete the booking.</p>
   ${P.err2?`<div class="err">${esc(P.err2)}</div>`:''}
   <div class="hint"><b>Your trip:</b> ${esc(t.travel_mode||'—')} · ${esc(t.from_location||'—')} → ${esc(to||'SSB')}${t.arrival?` · ${esc(t.arrival)}`:''}${travelDetailText(t)?` · ${esc(travelDetailText(t))}`:''}<br><b>Stay:</b> ${fmt(t.check_in)} → ${fmt(t.check_out)}${t.last_mile?`<br><b>To SSB:</b> ${esc(t.last_mile)}`:''}</div>
   <div class="grp-title">Your ID</div>
   <div class="field"><label>ID type *</label><div class="chips">
    <button class="chip ${P.idType==='Aadhaar'?'on':''}" onclick="pIdType('Aadhaar')">Aadhaar</button>
    <button class="chip ${P.idType==='Passport'?'on':''}" onclick="pIdType('Passport')">Passport</button></div></div>
   ${!P.idType?'':`
   <div class="field"><label>${P.idType} number *</label><input type="text" id="p_num" placeholder="${P.idType==='Aadhaar'?'12-digit Aadhaar number':'Passport number'}" value="${esc(P.num||'')}"></div>
   <div class="field"><label>${P.idType} image *</label><label class="upload ${P.file?'done':''}"><input type="file" id="p_img" accept="image/*,application/pdf"><span>📎</span><span class="u-txt">${P.file?'✓ '+esc(P.file.name):`Tap to upload your ${P.idType} (JPG or PDF)`}</span></label></div>`}
   <p class="privacy">🔒 Your ID is used only for travel booking by the SSB coordination team, and is not shared elsewhere.</p>
   <button class="primary" id="p_go" ${P.busy?'disabled':''}>${P.busy?'Uploading…':'Submit my ID'}</button>
  </div></div>`;
 if(el('p_img'))el('p_img').onchange=e=>{P.num=el('p_num')?.value||P.num;P.file=e.target.files[0]||null;renderIdPage(token);};
 if(el('p_go'))el('p_go').onclick=()=>submitPublicId(token);
}
window.pIdType=t=>{P.num=el('p_num')?.value||P.num;P.idType=t;P.file=null;renderIdPage(location.hash.slice(5));};

async function submitPublicId(token){
 const num=(el('p_num')?.value||'').trim();
 P.num=num;P.err2=null;
 if(!P.idType||!num||!P.file){P.err2='Please choose ID type, enter the number, and upload the image.';return renderIdPage(token);}
 if(P.idType==='Aadhaar'&&!/^\d{12}$/.test(num)){P.err2='Aadhaar must be 12 digits.';return renderIdPage(token);}
 P.busy=true;renderIdPage(token);
 try{
  const path=`ids/${token}-${Date.now()}-${P.file.name.replace(/[^\w.\-]/g,'_')}`;
  const up=await sb.storage.from('mkn-ids').upload(path,P.file);
  if(up.error)throw up.error;
  const {error}=await sb.rpc('mkn_submit_id',{p_token:token,p_id_type:P.idType,p_id_number:num,p_image_path:path});
  if(error)throw error;
  P.busy=false;P.done=true;P.trip.id_type=P.idType;
 }catch(e){P.busy=false;P.err2=e.message||String(e);}
 renderIdPage(token);
}

boot();

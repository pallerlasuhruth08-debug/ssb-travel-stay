/* MKN Travel & Stay · SSB Bengaluru — vanilla JS + Supabase. */
const SUPABASE_URL = 'https://zbqetpvgipgagmmyupcn.supabase.co';
const SUPABASE_KEY = 'sb_publishable_9N-AtGZTNYsOLNAYj1W8AQ_ya6ccY6C';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const CATEGORIES = ['Poornanga', 'Brahmachari', 'POC', 'Core Volunteer', 'Ishanga'];
const GENDERS = ['Male', 'Female', 'Other'];
const TRAVEL_MODES = ['Train', 'Flight', 'Bus', 'Own arrangement'];
const DEFAULT_ORIGIN = 'Isha Yoga Center, Coimbatore';

const CAB_FROM = ['Madivala', 'Majestic', 'Silk Board',
  'Bengaluru Railway Station (Cantonment)', 'Bengaluru Railway Station (KSR)', 'Airport T1', 'Airport T2'];
const CAB_TO = 'Sadhguru Sannidhi, Bengaluru (SSB)';
const CAB_VEHICLES = ['Innova', 'Sedan', 'Mini', 'Tempo Traveller', 'Bus'];
const CAB_STATUS_CHIP = {
  submitted: ['submitted', 'Awaiting review'],
  approved:  ['approved',  'Awaiting cab'],
  booked:    ['complete',  'Booked'],
  rejected:  ['rejected',  'Sent back'],
};

const STAGES = ['submitted', 'approved', 'booked', 'complete'];
const STAGE_LABEL = { submitted: 'Submitted', approved: 'Approved', booked: 'Ticketed', complete: 'Housed' };
const STATUS_CHIP = {
  submitted: ['submitted', 'Awaiting review'],
  approved:  ['approved',  'Awaiting ticket'],
  booked:    ['booked',    'Awaiting bed'],
  complete:  ['complete',  'Confirmed'],
  rejected:  ['rejected',  'Sent back'],
};

const ROLE_LABEL = {
  requester: 'Requester', poc: 'Team POC', coordinator: 'Coordinator',
  travel_desk: 'Travel Desk', accommodation_desk: 'Accommodation Desk', admin: 'Admin',
};

const TABS = [
  { id: 'submit', label: '1 · Submit Request', roles: '*' },
  { id: 'coord',  label: '2 · Coordinator',    roles: ['coordinator', 'admin'], badge: 'submitted', cabBadge: 'submitted' },
  { id: 'travel', label: '3 · Travel Desk',    roles: ['travel_desk', 'admin'], badge: 'approved', cabBadge: 'approved' },
  { id: 'accom',  label: '4 · Accommodation',  roles: ['accommodation_desk', 'admin'], badge: 'booked' },
  { id: 'master', label: 'Bed Master',         roles: ['accommodation_desk', 'coordinator', 'admin'] },
  { id: 'people', label: 'People & Roles',     roles: ['admin'] },
];

const TRAV_COLS = ['id', 'request_id', 'sort_order', 'name', 'age', 'gender', 'category',
  'id_number_masked', 'id_image_path', 'travel_mode', 'train_name', 'train_number',
  'flight_name', 'flight_number', 'bus_name', 'pnr', 'bed_id', 'bed_label'].join(',');

const S = {
  session: null, profile: null, view: 'submit',
  requests: [], beds: [], people: [], cabRequests: [],
  mode: 'individual', ticketPref: 'collective', reqCategory: 'intercity',
  solo: blankTrav(), travForm: [], pocTravels: false,
  form: {}, cabForm: {}, open: new Set(), busy: false, authMode: 'signin',
  deskFilter: 'pending', coordFilter: 'review', editing: new Set(),
  coordType: 'intercity', travelType: 'intercity',
};

/* ---------------- helpers ---------------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const el = id => document.getElementById(id);
const val = id => (el(id)?.value || '').trim();
const role = () => S.profile?.role || 'requester';
const isStaff = () => ['coordinator', 'travel_desk', 'accommodation_desk', 'admin'].includes(role());
const allowedTabs = () => TABS.filter(t => t.roles === '*' || t.roles.includes(role()));
const initials = n => String(n || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
const travellers = r => (r.travellers || []).slice().sort((a, b) => a.sort_order - b.sort_order);
const needsTicket = p => p.travel_mode !== 'Own arrangement';

function blankTrav(extra) {
  return { name: '', age: '', gender: '', category: 'Core Volunteer', idNumber: '',
    file: null, travel: 'Train', trainName: '', trainNumber: '', flightName: '', flightNumber: '', busName: '',
    isPoc: false, ...extra };
}

let toastTimer;
function toast(msg) {
  const t = el('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3600);
}

function travelDetail(p) {
  if (p.travel_mode === 'Train')  return [p.train_name, p.train_number].filter(Boolean).join(' · ');
  if (p.travel_mode === 'Flight') return [p.flight_name, p.flight_number].filter(Boolean).join(' · ');
  if (p.travel_mode === 'Bus')    return p.bus_name || '';
  return '';
}

/* ---------------- boot & data ---------------- */
async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  S.session = session;
  if (session) await loadAll();
  render();
  sb.auth.onAuthStateChange(async (_e, s) => {
    const changed = (s?.user?.id) !== (S.session?.user?.id);
    S.session = s;
    if (!changed) return;
    if (s) await loadAll(); else S.profile = null;
    render();
  });
}

async function loadAll() {
  const { data: profile } = await sb.from('mkn_profiles').select('*').eq('id', S.session.user.id).maybeSingle();
  S.profile = profile || { id: S.session.user.id, email: S.session.user.email, role: 'requester' };
  if (!allowedTabs().some(t => t.id === S.view)) S.view = allowedTabs()[0]?.id || 'submit';
  await refresh();
}

async function refresh() {
  const [reqs, beds, cabs] = await Promise.all([
    sb.from('mkn_trip_requests').select(`*,travellers:mkn_trip_travellers(${TRAV_COLS})`).order('created_at', { ascending: false }),
    ['coordinator', 'accommodation_desk', 'admin'].includes(role())
      ? sb.from('mkn_beds').select('*').order('location').order('bed')
      : Promise.resolve({ data: [] }),
    sb.from('mkn_cab_requests').select('*').order('created_at', { ascending: false }),
  ]);
  if (reqs.error) toast(reqs.error.message);
  if (cabs.error) toast(cabs.error.message);
  S.requests = reqs.data || [];
  S.beds = beds.data || [];
  S.cabRequests = cabs.data || [];
}

/* ---------------- shell ---------------- */
function render() {
  if (!S.session) { el('app').innerHTML = authView(); wireAuth(); return; }
  const tabs = allowedTabs();
  const counts = {};
  tabs.forEach(t => {
    if (!t.badge) return;
    let n = S.requests.filter(r => r.status === t.badge).length;
    if (t.cabBadge) n += S.cabRequests.filter(c => c.status === t.cabBadge).length;
    counts[t.id] = n;
  });

  el('app').innerHTML = `
  <header>
    <div class="head-inner">
      <div>
        <div class="eyebrow">Mahakshetra Nirmana · Consecration</div>
        <h1>Transport &amp; Stay Requests</h1>
        <div class="venue">Destination: Sadhguru Sannidhi, Bengaluru (SSB)</div>
      </div>
      <div class="head-user">
        <div class="who">
          <b>${esc(S.profile?.full_name || S.profile?.email || '')}</b>
          <span>${esc(ROLE_LABEL[role()] || role())}${S.profile?.team ? ' · ' + esc(S.profile.team) : ''}</span>
        </div>
        <button class="btn-out" onclick="signOut()">Sign out</button>
        <div class="om">ॐ</div>
      </div>
    </div>
  </header>

  <div class="ribbon">
    <div class="ribbon-inner">
      <span class="step"><span class="num">1</span>Requester submits</span><span class="arr">→</span>
      <span class="step"><span class="num">2</span>Coordinator approves</span><span class="arr">→</span>
      <span class="step"><span class="num">3</span>Travel desk books ticket</span><span class="arr">→</span>
      <span class="step"><span class="num">4</span>Accommodation allots bed</span><span class="arr">→</span>
      <span class="step"><span class="num">✓</span>Confirmed &amp; notified</span>
    </div>
  </div>

  <nav><div class="tabs">
    ${tabs.map(t => `<button class="tab ${S.view === t.id ? 'active' : ''}" onclick="goView('${t.id}')">${t.label}${counts[t.id] ? `<span class="badge">${counts[t.id]}</span>` : ''}</button>`).join('')}
  </div></nav>

  <main>${viewBody()}</main>`;

  wireView();
}

function viewBody() {
  // A view whose tab isn't shown for this role must never render either — goView() and
  // loadAll()'s stale S.view both funnel through here, so this is the one place that matters.
  if (!allowedTabs().some(t => t.id === S.view)) S.view = allowedTabs()[0]?.id || 'submit';
  switch (S.view) {
    case 'submit': return submitView();
    case 'coord':  return coordView();
    case 'travel': return deskView('travel');
    case 'accom':  return deskView('accom');
    case 'master': return masterView();
    case 'people': return peopleView();
    default:       return `<div class="empty"><div class="big">Not found</div></div>`;
  }
}

window.goView = v => { S.view = v; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); };
window.signOut = async () => { await sb.auth.signOut(); S.profile = null; S.requests = []; S.beds = []; render(); };

/* ---------------- auth ---------------- */
function authView() {
  return `<div class="auth-wrap">
    <div class="auth-head">
      <div class="om">ॐ</div>
      <h2>MKN Travel &amp; Stay</h2>
      <p>Sadhguru Sannidhi, Bengaluru · consecration travel &amp; accommodation</p>
    </div>
    <div class="card pad">
      <div class="auth-tabs">
        <button class="${S.authMode === 'signin' ? 'on' : ''}" onclick="setAuthMode('signin')">Sign in</button>
        <button class="${S.authMode === 'signup' ? 'on' : ''}" onclick="setAuthMode('signup')">Create account</button>
      </div>
      ${S.authMode === 'signup' ? `<div class="field"><label>Full name</label><input id="auName" placeholder="Your name"></div>` : ''}
      <div class="field"><label>Email</label><input id="auEmail" type="email" placeholder="name@example.com"></div>
      <div class="field"><label>Password</label><input id="auPw" type="password" placeholder="At least 6 characters"></div>
      <button class="btn btn-primary" id="auGo" style="width:100%">${S.authMode === 'signup' ? 'Create account' : 'Sign in'}</button>
      <div class="hint" style="margin-top:12px">New accounts start as <b>Requester</b> — you can raise a request for yourself or, once an admin makes you a Team POC, for your team. Coordinator, travel desk and accommodation roles are assigned by an admin.</div>
    </div>
  </div>`;
}
window.setAuthMode = m => { S.authMode = m; render(); };

function wireAuth() {
  const btn = el('auGo');
  if (!btn) return;
  const submit = async () => {
    const email = val('auEmail'), pw = val('auPw');
    if (!email || !pw) return toast('Enter your email and password.');
    btn.disabled = true; btn.textContent = 'Please wait…';
    const r = S.authMode === 'signup'
      ? await sb.auth.signUp({ email, password: pw, options: { data: { full_name: val('auName') || email.split('@')[0] } } })
      : await sb.auth.signInWithPassword({ email, password: pw });
    if (r.error) { btn.disabled = false; btn.textContent = S.authMode === 'signup' ? 'Create account' : 'Sign in'; return toast(r.error.message); }
    S.session = r.data.session;
    if (!S.session) { btn.disabled = false; S.authMode = 'signin'; render(); return toast('Account created — now sign in.'); }
    await loadAll(); render();
  };
  btn.onclick = submit;
  ['auEmail', 'auPw', 'auName'].forEach(id => { if (el(id)) el(id).onkeydown = e => { if (e.key === 'Enter') submit(); }; });
}

/* ---------------- 1 · submit ---------------- */
function submitView() {
  const cab = S.reqCategory === 'cab';
  const mine = [
    ...S.requests.filter(r => r.created_by === S.session.user.id).map(r => ({ r, cab: false })),
    ...S.cabRequests.filter(c => c.created_by === S.session.user.id).map(r => ({ r, cab: true })),
  ].sort((a, b) => new Date(b.r.created_at) - new Date(a.r.created_at));

  return `
  <div class="view active">
    <div class="view-head">
      <h2>New ${cab ? 'intracity cab' : 'intercity transport &amp; stay'} request</h2>
      <p>${cab
        ? 'Raise a request for a cab within Bengaluru, to or from SSB. It goes to the coordinator for approval, then to the travel desk to be booked.'
        : 'Raise a request for yourself, or as a POC on behalf of your team. Each traveller needs age, gender, category and an ID for ticket booking.'}</p>
    </div>

    ${mine.length ? `<div class="card pad" style="margin-bottom:18px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:10px">
        <div><h3 style="font-size:20px">Requests you've raised</h3>
          <div class="hint">Open one to see exactly where it stands — review, ticketing, or bed allotment.</div></div>
      </div>
      ${mine.map(m => m.cab ? cabCard(m.r) : reqCard(m.r)).join('')}
    </div>` : ''}

    <div class="card pad">
      <div class="field">
        <label>What kind of request is this?</label>
        <div class="seg">
          <button class="${!cab ? 'on' : ''}" onclick="setReqCategory('intercity')">Intercity Transport &amp; Stay</button>
          <button class="${cab ? 'on' : ''}" onclick="setReqCategory('cab')">Intracity Cab</button>
        </div>
      </div>
      ${cab ? cabFormHTML() : intercityFormHTML()}
    </div>
  </div>`;
}

function intercityFormHTML() {
  const poc = S.mode === 'poc';
  const canPoc = ['poc', 'coordinator', 'admin'].includes(role());
  if (!canPoc && poc) S.mode = 'individual';
  const f = S.form;

  return `
      <div class="field">
        <label>Who is this request for?</label>
        <div class="seg">
          <button class="${!poc ? 'on' : ''}" onclick="setMode('individual')">Just myself</button>
          ${canPoc ? `<button class="${poc ? 'on' : ''}" onclick="setMode('poc')">A team (I'm the POC)</button>` : ''}
        </div>
        ${!canPoc ? `<div class="hint">Raising for a team is available to Team POCs — ask an admin to set your role.</div>` : ''}
      </div>

      ${poc ? `<div class="field">
        <label>Team / group name <span class="hint" style="display:inline">(which team is this request for?)</span></label>
        <input id="cTeam" value="${esc(f.team || '')}" placeholder="e.g. Tamil Development Volunteers">
        <div class="hint">You can raise a separate request for each team you coordinate.</div>
      </div>` : ''}

      <div class="grid2">
        <div class="field"><label>${poc ? 'POC full name' : 'Full name'}</label>
          <input id="cName" value="${esc(f.name ?? S.profile?.full_name ?? '')}" placeholder="e.g. Prabahar Subbiah"></div>
        <div class="field"><label>Phone</label><input id="cPhone" value="${esc(f.phone || '')}" placeholder="+91 …"></div>
      </div>
      <div class="grid2">
        <div class="field"><label>Email <span class="hint" style="display:inline">(ticket &amp; updates go here)</span></label>
          <input id="cEmail" type="email" value="${esc(f.email ?? S.profile?.email ?? '')}" placeholder="name@example.com"></div>
        <div class="field"><label>Originating from</label>
          <input id="cOrigin" value="${esc(f.origin ?? DEFAULT_ORIGIN)}"></div>
      </div>
      <div class="grid2">
        <div class="field"><label>Preferred travel date</label><input type="date" id="cDate" value="${esc(f.date || '')}"></div>
        ${poc ? `<div class="field"><label>Ticket issue preference</label>
          <div class="seg">
            <button class="${S.ticketPref === 'collective' ? 'on' : ''}" onclick="setTicketPref('collective')">One collective ticket</button>
            <button class="${S.ticketPref === 'individual' ? 'on' : ''}" onclick="setTicketPref('individual')">Individual tickets</button>
          </div></div>` : '<div></div>'}
      </div>
      <div class="field"><label>Travel plan / notes</label>
        <textarea id="cPlan" placeholder="Boarding point, preferred timings, return journey, constraints…">${esc(f.plan || '')}</textarea></div>

      ${poc ? `<label class="chk"><input type="checkbox" id="pocTravels" ${S.pocTravels ? 'checked' : ''} onchange="setPocTravels(this.checked)"> The POC is also travelling (add me as a traveller)</label>` : ''}

      <div class="divider"></div>

      <div class="field" style="margin-bottom:8px">
        <label style="margin-bottom:2px">${poc ? 'Team members' : 'Your details'}</label>
        <div class="hint">${poc ? 'Add every traveller. Each needs age, gender, category and ID.' : 'Age, gender, category and ID are needed to book the ticket.'}</div>
      </div>
      <div id="travCards">${poc
        ? S.travForm.map((t, i) => travCardHTML(i, t, false)).join('')
        : travCardHTML(-1, S.solo, true)}</div>
      ${poc ? `<button class="btn btn-ghost btn-sm" onclick="addTrav()">+ Add team member</button>` : ''}

      <div class="actions" style="margin-top:20px">
        <button class="btn btn-primary" id="submitBtn" ${S.busy ? 'disabled' : ''}>${S.busy ? 'Submitting…' : 'Submit request'}</button>
        <button class="btn btn-ghost" onclick="resetForm()">Clear form</button>
      </div>`;
}

function cabFormHTML() {
  const cf = S.cabForm;
  return `
      <div class="grid2">
        <div class="field"><label>Date</label><input type="date" id="cabDate" value="${esc(cf.date || '')}"></div>
        <div class="field"><label>Time</label><input type="time" id="cabTime" value="${esc(cf.time || '')}"></div>
      </div>
      <div class="grid2">
        <div class="field"><label>From</label><select id="cabFrom">
          <option value="">— select pickup —</option>
          ${CAB_FROM.map(f => `<option ${cf.from === f ? 'selected' : ''}>${f}</option>`).join('')}
        </select></div>
        <div class="field"><label>To</label><input value="${esc(CAB_TO)}" disabled></div>
      </div>
      <div class="grid2">
        <div class="field"><label>Type of vehicle</label><select id="cabVehicle">
          <option value="">— select vehicle —</option>
          ${CAB_VEHICLES.map(v => `<option ${cf.vehicle === v ? 'selected' : ''}>${v}</option>`).join('')}
        </select></div>
        <div class="field"><label>No. of pax</label><input id="cabPax" value="${esc(cf.pax || '')}" inputmode="numeric" placeholder="e.g. 4"></div>
      </div>

      <div class="divider"></div>

      <div class="field" style="margin-bottom:8px"><label style="margin-bottom:2px">POC details</label>
        <div class="hint">Whoever the travel desk should reach for pickup coordination.</div></div>
      <div class="grid2">
        <div class="field"><label>Name</label>
          <input id="cabPocName" value="${esc(cf.pocName ?? S.profile?.full_name ?? '')}" placeholder="e.g. Prabahar Subbiah"></div>
        <div class="field"><label>Phone number</label><input id="cabPocPhone" value="${esc(cf.pocPhone || '')}" placeholder="+91 …"></div>
      </div>
      <div class="field"><label>Email ID</label>
        <input id="cabPocEmail" type="email" value="${esc(cf.pocEmail ?? S.profile?.email ?? '')}" placeholder="name@example.com"></div>

      <div class="actions" style="margin-top:20px">
        <button class="btn btn-primary" id="cabSubmitBtn" ${S.busy ? 'disabled' : ''}>${S.busy ? 'Submitting…' : 'Submit cab request'}</button>
        <button class="btn btn-ghost" onclick="resetCabForm()">Clear form</button>
      </div>`;
}

function travCardHTML(i, t, solo) {
  const title = solo ? 'Traveller' : t.isPoc ? 'You (POC)' : 'Member ' + (i + 1);
  const f = (name) => `data-f="${name}" data-i="${i}"`;
  return `<div class="trav-card">
    <div class="thead"><span class="tnum">${title}</span>
      ${solo || t.isPoc ? '' : `<button class="x-btn" onclick="removeTrav(${i})">Remove</button>`}</div>
    ${solo ? '' : `<div class="field"><label>Name</label><input ${f('name')} value="${esc(t.name)}" placeholder="Member name"></div>`}
    <div class="grid3">
      <div class="field"><label>Age</label><input ${f('age')} value="${esc(t.age)}" placeholder="Age" inputmode="numeric"></div>
      <div class="field"><label>Gender</label><select ${f('gender')}>
        <option value="">—</option>
        ${GENDERS.map(g => `<option ${t.gender === g ? 'selected' : ''}>${g}</option>`).join('')}
      </select></div>
      <div class="field"><label>Category</label><select ${f('category')}>
        ${CATEGORIES.map(c => `<option ${t.category === c ? 'selected' : ''}>${c}</option>`).join('')}
      </select></div>
    </div>
    <div class="grid2">
      <div class="field"><label>ID card number</label>
        <input ${f('idNumber')} value="${esc(t.idNumber)}" placeholder="e.g. Aadhaar / passport no."></div>
      <div class="field"><label>Travel preference</label><select data-f="travel" data-i="${i}" data-rerender="1">
        ${TRAVEL_MODES.map(m => `<option ${t.travel === m ? 'selected' : ''}>${m}</option>`).join('')}
      </select></div>
    </div>
    ${travelFieldsHTML(i, t)}
    <div class="field" style="margin-bottom:0">
      <label>ID proof upload <span class="hint" style="display:inline">(used only to book the ticket)</span></label>
      <div class="file-drop ${t.file ? 'has-file' : ''}" onclick="pickFile(${i})">
        <span>${t.file ? '✓ ' + esc(t.file.name) : 'Tap to attach ID (JPG / PNG / PDF)'}</span>
      </div>
      <input type="file" accept="image/*,.pdf" hidden id="travFile${i}" data-file="${i}">
    </div>
  </div>`;
}

function travelFieldsHTML(i, t) {
  const f = name => `data-f="${name}" data-i="${i}"`;
  if (t.travel === 'Train') return `<div class="grid2">
    <div class="field"><label>Train name</label><input ${f('trainName')} value="${esc(t.trainName)}" placeholder="e.g. Kovai Express"></div>
    <div class="field"><label>Train number</label><input ${f('trainNumber')} value="${esc(t.trainNumber)}" placeholder="e.g. 12675"></div></div>`;
  if (t.travel === 'Flight') return `<div class="grid2">
    <div class="field"><label>Flight name / airline</label><input ${f('flightName')} value="${esc(t.flightName)}" placeholder="e.g. IndiGo"></div>
    <div class="field"><label>Flight number</label><input ${f('flightNumber')} value="${esc(t.flightNumber)}" placeholder="e.g. 6E 204"></div></div>`;
  if (t.travel === 'Bus') return `<div class="field"><label>Bus name / operator</label>
    <input ${f('busName')} value="${esc(t.busName)}" placeholder="e.g. KSRTC Airavat"></div>`;
  return `<div class="hint" style="margin:-4px 0 12px">Travelling by their own arrangement — no ticket will be booked by the travel desk.</div>`;
}

window.setReqCategory = c => { captureForm(); captureCabForm(); S.reqCategory = c; render(); };
window.setMode = m => { S.mode = m; if (m === 'poc' && !S.travForm.length) S.travForm = [blankTrav()]; captureForm(); render(); };
window.setTicketPref = p => { captureForm(); S.ticketPref = p; render(); };
window.setPocTravels = v => {
  captureForm();
  S.pocTravels = v;
  // Give the POC a real, editable traveller card rather than a hidden blank row —
  // their age, gender and ID are needed to book a ticket just like anyone else's.
  S.travForm = S.travForm.filter(t => !t.isPoc);
  if (v) S.travForm.unshift(blankTrav({ isPoc: true, category: 'POC', name: (S.form.name || '').trim() }));
  render();
};
window.addTrav = () => { captureForm(); S.travForm.push(blankTrav()); render(); };
window.removeTrav = i => {
  captureForm(); S.travForm.splice(i, 1);
  if (!S.travForm.length) S.travForm = [blankTrav()];
  render();
};
window.pickFile = i => el('travFile' + i)?.click();
window.resetForm = () => {
  S.form = {}; S.solo = blankTrav(); S.travForm = S.mode === 'poc' ? [blankTrav()] : [];
  S.pocTravels = false; render(); toast('Form cleared.');
};

function captureForm() {
  if (S.view !== 'submit') return;
  const f = S.form;
  [['cName', 'name'], ['cPhone', 'phone'], ['cEmail', 'email'], ['cOrigin', 'origin'],
   ['cDate', 'date'], ['cPlan', 'plan'], ['cTeam', 'team']].forEach(([id, key]) => {
    if (el(id)) f[key] = el(id).value;
  });
}

function captureCabForm() {
  if (S.view !== 'submit') return;
  const f = S.cabForm;
  [['cabDate', 'date'], ['cabTime', 'time'], ['cabFrom', 'from'], ['cabVehicle', 'vehicle'],
   ['cabPax', 'pax'], ['cabPocName', 'pocName'], ['cabPocPhone', 'pocPhone'], ['cabPocEmail', 'pocEmail']].forEach(([id, key]) => {
    if (el(id)) f[key] = el(id).value;
  });
}

function wireView() {
  if (S.view !== 'submit') return;

  document.querySelectorAll('#travCards [data-f]').forEach(node => {
    const i = +node.dataset.i, key = node.dataset.f;
    const handler = () => {
      setTrav(i, key, node.value);
      if (node.dataset.rerender) { captureForm(); render(); }
    };
    node.addEventListener(node.tagName === 'SELECT' ? 'change' : 'input', handler);
  });

  document.querySelectorAll('#travCards [data-file]').forEach(node => {
    node.addEventListener('change', () => {
      if (!node.files[0]) return;
      setTrav(+node.dataset.file, 'file', node.files[0]);
      captureForm(); render();
    });
  });

  if (el('submitBtn')) el('submitBtn').onclick = submitRequest;
  if (el('cabSubmitBtn')) el('cabSubmitBtn').onclick = submitCabRequest;
}

function setTrav(i, key, v) {
  const target = (S.mode === 'individual' || i < 0) ? S.solo : S.travForm[i];
  if (target) target[key] = v;
}

function travPayload(t, name, path) {
  return {
    name, age: t.age || '', gender: t.gender || '', category: t.category || '',
    id_number: t.idNumber || '', id_image_path: path || '',
    travel_mode: t.travel || '',
    train_name: t.travel === 'Train' ? t.trainName : '',
    train_number: t.travel === 'Train' ? t.trainNumber : '',
    flight_name: t.travel === 'Flight' ? t.flightName : '',
    flight_number: t.travel === 'Flight' ? t.flightNumber : '',
    bus_name: t.travel === 'Bus' ? t.busName : '',
  };
}

async function uploadId(t) {
  if (!t.file) return '';
  const safe = t.file.name.replace(/[^\w.\-]/g, '_');
  const path = `ids/${S.session.user.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${safe}`;
  const { error } = await sb.storage.from('mkn-ids').upload(path, t.file);
  if (error) throw error;
  return path;
}

async function submitRequest() {
  captureForm();
  const f = S.form;
  const name = (f.name || '').trim();
  if (!name) return toast('Please enter a name.');

  const poc = S.mode === 'poc';
  const team = (f.team || '').trim();
  if (poc && !team) return toast('Please name the team this request is for.');

  // Assemble the traveller list before touching the network, so validation fails fast.
  let entries;
  if (poc) {
    entries = S.travForm.filter(t => t.name.trim()).map(t => ({ t, name: t.name.trim() }));
    if (!entries.length) return toast('Add at least one team member.');
  } else {
    entries = [{ t: S.solo, name }];
  }

  const incomplete = entries.find(e => !e.t.age || !e.t.gender);
  if (incomplete) return toast(`Age and gender are needed for ${incomplete.name}.`);

  S.busy = true; render();
  try {
    const payload = [];
    for (const e of entries) payload.push(travPayload(e.t, e.name, await uploadId(e.t)));

    const { data, error } = await sb.rpc('mkn_tr_submit', {
      p_request: {
        mode: S.mode, team: poc ? team : '',
        contact_name: name, contact_phone: f.phone || '', contact_email: f.email || '',
        origin: f.origin || DEFAULT_ORIGIN, travel_date: f.date || '', plan: f.plan || '',
        ticket_pref: poc ? S.ticketPref : '',
      },
      p_travellers: payload,
    });
    if (error) throw error;

    S.busy = false;
    if (poc) {
      // Keep the POC's own details so they can raise the next team straight away.
      S.form.team = ''; S.form.plan = '';
      S.travForm = [blankTrav()]; S.pocTravels = false;
      S.open.clear();
      await refresh(); render();
      toast(`"${team}" submitted as ${data}. Raise another team, or you're done.`);
    } else {
      S.form = {}; S.solo = blankTrav();
      await refresh(); render();
      toast(`Request ${data} submitted — now with the coordinator.`);
    }
  } catch (err) {
    S.busy = false; render();
    toast(err.message || String(err));
  }
}

async function submitCabRequest() {
  captureCabForm();
  const f = S.cabForm;
  if (!(f.pocName || '').trim()) return toast('Please enter the POC name.');
  if (!f.from) return toast('Pick a pickup location.');
  if (!f.vehicle) return toast('Pick a type of vehicle.');

  S.busy = true; render();
  try {
    const { data, error } = await sb.rpc('mkn_cab_submit', {
      p_request: {
        poc_name: f.pocName.trim(), poc_email: f.pocEmail || '', poc_phone: f.pocPhone || '',
        travel_date: f.date || '', travel_time: f.time || '',
        from_location: f.from, vehicle_type: f.vehicle, pax_count: f.pax || '',
      },
    });
    if (error) throw error;

    S.busy = false;
    S.cabForm = {};
    await refresh(); render();
    toast(`Cab request ${data} submitted — now with the coordinator.`);
  } catch (err) {
    S.busy = false; render();
    toast(err.message || String(err));
  }
}
window.resetCabForm = () => { S.cabForm = {}; render(); toast('Form cleared.'); };

/* ---------------- shared request card ---------------- */
function stepper(status) {
  if (status === 'rejected') return '';
  const idx = STAGES.indexOf(status);
  return `<div class="stepper">` + STAGES.map((s, i) => {
    const cls = i < idx ? 'done' : (i === idx ? 'now' : '');
    return `<div class="stp ${cls}"><div class="dot">${i < idx ? '✓' : i + 1}</div>
      <div class="lbl">${STAGE_LABEL[s]}</div>${i < STAGES.length - 1 ? '<div class="line"></div>' : ''}</div>`;
  }).join('') + `</div>`;
}

function statusChip(status) {
  const [cls, label] = STATUS_CHIP[status];
  return `<span class="chip ${cls}"><span class="chip-dot"></span>${label}</span>`;
}

function peopleTable(r) {
  return `<div class="ptable-wrap"><table class="ptable">
    <thead><tr><th>Traveller</th><th>Age</th><th>Gender</th><th>Category</th><th>ID number</th>
      <th>ID proof</th><th>Travel</th><th>Details</th>${r.status === 'booked' || r.status === 'complete' ? '<th>PNR</th>' : ''}${r.status === 'complete' ? '<th>Bed</th>' : ''}</tr></thead>
    <tbody>${travellers(r).map(p => `<tr>
      <td style="font-weight:600">${esc(p.name)}</td>
      <td>${esc(p.age ?? '—')}</td>
      <td>${esc(p.gender || '—')}</td>
      <td>${esc(p.category || '—')}</td>
      <td>${esc(p.id_number_masked || '—')}</td>
      <td>${p.id_image_path ? `<a href="#" onclick="viewFile(event,'mkn-ids','${esc(p.id_image_path)}')">view</a>` : '—'}</td>
      <td>${esc(p.travel_mode || '—')}</td>
      <td>${esc(travelDetail(p) || '—')}</td>
      ${r.status === 'booked' || r.status === 'complete' ? `<td>${esc(p.pnr || (needsTicket(p) ? '—' : 'own'))}</td>` : ''}
      ${r.status === 'complete' ? `<td>${esc(p.bed_label || '—')}</td>` : ''}
    </tr>`).join('')}</tbody></table></div>`;
}

function reqCard(r, inner) {
  const list = travellers(r);
  const modeChip = r.mode === 'poc'
    ? `<span class="chip mode">Team · ${list.length} pax</span>`
    : `<span class="chip mode">Individual</span>`;
  const sub = r.mode === 'poc'
    ? `Team: ${r.team || '—'} · POC`
    : (list[0]?.category || 'Traveller');

  return `<div class="req ${S.open.has(r.id) ? 'open' : ''}" id="req-${r.id}">
    <div class="req-head" onclick="toggleReq('${r.id}')">
      <div class="req-avatar">${initials(r.contact_name)}</div>
      <div><div class="req-title">${esc(r.contact_name)}</div>
        <div class="req-sub">${esc(sub)} · ${esc(r.origin || '—')} · ${esc(r.travel_date || 'no date')}</div></div>
      <div class="req-right">${modeChip}${statusChip(r.status)}<span class="caret">▶</span></div>
    </div>
    <div class="req-body">
      ${stepper(r.status)}
      <div class="detail-grid">
        <div><div class="k">Request</div><div class="v">${esc(r.id)}</div></div>
        <div><div class="k">Phone</div><div class="v">${esc(r.contact_phone || '—')}</div></div>
        <div><div class="k">Email</div><div class="v">${esc(r.contact_email || '—')}</div></div>
        <div><div class="k">Travel date</div><div class="v">${esc(r.travel_date || '—')}</div></div>
        ${r.ticket_pref ? `<div><div class="k">Ticket</div><div class="v">${esc(r.ticket_pref)}</div></div>` : ''}
      </div>
      ${r.plan ? `<div class="k" style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:600">Travel plan</div>
        <div class="v" style="font-size:14px;margin:2px 0 10px">${esc(r.plan)}</div>` : ''}
      ${r.rejection_reason ? `<div class="notice">Sent back: ${esc(r.rejection_reason)}</div>` : ''}
      ${peopleTable(r)}
      ${r.ticket_path ? `<div class="hint" style="margin-bottom:8px">📎 <a href="#" onclick="viewFile(event,'mkn-tickets','${esc(r.ticket_path)}')">View booked ticket</a></div>` : ''}
      ${inner || ''}
    </div>
  </div>`;
}

window.toggleReq = id => {
  if (S.open.has(id)) S.open.delete(id); else S.open.add(id);
  el('req-' + id)?.classList.toggle('open');
};

window.viewFile = async (e, bucket, path) => {
  e.preventDefault();
  const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, 300);
  if (error) return toast(error.message);
  window.open(data.signedUrl, '_blank');
};

function listOrEmpty(items, innerFn, emptyMsg, cardFn = reqCard) {
  if (!items.length) return `<div class="empty"><div class="big">All clear</div><div>${emptyMsg}</div></div>`;
  return items.map(r => cardFn(r, innerFn(r))).join('');
}

/* ---------------- shared cab request card ---------------- */
function cabStepper(status) {
  if (status === 'rejected') return '';
  const stages = ['submitted', 'approved', 'booked'];
  const labels = { submitted: 'Submitted', approved: 'Approved', booked: 'Cab booked' };
  const idx = stages.indexOf(status);
  return `<div class="stepper">` + stages.map((s, i) => {
    const cls = i < idx ? 'done' : (i === idx ? 'now' : '');
    return `<div class="stp ${cls}"><div class="dot">${i < idx ? '✓' : i + 1}</div>
      <div class="lbl">${labels[s]}</div>${i < stages.length - 1 ? '<div class="line"></div>' : ''}</div>`;
  }).join('') + `</div>`;
}

function cabStatusChip(status) {
  const [cls, label] = CAB_STATUS_CHIP[status];
  return `<span class="chip ${cls}"><span class="chip-dot"></span>${label}</span>`;
}

function cabTimeLabel(t) { return t ? String(t).slice(0, 5) : ''; }

function cabCard(r, inner) {
  return `<div class="req ${S.open.has(r.id) ? 'open' : ''}" id="req-${r.id}">
    <div class="req-head" onclick="toggleReq('${r.id}')">
      <div class="req-avatar">🚕</div>
      <div><div class="req-title">${esc(r.poc_name)}</div>
        <div class="req-sub">Intracity cab · ${esc(r.from_location)} → SSB · ${esc(r.travel_date || 'no date')}${cabTimeLabel(r.travel_time) ? ' · ' + esc(cabTimeLabel(r.travel_time)) : ''}</div></div>
      <div class="req-right"><span class="chip mode">${esc(r.vehicle_type)}${r.pax_count ? ' · ' + esc(r.pax_count) + ' pax' : ''}</span>${cabStatusChip(r.status)}<span class="caret">▶</span></div>
    </div>
    <div class="req-body">
      ${cabStepper(r.status)}
      <div class="detail-grid">
        <div><div class="k">Request</div><div class="v">${esc(r.id)}</div></div>
        <div><div class="k">From</div><div class="v">${esc(r.from_location)}</div></div>
        <div><div class="k">To</div><div class="v">${esc(r.to_location)}</div></div>
        <div><div class="k">Date &amp; time</div><div class="v">${esc(r.travel_date || '—')}${cabTimeLabel(r.travel_time) ? ' · ' + esc(cabTimeLabel(r.travel_time)) : ''}</div></div>
        <div><div class="k">Vehicle</div><div class="v">${esc(r.vehicle_type)}</div></div>
        <div><div class="k">Pax</div><div class="v">${esc(r.pax_count ?? '—')}</div></div>
        <div><div class="k">POC</div><div class="v">${esc(r.poc_name)}</div></div>
        <div><div class="k">Phone</div><div class="v">${esc(r.poc_phone || '—')}</div></div>
        <div><div class="k">Email</div><div class="v">${esc(r.poc_email || '—')}</div></div>
      </div>
      ${r.rejection_reason ? `<div class="notice">Sent back: ${esc(r.rejection_reason)}</div>` : ''}
      ${r.status === 'booked' ? `<div class="assigned">🚗 Driver: ${esc(r.driver_name)} · ${esc(r.driver_phone)}${r.vehicle_number ? ' · ' + esc(r.vehicle_number) : ''}</div>` : ''}
      ${inner || ''}
    </div>
  </div>`;
}

/* ---------------- 2 · coordinator ---------------- */
function coordView() {
  const cab = S.coordType === 'cab';
  const all = S.requests;
  const pending = all.filter(r => r.status === 'submitted');
  const approved = all.filter(r => r.status === 'approved');
  const pax = all.reduce((n, r) => n + travellers(r).length, 0);
  const free = S.beds.filter(b => !b.traveller_id).length;
  const cabPending = S.cabRequests.filter(c => c.status === 'submitted');
  const cabApproved = S.cabRequests.filter(c => c.status === 'approved');
  const onApproved = S.coordFilter === 'approved';

  return `<div class="view active">
    <div class="view-head"><h2>Coordinator — review &amp; approve</h2>
      <p>Fresh requests land here. Approve to pass the request to the travel desk, or send it back. Once approved, an
      intercity request can still be edited or disapproved here until the travel desk books it.</p></div>
    <div class="stats">
      <div class="stat"><div class="n">${all.length}</div><div class="l">Intercity requests</div></div>
      <div class="stat"><div class="n">${pax}</div><div class="l">Travellers</div></div>
      <div class="stat"><div class="n">${cab ? cabPending.length : pending.length}</div><div class="l">To review</div></div>
      <div class="stat"><div class="n">${all.filter(r => r.status === 'complete').length}</div><div class="l">Confirmed</div></div>
      <div class="stat"><div class="n">${free}</div><div class="l">Beds free</div></div>
    </div>
    <div class="seg" style="margin-bottom:10px">
      <button class="${!cab ? 'on' : ''}" onclick="setCoordType('intercity')">Intercity requests</button>
      <button class="${cab ? 'on' : ''}" onclick="setCoordType('cab')">Intracity cabs</button>
    </div>
    <div class="seg" style="margin-bottom:18px">
      <button class="${!onApproved ? 'on' : ''}" onclick="setCoordFilter('review')">To review</button>
      <button class="${onApproved ? 'on' : ''}" onclick="setCoordFilter('approved')">Approved</button>
    </div>
    ${cab
      ? (onApproved
          ? listOrEmpty(cabApproved, r => cabCoordInner(r, 'approved'), 'No approved cab requests yet.', cabCard)
          : listOrEmpty(cabPending, r => cabCoordInner(r, 'review'), 'No cab requests waiting for review.', cabCard))
      : (onApproved
          ? listOrEmpty(approved, r => coordInner(r, 'approved'), 'No approved requests yet.')
          : listOrEmpty(pending, r => coordInner(r, 'review'), 'No requests waiting for review.'))}
  </div>`;
}
window.setCoordFilter = f => { S.coordFilter = f; render(); };
window.setCoordType = t => { S.coordType = t; render(); };

function coordInner(r, stage) {
  if (S.editing.has(r.id)) return editForm(r);
  const editBtn = `<button class="btn btn-ghost btn-sm" onclick="startEdit('${r.id}')">Edit details</button>`;
  if (stage === 'approved') {
    return `<div class="actions">
      ${editBtn}
      <button class="btn btn-ghost btn-sm" onclick="decide('${r.id}','rejected')">Disapprove</button>
      <span class="hint">Sends it back to the requester with a reason, as if it had never been approved.</span>
    </div>`;
  }
  return `<div class="actions">
    <button class="btn btn-primary btn-sm" onclick="decide('${r.id}','approved')">Approve → send to travel desk</button>
    <button class="btn btn-ghost btn-sm" onclick="decide('${r.id}','rejected')">Send back</button>
    ${editBtn}
  </div>`;
}

window.decide = async (id, decision) => {
  let reason = null;
  if (decision === 'rejected') {
    reason = prompt('Reason for sending this back (optional):');
    if (reason === null) return;
  }
  const { error } = await sb.rpc('mkn_tr_decide', { p_request_id: id, p_decision: decision, p_reason: reason || null });
  if (error) return toast(error.message);
  await refresh(); render();
  toast(decision === 'approved' ? 'Approved — sent to travel desk.' : 'Sent back to the requester.');
};

function cabCoordInner(r, stage) {
  if (stage === 'approved') {
    return `<div class="actions">
      <button class="btn btn-ghost btn-sm" onclick="cabDecide('${r.id}','rejected')">Disapprove</button>
      <span class="hint">Sends it back to the requester with a reason, as if it had never been approved.</span>
    </div>`;
  }
  return `<div class="actions">
    <button class="btn btn-primary btn-sm" onclick="cabDecide('${r.id}','approved')">Approve → send to travel desk</button>
    <button class="btn btn-ghost btn-sm" onclick="cabDecide('${r.id}','rejected')">Send back</button>
  </div>`;
}

window.cabDecide = async (id, decision) => {
  let reason = null;
  if (decision === 'rejected') {
    reason = prompt('Reason for sending this back (optional):');
    if (reason === null) return;
  }
  const { error } = await sb.rpc('mkn_cab_decide', { p_request_id: id, p_decision: decision, p_reason: reason || null });
  if (error) return toast(error.message);
  await refresh(); render();
  toast(decision === 'approved' ? 'Approved — sent to travel desk.' : 'Sent back to the requester.');
};

/* ---------------- coordinator: edit request & traveller details ---------------- */
function editForm(r) {
  const list = travellers(r);
  return `<div class="workbox">
    <label>Request details</label>
    <div class="grid2">
      <div class="field"><label>${r.mode === 'poc' ? 'POC full name' : 'Full name'}</label>
        <input id="edh-name-${r.id}" value="${esc(r.contact_name)}"></div>
      <div class="field"><label>Phone</label><input id="edh-phone-${r.id}" value="${esc(r.contact_phone || '')}"></div>
    </div>
    <div class="grid2">
      <div class="field"><label>Email</label><input id="edh-email-${r.id}" type="email" value="${esc(r.contact_email || '')}"></div>
      <div class="field"><label>Originating from</label><input id="edh-origin-${r.id}" value="${esc(r.origin || '')}"></div>
    </div>
    <div class="grid2">
      <div class="field"><label>Travel date</label><input type="date" id="edh-date-${r.id}" value="${esc(r.travel_date || '')}"></div>
      ${r.mode === 'poc' ? `<div class="field"><label>Team / group name</label><input id="edh-team-${r.id}" value="${esc(r.team || '')}"></div>` : '<div></div>'}
    </div>
    <div class="field"><label>Travel plan / notes</label><textarea id="edh-plan-${r.id}">${esc(r.plan || '')}</textarea></div>
  </div>
  <div class="workbox">
    <label>Travellers</label>
    ${list.map(p => `<div class="trav-card">
      <div class="thead"><span class="tnum">${esc(p.name)}</span></div>
      <div class="grid3">
        <div class="field"><label>Name</label><input id="edt-name-${p.id}" value="${esc(p.name)}"></div>
        <div class="field"><label>Age</label><input id="edt-age-${p.id}" value="${esc(p.age ?? '')}" inputmode="numeric"></div>
        <div class="field"><label>Gender</label><select id="edt-gender-${p.id}">
          <option value="">—</option>
          ${GENDERS.map(g => `<option ${p.gender === g ? 'selected' : ''}>${g}</option>`).join('')}
        </select></div>
      </div>
      <div class="grid2">
        <div class="field"><label>Category</label><select id="edt-category-${p.id}">
          ${CATEGORIES.map(c => `<option ${p.category === c ? 'selected' : ''}>${c}</option>`).join('')}
        </select></div>
        <div class="field"><label>Travel mode</label><select id="edt-mode-${p.id}">
          ${TRAVEL_MODES.map(m => `<option ${p.travel_mode === m ? 'selected' : ''}>${m}</option>`).join('')}
        </select></div>
      </div>
      <div class="grid2">
        <div class="field"><label>Train name</label><input id="edt-trainName-${p.id}" value="${esc(p.train_name || '')}"></div>
        <div class="field"><label>Train number</label><input id="edt-trainNumber-${p.id}" value="${esc(p.train_number || '')}"></div>
      </div>
      <div class="grid2">
        <div class="field"><label>Flight name</label><input id="edt-flightName-${p.id}" value="${esc(p.flight_name || '')}"></div>
        <div class="field"><label>Flight number</label><input id="edt-flightNumber-${p.id}" value="${esc(p.flight_number || '')}"></div>
      </div>
      <div class="field"><label>Bus name</label><input id="edt-busName-${p.id}" value="${esc(p.bus_name || '')}"></div>
      <div class="field" style="margin-bottom:0"><label>ID card number <span class="hint" style="display:inline">(leave blank to keep the one on file)</span></label>
        <input id="edt-idNumber-${p.id}" placeholder="only if it needs correcting"></div>
    </div>`).join('')}
  </div>
  <div class="actions">
    <button class="btn btn-primary btn-sm" onclick="saveEdit('${r.id}')">Save changes</button>
    <button class="btn btn-ghost btn-sm" onclick="cancelEdit('${r.id}')">Cancel</button>
  </div>`;
}

window.startEdit = id => { S.editing.add(id); S.open.add(id); render(); };
window.cancelEdit = id => { S.editing.delete(id); render(); };

window.saveEdit = async id => {
  const r = S.requests.find(x => x.id === id);
  const list = travellers(r);
  const p_request = {
    contact_name: val(`edh-name-${id}`), contact_phone: val(`edh-phone-${id}`),
    contact_email: val(`edh-email-${id}`), origin: val(`edh-origin-${id}`),
    travel_date: val(`edh-date-${id}`), plan: val(`edh-plan-${id}`),
    team: r.mode === 'poc' ? val(`edh-team-${id}`) : r.team,
  };
  if (!p_request.contact_name) return toast('Full name is required.');
  const p_travellers = list.map(p => ({
    id: p.id, name: val(`edt-name-${p.id}`), age: val(`edt-age-${p.id}`),
    gender: el(`edt-gender-${p.id}`)?.value || '', category: el(`edt-category-${p.id}`)?.value || '',
    travel_mode: el(`edt-mode-${p.id}`)?.value || '',
    train_name: val(`edt-trainName-${p.id}`), train_number: val(`edt-trainNumber-${p.id}`),
    flight_name: val(`edt-flightName-${p.id}`), flight_number: val(`edt-flightNumber-${p.id}`),
    bus_name: val(`edt-busName-${p.id}`), id_number: val(`edt-idNumber-${p.id}`),
  }));
  const incomplete = p_travellers.find(t => !t.name);
  if (incomplete) return toast('Every traveller needs a name.');

  const { error } = await sb.rpc('mkn_tr_edit', { p_request_id: id, p_request, p_travellers });
  if (error) return toast(error.message);
  S.editing.delete(id);
  await refresh(); render();
  toast('Details updated.');
};

/* ---------------- 3 · travel desk & 4 · accommodation ---------------- */
function deskView(which) {
  const isTravel = which === 'travel';
  const done = S.deskFilter === 'done';
  const cab = isTravel && S.travelType === 'cab';

  if (cab) {
    const items = S.cabRequests.filter(c => done ? c.status === 'booked' : c.status === 'approved');
    const emptyMsg = done ? 'No booked cabs yet.' : 'No approved cab requests waiting to be booked.';
    return `<div class="view active">
      <div class="view-head"><h2>Travel desk — book cabs</h2>
        <p>Approved cab requests await booking. Enter the driver's name, phone number and the vehicle number, then confirm to share the details with the POC.</p></div>
      <div class="seg" style="margin-bottom:10px">
        <button class="${!cab ? 'on' : ''}" onclick="setTravelType('intercity')">Intercity requests</button>
        <button class="on" onclick="setTravelType('cab')">Intracity cabs</button>
      </div>
      <div class="seg" style="margin-bottom:18px">
        <button class="${!done ? 'on' : ''}" onclick="setDeskFilter('pending')">Awaiting booking</button>
        <button class="${done ? 'on' : ''}" onclick="setDeskFilter('done')">Booked</button>
      </div>
      ${listOrEmpty(items, cabTravelInner, emptyMsg, cabCard)}
    </div>`;
  }

  const head = isTravel
    ? { t: 'Travel desk — book tickets', p: 'Approved requests await ticketing. Enter the PNR / ticket reference (or a collective reference), attach the booked ticket, then confirm to notify the requester and pass on for bed allotment.' }
    : { t: 'Accommodation — allot beds', p: 'Ticketed travellers await a bed. Pick a free bed from the master for each person, then confirm to complete and notify.' };
  const pendingStatus = isTravel ? 'approved' : 'booked';
  const doneStatuses = isTravel ? ['booked', 'complete'] : ['complete'];
  const items = S.requests.filter(r => done ? doneStatuses.includes(r.status) : r.status === pendingStatus);
  const emptyMsg = done
    ? (isTravel ? 'No booked tickets yet.' : 'No housed travellers yet.')
    : (isTravel ? 'No approved requests waiting for tickets.' : 'No ticketed travellers waiting for beds.');
  return `<div class="view active">
    <div class="view-head"><h2>${head.t}</h2><p>${head.p}</p></div>
    ${isTravel ? `<div class="seg" style="margin-bottom:10px">
      <button class="on" onclick="setTravelType('intercity')">Intercity requests</button>
      <button class="" onclick="setTravelType('cab')">Intracity cabs</button>
    </div>` : ''}
    <div class="seg" style="margin-bottom:18px">
      <button class="${!done ? 'on' : ''}" onclick="setDeskFilter('pending')">${isTravel ? 'Awaiting ticket' : 'Awaiting bed'}</button>
      <button class="${done ? 'on' : ''}" onclick="setDeskFilter('done')">${isTravel ? 'Booked' : 'Housed'}</button>
    </div>
    ${listOrEmpty(items, isTravel ? travelInner : accomInner, emptyMsg)}
  </div>`;
}
window.setDeskFilter = f => { S.deskFilter = f; render(); };
window.setTravelType = t => { S.travelType = t; render(); };

function cabTravelInner(r) {
  return `<div class="workbox"><label>Cab booking</label>
    <div class="grid2">
      <div class="field"><label>Driver name</label><input id="drvName-${r.id}" value="${esc(r.driver_name || '')}" placeholder="Driver's full name"></div>
      <div class="field"><label>Driver phone</label><input id="drvPhone-${r.id}" value="${esc(r.driver_phone || '')}" placeholder="+91 …"></div>
    </div>
    <div class="field" style="margin-bottom:0"><label>Vehicle number</label>
      <input id="drvVehicle-${r.id}" value="${esc(r.vehicle_number || '')}" placeholder="e.g. KA-01-AB-1234"></div>
  </div>
  <div class="actions">
    <button class="btn btn-primary btn-sm" onclick="bookCab('${r.id}')">${r.status === 'approved' ? 'Confirm booking' : 'Update booking'} &amp; notify</button>
    <span class="hint">${r.status === 'approved' ? `Shares the driver's details with ${esc(r.poc_email || 'the POC')}.` : 'Corrects the driver details already on file.'}</span>
  </div>`;
}

window.bookCab = async id => {
  const name = val(`drvName-${id}`), phone = val(`drvPhone-${id}`), vehicle = val(`drvVehicle-${id}`);
  if (!name) return toast('Enter the driver name.');
  if (!phone) return toast('Enter the driver phone number.');
  const { error } = await sb.rpc('mkn_cab_book', { p_request_id: id, p_driver_name: name, p_driver_phone: phone, p_vehicle_number: vehicle || null });
  if (error) return toast(error.message);
  await refresh(); render();
  toast('Cab booked ✓ Driver details shared with the POC.');
};

function travelInner(r) {
  const list = travellers(r);
  const collective = r.ticket_pref === 'collective';
  const rows = collective
    ? `<div class="field" style="margin-bottom:0"><label>Collective ticket reference / PNR</label>
        <input id="pnrAll-${r.id}" value="${esc(list.find(p => p.pnr)?.pnr || '')}" placeholder="e.g. PNR-XXXX for the group"></div>`
    : list.map(p => `<div class="field" style="margin-bottom:8px">
        <label>${esc(p.name)} · ${esc(p.travel_mode || '—')}${travelDetail(p) ? ' · ' + esc(travelDetail(p)) : ''}</label>
        <input id="pnr-${p.id}" value="${esc(p.pnr || '')}" ${needsTicket(p) ? '' : 'disabled'}
          placeholder="${needsTicket(p) ? 'PNR / ticket ref' : 'Own arrangement — no ticket needed'}"></div>`).join('');

  return `<div class="workbox"><label>Ticket booking</label>${rows}
    <div class="file-drop" style="margin-top:8px" onclick="pickTicket('${r.id}')" id="tktDrop-${r.id}">
      <span>Attach booked ticket (PDF / image)</span></div>
    <input type="file" accept="image/*,.pdf" hidden id="tktFile-${r.id}" onchange="ticketPicked('${r.id}')">
  </div>
  <div class="actions">
    <button class="btn btn-primary btn-sm" onclick="book('${r.id}',${collective})">${r.status === 'approved' ? 'Confirm booking' : 'Update booking'} &amp; notify</button>
    <span class="hint">${r.status === 'approved' ? `Emails the ticket to ${esc(r.contact_email || 'the requester')} and passes on for bed allotment.` : 'Corrects the PNR / ticket already on file.'}</span>
  </div>`;
}

const ticketFiles = {};
window.pickTicket = id => el('tktFile-' + id)?.click();
window.ticketPicked = id => {
  const f = el('tktFile-' + id)?.files[0];
  if (!f) return;
  ticketFiles[id] = f;
  const drop = el('tktDrop-' + id);
  drop.classList.add('has-file');
  drop.querySelector('span').textContent = '✓ ' + f.name;
};

window.book = async (id, collective) => {
  const r = S.requests.find(x => x.id === id);
  const list = travellers(r);
  const pnrs = {};
  if (collective) {
    const shared = (el('pnrAll-' + id)?.value || '').trim();
    if (!shared) return toast('Enter the collective ticket reference.');
    list.forEach(p => { if (needsTicket(p)) pnrs[p.id] = shared; });
  } else {
    for (const p of list) {
      if (!needsTicket(p)) continue;
      const v = (el('pnr-' + p.id)?.value || '').trim();
      if (!v) return toast(`Enter a ticket reference for ${p.name}.`);
      pnrs[p.id] = v;
    }
  }

  let path = null;
  const file = ticketFiles[id];
  if (file) {
    path = `tickets/${id}-${Date.now()}-${file.name.replace(/[^\w.\-]/g, '_')}`;
    const up = await sb.storage.from('mkn-tickets').upload(path, file);
    if (up.error) return toast(up.error.message);
  }

  const { error } = await sb.rpc('mkn_tr_book', { p_request_id: id, p_pnrs: pnrs, p_ticket_path: path });
  if (error) return toast(error.message);
  delete ticketFiles[id];
  await refresh(); render();
  toast('Tickets booked ✓ Requester notified. Now awaiting bed.');
};

function accomInner(r) {
  const rows = travellers(r).map(p => {
    if (p.bed_id) return `<div class="assigned">🛏 ${esc(p.name)} → ${esc(p.bed_label)}
      <button class="x-btn" style="margin-left:auto" onclick="setBed('${p.id}','')">Change</button></div>`;
    return `<div class="field" style="margin-bottom:8px">
      <label>${esc(p.name)} · ${esc(p.gender || '—')} · ${esc(p.category || '—')}</label>
      <select onchange="setBed('${p.id}',this.value)">${bedOptions(null)}</select></div>`;
  }).join('');
  return `<div class="workbox"><label>Bed allotment at SSB</label>${rows}</div>
  ${r.status === 'complete'
    ? `<div class="hint" style="margin-top:10px">All travellers housed. Use "Change" above to reassign a bed if needed.</div>`
    : `<div class="actions">
        <button class="btn btn-primary btn-sm" onclick="completeReq('${r.id}')">Allot beds &amp; confirm</button>
        <span class="hint">Sends final stay details to ${esc(r.contact_email || 'the requester')}.</span>
      </div>`}`;
}

function bedOptions(selected) {
  const byLoc = {};
  S.beds.forEach(b => {
    if (b.traveller_id && b.id !== selected) return;
    (byLoc[b.location] = byLoc[b.location] || []).push(b);
  });
  let out = '<option value="">— select bed —</option>';
  Object.keys(byLoc).sort().forEach(loc => {
    out += `<optgroup label="${esc(loc)}">`;
    byLoc[loc].forEach(b => {
      out += `<option value="${b.id}" ${b.id === selected ? 'selected' : ''}>${esc(loc)} · Bed ${esc(b.bed)}</option>`;
    });
    out += '</optgroup>';
  });
  return out;
}

window.setBed = async (travellerId, bedId) => {
  const { error } = await sb.rpc('mkn_tr_set_bed', { p_traveller_id: travellerId, p_bed_id: bedId || null });
  if (error) return toast(error.message);
  await refresh(); render();
};

window.completeReq = async id => {
  const { error } = await sb.rpc('mkn_tr_complete', { p_request_id: id });
  if (error) return toast(error.message);
  const r = S.requests.find(x => x.id === id);
  await refresh(); render();
  toast('Confirmed ✓ Full travel + stay details sent to ' + (r?.contact_email || 'requester') + '.');
};

/* ---------------- bed master ---------------- */
function masterView() {
  const canEdit = ['accommodation_desk', 'admin'].includes(role());
  const byLoc = {};
  S.beds.forEach(b => (byLoc[b.location] = byLoc[b.location] || []).push(b));
  const locs = Object.keys(byLoc).sort();
  const rows = locs.map(loc => {
    const beds = byLoc[loc], total = beds.length;
    const taken = beds.filter(b => b.traveller_id).length;
    const pct = total ? Math.round(taken / total * 100) : 0;
    return `<tr><td style="font-weight:600">${esc(loc)}</td><td>${total}</td><td>${taken}</td>
      <td class="occ">${pct}%<div class="bar"><span style="width:${pct}%"></span></div></td>
      ${canEdit ? `<td><button class="btn btn-ghost btn-sm" onclick="renameLocation('${esc(loc)}')">Rename</button></td>` : ''}</tr>`;
  }).join('');

  return `<div class="view active">
    <div class="view-head"><h2>Bed master</h2>
      <p>All beds available at SSB. Add or remove beds, and rename a location; occupancy updates as beds are allotted.</p></div>
    ${canEdit ? `<div class="card pad" style="margin-bottom:22px">
      <label>Add beds to a location</label>
      <div class="alloc-row">
        <div class="field"><label>Location / block</label><input id="acLoc" placeholder="e.g. Anna Block A"></div>
        <div class="field"><label>Bed numbers</label><input id="acBeds" placeholder="e.g. 101-110  or  1,2,3">
          <div class="hint">Range (101-110) or comma list (1,2,3).</div></div>
        <button class="btn btn-primary" onclick="addBeds()">Add beds</button>
      </div>
    </div>` : ''}
    ${canEdit && locs.length ? `<div class="card pad" style="margin-bottom:22px">
      <label>Remove beds from a location</label>
      <div class="alloc-row">
        <div class="field"><label>Location / block</label><select id="rmLoc">
          ${locs.map(l => `<option>${esc(l)}</option>`).join('')}
        </select></div>
        <div class="field"><label>Bed numbers</label><input id="rmBeds" placeholder="e.g. 101-110  or  1,2,3">
          <div class="hint">Range (101-110) or comma list (1,2,3). A bed already allotted to someone is left in place.</div></div>
        <button class="btn btn-ghost" onclick="removeBeds()">Remove beds</button>
      </div>
    </div>` : ''}
    <div class="card pad">
      <div style="overflow-x:auto">
      <table class="master">
        <thead><tr><th>Location</th><th>Total</th><th>Allotted</th><th style="width:190px">Occupancy</th>${canEdit ? '<th></th>' : ''}</tr></thead>
        <tbody>${rows || `<tr><td colspan="${canEdit ? 5 : 4}" class="empty">No beds added yet.</td></tr>`}</tbody>
      </table>
      </div>
    </div>
  </div>`;
}

function parseBedNumbers(raw) {
  if (/^\d+\s*-\s*\d+$/.test(raw)) {
    const [a, b] = raw.split('-').map(x => parseInt(x.trim(), 10));
    const out = [];
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.push(String(i));
    return out;
  }
  return raw.split(',').map(x => x.trim()).filter(Boolean);
}

window.addBeds = async () => {
  const loc = val('acLoc'), raw = val('acBeds');
  if (!loc || !raw) return toast('Enter a location and bed numbers.');
  const beds = parseBedNumbers(raw);
  if (!beds.length) return toast('Enter at least one bed number.');
  const { data, error } = await sb.rpc('mkn_tr_add_beds', { p_location: loc, p_beds: beds });
  if (error) return toast(error.message);
  await refresh(); render();
  toast(`Added ${data} bed(s) to ${loc}.` + (data < beds.length ? ' Duplicates were skipped.' : ''));
};

window.removeBeds = async () => {
  const loc = val('rmLoc'), raw = val('rmBeds');
  if (!loc || !raw) return toast('Enter a location and bed numbers.');
  const beds = parseBedNumbers(raw);
  if (!beds.length) return toast('Enter at least one bed number.');
  const { data, error } = await sb.rpc('mkn_tr_remove_beds', { p_location: loc, p_beds: beds });
  if (error) return toast(error.message);
  await refresh(); render();
  toast(`Removed ${data} bed(s) from ${loc}.` + (data < beds.length ? ' Any already allotted were left in place.' : ''));
};

window.renameLocation = async loc => {
  const next = prompt(`Rename "${loc}" to:`, loc);
  if (next === null) return;
  const trimmed = next.trim();
  if (!trimmed || trimmed === loc) return;
  const { error } = await sb.rpc('mkn_tr_rename_location', { p_old: loc, p_new: trimmed });
  if (error) return toast(error.message);
  await refresh(); render();
  toast(`Renamed to "${trimmed}".`);
};

/* ---------------- people & roles (admin) ---------------- */
function peopleView() {
  return `<div class="view active">
    <div class="view-head"><h2>People &amp; roles</h2>
      <p>Everyone who creates an account starts as a Requester. Promote them to POC, coordinator or a desk here.</p></div>
    <div class="card pad">
      <button class="btn btn-ghost btn-sm" onclick="loadPeople()">Refresh list</button>
      <div style="overflow-x:auto;margin-top:14px"><table class="master">
        <thead><tr><th>Name</th><th>Email</th><th>Role</th></tr></thead>
        <tbody>${S.people.map(u => `<tr>
          <td>${esc(u.full_name || '—')}</td><td>${esc(u.email || '')}</td>
          <td><select onchange="setRole('${u.id}',this.value)">
            ${Object.keys(ROLE_LABEL).map(r => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${ROLE_LABEL[r]}</option>`).join('')}
          </select></td></tr>`).join('') || `<tr><td colspan="3" class="empty">Click refresh to load accounts.</td></tr>`}
        </tbody></table></div>
    </div>
  </div>`;
}

window.loadPeople = async () => {
  const { data, error } = await sb.from('mkn_profiles').select('*').order('created_at');
  if (error) return toast(error.message);
  S.people = data || []; render();
};

window.setRole = async (uid, r) => {
  const { error } = await sb.rpc('mkn_set_role', { p_user_id: uid, p_role: r });
  if (error) return toast(error.message);
  await loadPeople();
  toast('Role updated.');
};

boot();

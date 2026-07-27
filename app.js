/* MKN Travel & Stay · SSB Bengaluru — vanilla JS + Supabase. */
const SUPABASE_URL = 'https://zbqetpvgipgagmmyupcn.supabase.co';
const SUPABASE_KEY = 'sb_publishable_9N-AtGZTNYsOLNAYj1W8AQ_ya6ccY6C';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const CATEGORIES = ['Poornanga', 'Brahmachari', 'POC', 'Core Volunteer', 'Ishanga'];
const GENDERS = ['Male', 'Female', 'Other'];
const TRAVEL_MODES = ['Train', 'Flight', 'Bus', 'Own arrangement'];
const DEFAULT_ORIGIN = 'Isha Yoga Center, Coimbatore';

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
  { id: 'coord',  label: '2 · Coordinator',    roles: ['coordinator', 'admin'], badge: 'submitted' },
  { id: 'travel', label: '3 · Travel Desk',    roles: ['travel_desk', 'admin'], badge: 'approved' },
  { id: 'accom',  label: '4 · Accommodation',  roles: ['accommodation_desk', 'admin'], badge: 'booked' },
  { id: 'master', label: 'Bed Master',         roles: ['accommodation_desk', 'coordinator', 'admin'] },
  { id: 'people', label: 'People & Roles',     roles: ['admin'] },
];

const TRAV_COLS = ['id', 'request_id', 'sort_order', 'name', 'age', 'gender', 'category',
  'id_number_masked', 'id_image_path', 'travel_mode', 'train_name', 'train_number',
  'flight_name', 'flight_number', 'bus_name', 'pnr', 'bed_id', 'bed_label'].join(',');

const S = {
  session: null, profile: null, view: 'submit',
  requests: [], beds: [], people: [],
  mode: 'individual', ticketPref: 'collective',
  solo: blankTrav(), travForm: [], pocTravels: false,
  form: {}, open: new Set(), busy: false, authMode: 'signin',
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
  const [reqs, beds] = await Promise.all([
    sb.from('mkn_trip_requests').select(`*,travellers:mkn_trip_travellers(${TRAV_COLS})`).order('created_at', { ascending: false }),
    ['coordinator', 'accommodation_desk', 'admin'].includes(role())
      ? sb.from('mkn_beds').select('*').order('location').order('bed')
      : Promise.resolve({ data: [] }),
  ]);
  if (reqs.error) toast(reqs.error.message);
  S.requests = reqs.data || [];
  S.beds = beds.data || [];
}

/* ---------------- shell ---------------- */
function render() {
  if (!S.session) { el('app').innerHTML = authView(); wireAuth(); return; }
  const tabs = allowedTabs();
  const counts = {};
  tabs.forEach(t => { if (t.badge) counts[t.id] = S.requests.filter(r => r.status === t.badge).length; });

  el('app').innerHTML = `
  <header>
    <div class="head-inner">
      <div>
        <div class="eyebrow">Mahakshetra Nirmana · Consecration</div>
        <h1>Travel &amp; Stay Requests</h1>
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
  const poc = S.mode === 'poc';
  const canPoc = ['poc', 'coordinator', 'admin'].includes(role());
  if (!canPoc && poc) S.mode = 'individual';
  const f = S.form;
  const mine = S.requests.filter(r => r.created_by === S.session.user.id);

  return `
  <div class="view active">
    <div class="view-head">
      <h2>New travel &amp; stay request</h2>
      <p>Raise a request for yourself, or as a POC on behalf of your team. Each traveller needs age, gender, category and an ID for ticket booking.</p>
    </div>

    ${mine.length ? `<div class="card pad" style="margin-bottom:18px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:10px">
        <div><h3 style="font-size:20px">Requests you've raised</h3>
          <div class="hint">Track each one as it moves through review, ticketing and bed allotment.</div></div>
      </div>
      ${mine.map(r => myRequestRow(r)).join('')}
    </div>` : ''}

    <div class="card pad">
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
      </div>
    </div>
  </div>`;
}

function myRequestRow(r) {
  const [cls, label] = STATUS_CHIP[r.status];
  const who = r.mode === 'poc' ? (r.team || '(unnamed team)') : (travellers(r)[0]?.name || r.contact_name);
  return `<div class="assigned" style="background:var(--band);border-color:var(--border);color:var(--ink)">
    <strong style="font-weight:600">${esc(who)}</strong>
    <span class="hint" style="display:inline;margin:0">· ${esc(r.id)} · ${travellers(r).length} pax</span>
    <span style="margin-left:auto"><span class="chip ${cls}"><span class="chip-dot"></span>${label}</span></span>
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

function listOrEmpty(items, innerFn, emptyMsg) {
  if (!items.length) return `<div class="empty"><div class="big">All clear</div><div>${emptyMsg}</div></div>`;
  return items.map(r => reqCard(r, innerFn(r))).join('');
}

/* ---------------- 2 · coordinator ---------------- */
function coordView() {
  const all = S.requests;
  const pending = all.filter(r => r.status === 'submitted');
  const pax = all.reduce((n, r) => n + travellers(r).length, 0);
  const free = S.beds.filter(b => !b.traveller_id).length;

  return `<div class="view active">
    <div class="view-head"><h2>Coordinator — review &amp; approve</h2>
      <p>Fresh requests land here. Approve to pass the request to the travel desk, or send it back.</p></div>
    <div class="stats">
      <div class="stat"><div class="n">${all.length}</div><div class="l">Requests</div></div>
      <div class="stat"><div class="n">${pax}</div><div class="l">Travellers</div></div>
      <div class="stat"><div class="n">${pending.length}</div><div class="l">To review</div></div>
      <div class="stat"><div class="n">${all.filter(r => r.status === 'complete').length}</div><div class="l">Confirmed</div></div>
      <div class="stat"><div class="n">${free}</div><div class="l">Beds free</div></div>
    </div>
    ${listOrEmpty(pending, r => `<div class="actions">
      <button class="btn btn-primary btn-sm" onclick="decide('${r.id}','approved')">Approve → send to travel desk</button>
      <button class="btn btn-ghost btn-sm" onclick="decide('${r.id}','rejected')">Send back</button>
    </div>`, 'No requests waiting for review.')}
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

/* ---------------- 3 · travel desk & 4 · accommodation ---------------- */
function deskView(which) {
  const isTravel = which === 'travel';
  const head = isTravel
    ? { t: 'Travel desk — book tickets', p: 'Approved requests await ticketing. Enter the PNR / ticket reference (or a collective reference), attach the booked ticket, then confirm to notify the requester and pass on for bed allotment.' }
    : { t: 'Accommodation — allot beds', p: 'Ticketed travellers await a bed. Pick a free bed from the master for each person, then confirm to complete and notify.' };
  const items = S.requests.filter(r => r.status === (isTravel ? 'approved' : 'booked'));
  return `<div class="view active">
    <div class="view-head"><h2>${head.t}</h2><p>${head.p}</p></div>
    ${listOrEmpty(items, isTravel ? travelInner : accomInner,
      isTravel ? 'No approved requests waiting for tickets.' : 'No ticketed travellers waiting for beds.')}
  </div>`;
}

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
    <button class="btn btn-primary btn-sm" onclick="book('${r.id}',${collective})">Confirm booking &amp; notify</button>
    <span class="hint">Emails the ticket to ${esc(r.contact_email || 'the requester')} and passes on for bed allotment.</span>
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
  <div class="actions">
    <button class="btn btn-primary btn-sm" onclick="completeReq('${r.id}')">Allot beds &amp; confirm</button>
    <span class="hint">Sends final stay details to ${esc(r.contact_email || 'the requester')}.</span>
  </div>`;
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
  const rows = Object.keys(byLoc).sort().map(loc => {
    const beds = byLoc[loc], total = beds.length;
    const taken = beds.filter(b => b.traveller_id).length;
    const pct = total ? Math.round(taken / total * 100) : 0;
    return `<tr><td style="font-weight:600">${esc(loc)}</td><td>${total}</td><td>${taken}</td>
      <td class="occ">${pct}%<div class="bar"><span style="width:${pct}%"></span></div></td></tr>`;
  }).join('');

  return `<div class="view active">
    <div class="view-head"><h2>Bed master</h2>
      <p>All beds available at SSB. Add a location and bed numbers; occupancy updates as beds are allotted.</p></div>
    ${canEdit ? `<div class="card pad" style="margin-bottom:22px">
      <label>Add beds to a location</label>
      <div class="alloc-row">
        <div class="field"><label>Location / block</label><input id="acLoc" placeholder="e.g. Anna Block A"></div>
        <div class="field"><label>Bed numbers</label><input id="acBeds" placeholder="e.g. 101-110  or  1,2,3">
          <div class="hint">Range (101-110) or comma list (1,2,3).</div></div>
        <button class="btn btn-primary" onclick="addBeds()">Add beds</button>
      </div>
    </div>` : ''}
    <div class="card pad">
      <table class="master">
        <thead><tr><th>Location</th><th>Total</th><th>Allotted</th><th style="width:190px">Occupancy</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="4" class="empty">No beds added yet.</td></tr>`}</tbody>
      </table>
    </div>
  </div>`;
}

window.addBeds = async () => {
  const loc = val('acLoc'), raw = val('acBeds');
  if (!loc || !raw) return toast('Enter a location and bed numbers.');
  let beds;
  if (/^\d+\s*-\s*\d+$/.test(raw)) {
    const [a, b] = raw.split('-').map(x => parseInt(x.trim(), 10));
    beds = [];
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) beds.push(String(i));
  } else {
    beds = raw.split(',').map(x => x.trim()).filter(Boolean);
  }
  if (!beds.length) return toast('Enter at least one bed number.');
  const { data, error } = await sb.rpc('mkn_tr_add_beds', { p_location: loc, p_beds: beds });
  if (error) return toast(error.message);
  await refresh(); render();
  toast(`Added ${data} bed(s) to ${loc}.` + (data < beds.length ? ' Duplicates were skipped.' : ''));
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

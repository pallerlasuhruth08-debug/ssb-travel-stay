# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

MKN Transport & Stay — a travel/stay/cab request-tracking tool for SSB Bengaluru (Mahakshetra Nirmana consecration
event). A static front end (`index.html` + `app.js`) deployed to both GitHub Pages and Vercel, talking to a
Postgres database on Supabase. There is no build step, no framework, and no package.json — editing either file and
redeploying is the entire change cycle.

**Read `HANDOVER.md` first.** It is the authoritative, detailed reference for the data model, roles, security
model, and known gaps — this file only orients you to the codebase shape and points you at what to read.

## Stack and where things live

- **Front end**: `index.html` (all markup + all CSS in one `<style>` block) and `app.js` (all behavior, ~1250
  lines). Both are hand-written vanilla JS/CSS — no JSX, no bundler, no transpilation.
- **Back end**: Supabase project `zbqetpvgipgagmmyupcn` ("hasirushaale", region ap-south-1). Every table, function,
  and storage bucket for this app is prefixed `mkn_` / `mkn-`, so it coexists with an unrelated `hs_*` schema in the
  same project without touching it. Only the publishable (anon) key is embedded in the front end
  (`SUPABASE_URL`/`SUPABASE_KEY` constants at the top of `app.js`); every privileged write goes through a
  `SECURITY DEFINER` Postgres function, never a raw table insert/update.
- **Deployment**: two hosts kept in sync, both auto-deploying `main` — GitHub Pages (via
  `.github/workflows/pages.yml`, at `https://pallerlasuhruth08-debug.github.io/ssb-travel-stay/`) and a Vercel
  project `ssb-travel-stay` (via a direct Git integration, at `https://ssb-travel-stay.vercel.app`). Deploying is
  just `git push` — there's no separate upload step for either host anymore.

## Working with the Supabase backend

- Schema changes go through migrations applied directly against the live project (there is no local Supabase
  stack, no migrations directory in this repo, and no way to test against a copy first).
- Before changing a table or function, check its current definition live rather than assuming — the schema has
  evolved significantly (see "Two request categories" below) and the code is the only source of truth.
- When testing a change that touches RLS or a `SECURITY DEFINER` function, simulate the relevant role rather than
  trusting the anon key alone: wrap the check in `begin; set local role authenticated; set local
  request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}'; ...; rollback;` so nothing is persisted. This is
  the only reliable way to verify RLS behavior for a specific user without touching live data.
- Every write path is a Postgres function (`mkn_tr_submit`, `mkn_tr_decide`, `mkn_tr_edit`, `mkn_tr_book`,
  `mkn_tr_set_bed`, `mkn_tr_complete`, `mkn_tr_add_beds`, `mkn_tr_remove_beds`, `mkn_tr_rename_location`,
  `mkn_cab_submit`, `mkn_cab_decide`, `mkn_cab_book`, `mkn_set_role`) that re-checks the caller's role
  server-side. There are no insert/update/delete RLS policies at all — only SELECT policies exist, so a new
  mutation always needs a new or extended function, not a new policy.
- The raw traveller ID number (`mkn_trip_travellers.id_number`) is write-only: the table-level SELECT grant is
  revoked and re-granted column-by-column, omitting that column, so it can never be read back through the API even
  with the anon key. The app only ever reads `id_number_masked`. Don't "simplify" this back to a blanket grant.
- IDs and tickets live in **private** storage buckets (`mkn-ids`, `mkn-tickets`), served only via short-lived
  signed URLs (`sb.storage.from(bucket).createSignedUrl(path, 300)` in `app.js`), never public URLs.

## Front-end architecture (`app.js`)

Single-file, no-framework SPA built around one global mutable state object `S` and a full re-render on every
change — there is no virtual DOM or diffing:

- `S` holds session/profile, the fetched `requests`/`cabRequests`/`beds`/`people` arrays, and all in-progress form
  state. Any `window.*`-exposed handler mutates `S` and then calls `render()`.
- `render()` rebuilds `#app`'s entire `innerHTML` from template strings, then `wireView()` re-attaches listeners
  that can't be expressed as inline `onclick`/`onchange` attributes (file inputs, per-traveller dynamic fields).
- `refresh()` re-fetches all three tables (`mkn_trip_requests` with a nested `travellers` select,
  `mkn_beds`, `mkn_cab_requests`) in parallel and is called after every mutating RPC.
- View routing is a plain switch in `viewBody()` keyed on `S.view`; `allowedTabs()` filters the `TABS` array by
  the signed-in user's role, and `goView`/`loadAll` both guard against rendering a view the current role can't see.
- All server-facing functions are called via `sb.rpc(name, params)`, never `sb.from(table).insert/update(...)`
  directly — mutations always go through the `SECURITY DEFINER` functions described above.
- Nothing on the critical render path may block on a third-party host. The Google Fonts stylesheet is
  loaded non-render-blocking (`media="print" onload="this.media='all'"`) because as a plain stylesheet link it
  froze the page whenever `fonts.googleapis.com` was slow or filtered — the same trap as the old Supabase CDN
  tag. Don't revert it to a plain `<link>`, and don't add new blocking third-party tags. Boot-path awaits are
  raced via `withTimeout()` with a `setTimeout` failsafe — see "Nothing on the critical path…" in `HANDOVER.md`.
- The `onAuthStateChange` callback must stay **synchronous** — it defers to `onAuthChange()` via
  `setTimeout`. supabase-js runs it while holding its auth lock and awaits it, and every PostgREST query
  needs that lock to attach the token, so awaiting a query inside it deadlocks: sign-in never resolves and
  every later auth call hangs. See "Never await a query inside an onAuthStateChange callback" in `HANDOVER.md`.
- `boot()` renders **before** it touches the auth client, and restores the session in the background.
  `sb.auth.getSession()` takes an indefinite `navigator.locks` lock that another tab can hold forever, so
  awaiting it before the first `render()` froze the page on "Loading…" for ~13s. Never put an `await` before
  that first `render()` — see "The first render must not depend on the auth client" in `HANDOVER.md`.
- Every `sb.auth.*` call goes through the `call()` helper, and post-login data loads through `loadAllSafe()`.
  `supabase-js` *rejects* on a request that never completes (offline, blocked, CDN/firewall), and an unguarded
  rejection inside a click handler silently leaves the button stuck on "Please wait…" with no error shown. Don't
  add a bare `await sb.auth.x()` to a handler — see "Auth calls must never fail silently" in `HANDOVER.md`.

### Two request categories, one shared UI

The Submit / Coordinator / Travel Desk tabs each carry a category toggle between two independent pipelines that
share the coordinator and travel-desk roles but have their own tables, statuses, and functions:

- **Intercity Transport & Stay** (`mkn_trip_requests` + `mkn_trip_travellers` + `mkn_beds`): a 4-stage pipeline
  (Submitted → Approved → Ticketed → Housed) covering one or more travellers per request, ticket booking, and bed
  allotment.
- **Intracity Cab** (`mkn_cab_requests`, no line table — one row is one booking): a 3-stage pipeline (Submitted →
  Approved → Cab booked), never touches beds or tickets.

Card-rendering, stepper, and status-chip logic is duplicated in parallel pairs for the two categories
(`reqCard`/`cabCard`, `stepper`/`cabStepper`, `statusChip`/`cabStatusChip`, `coordInner`/`cabCoordInner`) rather
than unified — when adding a feature to one pipeline, check whether the other needs the equivalent, but don't
assume they should be merged (they were deliberately kept structurally separate since one never needs the other's
fields).

### Testing (no repo-native harness)

There are no test files or npm scripts in this repo. Verification during development in this session has used two
ad hoc, throwaway approaches (not checked in):

1. A jsdom + `vm` harness that stubs `window.supabase` and requires `app.js` in a sandboxed context, asserting on
   the rendered HTML string and on the `rpc()` calls a simulated click produces.
2. Playwright driving the real `index.html`/`app.js` served locally via `http-server`, with `page.route()`
   intercepting the `vendor/supabase.js` script tag to inject the same kind of stub client — used for real-DOM
   checks (e.g. `document.documentElement.scrollWidth` vs `clientWidth` to catch mobile layout overflow) that a
   string assertion can't catch.

Either approach works because the app has exactly one external dependency (`window.supabase`) — stub that one
object and the whole app runs headless. That dependency is now vendored (`vendor/supabase.js`, plus its
`vendor/591.supabase.js` webpack chunk), not loaded from a third-party CDN — see "Vendored dependency" below for why.

## Vendored dependency

`vendor/supabase.js` (+ `vendor/591.supabase.js`, its one lazy-loaded webpack chunk) is the official
`@supabase/supabase-js@2.45.4` UMD build, committed verbatim from the npm tarball — it used to be loaded from
`cdn.jsdelivr.net` instead. That CDN script tag was a real production bug: if it failed to load for any reason (a
slow connection, an ad-blocker, a CDN hiccup, a corporate firewall), `window.supabase` stayed `undefined` and the
very first executable line of `app.js` (`window.supabase.createClient(...)`) threw an uncaught `TypeError`, silently
halting the entire script — leaving the page frozen on the static "Loading…" placeholder in `index.html` forever,
with no visible error. This reproduced identically on both GitHub Pages and Vercel once diagnosed with a real
(non-stubbed) Playwright run against a sandbox that blocks the CDN host, which is what confirmed the root cause.
Vendoring removes the third-party-reachability dependency entirely; `app.js` also now checks `window.supabase`
before use and replaces `#app` with a clear "couldn't load a required script" message instead of throwing silently,
as a safety net in case the vendored file itself ever fails to load (e.g. a bad browser cache after a redeploy).
To update the pinned version: `npm pack @supabase/supabase-js@<version>`, extract it, and copy
`package/dist/umd/supabase.js` and `package/dist/umd/*.supabase.js` (any numbered chunk files) into `vendor/` as-is
— no build step, no modification.

## Redeploying

Both hosts now redeploy automatically on every push to `main` — GitHub Pages via
`.github/workflows/pages.yml`, Vercel via a direct Git integration (Project Settings → Git,
connected 29 Jul 2026). Deploying via `git push` is now the only path; there is no build step, so
what's committed is exactly what runs. This replaced deploying to Vercel by pasting file content
through an API tool call, which had started silently failing to transfer `vendor/supabase.js`
(110KB — too large to reliably retype into a tool call without corruption) and left it 404ing in
production. If a Vercel deploy is ever needed outside the normal push-to-`main` flow, push an empty
commit (`git commit --allow-empty`) rather than reaching for the content-inlining tool again.

`vercel.json` rewrites bare `/` to `/index.html` — without it Vercel 404s on the root URL for a
static site with no detected framework (individual files like `/app.js` and `/vendor/supabase.js`
are served fine either way, since Vercel checks the filesystem before applying rewrites).

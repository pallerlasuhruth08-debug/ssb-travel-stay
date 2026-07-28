# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

MKN Transport & Stay — a travel/stay/cab request-tracking tool for SSB Bengaluru (Mahakshetra Nirmana consecration
event). A static front end (`index.html` + `app.js`) deployed to Vercel, talking to a Postgres database on
Supabase. There is no build step, no framework, and no package.json — editing either file and redeploying is the
entire change cycle.

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
- **Deployment**: Vercel project `ssb-travel-stay`. Deploying means uploading `index.html` and `app.js` — always
  both together, since a partial deploy (one file only) breaks the app. There is no CI; the live app is at
  `https://ssb-travel-stay.vercel.app`.

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
   intercepting the Supabase CDN script tag to inject the same kind of stub client — used for real-DOM checks
   (e.g. `document.documentElement.scrollWidth` vs `clientWidth` to catch mobile layout overflow) that a string
   assertion can't catch.

Either approach works because the app has exactly one external dependency (`window.supabase`, loaded from a CDN
`<script>` tag in `index.html`) — stub that one object and the whole app runs headless.

## Redeploying

Deploy the two files verbatim to the existing Vercel project — there is no build step, so what's uploaded is
exactly what runs. Always deploy `index.html` and `app.js` together, even for a single-file change, to avoid
shipping a mismatched pair.

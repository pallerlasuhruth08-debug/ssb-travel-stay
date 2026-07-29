# MKN Transport & Stay — SSB Bengaluru

**Live app:** https://ssb-travel-stay.vercel.app

A static front end on Vercel talking to a Postgres database on Supabase. Rebuilt 27 Jul 2026 to the tabbed
*Submit → Coordinator → Travel desk → Accommodation* structure, replacing the earlier sidebar build. The Submit,
Coordinator and Travel Desk tabs now each carry **two request categories** — see "Two request categories" below.

## Stack and where everything lives

The front end is two files — `index.html` (markup plus all styling) and `app.js` (all behaviour) — deployed to
Vercel as static assets. There is no build step and no framework, so editing either file and redeploying is the
whole change cycle. The back end is a Supabase project named **hasirushaale** (project ref
`zbqetpvgipgagmmyupcn`, region ap-south-1 / Mumbai). Every table, function and storage bucket for this system
is prefixed `mkn_` or `mkn-`, so it sits alongside the unrelated `hs_*` tables without touching them. Only the
publishable (anon) key is embedded in the front end; every privileged operation goes through a database function.

## Two request categories

The Submit tab opens with a category toggle: **Intercity Transport & Stay** (the original flow, below) or
**Intracity Cab** (new). Both share the coordinator and travel desk roles and both show up combined in "Requests
you've raised", but they are otherwise two independent pipelines with their own tables, statuses and functions —
a cab request never touches beds or tickets, and an intercity request never touches drivers.

### Intercity Transport & Stay

One request covers one or more travellers and moves through four stages, shown as a stepper on every request card:

**Submitted** → **Approved** → **Ticketed** → **Housed**

A requester raises a request for themselves, or a POC raises one per team. It lands with the **coordinator**, who
approves it or sends it back with a reason. Once approved it reaches the **travel desk**, which records a PNR per
traveller (or one collective reference for the whole team) and attaches the booked ticket. It then reaches the
**accommodation desk**, which allots each traveller a specific bed from the bed master and confirms. Unlike the
previous build the two desks now run in sequence, not in parallel — a bed cannot be allotted before the ticket
exists, which is what the tabs 1-2-3-4 represent.

A traveller marked **Own arrangement** is skipped by the ticket check — they still need a bed, but the travel desk
is not asked for a PNR.

A request can also end in **Cancelled** — the requester's own call, any time before it's housed — alongside the
existing **Rejected** (the coordinator's call). Both drop out of the stepper entirely, same as each other.

### Intracity Cab

A shorter, three-stage pipeline for a local cab pickup to or from SSB — no accommodation stage, since it's a same-day
local trip:

**Submitted** → **Approved** → **Cab booked**

The requester picks a date, time, pickup point (Madivala, Majestic, Silk Board, Bengaluru Railway Station
Cantonment/KSR, Airport T1/T2, or IYC Coimbatore Ashram), a destination (defaults to SSB, but can instead be
Coimbatore Railway Station, IYC Coimbatore Ashram, or Coimbatore Bus Stand — covering local cab hops at the
Coimbatore end for travellers connecting to/from an intercity train or bus, not just the Bengaluru-side SSB run;
picking the same place for both is blocked client-side), a vehicle type (Innova, Sedan, Mini, Tempo Traveller,
Bus), a passenger count, and the POC's name/email/phone the travel desk should coordinate pickup with. The **coordinator** approves or sends it back exactly like an intercity request. Once approved, the **travel
desk** enters the driver's name, phone number and the vehicle number and confirms — the coordinator can still
disapprove an approved cab request, and the travel desk can re-open a booked one to correct the driver details via
the same "Update booking" action pattern as tickets. A cab request can also be **Cancelled** by its own requester
while it's still submitted or approved — not once a cab is actually booked.

## Roles

Anyone can create an account from the sign-in screen. At sign-up they pick "Just myself" or "I'm a Team POC" and
land directly as **Requester** or **Team POC** accordingly (the `mkn_handle_new_user` trigger reads the choice off
the sign-up metadata) — no admin step needed for that one distinction. Every other role (Coordinator, Travel Desk,
Accommodation Desk, Admin) is still assigned manually from the *People & Roles* tab. The account
`psuhruth08@gmail.com` is made Admin automatically the first time it signs up, overriding whatever it picked. The
trigger only ever assigns `poc` or `requester` off that metadata field — a tampered sign-up request can't claim
`admin` or any staff role that way.

| Role | Tabs they see |
|---|---|
| Requester | Submit Request |
| Team POC | Submit Request (with the team form unlocked) |
| Coordinator | Submit, Coordinator, Bed Master (read-only) |
| Travel Desk | Submit, Travel Desk |
| Accommodation Desk | Submit, Accommodation, Bed Master (editable) |
| Admin | all seven, including People & Roles and Report |

## Password reset

There's no "admin password" and no way for anyone — including Claude Code sessions with live DB access — to read
back or guess an existing password; Supabase only ever stores a bcrypt hash (`auth.users.encrypted_password`).
Three ways to deal with a lost/forgotten password, in order of preference:

1. **"Forgot password?"** on the sign-in screen (`setAuthMode('reset')`) calls
   `sb.auth.resetPasswordForEmail(email, { redirectTo: <same deployed URL> })`. Supabase emails a link that redirects
   back into the app with recovery tokens in the URL fragment; `supabase-js` detects that automatically and fires an
   `onAuthStateChange` event of type `PASSWORD_RECOVERY`. `app.js` listens for that (the listener is registered
   *before* the initial `getSession()` call in `boot()`, since it's a one-shot event emitted while the client parses
   the redirect URL — registering it any later can miss it) and sets `S.recovery = true`, which makes `render()` show
   a dedicated "Set a new password" screen (`recoveryView()`/`wireRecovery()`) instead of the normal app, calling
   `sb.auth.updateUser({ password })` to finish. **This depends on Supabase's built-in email sending, which on the
   free tier has a low rate limit and can silently fail to arrive** — if a bunch of accounts were created in a short
   window, reset emails may not go out at all.
2. **"Change password"** button in the header, visible to anyone already signed in (`toggleChangePw()` /
   `changePwPanel()`/`wireChangePw()`) — same `sb.auth.updateUser({ password })` call, no email involved. Use this
   for "I know my current password but want to change it" rather than "I'm locked out."
3. **Direct DB reset** (last resort, needs live Supabase access): `auth.users.encrypted_password` can be set directly
   via `pgcrypto` (installed in the `extensions` schema), e.g.
   `update auth.users set encrypted_password = extensions.crypt('<new password>', extensions.gen_salt('bf', 6)) where email = '<email>';`
   — matches the bcrypt cost factor (`$2a$06$`) Supabase's own hashes use. Only do this for an account you've
   confirmed the owner of; it bypasses email verification entirely.

Everyone keeps the Submit tab — staff travel too — and the panel at the top of it now shows the *full* card for
each request you raised (stepper, traveller table, PNR/bed once assigned), not just a status chip, so you can see
exactly where it stands. From that same card, a requester can **cancel their own request** at any point before it's
fully done (intercity: any stage up to and including ticketed, but not once housed; cab: submitted or approved, but
not once booked) via `mkn_tr_cancel`/`mkn_cab_cancel` — either function also accepts a staff caller, not just the
original creator. Cancelling an intercity request frees any bed already allotted to its travellers.

A **Team POC** can additionally **add or remove members on their own team request** at any time while it's still
`submitted` or `approved` — team composition often isn't final at submission time. This uses two new functions,
`mkn_tr_add_member`/`mkn_tr_remove_member`, mirroring the existing `mkn_tr_add_beds`/`mkn_tr_remove_beds` pattern:
both check the caller is the request's own creator (or staff), that the request is still `mode = 'poc'`, and that
it hasn't been ticketed yet. Removing is blocked once a team is down to its last member — a request always needs at
least one traveller. This is separate from the coordinator's "Edit details", which only edits existing travellers'
fields and still can't add or remove people from the list.

The coordinator's queue has a **To review / Approved** toggle. Approved requests stay reachable there — "Edit
details" lets the coordinator correct contact or traveller details (name, age, gender, category, travel mode and
its detail fields, ID number) any time before the travel desk books a ticket, and "Disapprove" sends an approved
request back to the requester with a reason, exactly like "Send back" does from the review queue (same
`mkn_tr_decide` call — it already allowed this transition, it just had no button pointed at it). Above that toggle
sits a second one, **Intercity requests / Intracity cabs**, switching which pipeline the list and stats below are
showing — the Travel Desk tab has the same second toggle. ("Edit details" is intercity-only for now; cab requests
don't have an edit path, just approve/send-back and, later, re-open-to-correct-driver-details.)

## Data model

`mkn_trip_requests` is the header: one row per request, carrying mode (`individual` / `poc`), team name, the
contact block, travel date, plan, ticket preference and the status. `mkn_trip_travellers` is the line table: one
row per person, carrying age, gender, category, ID, travel mode, the conditional travel detail, and — filled in
later by the desks — `pnr`, `bed_id` and `bed_label`. `mkn_beds` is the bed master: one row per physical bed,
unique on (location, bed), pointing at the traveller occupying it.

`mkn_cab_requests` is the entire intracity-cab pipeline in one table (no line table — one cab request is one
booking, not a group of travellers): POC name/email/phone, date, time, `from_location` and `to_location` (each
checked against their own fixed list — defaults to SSB if left unset), `vehicle_type` (checked against the fixed
vehicle list), `pax_count`,
`status` (`submitted`/`approved`/`booked`/`rejected`), `rejection_reason`, and — filled in by the travel desk on
booking — `driver_name`, `driver_phone`, `vehicle_number`. IDs are sequential too (`CAB-1001`, …), off their own
sequence (`mkn_cab_seq`) so they never collide with `REQ-` IDs.

Travel mode is one of **Train**, **Flight**, **Bus**, **Own arrangement** (shown as "will not claim for charges"),
**Ashram bus** ("Bus arranged by Ashram, IYC to SSB") or **Ashram vehicle** ("Dedicated Team vehicle arranged by
Ashram, IYC to SSB"). Train/Flight/Bus each carry their own detail fields (name + number, or bus name); the other
three need no ticket at all — the travel desk's ticketing queue skips them (`needsTicket()`), since the Ashram or
the traveller is arranging that leg directly, not the travel desk.

Categories are Poornanga, Brahmachari, POC, Core Volunteer and Ishanga.

Request IDs are sequential (`REQ-1001`, `REQ-1002`, …) so they sort chronologically and never collide.

The earlier `mkn_requests` table and its functions are left in place untouched, holding the old test rows. Nothing
in the current app reads them; drop them once you are satisfied with the rebuild.

## Security model

Row-level security is on for all three tables. A requester only ever sees rows they created. The coordinator and
admin can see every request regardless of status; the two desks see a request only once the coordinator has
approved it — never while it is still awaiting review or after it has been sent back. Every write goes through a
`SECURITY DEFINER` function (`mkn_tr_submit`, `mkn_tr_decide`, `mkn_tr_edit`, `mkn_tr_book`, `mkn_tr_set_bed`,
`mkn_tr_complete`, `mkn_tr_add_beds`, `mkn_tr_remove_beds`, `mkn_tr_rename_location`) that re-checks the caller's
role server-side, so a tampered browser cannot bypass it. There are no insert/update/delete policies at all.

`mkn_cab_requests` has the same shape of protection, one level simpler since there's no accommodation desk in this
pipeline: RLS via `mkn_can_see_cab(created_by, status)` (own rows always; coordinator/admin always; travel desk
only once `approved`/`booked`), and three functions — `mkn_cab_submit` (any signed-in user), `mkn_cab_decide`
(coordinator/admin, same submitted/approved/rejected transition rules as `mkn_tr_decide`), and `mkn_cab_book`
(travel desk/admin, accepts re-booking on an already-`booked` request so a driver detail typo can be corrected
the same way a PNR can).

`mkn_tr_edit` (coordinator/admin) lets a request and its travellers be corrected while status is `submitted` or
`approved` — once the travel desk has booked a ticket against it, the function refuses further edits from this
path, so the booked PNR/mode combination can't be silently invalidated. Leaving the ID-number field blank on edit
keeps the traveller's existing raw value (the UI has no way to read it back to prefill, by design).

`mkn_tr_remove_beds` (accommodation desk/admin) never evicts an occupant: a bed already held by a traveller is
left in place and simply not counted in the removed total, rather than silently freeing someone's allotment.
`mkn_tr_rename_location` moves every bed at a location to a new name in one call and refuses to collide with an
existing location name.

The raw ID number is still write-only at the table/grant level — `mkn_trip_travellers.id_number`'s SELECT grant is
revoked and re-granted column by column, omitting that one column, so no direct `.from()` select can ever return
it (a column-level `REVOKE` alone is a no-op while a table-level grant exists — that was caught and fixed during
the rebuild, so do not "simplify" it back). Everyone reads `id_number_masked` by default, which stores
`XXXX-XXXX-1234` for a 12-digit Aadhaar and `AB••••67` otherwise.

Staff (coordinator, travel desk, accommodation desk, admin) can additionally see the **real** ID number and the
uploaded ID image, needed to actually book travel — a plain requester or POC never can, even for their own
request. This can't be done with a grant or an RLS policy alone, since `mkn_trip_travellers`'s SELECT policy
already lets a request's own creator read that row (for the masked view), and RLS filters rows, not columns — so
column-level access would leak to the creator too. Instead, `mkn_staff_id_numbers(p_traveller_ids uuid[])` is a
`SECURITY DEFINER` function that raises if the caller isn't staff, otherwise returns the raw `id_number` for the
given traveller ids; `refresh()` calls it once per load (only when `isStaff()`) and merges the result onto
`S.requests[].travellers[]` client-side, and `peopleTable()` prefers that real value over the masked one when
present. ID images follow the same staff-only line, but via the storage side: the `mkn_ids_read` bucket policy is
`bucket_id = 'mkn-ids' and mkn_is_staff()` with no per-row exception for the creator, so a non-staff viewer's
"ID proof" cell just says "Uploaded" instead of rendering a `view` link — the raw file was never reachable for
them at the storage layer regardless of what the front end tried to render.

ID images and tickets live in **private** storage buckets (`mkn-ids`, `mkn-tickets`) and are served only through
short-lived signed URLs.

A bed cannot be double-booked: `mkn_tr_set_bed` rejects a bed already held by another traveller, and reassigning
a traveller frees their previous bed automatically.

Both desks keep a **Pending / Done** toggle so a completed step stays reachable instead of disappearing. Travel
desk's toggle is *Awaiting ticket* / *Booked* — the Booked side shows already-ticketed requests and lets the desk
correct a PNR via the same "Update booking" action (`mkn_tr_book` now accepts corrections on `booked`/`complete`
requests, not just `approved` ones). Accommodation's toggle is *Awaiting bed* / *Housed* — the Housed side shows
fully-allotted requests, and "Change" next to any traveller's bed still works there to reassign it.

## Report tab (admin only)

A seventh tab, visible only to Admin, exists purely to get data *out* of the app. It has an **Intercity requests /
Intracity cabs** toggle just like Coordinator and Travel Desk, and renders every field from the currently-loaded
`S.requests`/`S.cabRequests` (already in browser memory — no extra query) as one flat table: one row per traveller
for intercity requests (so a 3-person team produces 3 rows sharing the same request-level fields), one row per
booking for cabs. This is deliberately a flat, denormalized table rather than a true pivot — "pivot-ready" data the
admin can pivot themselves once it's in Excel, not aggregation done server-side.

"⬇ Download as Excel (CSV)" builds a UTF-8 CSV (with a BOM, so Excel doesn't mis-decode names) client-side via
`toCSV()` + a `Blob`/`URL.createObjectURL` anchor-click download — no server round-trip, no new backend function,
no added dependency (a real `.xlsx` would need a library; Excel opens `.csv` natively so this was the simplest
correct choice given the no-build-step constraint). Verified with a real headless-Chromium run (not just jsdom,
which doesn't fully implement `Blob`/`URL.createObjectURL`/download events) confirming the actual downloaded file's
BOM, header row, and comma/quote/newline escaping are all correct.

Because the raw ID number is only ever present client-side for staff (see the ID-number section above), and Admin
is staff, the report's "ID Number" column shows the real value, not the masked one — same rule as everywhere else.

## Test accounts

Password for all five: `SSBtest2026!`

| Email | Role |
|---|---|
| `coord.test@ssb.local` | Coordinator |
| `poc.test@ssb.local` | Team POC (team: Media) |
| `travel.test@ssb.local` | Travel Desk |
| `stay.test@ssb.local` | Accommodation Desk |
| `vol.test@ssb.local` | Requester |

Three demo intercity requests (`REQ-1001` submitted, `REQ-1002` approved, `REQ-1003` ticketed) and one demo cab
request (`CAB-1006` submitted, raised by `vol.test@ssb.local`) are seeded so every queue is populated for a
walkthrough. **Delete these accounts and requests before real data goes in.**

## Known gaps — decide before go-live

The bed master is seeded with placeholder blocks (Anna Block A, Anna Block B, Bhairavi Dorm — 42 beds total)
because the real SSB list was never supplied. Replace them from the *Bed Master* tab.

There are no notifications yet. The UI says the requester is emailed at each stage; nothing actually sends. Wiring
this up means a Supabase edge function on status change, or a scheduled job.

Handover requires two account transfers: the Vercel project (`ssb-travel-stay` under `suhruth-s-projects`) and the
Supabase project (`hasirushaale`). Note that the Supabase project also hosts the unrelated `hs_*` tables, so
transferring it hands over both — if that is a problem, the `mkn_*` tables need moving to their own Supabase
project first, which requires a paid plan because the free tier caps at two projects per account.

## Redeploying after an edit

Edit `index.html` or `app.js`, then deploy the folder to the existing `ssb-travel-stay` Vercel project. Because
there is no build step, what you upload is exactly what runs.

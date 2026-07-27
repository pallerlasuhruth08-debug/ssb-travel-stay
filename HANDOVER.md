# MKN Travel & Stay — SSB Bengaluru

**Live app:** https://ssb-travel-stay.vercel.app

A static front end on Vercel talking to a Postgres database on Supabase. Rebuilt 27 Jul 2026 to the tabbed
*Submit → Coordinator → Travel desk → Accommodation* structure, replacing the earlier sidebar build.

## Stack and where everything lives

The front end is two files — `index.html` (markup plus all styling) and `app.js` (all behaviour) — deployed to
Vercel as static assets. There is no build step and no framework, so editing either file and redeploying is the
whole change cycle. The back end is a Supabase project named **hasirushaale** (project ref
`zbqetpvgipgagmmyupcn`, region ap-south-1 / Mumbai). Every table, function and storage bucket for this system
is prefixed `mkn_` or `mkn-`, so it sits alongside the unrelated `hs_*` tables without touching them. Only the
publishable (anon) key is embedded in the front end; every privileged operation goes through a database function.

## The flow

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

## Roles

Anyone can create an account from the sign-in screen and lands as **Requester**. An **Admin** promotes people from
the *People & Roles* tab. The account `psuhruth08@gmail.com` is made Admin automatically the first time it
signs up; everyone else is promoted manually.

| Role | Tabs they see |
|---|---|
| Requester | Submit Request |
| Team POC | Submit Request (with the team form unlocked) |
| Coordinator | Submit, Coordinator, Bed Master (read-only) |
| Travel Desk | Submit, Travel Desk |
| Accommodation Desk | Submit, Accommodation, Bed Master (editable) |
| Admin | all six, including People & Roles |

Everyone keeps the Submit tab — staff travel too — and the panel at the top of it tracks the requests you raised
yourself, whatever your role.

## Data model

`mkn_trip_requests` is the header: one row per request, carrying mode (`individual` / `poc`), team name, the
contact block, travel date, plan, ticket preference and the status. `mkn_trip_travellers` is the line table: one
row per person, carrying age, gender, category, ID, travel mode, the conditional travel detail, and — filled in
later by the desks — `pnr`, `bed_id` and `bed_label`. `mkn_beds` is the bed master: one row per physical bed,
unique on (location, bed), pointing at the traveller occupying it.

Travel mode is one of **Train**, **Flight**, **Bus** or **Own arrangement**, and each carries its own detail fields:
train name + number, flight name + number, or bus name. Only the set matching the chosen mode is stored.

Categories are Poornanga, Brahmachari, POC, Core Volunteer and Ishanga.

Request IDs are sequential (`REQ-1001`, `REQ-1002`, …) so they sort chronologically and never collide.

The earlier `mkn_requests` table and its functions are left in place untouched, holding the old test rows. Nothing
in the current app reads them; drop them once you are satisfied with the rebuild.

## Security model

Row-level security is on for all three tables. A requester only ever sees rows they created. The two desks see a
request only once the coordinator has approved it — never while it is still awaiting review or after it has been
sent back. Every write goes through a `SECURITY DEFINER` function (`mkn_tr_submit`, `mkn_tr_decide`,
`mkn_tr_book`, `mkn_tr_set_bed`, `mkn_tr_complete`, `mkn_tr_add_beds`) that re-checks the caller's role
server-side, so a tampered browser cannot bypass it. There are no insert/update/delete policies at all.

The raw ID number is **write-only**. `mkn_trip_travellers.id_number` is set by `mkn_tr_submit` and can never be
read back through the API: the table-level SELECT grant is revoked and re-granted column by column, omitting that
one column. The app reads `id_number_masked` instead, which stores `XXXX-XXXX-1234` for a 12-digit Aadhaar and
`AB••••67` otherwise. (A column-level `REVOKE` alone is a no-op while a table-level grant exists — that was caught
and fixed during the rebuild, so do not "simplify" it back.)

ID images and tickets live in **private** storage buckets (`mkn-ids`, `mkn-tickets`) and are served only through
short-lived signed URLs.

A bed cannot be double-booked: `mkn_tr_set_bed` rejects a bed already held by another traveller, and reassigning
a traveller frees their previous bed automatically.

Both desks keep a **Pending / Done** toggle so a completed step stays reachable instead of disappearing. Travel
desk's toggle is *Awaiting ticket* / *Booked* — the Booked side shows already-ticketed requests and lets the desk
correct a PNR via the same "Update booking" action (`mkn_tr_book` now accepts corrections on `booked`/`complete`
requests, not just `approved` ones). Accommodation's toggle is *Awaiting bed* / *Housed* — the Housed side shows
fully-allotted requests, and "Change" next to any traveller's bed still works there to reassign it.

## Test accounts

Password for all five: `SSBtest2026!`

| Email | Role |
|---|---|
| `coord.test@ssb.local` | Coordinator |
| `poc.test@ssb.local` | Team POC (team: Media) |
| `travel.test@ssb.local` | Travel Desk |
| `stay.test@ssb.local` | Accommodation Desk |
| `vol.test@ssb.local` | Requester |

Three demo requests (`REQ-1001` submitted, `REQ-1002` approved, `REQ-1003` ticketed) are seeded so every queue is
populated for a walkthrough. **Delete these accounts and requests before real data goes in.**

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

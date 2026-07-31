# Self-hosting the backend

Moves this app's Supabase backend onto your own server. Written for a fresh Ubuntu/Debian box
with root access.

## Read this first

The server has **no domain pointed at it yet**, so this runs over plain HTTP against the IP.
That is why the front end is served from the same box: an HTTPS page is not allowed to call an
HTTP API (mixed content), and Let's Encrypt will not issue a certificate for a bare IP. Serving
both over HTTP from one origin sidesteps both problems and gets you running today.

**Plain HTTP means passwords and traveller ID numbers cross the network unencrypted, and this
app stores Aadhaar/passport numbers and ID photographs.** Anyone positioned between a user and
the server can read them. So:

- Use it with test data to prove the migration worked.
- Point a domain at the server and run `enable-tls.sh` **before** real traveller data goes in.
- Until then, keep the hosted Supabase as the live backend.

A domain is roughly ₹800/year and the DNS record takes minutes. It is the cheapest part of this.

## 1. Bootstrap

On the server, as root:

```bash
git clone https://github.com/pallerlasuhruth08-debug/ssb-travel-stay.git /opt/mkn-src
cd /opt/mkn-src/selfhost

# From Supabase Dashboard -> Project Settings -> Database -> Connection string -> URI
export SUPABASE_DB_URL='postgresql://postgres.zbqetpvgipgagmmyupcn:<db-password>@<host>:5432/postgres'

bash bootstrap.sh
```

It installs Docker and the Postgres client, starts the Supabase stack, mints the `anon` and
`service_role` JWTs, `pg_dump`s your schema and data across, and publishes the front end on
port 80 pointed at the new API. Takes 5–15 minutes, mostly image pulls.

The `SUPABASE_DB_URL` is read-only here — nothing is written to the hosted project, so the live
site keeps working throughout and you can abandon this at any point with no consequences.

## 2. Copy the uploaded files

The database rows migrate with the dump; the actual ID photos and tickets are blobs in object
storage and need a separate pass:

```bash
export OLD_SERVICE_KEY='<service_role key: Dashboard -> Settings -> API>'
/opt/mkn/copy-storage.sh
```

## 3. Check it

Open `http://<server-ip>`, sign in with an existing account (passwords carry over — bcrypt
hashes migrate verbatim), and confirm your requests, travellers and beds are all present.

## 4. Add the domain

Point an A record at the server, then:

```bash
bash /opt/mkn-src/selfhost/enable-tls.sh mkn.yourdomain.org
```

Caddy takes over ports 80/443, obtains the certificate, and proxies `/auth`, `/rest` and
`/storage` to the API with everything else going to the app — one origin, so no CORS and no
mixed content. It also rewrites `SITE_URL` and `API_EXTERNAL_URL`, which is what password-reset
emails are built from; skipping that would send reset links to the old IP.

## What you take on

Hosted Supabase handled these; now you do.

- **Backups.** Nothing backs this up by default. At minimum a nightly
  `docker compose exec -T db pg_dump -U postgres postgres | gzip > …` off the box.
- **`$STACK_DIR/.env`.** Losing `JWT_SECRET` invalidates every token; losing `POSTGRES_PASSWORD`
  locks you out of the database. Back it up somewhere other than this server.
- **Uptime and updates.** Security patches, disk space, restarts after reboot.
- **Email.** Self-hosted GoTrue has no built-in sender. Set the `SMTP_*` values in `.env` or
  password reset stops working entirely. (`ENABLE_EMAIL_AUTOCONFIRM=true` is set so sign-ups do
  not stall waiting on a confirmation email that cannot be sent.)

## Rolling back

The hosted project is untouched. Revert `SUPABASE_URL` / `SUPABASE_KEY` in `app.js` to the
hosted values, push, and both GitHub Pages and Vercel are back on it within a minute.

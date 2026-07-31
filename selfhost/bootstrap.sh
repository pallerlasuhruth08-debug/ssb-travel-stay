#!/usr/bin/env bash
# Stand up self-hosted Supabase + this app on a fresh Ubuntu/Debian server.
#
#   Run as root ON THE SERVER:
#     export SUPABASE_DB_URL='postgresql://postgres.<ref>:<password>@<host>:5432/postgres'
#     bash bootstrap.sh
#
# SUPABASE_DB_URL is the *existing* hosted project's connection string, copied from
# Supabase Dashboard -> Project Settings -> Database -> Connection string -> URI.
# It is used read-only, to pg_dump the current schema and data across.
#
# Serves on plain HTTP against the server's IP, because no domain is pointed here yet:
#   frontend  http://<ip>/
#   API       http://<ip>:8000
# Both are HTTP, so the browser's mixed-content rule is satisfied. Run ./enable-tls.sh
# once a domain resolves here to move both behind HTTPS.
set -euo pipefail

PUBLIC_IP="${PUBLIC_IP:-$(curl -fsS --max-time 10 https://api.ipify.org || hostname -I | awk '{print $1}')}"
APP_DIR=/opt/mkn
STACK_DIR=$APP_DIR/supabase/docker
REPO_URL="${REPO_URL:-https://github.com/pallerlasuhruth08-debug/ssb-travel-stay.git}"

say() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }
need() { command -v "$1" >/dev/null || { echo "missing: $1"; exit 1; }; }

[ -n "${SUPABASE_DB_URL:-}" ] || { echo "Set SUPABASE_DB_URL first (see header)."; exit 1; }

say "1/8 Installing Docker, compose, postgres client, git"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg git jq openssl >/dev/null
install -m 0755 -d /etc/apt/keyrings
[ -f /etc/apt/keyrings/docker.gpg ] || curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
. /etc/os-release
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/${ID} ${VERSION_CODENAME} stable" > /etc/apt/sources.list.d/docker.list
apt-get update -qq
apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null
# Client must match the server's major version (Supabase is on PG15+); 16 reads 15 fine.
apt-get install -y -qq postgresql-client-16 >/dev/null 2>&1 || apt-get install -y -qq postgresql-client >/dev/null
need docker; need pg_dump; need psql
systemctl enable --now docker >/dev/null 2>&1 || true

say "2/8 Fetching the Supabase self-hosted stack"
mkdir -p "$APP_DIR"
[ -d "$APP_DIR/supabase" ] || git clone --depth 1 https://github.com/supabase/supabase "$APP_DIR/supabase"
cd "$STACK_DIR"
[ -f .env ] || cp .env.example .env

say "3/8 Generating secrets and the anon / service_role JWTs"
b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
mint_jwt() { # $1 = role
  local hdr pl sig now exp
  now=$(date +%s); exp=$((now + 60*60*24*365*10))
  hdr=$(printf '{"alg":"HS256","typ":"JWT"}' | b64url)
  pl=$(printf '{"role":"%s","iss":"supabase","iat":%s,"exp":%s}' "$1" "$now" "$exp" | b64url)
  sig=$(printf '%s.%s' "$hdr" "$pl" | openssl dgst -binary -sha256 -hmac "$JWT_SECRET" | b64url)
  printf '%s.%s.%s' "$hdr" "$pl" "$sig"
}
if ! grep -q '^MKN_PROVISIONED=1' .env; then
  POSTGRES_PASSWORD=$(openssl rand -hex 24)
  JWT_SECRET=$(openssl rand -hex 32)            # must be >=32 chars for GoTrue
  ANON_KEY=$(mint_jwt anon)
  SERVICE_ROLE_KEY=$(mint_jwt service_role)
  DASHBOARD_PASSWORD=$(openssl rand -hex 12)
  set_env() { grep -q "^$1=" .env && sed -i "s|^$1=.*|$1=$2|" .env || echo "$1=$2" >> .env; }
  set_env POSTGRES_PASSWORD "$POSTGRES_PASSWORD"
  set_env JWT_SECRET        "$JWT_SECRET"
  set_env ANON_KEY          "$ANON_KEY"
  set_env SERVICE_ROLE_KEY  "$SERVICE_ROLE_KEY"
  set_env DASHBOARD_USERNAME supabase
  set_env DASHBOARD_PASSWORD "$DASHBOARD_PASSWORD"
  set_env SECRET_KEY_BASE   "$(openssl rand -hex 32)"
  set_env VAULT_ENC_KEY     "$(openssl rand -hex 16)"
  set_env API_EXTERNAL_URL     "http://$PUBLIC_IP:8000"
  set_env SUPABASE_PUBLIC_URL  "http://$PUBLIC_IP:8000"
  set_env SITE_URL             "http://$PUBLIC_IP"
  set_env ADDITIONAL_REDIRECT_URLS "http://$PUBLIC_IP,http://$PUBLIC_IP/"
  # Confirmation emails need real SMTP; without it signups would stall unverified.
  set_env ENABLE_EMAIL_AUTOCONFIRM true
  echo 'MKN_PROVISIONED=1' >> .env
fi
set -a; . ./.env; set +a

say "4/8 Starting the stack (first pull takes a few minutes)"
docker compose pull -q
docker compose up -d
printf 'waiting for postgres'
for i in $(seq 1 90); do
  docker compose exec -T db pg_isready -U postgres >/dev/null 2>&1 && break
  printf '.'; sleep 2
done; echo

LOCAL_DB="postgresql://postgres:${POSTGRES_PASSWORD}@127.0.0.1:5432/postgres"

say "5/8 Dumping schema + data from the hosted project"
cd "$APP_DIR"
# public: full structure and data (tables, functions, RLS, grants, triggers).
# Privileges are deliberately NOT excluded -- mkn_trip_travellers.id_number is kept
# unreadable by a column-level grant, and dropping that would expose raw ID numbers.
pg_dump "$SUPABASE_DB_URL" --schema=public --no-owner \
  --quote-all-identifiers -f public.sql
# auth/storage: rows only -- those schemas already exist in the new stack.
pg_dump "$SUPABASE_DB_URL" --data-only --no-owner \
  --table=auth.users --table=auth.identities -f auth_rows.sql
pg_dump "$SUPABASE_DB_URL" --data-only --no-owner \
  --table=storage.buckets --table=storage.objects -f storage_rows.sql

say "6/8 Restoring into the local database"
# Triggers off during the auth load: on_auth_user_created_mkn would fire per row and
# collide with the mkn_profiles rows that public.sql already inserted.
psql "$LOCAL_DB" -v ON_ERROR_STOP=0 -f public.sql
psql "$LOCAL_DB" -v ON_ERROR_STOP=0 -c "alter table auth.users disable trigger user;" \
  -f auth_rows.sql -c "alter table auth.users enable trigger user;"
psql "$LOCAL_DB" -v ON_ERROR_STOP=0 -f storage_rows.sql
echo "rows now local:"
psql "$LOCAL_DB" -At -c "select 'auth.users='||count(*) from auth.users
  union all select 'mkn_profiles='||count(*) from public.mkn_profiles
  union all select 'trip_requests='||count(*) from public.mkn_trip_requests
  union all select 'travellers='||count(*) from public.mkn_trip_travellers
  union all select 'cab_requests='||count(*) from public.mkn_cab_requests
  union all select 'beds='||count(*) from public.mkn_beds;"

say "7/8 Publishing the front end against the new API"
rm -rf "$APP_DIR/src"; git clone --depth 1 "$REPO_URL" "$APP_DIR/src"
mkdir -p "$APP_DIR/www"; cp -r "$APP_DIR/src/index.html" "$APP_DIR/src/app.js" "$APP_DIR/src/vendor" "$APP_DIR/www/"
sed -i "s|const SUPABASE_URL = '.*'|const SUPABASE_URL = 'http://$PUBLIC_IP:8000'|" "$APP_DIR/www/app.js"
sed -i "s|const SUPABASE_KEY = '.*'|const SUPABASE_KEY = '$ANON_KEY'|" "$APP_DIR/www/app.js"
grep -n "^const SUPABASE_" "$APP_DIR/www/app.js"
docker rm -f mkn-web >/dev/null 2>&1 || true
docker run -d --name mkn-web --restart unless-stopped -p 80:80 \
  -v "$APP_DIR/www":/usr/share/nginx/html:ro nginx:alpine >/dev/null

say "8/8 Storage files (ID photos + tickets)"
cat > "$APP_DIR/copy-storage.sh" <<EOF
#!/usr/bin/env bash
# Copies the actual uploaded files. The rows are already migrated; these are the blobs.
# Needs the OLD project's service_role key: Dashboard -> Settings -> API -> service_role.
set -euo pipefail
OLD_URL="https://zbqetpvgipgagmmyupcn.supabase.co"
OLD_KEY="\${OLD_SERVICE_KEY:?export OLD_SERVICE_KEY=... first}"
NEW_URL="http://$PUBLIC_IP:8000"
NEW_KEY="$SERVICE_ROLE_KEY"
for bucket in mkn-ids mkn-tickets; do
  curl -fsS -X POST "\$NEW_URL/storage/v1/bucket" -H "Authorization: Bearer \$NEW_KEY" \\
    -H 'Content-Type: application/json' -d "{\"id\":\"\$bucket\",\"name\":\"\$bucket\",\"public\":false}" >/dev/null 2>&1 || true
  curl -fsS -X POST "\$OLD_URL/storage/v1/object/list/\$bucket" -H "Authorization: Bearer \$OLD_KEY" \\
    -H 'Content-Type: application/json' -d '{"prefix":"","limit":1000}' \\
   | jq -r '.[].name' | while read -r f; do
      [ -n "\$f" ] || continue
      curl -fsS "\$OLD_URL/storage/v1/object/\$bucket/\$f" -H "Authorization: Bearer \$OLD_KEY" -o /tmp/blob
      curl -fsS -X POST "\$NEW_URL/storage/v1/object/\$bucket/\$f" -H "Authorization: Bearer \$NEW_KEY" \\
        -H 'Content-Type: application/octet-stream' \\
        --data-binary @/tmp/blob >/dev/null && echo "  copied \$bucket/\$f"
    done
done
EOF
chmod +x "$APP_DIR/copy-storage.sh"

cat <<EOF

============================================================
 App        http://$PUBLIC_IP
 API        http://$PUBLIC_IP:8000
 Studio     http://$PUBLIC_IP:8000  (user: supabase / pass: $DASHBOARD_PASSWORD)

 anon key   $ANON_KEY

 Still to do:
   1. Copy the uploaded files:
        export OLD_SERVICE_KEY='<service_role key from the old project>'
        $APP_DIR/copy-storage.sh
   2. Sign in and confirm your requests and beds are all present.
   3. Point the domain here, then run ./enable-tls.sh <domain> for HTTPS.

 Secrets are in $STACK_DIR/.env -- back that file up; losing JWT_SECRET
 invalidates every issued token.
============================================================
EOF

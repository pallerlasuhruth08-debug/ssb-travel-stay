#!/usr/bin/env bash
# Run once a domain's A record points at this server:
#     bash enable-tls.sh mkn.example.org
#
# Puts Caddy in front of both the app and the API so everything is HTTPS on one
# origin, and rewires the front end and GoTrue to the domain. Caddy obtains and
# renews the Let's Encrypt certificate on its own -- this is the step that could
# not be done while the server was reachable only by IP, since Let's Encrypt does
# not issue certificates for bare IP addresses.
set -euo pipefail
DOMAIN="${1:?usage: enable-tls.sh <domain>}"
APP_DIR=/opt/mkn
STACK_DIR=$APP_DIR/supabase/docker
set -a; . "$STACK_DIR/.env"; set +a

command -v dig >/dev/null || apt-get install -y -qq dnsutils >/dev/null
resolved=$(dig +short "$DOMAIN" | tail -1)
here=$(curl -fsS --max-time 10 https://api.ipify.org || true)
[ -n "$resolved" ] || { echo "$DOMAIN does not resolve yet -- add the A record first."; exit 1; }
[ "$resolved" = "$here" ] || echo "warning: $DOMAIN resolves to $resolved, this host looks like $here"

# nginx moves off :80 so Caddy can own it (and answer the ACME challenge).
docker rm -f mkn-web >/dev/null 2>&1 || true
docker run -d --name mkn-web --restart unless-stopped -p 8080:80 \
  -v "$APP_DIR/www":/usr/share/nginx/html:ro nginx:alpine >/dev/null

mkdir -p "$APP_DIR/caddy"
cat > "$APP_DIR/caddy/Caddyfile" <<EOF
$DOMAIN {
    # The API keeps its /auth, /rest, /storage prefixes, so route by path and let
    # everything else fall through to the static app on one origin -- no CORS, no
    # mixed content, no second certificate.
    @api path /auth/* /rest/* /storage/* /realtime/* /functions/*
    handle @api {
        reverse_proxy host.docker.internal:8000
    }
    handle {
        reverse_proxy host.docker.internal:8080
    }
}
EOF

docker rm -f mkn-caddy >/dev/null 2>&1 || true
docker run -d --name mkn-caddy --restart unless-stopped \
  --add-host host.docker.internal:host-gateway \
  -p 80:80 -p 443:443 \
  -v "$APP_DIR/caddy/Caddyfile":/etc/caddy/Caddyfile:ro \
  -v "$APP_DIR/caddy/data":/data \
  caddy:alpine >/dev/null

# Same origin now serves both, so the client points at the domain root.
sed -i "s|const SUPABASE_URL = '.*'|const SUPABASE_URL = 'https://$DOMAIN'|" "$APP_DIR/www/app.js"

# GoTrue builds its email links from these; stale values send reset links to the old IP.
cd "$STACK_DIR"
sed -i "s|^API_EXTERNAL_URL=.*|API_EXTERNAL_URL=https://$DOMAIN|" .env
sed -i "s|^SUPABASE_PUBLIC_URL=.*|SUPABASE_PUBLIC_URL=https://$DOMAIN|" .env
sed -i "s|^SITE_URL=.*|SITE_URL=https://$DOMAIN|" .env
sed -i "s|^ADDITIONAL_REDIRECT_URLS=.*|ADDITIONAL_REDIRECT_URLS=https://$DOMAIN,https://$DOMAIN/|" .env
docker compose up -d

echo
echo "Live on https://$DOMAIN (certificate issues on the first request; give it ~30s)."
echo "Close the old ports once you have confirmed it works:"
echo "  ufw allow 80,443/tcp && ufw deny 8000/tcp && ufw enable"

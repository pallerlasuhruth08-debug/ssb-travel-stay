#!/usr/bin/env bash
# Fixes "Error sending confirmation email" on sign-up.
#
#   bash fix-signup-email.sh                 # unblock sign-ups now (auto-confirm, no SMTP)
#   bash fix-signup-email.sh --smtp          # also configure SMTP, prompted
#
# Hosted Supabase ships a built-in email sender. Self-hosted GoTrue does NOT: with no SMTP
# configured it still tries to send a confirmation email on every sign-up, fails, and returns
# an error -- so the account cannot be created. Turning on auto-confirm removes the email from
# the sign-up path entirely and accounts work immediately.
#
# Auto-confirm does not fix "Forgot password", which genuinely has to send mail. Run with
# --smtp for that, or set SMTP_* in .env later.
set -euo pipefail
STACK_DIR="${STACK_DIR:-/opt/mkn/supabase/docker}"
cd "$STACK_DIR"

set_env() { grep -q "^$1=" .env && sed -i "s|^$1=.*|$1=$2|" .env || echo "$1=$2" >> .env; }

echo "==> Enabling auto-confirm so sign-up stops depending on email"
set_env ENABLE_EMAIL_SIGNUP      true
set_env ENABLE_EMAIL_AUTOCONFIRM true

if [ "${1:-}" = "--smtp" ]; then
  echo
  echo "SMTP (Gmail/Workspace: smtp.gmail.com : 587, and use an App Password, not the"
  echo "account password. SendGrid: smtp.sendgrid.net : 587, user 'apikey')."
  read -rp "  SMTP host: " H
  read -rp "  SMTP port [587]: " P; P=${P:-587}
  read -rp "  SMTP username: " U
  read -rsp "  SMTP password: " W; echo
  read -rp "  From address (e.g. mkn@sadhguru.org): " F
  set_env SMTP_HOST "$H"; set_env SMTP_PORT "$P"; set_env SMTP_USER "$U"
  set_env SMTP_PASS "$W"; set_env SMTP_ADMIN_EMAIL "$F"; set_env SMTP_SENDER_NAME "MKN Transport & Stay"
  echo "==> SMTP set. Password reset will work once auth restarts."
fi

echo "==> Restarting the auth service"
docker compose up -d auth
sleep 6

echo "==> Verifying what GoTrue actually loaded"
docker compose exec -T auth env 2>/dev/null \
  | grep -E 'GOTRUE_MAILER_AUTOCONFIRM|GOTRUE_EXTERNAL_EMAIL_ENABLED|GOTRUE_SMTP_HOST' \
  || echo "  (could not read container env -- check 'docker compose logs auth')"

echo
echo "==> Accounts left stranded by the failed sign-ups"
# GoTrue may create the user row and *then* fail on the email, so the address is taken but
# unusable -- a retry says "User already registered" while sign-in says the email is not
# confirmed. These rows are confirmed in place rather than deleted so nobody loses an account.
docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL'
select email, created_at, (email_confirmed_at is not null) as confirmed
  from auth.users where email_confirmed_at is null order by created_at;

update auth.users
   set email_confirmed_at = coalesce(email_confirmed_at, now()),
       confirmed_at       = coalesce(confirmed_at, now())
 where email_confirmed_at is null;

select count(*) as still_unconfirmed from auth.users where email_confirmed_at is null;
SQL

cat <<'EOF'

Done. Sign-up should work immediately -- have them try again.

If the address was already taken by a failed attempt it has just been confirmed, so that
person can sign in with the password they originally chose rather than re-registering.

Password reset still needs SMTP; re-run with --smtp when you have credentials.
EOF

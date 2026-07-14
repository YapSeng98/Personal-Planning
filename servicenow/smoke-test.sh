#!/bin/sh
# Smoke-tests the Planner's ServiceNow integration — NO credentials needed.
# Uses the Money Tracker's live /auth endpoints to register/login a dedicated
# e2e account, then exercises the Planner API with its session token.
set -e
SN=https://dev405150.service-now.com
PFMT="$SN/api/x_887486_0/pfmt"
PLANNER="$SN/api/x_887486_0/planner"
U="planner_e2e"
P="PlannerE2E!2026"
UUID="smoke-$(date +%s)"
TODAY=$(date +%F)

check() { # label, expected substring, actual
  case "$3" in
    *"$2"*) echo "  PASS  $1" ;;
    *) echo "  FAIL  $1"; echo "        got: $(echo "$3" | head -c 300)"; FAILED=1 ;;
  esac
}

echo "1. Auth — login (or first-time register) the e2e account"
R=$(curl -s -X POST "$PFMT/auth/login" -H 'Content-Type: application/json' \
  -d "{\"username\":\"$U\",\"password\":\"$P\"}")
case "$R" in
  *token*) : ;;
  *) curl -s -X POST "$PFMT/auth/register" -H 'Content-Type: application/json' \
       -d "{\"username\":\"$U\",\"password\":\"$P\",\"display_name\":\"Planner E2E\"}" >/dev/null
     R=$(curl -s -X POST "$PFMT/auth/login" -H 'Content-Type: application/json' \
       -d "{\"username\":\"$U\",\"password\":\"$P\"}") ;;
esac
check "login returns session token" '"token"' "$R"
TOKEN=$(echo "$R" | sed -n 's/.*"token" *: *"\([a-f0-9]*\)".*/\1/p')
[ -n "$TOKEN" ] || { echo "  cannot continue without token"; exit 1; }

echo "2. Planner API — sync pull"
R=$(curl -s "$PLANNER/sync/pull?since=1970-01-01%2000:00:00" -H "X-PFMT-Token: $TOKEN" -H "X-HTTP-Method: GET")
check "GET /sync/pull returns cursor" '"cursor"' "$R"

echo "3. Planner API — sync push (store a test task)"
R=$(curl -s -X POST "$PLANNER/sync/push" -H 'Content-Type: application/json' \
  -H "X-PFMT-Token: $TOKEN" -H "X-HTTP-Method: POST" \
  -d "{\"items\":[{\"table\":\"task\",\"client_uuid\":\"$UUID\",\"edited_at\":$(date +%s)000,
       \"payload\":{\"title\":\"smoke test task\",\"state\":\"open\",\"priority\":3,
        \"due\":\"$TODAY\",\"timeBlockStart\":\"${TODAY}T09:00\",\"deleted\":false}}]}")
check "POST /sync/push applied" '"applied"' "$R"

echo "4. Fetch round-trip — pull sees the stored task"
R=$(curl -s "$PLANNER/sync/pull?since=1970-01-01%2000:00:00" -H "X-PFMT-Token: $TOKEN" -H "X-HTTP-Method: GET")
check "pull returns the smoke task uuid" "$UUID" "$R"
check "title stored and fetched" 'smoke test task' "$R"

echo "5. Dashboard aggregate"
R=$(curl -s "$PLANNER/dashboard/today" -H "X-PFMT-Token: $TOKEN" -H "X-HTTP-Method: GET")
check "GET /dashboard/today includes the task" 'smoke test task' "$R"

echo "6. Auth guard — planner API without token is rejected"
R=$(curl -s "$PLANNER/sync/pull?since=1970-01-01%2000:00:00" -H "X-HTTP-Method: GET")
check "401 error without token" 'error' "$R"

[ -z "$FAILED" ] && echo "ALL SMOKE TESTS PASSED" || { echo "SMOKE TESTS FAILED — see above"; exit 1; }

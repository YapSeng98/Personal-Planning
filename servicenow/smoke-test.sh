#!/bin/sh
# Smoke-tests the ServiceNow side alone (no app involved).
# Reads credentials from frontend/.env.local:
#   VITE_SN_TEST_USER=...
#   VITE_SN_TEST_PASSWORD=...
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENVF="$ROOT/frontend/.env.local"
[ -f "$ENVF" ] || { echo "Missing $ENVF — create it with VITE_SN_TEST_USER / VITE_SN_TEST_PASSWORD"; exit 1; }
USER=$(grep '^VITE_SN_TEST_USER=' "$ENVF" | cut -d= -f2-)
PASS=$(grep '^VITE_SN_TEST_PASSWORD=' "$ENVF" | cut -d= -f2-)
SN=https://dev405150.service-now.com
AUTH="$USER:$PASS"
UUID="smoke-$(date +%s)"

check() { # label, expected substring, actual
  case "$3" in
    *"$2"*) echo "  PASS  $1" ;;
    *) echo "  FAIL  $1"; echo "        got: $(echo "$3" | head -c 300)"; FAILED=1 ;;
  esac
}

echo "1. Auth + x_pps_task table reachable"
R=$(curl -s -u "$AUTH" "$SN/api/now/table/x_pps_task?sysparm_limit=1")
check "table API + ACL" '"result"' "$R"

echo "2. Scripted REST: sync pull"
R=$(curl -s -u "$AUTH" "$SN/api/x_pps/pps/sync/pull?since=1970-01-01%2000:00:00")
check "GET /sync/pull returns cursor" '"cursor"' "$R"

echo "3. Scripted REST: sync push (test task, due today, with time block)"
TODAY=$(date +%F)
R=$(curl -s -u "$AUTH" -X POST "$SN/api/x_pps/pps/sync/push" \
  -H 'Content-Type: application/json' \
  -d "{\"items\":[{\"table\":\"task\",\"client_uuid\":\"$UUID\",\"edited_at\":$(date +%s)000,
       \"payload\":{\"title\":\"smoke test task\",\"state\":\"open\",\"priority\":3,
        \"due\":\"$TODAY\",\"timeBlockStart\":\"${TODAY}T09:00\",\"deleted\":false}}]}")
check "POST /sync/push applied" '"applied"' "$R"

echo "4. Round-trip: pushed task visible via table API"
R=$(curl -s -u "$AUTH" "$SN/api/now/table/x_pps_task?sysparm_query=client_uuid=$UUID")
check "record stored with title" 'smoke test task' "$R"
check "time block stored with seconds" "$TODAY 09:00:00" "$R"

echo "5. Dashboard aggregate"
R=$(curl -s -u "$AUTH" "$SN/api/x_pps/pps/dashboard/today")
check "GET /dashboard/today includes pushed task" 'smoke test task' "$R"

echo "6. Pull sees the new record"
R=$(curl -s -u "$AUTH" "$SN/api/x_pps/pps/sync/pull?since=1970-01-01%2000:00:00")
check "pull returns the smoke task" "$UUID" "$R"

[ -z "$FAILED" ] && echo "ALL SMOKE TESTS PASSED" || { echo "SMOKE TESTS FAILED — see above"; exit 1; }

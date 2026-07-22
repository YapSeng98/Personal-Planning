#!/bin/sh
# Smoke-tests the Planner's ServiceNow integration — NO credentials needed.
# Uses the Planner's own /auth endpoints to register/login a dedicated
# e2e account, then exercises the Planner API with its session token.
set -e
SN=https://dev405150.service-now.com
# The Planner app's scope — Studio shows it after creating the app;
# adjust here if it differs.
SCOPE="x_887486_persona_0"
PLANNER="$SN/api/$SCOPE/pps"
PLANNER_AUTH="$PLANNER"
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
R=$(curl -s -X POST "$PLANNER_AUTH/auth/login" -H 'Content-Type: application/json' \
  -d "{\"username\":\"$U\",\"password\":\"$P\"}")
case "$R" in
  *token*) : ;;
  *) curl -s -X POST "$PLANNER_AUTH/auth/register" -H 'Content-Type: application/json' \
       -d "{\"username\":\"$U\",\"password\":\"$P\",\"display_name\":\"Planner E2E\"}" >/dev/null
     R=$(curl -s -X POST "$PLANNER_AUTH/auth/login" -H 'Content-Type: application/json' \
       -d "{\"username\":\"$U\",\"password\":\"$P\"}") ;;
esac
check "login returns session token" '"token"' "$R"
TOKEN=$(echo "$R" | sed -n 's/.*"token" *: *"\([a-f0-9]*\)".*/\1/p')
[ -n "$TOKEN" ] || { echo "  cannot continue without token"; exit 1; }

echo "2. Planner API — sync pull"
R=$(curl -s "$PLANNER/sync/pull?since=1970-01-01%2000:00:00" -H "X-Planner-Token: $TOKEN" -H "X-HTTP-Method: GET")
check "GET /sync/pull returns cursor" '"cursor"' "$R"

echo "3. Planner API — sync push (store a test task)"
R=$(curl -s -X POST "$PLANNER/sync/push" -H 'Content-Type: application/json' \
  -H "X-Planner-Token: $TOKEN" -H "X-HTTP-Method: POST" \
  -d "{\"items\":[{\"table\":\"task\",\"client_uuid\":\"$UUID\",\"edited_at\":$(date +%s)000,
       \"payload\":{\"title\":\"smoke test task\",\"state\":\"open\",\"priority\":3,
        \"due\":\"$TODAY\",\"timeBlockStart\":\"${TODAY}T09:00\",\"deleted\":false}}]}")
check "POST /sync/push applied" '"applied"' "$R"

echo "4. Fetch round-trip — pull sees the stored task"
R=$(curl -s "$PLANNER/sync/pull?since=1970-01-01%2000:00:00" -H "X-Planner-Token: $TOKEN" -H "X-HTTP-Method: GET")
check "pull returns the smoke task uuid" "$UUID" "$R"
check "title stored and fetched" 'smoke test task' "$R"

echo "5. Dashboard aggregate (with the client's local date)"
R=$(curl -s "$PLANNER/dashboard/today?date=$TODAY" -H "X-Planner-Token: $TOKEN" -H "X-HTTP-Method: GET")
check "GET /dashboard/today includes the task" 'smoke test task' "$R"

echo "5b. Server-side goal roll-up (needs latest sync_push.js pasted)"
curl -s -X POST "$PLANNER/sync/push" -H 'Content-Type: application/json' \
  -H "X-Planner-Token: $TOKEN" -H "X-HTTP-Method: POST" \
  -d "{\"items\":[
   {\"table\":\"goal\",\"client_uuid\":\"rollup-$UUID\",\"edited_at\":$(date +%s)000,
    \"payload\":{\"title\":\"rollup probe\",\"type\":\"month\",\"status\":\"in_progress\",\"progress\":0,\"deleted\":false}},
   {\"table\":\"task\",\"client_uuid\":\"rolluptask-$UUID\",\"edited_at\":$(date +%s)000,
    \"payload\":{\"title\":\"rollup probe task\",\"state\":\"done\",\"priority\":3,\"due\":\"$TODAY\",\"goalId\":\"rollup-$UUID\",\"deleted\":false}}]}" >/dev/null
sleep 2
R=$(curl -s "$PLANNER/sync/pull?since=$(date -u -v-2M '+%Y-%m-%d %H:%M:%S' | sed 's/ /%20/')" -H "X-Planner-Token: $TOKEN" -H "X-HTTP-Method: GET")
OK=$(echo "$R" | python3 -c "
import json,sys
d = json.load(sys.stdin)['result']
print(any(r['table']=='goal' and r['data'].get('title')=='rollup probe' and r['data'].get('progress')==100 for r in d['records']))
" 2>/dev/null)
if [ "$OK" = "True" ]; then
  echo "  PASS  done task rolled its goal to 100% server-side"
else
  echo "  PEND  server roll-up not active — sync_push.js re-paste still pending"
  FAILED=1
fi

echo "7. Board feature — project CRUD + task->project link + in_progress round-trip"
echo "   (needs the new x_pps_project table + task.project field + re-pasted scripts)"
PROJUUID="smokeproj-$(date +%s)"
curl -s -X POST "$PLANNER/sync/push" -H 'Content-Type: application/json' \
  -H "X-Planner-Token: $TOKEN" -H "X-HTTP-Method: POST" \
  -d "{\"items\":[
   {\"table\":\"project\",\"client_uuid\":\"$PROJUUID\",\"edited_at\":$(date +%s)000,
    \"payload\":{\"title\":\"smoke project\",\"color\":\"blue\",\"archived\":false,\"deleted\":false}},
   {\"table\":\"task\",\"client_uuid\":\"projtask-$UUID\",\"edited_at\":$(date +%s)000,
    \"payload\":{\"title\":\"in-progress smoke task\",\"state\":\"in_progress\",\"priority\":3,
     \"due\":\"$TODAY\",\"projectId\":\"$PROJUUID\",\"deleted\":false}}]}" >/dev/null
R=$(curl -s "$PLANNER/sync/pull?since=1970-01-01%2000:00:00" -H "X-Planner-Token: $TOKEN" -H "X-HTTP-Method: GET")
check "project title round-trips" 'smoke project' "$R"
check "project color round-trips" '"color":"blue"' "$R"
check "task state in_progress round-trips" '"in_progress"' "$R"
check "task links to project" "\"projectId\":\"$PROJUUID\"" "$R"

echo "6. Auth guard — planner API without token is rejected"
R=$(curl -s "$PLANNER/sync/pull?since=1970-01-01%2000:00:00" -H "X-HTTP-Method: GET")
check "401 error without token" 'error' "$R"

[ -z "$FAILED" ] && echo "ALL SMOKE TESTS PASSED" || { echo "SMOKE TESTS FAILED — see above"; exit 1; }

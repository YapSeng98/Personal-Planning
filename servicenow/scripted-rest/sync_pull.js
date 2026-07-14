// ============================================================
// Planner Scripted REST API — /sync/pull
// Location : ServiceNow → Studio (inside the PFMT app, scope x_887486_0)
// API Name : Planner API   (API ID: planner)
// Resource : /sync/pull    Method: GET
// Full URL : https://<instance>.service-now.com/api/x_887486_0/planner/sync/pull?since=...
//
// All requests require header: X-PFMT-Token (same session as Money Tracker)
// NOTE: Set "Requires authentication" = false on this resource
// ============================================================
(function process(request, response) {
    var helper = new PFMTAuthHelper();
    var T = 'x_887486_0_pps_';

    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-PFMT-Token, X-HTTP-Method');
    if (request.getHeader('X-HTTP-Method') === 'OPTIONS') { response.setStatus(200); return; }

    var profile = helper.validateToken(request.getHeader('X-PFMT-Token') || '');
    if (!profile) { helper.errorResponse(response, 401, 'Invalid or expired session. Please log in again.'); return; }

    var TABLES = { task: T + 'task', habit: T + 'habit', habit_log: T + 'habit_log', goal: T + 'goal', review: T + 'review' };

    var FIELD_MAPS = {
        task: {
            title: 'title', notes: 'notes', state: 'state', priority: 'priority',
            due: 'due', time_block_start: 'timeBlockStart', time_block_end: 'timeBlockEnd',
            estimated_hours: 'estimatedHours', actual_hours: 'actualHours',
            goal: 'ref:goalId', is_mit: 'isMit'
        },
        habit: {
            name: 'name', emoji: 'emoji', frequency: 'frequency',
            target_per_day: 'targetPerDay', active: 'active'
        },
        habit_log: { habit: 'ref:habitId', date: 'date', count: 'count' },
        goal: {
            title: 'title', type: 'type', parent_goal: 'ref:parentId',
            life_area: 'lifeArea', why_it_matters: 'whyItMatters', progress: 'progress',
            status: 'status', target_date: 'targetDate'
        },
        review: {
            type: 'type', period_start: 'periodStart', period_end: 'periodEnd',
            wins: 'wins', failures: 'failures', lesson: 'lesson', mood: 'mood',
            energy: 'energy', next_priorities: 'nextPriorities'
        }
    };

    var INT_FIELDS = { priority: 1, progress: 1, energy: 1, count: 1, target_per_day: 1 };
    var BOOL_FIELDS = { is_mit: 1, active: 1 };

    var since = request.queryParams.since || '1970-01-01 00:00:00';
    // Cursor captured BEFORE querying: concurrent writes land in the next
    // pull; re-applying an overlap is harmless (idempotent puts).
    var cursor = new GlideDateTime().getDisplayValue();
    var records = [];

    for (var key in TABLES) {
        var gr = new GlideRecord(TABLES[key]);
        gr.addQuery('user_profile', profile);
        gr.addQuery('sys_updated_on', '>', since);
        gr.query();
        while (gr.next()) {
            var map = FIELD_MAPS[key];
            var data = {};
            for (var col in map) {
                var target = map[col];
                if (target.indexOf('ref:') === 0) {
                    var refGr = gr[col].getRefRecord();
                    data[target.substring(4)] = (refGr && refGr.isValidRecord()) ?
                        refGr.getValue('client_uuid') : null;
                } else if (INT_FIELDS[col]) {
                    data[target] = parseInt(gr.getValue(col), 10) || 0;
                } else if (BOOL_FIELDS[col]) {
                    data[target] = gr.getValue(col) === 'true' ? 1 : 0;
                } else {
                    var v = gr.getValue(col);
                    data[target] = v === null ? undefined : String(v).replace(' ', 'T');
                }
            }
            data.deleted = gr.getValue('deleted') === 'true' ? 1 : 0;
            data.updatedAt = new GlideDateTime(gr.getValue('sys_updated_on')).getNumericValue();
            records.push({
                table: key,
                client_uuid: gr.getValue('client_uuid'),
                sys_id: gr.getUniqueValue(),
                deleted: gr.getValue('deleted') === 'true',
                data: data
            });
        }
    }

    response.setStatus(200);
    response.setBody({ cursor: cursor, records: records });
})(request, response);

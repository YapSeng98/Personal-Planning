// ============================================================
// Planner Scripted REST API — /sync/push
// Location : ServiceNow → Studio (inside the Planner app)
// API Name : Planner API   (API ID: planner)
// Resource : /sync/push    Method: POST
// Full URL : https://<instance>.service-now.com/api/x_887486_persona_0/planner/sync/push
//
// All requests require header: X-Planner-Token (Planner's own session)
// NOTE: Set "Requires authentication" = false on this resource
// ============================================================
(function process(request, response) {
    var helper = new PlannerAuthHelper();
    var T = helper.SCOPE + '_x_pps_'; // derived from PlannerAuthHelper.SCOPE

    // ── CORS ─────────────────────────────────────────────────
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Planner-Token, X-HTTP-Method');
    if (request.getHeader('X-HTTP-Method') === 'OPTIONS') { response.setStatus(200); return; }

    // ── Auth ─────────────────────────────────────────────────
    var profile = helper.validateToken(request.getHeader('X-Planner-Token') || '');
    if (!profile) { helper.errorResponse(response, 401, 'Invalid or expired session. Please log in again.'); return; }

    var TABLES = { task: T + 'task', habit: T + 'habit', habit_log: T + 'habit_log', goal: T + 'goal', review: T + 'review' };

    // frontend camelCase -> SN column. 'ref:' resolves a client_uuid to a
    // sys_id on the named planner table (task/goal/habit key).
    var FIELD_MAPS = {
        task: {
            title: 'title', notes: 'notes', state: 'state', priority: 'priority',
            due: 'due', timeBlockStart: 'time_block_start', timeBlockEnd: 'time_block_end',
            estimatedHours: 'estimated_hours', actualHours: 'actual_hours',
            goalId: 'ref:goal:goal', isMit: 'is_mit', deleted: 'deleted'
        },
        habit: {
            name: 'name', emoji: 'emoji', frequency: 'frequency',
            targetPerDay: 'target_per_day', active: 'active', deleted: 'deleted'
        },
        habit_log: { habitId: 'ref:habit:habit', date: 'date', count: 'count', deleted: 'deleted' },
        goal: {
            title: 'title', type: 'type', parentId: 'ref:parent_goal:goal',
            lifeArea: 'life_area', whyItMatters: 'why_it_matters', progress: 'progress',
            status: 'status', targetDate: 'target_date', deleted: 'deleted'
        },
        review: {
            type: 'type', periodStart: 'period_start', periodEnd: 'period_end',
            wins: 'wins', failures: 'failures', lesson: 'lesson', mood: 'mood',
            energy: 'energy', nextPriorities: 'next_priorities', deleted: 'deleted'
        }
    };

    function resolveRef(tableKey, clientUuid) {
        if (!clientUuid) return '';
        var gr = new GlideRecord(TABLES[tableKey]);
        gr.addQuery('client_uuid', clientUuid);
        gr.addQuery('user_profile', profile);
        gr.query();
        return gr.next() ? gr.getUniqueValue() : '';
    }

    function isoToGlide(v) {
        var s = String(v).replace('T', ' ');
        if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s)) s += ':00';
        return s;
    }

    var body = request.body ? request.body.data : {};
    var items = (body && body.items) || [];
    var results = [];

    for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var tableName = TABLES[item.table];
        var map = FIELD_MAPS[item.table];
        if (!tableName || !map) continue;

        var gr = new GlideRecord(tableName);
        gr.addQuery('client_uuid', item.client_uuid);
        gr.addQuery('user_profile', profile);
        gr.query();
        var exists = gr.next();

        // Last-write-wins: if the server copy changed after this client edit,
        // the server wins; the client converges on the next pull.
        if (exists) {
            var serverMs = new GlideDateTime(gr.getValue('sys_updated_on')).getNumericValue();
            if (serverMs > item.edited_at) {
                results.push({ client_uuid: item.client_uuid, sys_id: gr.getUniqueValue(), outcome: 'server_won' });
                continue;
            }
        } else {
            gr.initialize();
            gr.setValue('client_uuid', item.client_uuid);
            gr.setValue('user_profile', profile);
        }

        var p = item.payload || {};
        for (var key in map) {
            if (!p.hasOwnProperty(key) || p[key] === null || p[key] === undefined) continue;
            var target = map[key];
            if (target.indexOf('ref:') === 0) {
                var parts = target.split(':'); // ref : column : tableKey
                gr.setValue(parts[1], resolveRef(parts[2], p[key]));
            } else if (key === 'due' || key === 'date' || key.indexOf('timeBlock') === 0 ||
                       key === 'targetDate' || key.indexOf('period') === 0) {
                gr.setValue(target, isoToGlide(p[key]));
            } else if (typeof p[key] === 'boolean') {
                gr.setValue(target, p[key] ? 'true' : 'false');
            } else {
                gr.setValue(target, p[key]);
            }
        }

        var sysId = exists ? gr.update() : gr.insert();
        results.push({ client_uuid: item.client_uuid, sys_id: String(sysId), outcome: 'applied' });
    }

    response.setStatus(200);
    response.setBody({ results: results });
})(request, response);

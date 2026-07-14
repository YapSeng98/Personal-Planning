// POST /api/x_pps/pps/sync/push
// Body: { items: [{ table, client_uuid, payload, edited_at }] }
// Idempotent upsert keyed on client_uuid; last-write-wins vs sys_updated_on.
(function process(request, response) {
    var TABLES = {
        task: 'x_pps_task',
        habit: 'x_pps_habit',
        habit_log: 'x_pps_habit_log',
        goal: 'x_pps_goal',
        review: 'x_pps_review'
    };

    // frontend camelCase -> SN column. 'ref:' values resolve a client_uuid
    // to a sys_id on the named table.
    var FIELD_MAPS = {
        task: {
            title: 'title', notes: 'notes', state: 'state', priority: 'priority',
            due: 'due', timeBlockStart: 'time_block_start', timeBlockEnd: 'time_block_end',
            estimatedHours: 'estimated_hours', actualHours: 'actual_hours',
            goalId: 'ref:goal:x_pps_goal', isMit: 'is_mit', deleted: 'deleted'
        },
        habit: {
            name: 'name', emoji: 'emoji', frequency: 'frequency',
            targetPerDay: 'target_per_day', active: 'active', deleted: 'deleted'
        },
        habit_log: {
            habitId: 'ref:habit:x_pps_habit', date: 'date', count: 'count', deleted: 'deleted'
        },
        goal: {
            title: 'title', type: 'type', parentId: 'ref:parent_goal:x_pps_goal',
            lifeArea: 'life_area', whyItMatters: 'why_it_matters', progress: 'progress',
            status: 'status', targetDate: 'target_date', deleted: 'deleted'
        },
        review: {
            type: 'type', periodStart: 'period_start', periodEnd: 'period_end',
            wins: 'wins', failures: 'failures', lesson: 'lesson', mood: 'mood',
            energy: 'energy', nextPriorities: 'next_priorities', deleted: 'deleted'
        }
    };

    function resolveRef(table, clientUuid) {
        if (!clientUuid) return '';
        var gr = new GlideRecord(table);
        gr.addQuery('client_uuid', clientUuid);
        gr.query();
        return gr.next() ? gr.getUniqueValue() : '';
    }

    function isoToGlide(v) {
        // Accepts YYYY-MM-DD or YYYY-MM-DDTHH:mm[:ss]; SN wants
        // space-separated with seconds.
        var s = String(v).replace('T', ' ');
        if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s)) s += ':00';
        return s;
    }

    var body = request.body.data;
    var items = (body && body.items) || [];
    var results = [];

    for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var tableName = TABLES[item.table];
        var map = FIELD_MAPS[item.table];
        if (!tableName || !map) continue;

        var gr = new GlideRecord(tableName);
        gr.addQuery('client_uuid', item.client_uuid);
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
        }

        var p = item.payload || {};
        for (var key in map) {
            if (!p.hasOwnProperty(key) || p[key] === null || p[key] === undefined) continue;
            var target = map[key];
            if (target.indexOf('ref:') === 0) {
                var parts = target.split(':'); // ref : column : table
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

// ============================================================
// Planner Scripted REST API — /dashboard/today
// Location : ServiceNow → Studio (inside the Planner app)
// API Name : Planner API   (API ID: planner)
// Resource : /dashboard/today    Method: GET
// Full URL : https://<instance>.service-now.com/api/x_887486_persona_0/planner/dashboard/today
//
// All requests require header: X-Planner-Token (Planner's own session)
// NOTE: Set "Requires authentication" = false on this resource
// ============================================================
(function process(request, response) {
    var helper = new PlannerAuthHelper();
    var T = helper.SCOPE + '_x_pps_'; // derived from PlannerAuthHelper.SCOPE

    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Planner-Token, X-HTTP-Method');
    if (request.getHeader('X-HTTP-Method') === 'OPTIONS') { response.setStatus(200); return; }

    var profile = helper.validateToken(request.getHeader('X-Planner-Token') || '');
    if (!profile) { helper.errorResponse(response, 401, 'Invalid or expired session. Please log in again.'); return; }

    var today = new GlideDate().getValue(); // YYYY-MM-DD

    var tasks = [];
    var tGr = new GlideRecord(T + 'task');
    tGr.addQuery('user_profile', profile);
    tGr.addQuery('due', today);
    tGr.addQuery('deleted', false);
    tGr.orderBy('time_block_start');
    tGr.query();
    while (tGr.next()) {
        tasks.push({
            client_uuid: tGr.getValue('client_uuid'),
            title: tGr.getValue('title'),
            state: tGr.getValue('state'),
            priority: parseInt(tGr.getValue('priority'), 10) || 3,
            is_mit: tGr.getValue('is_mit') === 'true',
            time_block_start: tGr.getValue('time_block_start'),
            time_block_end: tGr.getValue('time_block_end')
        });
    }

    var habits = [];
    var hGr = new GlideRecord(T + 'habit');
    hGr.addQuery('user_profile', profile);
    hGr.addQuery('active', true);
    hGr.addQuery('deleted', false);
    hGr.query();
    while (hGr.next()) {
        var log = new GlideRecord(T + 'habit_log');
        log.addQuery('habit', hGr.getUniqueValue());
        log.addQuery('date', today);
        log.addQuery('deleted', false);
        log.query();
        habits.push({
            client_uuid: hGr.getValue('client_uuid'),
            name: hGr.getValue('name'),
            emoji: hGr.getValue('emoji'),
            target_per_day: parseInt(hGr.getValue('target_per_day'), 10) || 1,
            done_today: log.next() ? (parseInt(log.getValue('count'), 10) || 0) : 0
        });
    }

    var goals = [];
    var gGr = new GlideRecord(T + 'goal');
    gGr.addQuery('user_profile', profile);
    gGr.addQuery('status', 'in_progress');
    gGr.addQuery('deleted', false);
    gGr.addQuery('type', 'IN', 'year,quarter');
    gGr.query();
    while (gGr.next()) {
        goals.push({
            client_uuid: gGr.getValue('client_uuid'),
            title: gGr.getValue('title'),
            type: gGr.getValue('type'),
            progress: parseInt(gGr.getValue('progress'), 10) || 0
        });
    }

    response.setStatus(200);
    response.setBody({ date: today, tasks: tasks, habits: habits, goals: goals });
})(request, response);

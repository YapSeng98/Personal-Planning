// ============================================================
// Planner Scripted REST API — /habit/checkin
// Location : ServiceNow → Studio (inside the Planner app)
// API Name : Planner API   (API ID: planner)
// Resource : /habit/checkin    Method: POST
// Body     : { "habit": "<habit client_uuid>" }
// Full URL : https://<instance>.service-now.com/api/x_887486_persona_0/planner/habit/checkin
//
// All requests require header: X-Planner-Token (Planner's own session)
// NOTE: Set "Requires authentication" = false on this resource
// ============================================================
(function process(request, response) {
    var helper = new PlannerAuthHelper();
    var T = helper.SCOPE + '_x_pps_'; // derived from PlannerAuthHelper.SCOPE

    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Planner-Token, X-HTTP-Method');
    if (request.getHeader('X-HTTP-Method') === 'OPTIONS') { response.setStatus(200); return; }

    var profile = helper.validateToken(request.getHeader('X-Planner-Token') || '');
    if (!profile) { helper.errorResponse(response, 401, 'Invalid or expired session. Please log in again.'); return; }

    var body = request.body ? request.body.data : {};
    var habitUuid = (body && body.habit) || '';

    var habit = new GlideRecord(T + 'habit');
    habit.addQuery('client_uuid', habitUuid);
    habit.addQuery('user_profile', profile);
    habit.query();
    if (!habit.next()) {
        helper.errorResponse(response, 404, 'No habit with client_uuid ' + habitUuid);
        return;
    }

    var today = new GlideDate().getValue();
    var log = new GlideRecord(T + 'habit_log');
    log.addQuery('habit', habit.getUniqueValue());
    log.addQuery('date', today);
    log.query();
    if (log.next()) {
        log.setValue('count', (parseInt(log.getValue('count'), 10) || 0) + 1);
        log.setValue('deleted', 'false');
        log.update();
    } else {
        log.initialize();
        log.setValue('client_uuid', gs.generateGUID());
        log.setValue('user_profile', profile);
        log.setValue('habit', habit.getUniqueValue());
        log.setValue('date', today);
        log.setValue('count', 1);
        log.setValue('deleted', 'false');
        log.insert();
    }

    // Walk backwards from today counting consecutive logged days.
    var streak = 0;
    var cursor = new GlideDate();
    while (true) {
        var dayLog = new GlideRecord(T + 'habit_log');
        dayLog.addQuery('habit', habit.getUniqueValue());
        dayLog.addQuery('date', cursor.getValue());
        dayLog.addQuery('count', '>', 0);
        dayLog.addQuery('deleted', false);
        dayLog.query();
        if (!dayLog.next()) break;
        streak++;
        cursor.addDays(-1);
        if (streak > 3650) break; // sanity bound
    }

    response.setStatus(200);
    response.setBody({ habit: habitUuid, date: today, streak: streak });
})(request, response);

// GET /api/x_pps/pps/dashboard/today
// One-call aggregate for the Today screen: today's tasks, active habits with
// today's log, and in-progress goal snapshots (design doc §07).
(function process(request, response) {
    var today = new GlideDate().getValue(); // YYYY-MM-DD

    var tasks = [];
    var tGr = new GlideRecord('x_pps_task');
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
    var hGr = new GlideRecord('x_pps_habit');
    hGr.addQuery('active', true);
    hGr.addQuery('deleted', false);
    hGr.query();
    while (hGr.next()) {
        var log = new GlideRecord('x_pps_habit_log');
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
    var gGr = new GlideRecord('x_pps_goal');
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

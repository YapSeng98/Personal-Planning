// POST /api/x_pps/pps/habit/{id}/checkin   ({id} = habit client_uuid)
// Writes/increments today's log row and returns the recalculated streak —
// streaks are always derived from logs, never a stored counter (doc §06).
(function process(request, response) {
    var habitUuid = request.pathParams.id;

    var habit = new GlideRecord('x_pps_habit');
    habit.addQuery('client_uuid', habitUuid);
    habit.query();
    if (!habit.next()) {
        response.setStatus(404);
        response.setBody({ error: 'No habit with client_uuid ' + habitUuid });
        return;
    }

    var today = new GlideDate().getValue();
    var log = new GlideRecord('x_pps_habit_log');
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
        var dayLog = new GlideRecord('x_pps_habit_log');
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

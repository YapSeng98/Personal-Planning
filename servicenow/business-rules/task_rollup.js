// Business Rule on x_887486_persona_0_x_pps_task  (inside the Planner app)
//   When: after · Insert = true, Update = true
//   Condition: state changes OR goal changes
// Recalculates the linked goal's progress from its tasks, then cascades the
// average up the parent_goal chain: Week → Month → Quarter → Year.
(function executeRule(current, previous /*null when async/insert*/) {
    var T = new PlannerAuthHelper().SCOPE + '_x_pps_';

    function recalcFromTasks(goalSysId) {
        var total = 0, done = 0;
        var t = new GlideRecord(T + 'task');
        t.addQuery('goal', goalSysId);
        t.addQuery('deleted', false);
        t.addQuery('state', '!=', 'cancelled');
        t.query();
        while (t.next()) {
            total++;
            if (t.getValue('state') === 'done') done++;
        }
        return total === 0 ? 0 : Math.round((done / total) * 100);
    }

    function recalcFromChildren(goalSysId) {
        var sum = 0, n = 0;
        var c = new GlideRecord(T + 'goal');
        c.addQuery('parent_goal', goalSysId);
        c.addQuery('deleted', false);
        c.query();
        while (c.next()) {
            sum += parseInt(c.getValue('progress'), 10) || 0;
            n++;
        }
        return n === 0 ? null : Math.round(sum / n);
    }

    function setProgress(goalSysId, value) {
        var g = new GlideRecord(T + 'goal');
        if (!g.get(goalSysId)) return null;
        g.setValue('progress', value);
        if (value >= 100) g.setValue('status', 'completed');
        else if (value > 0 && g.getValue('status') === 'not_started') g.setValue('status', 'in_progress');
        g.setWorkflow(false); // don't re-trigger rules on the goal table
        g.update();
        return g.getValue('parent_goal');
    }

    var goalId = current.getValue('goal');
    // If the task was re-linked, the old goal needs recalculating too.
    var goalIds = [goalId];
    if (previous && previous.getValue('goal') && previous.getValue('goal') !== goalId) {
        goalIds.push(previous.getValue('goal'));
    }

    for (var i = 0; i < goalIds.length; i++) {
        var id = goalIds[i];
        if (!id) continue;
        var parent = setProgress(id, recalcFromTasks(id));
        var depth = 0;
        while (parent && depth < 10) {
            var avg = recalcFromChildren(parent);
            if (avg === null) break;
            parent = setProgress(parent, avg);
            depth++;
        }
    }
})(current, previous);

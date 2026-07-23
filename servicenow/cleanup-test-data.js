// ============================================================
// One-time cleanup of automated-test junk in the Planner app.
// Run in: ServiceNow → System Definition → Scripts - Background
//         (set the scope selector to the Planner app / x_887486_persona_0)
//
// SAFE BY DEFAULT: DRY_RUN = true only PRINTS what it would delete.
// Review the log, then set DRY_RUN = false and run again to delete.
//
// What it removes:
//  - throwaway test accounts (board_e2e_*, order_e2e_*, deepui_*, dre_*)
//    and ALL their data + sessions
//  - the data (tasks/projects/goals/habits/logs/reviews) in the shared
//    `planner_e2e` account — but keeps the account itself (smoke-test.sh
//    re-uses it). Nothing touches YOUR real account.
// ============================================================
(function () {
  var DRY_RUN = true; // <-- set to false to actually delete

  var SCOPE = 'x_887486_persona_0';
  var T = SCOPE + '_x_pps_';
  var DATA = ['task', 'project', 'goal', 'habit', 'habit_log', 'review'];

  function purge(gr, label) {
    var n = gr.getRowCount();
    if (n > 0 && !DRY_RUN) gr.deleteMultiple();
    gs.info((DRY_RUN ? '[dry-run] would delete ' : 'deleted ') + n + '  (' + label + ')');
    return n;
  }

  // throwaway test accounts by username prefix
  var throwaway = [];
  var up = new GlideRecord(SCOPE + '_user_profile');
  up.addEncodedQuery('user_nameSTARTSWITHboard_e2e_^ORuser_nameSTARTSWITHorder_e2e_^ORuser_nameSTARTSWITHdeepui_^ORuser_nameSTARTSWITHdre_');
  up.query();
  while (up.next()) throwaway.push(up.getUniqueValue());
  gs.info('throwaway test accounts found: ' + throwaway.length);

  // planner_e2e (keep the account, clear its data)
  var pe = new GlideRecord(SCOPE + '_user_profile');
  var peId = pe.get('user_name', 'planner_e2e') ? pe.getUniqueValue() : null;

  var clearData = throwaway.slice();
  if (peId) clearData.push(peId);

  var total = 0;
  if (clearData.length) {
    DATA.forEach(function (tbl) {
      var gr = new GlideRecord(T + tbl);
      gr.addQuery('user_profile', 'IN', clearData.join(','));
      gr.query();
      total += purge(gr, T + tbl);
    });
  }

  // throwaway accounts: sessions + the accounts themselves
  if (throwaway.length) {
    var sess = new GlideRecord(SCOPE + '_session');
    sess.addQuery('user_profile', 'IN', throwaway.join(','));
    sess.query();
    purge(sess, SCOPE + '_session');

    var acct = new GlideRecord(SCOPE + '_user_profile');
    acct.addQuery('sys_id', 'IN', throwaway.join(','));
    acct.query();
    purge(acct, SCOPE + '_user_profile (test accounts)');
  }

  gs.info('----');
  gs.info((DRY_RUN ? '[DRY RUN] would remove ' : 'removed ') + total + ' junk data rows + ' + throwaway.length + ' test accounts.');
  gs.info(DRY_RUN ? '>> Looks right? Set DRY_RUN = false at the top and run again.' : '>> Cleanup complete.');
})();

// ============================================================
// Planner Scripted REST API — /auth/{action}
// Location : ServiceNow → Studio (inside the Planner app)
// API Name : Planner API   (API ID: planner)
// Resource : /auth/{action}    Method: POST
// Actions  : login · register · logout
// Full URL : https://<instance>.service-now.com/api/<scope>/planner/auth/{action}
//
// NOTE: Set "Requires authentication" = false on this resource
//       so users can log in without SN credentials.
// ============================================================
(function process(request, response) {
    var helper = new PlannerAuthHelper();
    var SCOPE = helper.SCOPE;
    var action = request.pathParams.action; // login | register | logout
    var body = request.body ? request.body.data : {};

    // ── CORS (needed for GitHub Pages → SN calls) ────────────
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Planner-Token, X-HTTP-Method');
    if (request.getHeader('X-HTTP-Method') === 'OPTIONS') { response.setStatus(200); return; }

    // ── /auth/login ──────────────────────────────────────────
    if (action === 'login') {
        var username = (body.username || '').trim().toLowerCase();
        var password = body.password || '';
        if (!username || !password) { helper.errorResponse(response, 400, 'username and password are required'); return; }

        var gr = new GlideRecord(SCOPE + '_user_profile');
        gr.addQuery('username', username);
        gr.setLimit(1);
        gr.query();
        if (!gr.next() || gr.getValue('password_hash') !== helper.hashPassword(password)) {
            helper.errorResponse(response, 401, 'Wrong username or password.');
            return;
        }

        response.setStatus(200);
        response.setBody({
            token: helper.createSession(gr.getUniqueValue(), body.device_hint),
            username: gr.getValue('username'),
            display_name: gr.getValue('display_name')
        });
        return;
    }

    // ── /auth/register ───────────────────────────────────────
    if (action === 'register') {
        var regUser = (body.username || '').trim().toLowerCase();
        var regPassword = body.password || '';
        if (!regUser || regUser.length < 3) { helper.errorResponse(response, 400, 'Username must be at least 3 characters.'); return; }
        if (regPassword.length < 8) { helper.errorResponse(response, 400, 'Password must be at least 8 characters.'); return; }

        var dupe = new GlideRecord(SCOPE + '_user_profile');
        dupe.addQuery('username', regUser);
        dupe.setLimit(1);
        dupe.query();
        if (dupe.next()) { helper.errorResponse(response, 409, 'That username is taken.'); return; }

        var newGR = new GlideRecord(SCOPE + '_user_profile');
        newGR.initialize();
        newGR.setValue('username', regUser);
        newGR.setValue('display_name', body.display_name || regUser);
        newGR.setValue('password_hash', helper.hashPassword(regPassword));
        var sysId = newGR.insert();

        response.setStatus(201);
        response.setBody({
            token: helper.createSession(String(sysId), body.device_hint),
            username: regUser,
            display_name: body.display_name || regUser
        });
        return;
    }

    // ── /auth/logout ─────────────────────────────────────────
    if (action === 'logout') {
        helper.deleteSession(request.getHeader('X-Planner-Token') || (body.token || ''));
        response.setStatus(200);
        response.setBody({ ok: true });
        return;
    }

    helper.errorResponse(response, 404, 'Unknown auth action: ' + action);
})(request, response);

// ============================================================
// Planner Script Include — PlannerAuthHelper
// Location : ServiceNow → Studio (inside the Planner app) → Script Include
// Name     : PlannerAuthHelper       Client callable: NO
//
// If your app's scope is not x_887486_planner, change SCOPE below
// (Studio shows the scope after you create the application).
// ============================================================

var PlannerAuthHelper = Class.create();
PlannerAuthHelper.prototype = {

  SCOPE: 'x_887486_planner',

  initialize: function() {},

  // ── Validate token from request header X-Planner-Token ───
  // Returns user_profile sys_id string, or null if invalid/expired
  validateToken: function(token) {
    if (!token) return null;

    var gr = new GlideRecord(this.SCOPE + '_session');
    gr.addQuery('token', token);
    gr.addQuery('expires_at', '>', new GlideDateTime());
    gr.setLimit(1);
    gr.query();

    if (!gr.next()) return null;

    var profileSysId = gr.user_profile.toString();
    var profileGR = new GlideRecord(this.SCOPE + '_user_profile');
    if (profileGR.get(profileSysId)) {
      profileGR.last_login = new GlideDateTime();
      profileGR.update();
    }

    return profileSysId;
  },

  // ── Hash a plaintext password with SHA-256 ───────────────
  hashPassword: function(plaintext) {
    var digest = new GlideDigest();
    return digest.getSHA256Hex(plaintext);
  },

  // ── Generate a random 32-char hex session token ──────────
  generateToken: function() {
    return gs.generateGUID().replace(/-/g, '');
  },

  // ── Create a session record (7-day expiry) ───────────────
  createSession: function(userProfileSysId, deviceHint) {
    var token = this.generateToken();
    var expires = new GlideDateTime();
    expires.addDaysUTC(7);

    var gr = new GlideRecord(this.SCOPE + '_session');
    gr.initialize();
    gr.user_profile = userProfileSysId;
    gr.token = token;
    gr.expires_at = expires;
    gr.device_hint = deviceHint || '';
    gr.insert();

    return token;
  },

  // ── Invalidate a session by token (logout) ───────────────
  deleteSession: function(token) {
    var gr = new GlideRecord(this.SCOPE + '_session');
    gr.addQuery('token', token);
    gr.query();
    if (gr.next()) {
      gr.setValue('expires_at', new GlideDateTime());
      gr.update();
    }
  },

  // ── Build a standardised error response ──────────────────
  errorResponse: function(response, status, message) {
    response.setStatus(status);
    response.setBody({ error: message });
  },

  type: 'PlannerAuthHelper'
};

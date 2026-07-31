# Planner AI proxy (Google Gemini, free tier)

The Planner is a static site, so a Google Gemini API key can't live in the app
(anyone could read it). This tiny Cloudflare Worker holds the key and forwards
prompts. Both the Gemini free tier and the Cloudflare Worker free tier are
plenty for personal use.

The app calls it as: `POST { prompt, system } → { text }`.

## One-time setup (~15 min)

### 1. Get a free Gemini API key
1. Go to **https://aistudio.google.com/app/apikey** (sign in with Google).
2. **Create API key** → copy it. No credit card, free tier.

### 2. Create the Cloudflare Worker
1. Sign up free at **https://dash.cloudflare.com** → **Workers & Pages** → **Create** → **Create Worker**.
2. Give it a name (e.g. `planner-ai`), Deploy the starter, then **Edit code**.
3. Replace all the code with the contents of [`worker.js`](worker.js), and **Deploy**.

### 3. Add your key + allowed origin (Worker → Settings → Variables)
- **Secret** `GEMINI_KEY` = the key from step 1 (use "Encrypt").
- **Variable** `ALLOW_ORIGIN` = `https://yapseng98.github.io`
  (your app's origin; use `*` while testing if you like).
- **Deploy** again after adding them.

### 4. Connect the app
1. Copy your Worker URL (e.g. `https://planner-ai.<you>.workers.dev`).
2. In the Planner → **Settings → AI assistant**, paste the URL and hit **Test**.
3. When the test says connected, the AI briefing and review drafts turn on.

## Notes
- **Cost:** free within the tiers (~500 Gemini requests/day, 100k Worker
  requests/day). A personal user makes a handful a day.
- **Privacy:** the relevant task/goal/review text is sent to Gemini to answer.
  Nothing is stored by the model. The app only calls the AI when you open Today
  (once/day, cached) or press "Draft with AI" on a review.
- **Model:** `gemini-2.0-flash`. Change `MODEL` at the top of `worker.js` if you
  want a different one.
- If AI is not configured, the app works exactly as before (rule-based briefing,
  manual reviews) — the AI bits just stay hidden.

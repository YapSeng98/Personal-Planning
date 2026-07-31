# Planner AI proxy (Google Gemini, free tier)

The Planner is a static site, so a Gemini API key can't live in the app — anyone
could read it. This small Cloudflare Worker holds the key and forwards prompts.
Gemini's free tier and Cloudflare's Worker free tier are both far beyond what a
personal planner uses.

The app calls it as: `POST { prompt, system } → { text }`.

> **Never put the key in this repo or in the app.** It belongs only in the
> Cloudflare Worker's encrypted secret. If a key is ever pasted somewhere
> public, delete it in AI Studio and create a new one.

## One-time setup (~15 min)

### Step 1 — Get a free Gemini API key
1. Go to **https://aistudio.google.com/app/api-keys** and sign in with Google.
2. Click **Create API key** (pick/creates a project). Free, no credit card.
3. **Copy** the key. New keys look like `AQ.Ab8...` (Google's current "auth key"
   format — older `AIza...` keys are being retired).
4. Keep the tab open; you'll paste this into Cloudflare, nowhere else.

### Step 2 — Create the Cloudflare Worker
1. Sign up free at **https://dash.cloudflare.com**.
2. Left sidebar → **Workers & Pages** → **Create** → **Create Worker**.
3. Name it (e.g. `planner-ai`) → **Deploy** (deploys the placeholder).
4. Click **Edit code** (or **</> Edit code**).
5. Select all the placeholder code, delete it, and paste the entire contents of
   [`worker.js`](worker.js) from this repo.
6. **Deploy** (top right).

### Step 3 — Add your key + allowed origin
Still in the Worker → **Settings** → **Variables and Secrets** → **Add**:

| Type         | Name           | Value                                       |
|--------------|----------------|---------------------------------------------|
| **Secret**   | `GEMINI_KEY`   | the key from Step 1                          |
| **Text**     | `ALLOW_ORIGIN` | `https://yapseng98.github.io`                |
| **Text**     | `MODEL`        | *(optional)* e.g. `gemini-3.6-flash`         |

- `GEMINI_KEY` **must be type Secret** (encrypted, hidden afterwards).
- `ALLOW_ORIGIN` restricts who may call your Worker. Use your app's origin —
  **no trailing slash, no path**. (`*` allows anyone; fine only for testing.)
- Click **Deploy** again so the variables take effect.

### Step 4 — Connect the app
1. Copy the Worker URL — `https://planner-ai.<your-subdomain>.workers.dev`
   (shown on the Worker's page; it's public, safe to share).
2. Open the Planner → **Settings** → **AI assistant**.
3. Paste the URL → press **Test**.
4. Green "Connected" → the AI briefing and review drafts are on.

## Troubleshooting (what the Test button tells you)

| Message | Meaning / fix |
|---|---|
| `GEMINI_KEY not set on the Worker` | Step 3 missing or you didn't redeploy after adding it. |
| `API key not valid` | Wrong/revoked key. Create a new one in AI Studio and update the secret. |
| `... is not found` / `model` in the error | That model isn't available to you — set the `MODEL` variable to another current one (`gemini-3.6-flash`, `gemini-3.5-flash`, `gemini-3.5-flash-lite`). |
| `Failed to fetch` / CORS error | `ALLOW_ORIGIN` doesn't exactly match your app's origin, or you didn't redeploy. |
| `quota` / `429` | Free-tier daily limit hit; it resets. |

Every error also names the model in use, so it's clear what was attempted.

## Notes
- **Model:** defaults to `gemini-3.5-flash-lite` (fast + free-tier friendly).
  Change it any time with the `MODEL` variable — no code edit.
  Don't use `gemini-2.0-flash` or older; they're shut down.
- **Auth:** the key is sent as an `x-goog-api-key` header (never in the URL, so
  it can't leak through logs), which works for both `AQ.*` and legacy `AIza*` keys.
- **Cost:** $0 within the free tiers. The app calls AI only when you open Today
  (once per day, cached) or press "Draft with AI".
- **Privacy:** the relevant task/goal/review text is sent to Gemini to answer.
- **If AI is not configured**, the app behaves exactly as before — the rule-based
  briefing stays and the AI buttons stay hidden.

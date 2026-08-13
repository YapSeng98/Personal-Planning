# Planner AI proxy (Groq, free tier)

The Planner is a static site, so a Groq API key can't live in the app — anyone
could read it. This small Cloudflare Worker holds the key and forwards prompts.
Groq's free tier and Cloudflare's Worker free tier are both far beyond what a
personal planner uses.

The app calls it as: `POST { prompt, system } → { text }`.

> **Never put the key in this repo or in the app.** It belongs only in the
> Cloudflare Worker's encrypted secret. If a key is ever pasted somewhere
> public (chat, a screenshot, a commit), delete it in the Groq console and
> create a new one — treat it as already compromised.

## One-time setup (~15 min)

### Step 1 — Get a free Groq API key
1. Go to **https://console.groq.com/keys** and sign in.
2. Click **Create API key**. Free, no credit card.
3. **Copy** the key — it looks like `gsk_...`.
4. Keep the tab open; you'll paste this into Cloudflare, nowhere else — **not**
   into the Planner app itself (the app only ever takes a Worker URL).

### Step 2 — Create the Cloudflare Worker
1. Sign up free at **https://dash.cloudflare.com**.
2. Sidebar → under **Build** click **Compute** → **Workers & Pages**.
   (Cloudflare moved this — it used to be a top-level item. Direct link:
   `https://dash.cloudflare.com/?to=/:account/workers-and-pages`)
   Then **Create** → **Create Worker**.
3. Name it (e.g. `planner-ai`) → **Deploy** (deploys the placeholder).
4. Click **Edit code** (or **</> Edit code**).
5. Select all the placeholder code, delete it, and paste the entire contents of
   [`worker.js`](worker.js) from this repo.
6. **Deploy** (top right).

### Step 3 — Add your key + allowed origin
Still in the Worker → **Settings** → **Variables and Secrets** → **Add**:

| Type         | Name           | Value                                       |
|--------------|----------------|---------------------------------------------|
| **Secret**   | `GROQ_KEY`     | the key from Step 1 (`gsk_...`)              |
| **Text**     | `ALLOW_ORIGIN` | `https://yapseng98.github.io`                |
| **Text**     | `MODEL`        | *(optional)* e.g. `llama-3.1-8b-instant`     |

- `GROQ_KEY` **must be type Secret** (encrypted, hidden afterwards).
- `ALLOW_ORIGIN` restricts who may call your Worker. Use your app's origin —
  **no trailing slash, no path**. (`*` allows anyone; fine only for testing.)
- Click **Deploy** again so the variables take effect.

### Step 4 — Connect the app
1. Copy the Worker URL — `https://planner-ai.<your-subdomain>.workers.dev`
   (shown on the Worker's page; it's public, safe to share — it doesn't
   contain your key).
2. Open the Planner → **Settings** → **AI assistant**.
3. Paste **that URL** (not the `gsk_...` key) → press **Test**.
4. Green "Connected" → the AI briefing, review drafts, and habit insights are on.

## Troubleshooting (what the Test button tells you)

| Message | Meaning / fix |
|---|---|
| `AI request failed (405)` right after pasting a `gsk_...` string | You pasted the raw Groq key into the URL field. The app POSTs it as a relative path to its own site, which doesn't accept POST requests. Complete Steps 2–4 above and paste the **Worker URL** instead. |
| `GROQ_KEY not set on the Worker` | Step 3 missing or you didn't redeploy after adding it. |
| `Invalid API Key` | Wrong/revoked key. Create a new one in the Groq console and update the secret. |
| `model` mentioned in the error / `decommissioned` | That model isn't available — set the `MODEL` variable to another current one (`llama-3.3-70b-versatile`, `llama-3.1-8b-instant`, `openai/gpt-oss-120b`). |
| `Failed to fetch` / CORS error | `ALLOW_ORIGIN` doesn't exactly match your app's origin, or you didn't redeploy. |
| `rate_limit_exceeded` / `429` | Free-tier limit hit; it resets on a rolling window. |

Every error also names the model in use, so it's clear what was attempted.

## Notes
- **Model:** defaults to `llama-3.3-70b-versatile` (strong quality, 131K context,
  free tier). Change it any time with the `MODEL` variable — no code edit.
- **Auth:** the key is sent as an `Authorization: Bearer` header, the standard
  OpenAI-compatible scheme Groq uses.
- **Cost:** $0 within the free tier. The app calls AI only when you open Today
  (once per day, cached), press "Draft with AI", or open a habit's detail page.
- **Privacy:** the relevant task/goal/review/habit text is sent to Groq to answer.
- **If AI is not configured**, the app behaves exactly as before — the rule-based
  briefing stays and the AI buttons stay hidden.

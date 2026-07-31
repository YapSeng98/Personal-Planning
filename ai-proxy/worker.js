// ============================================================
// Planner AI proxy — a Cloudflare Worker that holds your Google Gemini
// API key and forwards prompts from the Planner app. The key never
// reaches the browser.
//
// The app POSTs { prompt, system } and gets back { text }.
//
// Deploy: see ai-proxy/README.md. You set:
//   - GEMINI_KEY   (secret)   = your Google AI Studio key  (required)
//   - ALLOW_ORIGIN (variable) = https://yapseng98.github.io (your app origin)
//   - MODEL        (variable) = optional; overrides DEFAULT_MODEL below
// ============================================================

// Current stable Gemini model. Override without editing code by setting a
// plain-text Worker variable named MODEL (e.g. gemini-3.5-flash-lite).
// NOTE: gemini-2.0-flash and older are shut down — don't use them.
const DEFAULT_MODEL = 'gemini-3.5-flash-lite'

export default {
  async fetch(request, env) {
    const origin = env.ALLOW_ORIGIN || '*'
    const cors = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors })
    if (request.method !== 'POST') return json({ error: 'POST only' }, 405, cors)
    if (!env.GEMINI_KEY) return json({ error: 'GEMINI_KEY not set on the Worker' }, 500, cors)

    let body
    try { body = await request.json() } catch { return json({ error: 'bad json' }, 400, cors) }
    const prompt = String(body.prompt || '').slice(0, 8000)
    const system = body.system ? String(body.system).slice(0, 2000) : undefined
    if (!prompt) return json({ error: 'no prompt' }, 400, cors)

    const model = env.MODEL || DEFAULT_MODEL
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
    let g
    try {
      g = await fetch(url, {
        method: 'POST',
        // Key goes in the header (works for both the new AQ.* auth keys and
        // legacy AIza* keys); never in the URL, so it can't leak via logs.
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_KEY },
        body: JSON.stringify({
          ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 600 },
        }),
      })
    } catch (e) {
      return json({ error: 'upstream fetch failed: ' + e }, 502, cors)
    }
    const data = await g.json().catch(() => ({}))
    if (!g.ok) {
      // Surface Google's own message so the app's Test button is actionable
      // (bad key, model not found, quota exceeded…).
      const msg = data?.error?.message || `gemini ${g.status}`
      return json({ error: `${msg} (model: ${model})` }, g.status, cors)
    }
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || ''
    if (!text) {
      const why = data?.promptFeedback?.blockReason || data?.candidates?.[0]?.finishReason || 'no content returned'
      return json({ error: `Empty response from ${model} (${why})` }, 502, cors)
    }
    return json({ text: text.trim() }, 200, cors)
  },
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

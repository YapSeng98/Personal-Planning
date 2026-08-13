// ============================================================
// Planner AI proxy — a Cloudflare Worker that holds your Groq API key
// and forwards prompts from the Planner app. The key never reaches
// the browser.
//
// The app POSTs { prompt, system } and gets back { text }.
//
// Deploy: see ai-proxy/README.md. You set:
//   - GROQ_KEY     (secret)   = your Groq API key  (required)
//   - ALLOW_ORIGIN (variable) = https://yapseng98.github.io (your app origin)
//   - MODEL        (variable) = optional; overrides DEFAULT_MODEL below
// ============================================================

// Current recommended Groq model (131K context, fast, generous free tier).
// Override without editing code by setting a plain-text Worker variable
// named MODEL (e.g. llama-3.1-8b-instant for even faster/cheaper).
const DEFAULT_MODEL = 'llama-3.3-70b-versatile'

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
    if (!env.GROQ_KEY) return json({ error: 'GROQ_KEY not set on the Worker' }, 500, cors)

    let body
    try { body = await request.json() } catch { return json({ error: 'bad json' }, 400, cors) }
    const prompt = String(body.prompt || '').slice(0, 8000)
    const system = body.system ? String(body.system).slice(0, 2000) : undefined
    if (!prompt) return json({ error: 'no prompt' }, 400, cors)

    const model = env.MODEL || DEFAULT_MODEL
    const url = 'https://api.groq.com/openai/v1/chat/completions'
    let g
    try {
      g = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.GROQ_KEY}` },
        body: JSON.stringify({
          model,
          messages: [
            ...(system ? [{ role: 'system', content: system }] : []),
            { role: 'user', content: prompt },
          ],
          temperature: 0.7,
          max_tokens: 600,
        }),
      })
    } catch (e) {
      return json({ error: 'upstream fetch failed: ' + e }, 502, cors)
    }
    const data = await g.json().catch(() => ({}))
    if (!g.ok) {
      // Surface Groq's own message so the app's Test button is actionable
      // (bad key, model decommissioned, rate limit…).
      const msg = data?.error?.message || `groq ${g.status}`
      return json({ error: `${msg} (model: ${model})` }, g.status, cors)
    }
    const text = data?.choices?.[0]?.message?.content || ''
    if (!text) {
      const why = data?.choices?.[0]?.finish_reason || 'no content returned'
      return json({ error: `Empty response from ${model} (${why})` }, 502, cors)
    }
    return json({ text: text.trim() }, 200, cors)
  },
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

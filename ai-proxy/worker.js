// ============================================================
// Planner AI proxy — a Cloudflare Worker that holds your Google Gemini
// API key and forwards prompts from the Planner app. The key never
// reaches the browser.
//
// The app POSTs { prompt, system } and gets back { text }.
//
// Deploy: see ai-proxy/README.md. You set two things:
//   - GEMINI_KEY   (secret)  = your Google AI Studio key
//   - ALLOW_ORIGIN (var)     = https://yapseng98.github.io   (your app origin)
// ============================================================

const MODEL = 'gemini-2.0-flash' // free tier; swap to gemini-1.5-flash if needed

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

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${env.GEMINI_KEY}`
    let g
    try {
      g = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
    if (!g.ok) return json({ error: data?.error?.message || ('gemini ' + g.status) }, g.status, cors)
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || ''
    return json({ text: text.trim() }, 200, cors)
  },
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

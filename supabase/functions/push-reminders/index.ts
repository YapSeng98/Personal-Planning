// push-reminders — sends the app's reminder notifications (Web Push).
//
// Called once a minute by the database (schema.sql → send_due_reminders,
// scheduled by push_setup.sql) with the reminders that are due:
//   POST { vapid: <private key, JWK>, messages: [{ endpoint, p256dh, auth, payload }] }
// It encrypts each payload for its device (RFC 8291, aes128gcm) and posts it
// to the device's push service, signed with the VAPID key (RFC 8292).
// Answers { planner: 1, sent, gone: [endpoints the push service says no
// longer exist], failed }; the database drops the gone ones.
//
// No secrets here and no database access: the key comes with the request,
// and only the app's own key is accepted (it must match VAPID_PUBLIC_KEY,
// the one the app's devices subscribed with). GET answers { planner: 1 } —
// how Settings checks that the function is deployed.
//
// Deploy: Supabase → Edge Functions → Deploy a new function → Via editor,
// name "push-reminders", paste this file, Deploy; then in its settings turn
// OFF "Enforce JWT verification" (the database's timer has no sign-in).

/** Same as VAPID_PUBLIC_KEY in frontend/src/lib/reminders.ts. */
export const VAPID_PUBLIC_KEY = 'BC6fnTha5LG_C6l5AHclqDHqZfFb-XG50a9JaxTFh2drfxi8fKybnJi5o5Ue6OVIVvhuTJm08Kb-Zy_u_3zRwR0'
const SUBJECT = 'mailto:planner-reminders@users.noreply.github.com'
/** A reminder that can't be delivered within 10 minutes is no use. */
const TTL = 600
/** Only real push services (no requests to arbitrary addresses). */
const PUSH_HOSTS = /(^|\.)(fcm\.googleapis\.com|googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)$/

const enc = new TextEncoder()

export function b64u(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function unb64u(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4))
  const out = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(parts.reduce((n, p) => n + p.length, 0)))
  let i = 0
  for (const p of parts) { out.set(p, i); i += p.length }
  return out
}

async function hkdf(salt: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, bytes: number): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8))
}

/** RFC 8291: the payload encrypted for one subscription (aes128gcm body). */
export async function encryptPayload(plaintext: Uint8Array, p256dh: string, authSecret: string): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublic = unb64u(p256dh)
  const auth = unb64u(authSecret)
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey))
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256))
  const ikm = await hkdf(auth, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32)
  const salt = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(16)))
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12)
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  // one record: the payload, then the 0x02 "last record" delimiter
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(plaintext, new Uint8Array([2]))))
  const rs = new Uint8Array(4)
  new DataView(rs.buffer).setUint32(0, 4096)
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, sealed)
}

/** The VAPID key from the request — accepted only if it's the app's own. */
export async function loadVapid(jwk: JsonWebKey): Promise<CryptoKey> {
  const pub = unb64u(VAPID_PUBLIC_KEY)
  const priv = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), d: jwk.d, ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  // prove it: a signature made with it must check out against the public key
  const verifier = await crypto.subtle.importKey('raw', pub, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
  const probe = enc.encode('planner-vapid-check')
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, priv, probe)
  if (!(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, verifier, sig, probe))) throw new Error('not the app’s key')
  return priv
}

/** RFC 8292: the Authorization header for one push service. */
export async function vapidHeader(key: CryptoKey, audience: string, now = Date.now()): Promise<string> {
  const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const body = b64u(enc.encode(JSON.stringify({ aud: audience, exp: Math.floor(now / 1000) + 12 * 3600, sub: SUBJECT })))
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${head}.${body}`)))
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${VAPID_PUBLIC_KEY}`
}

export interface Message {
  endpoint: string
  p256dh: string
  auth: string
  payload: unknown
}

/** Send one push; the push service's HTTP status (0 = couldn't reach it). */
export async function sendPush(key: CryptoKey, m: Message, fetcher: typeof fetch = fetch): Promise<number> {
  const url = new URL(m.endpoint)
  if (url.protocol !== 'https:' || !PUSH_HOSTS.test(url.hostname)) return 400
  const body = await encryptPayload(enc.encode(JSON.stringify(m.payload)), m.p256dh, m.auth)
  try {
    const r = await fetcher(m.endpoint, {
      method: 'POST',
      headers: {
        Authorization: await vapidHeader(key, url.origin),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(TTL),
        Urgency: 'high',
      },
      body,
    })
    return r.status
  } catch {
    return 0
  }
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
})

export async function handle(req: Request, fetcher: typeof fetch = fetch): Promise<Response> {
  if (req.method === 'GET' || req.method === 'OPTIONS') return json({ planner: 1, ok: true })
  if (req.method !== 'POST') return json({ planner: 1, error: 'method' }, 405)
  let input: { vapid?: JsonWebKey; messages?: Message[] }
  try {
    input = await req.json()
  } catch {
    return json({ planner: 1, error: 'not JSON' }, 400)
  }
  let key: CryptoKey
  try {
    key = await loadVapid(input.vapid ?? {})
  } catch {
    return json({ planner: 1, error: 'key' }, 403)
  }
  const messages = (input.messages ?? []).slice(0, 500)
  const statuses = await Promise.all(messages.map((m) => sendPush(key, m, fetcher).catch(() => 0)))
  const gone = messages.filter((_, i) => statuses[i] === 404 || statuses[i] === 410).map((m) => m.endpoint)
  const failed = messages.map((m, i) => ({ endpoint: m.endpoint, status: statuses[i] }))
    .filter((x) => x.status !== 201 && x.status !== 200 && x.status !== 202 && x.status !== 404 && x.status !== 410)
  return json({ planner: 1, sent: statuses.filter((s) => s >= 200 && s < 300).length, gone, failed })
}

// Supabase Edge Functions (Deno) run this; tests import it under Node.
const deno = (globalThis as { Deno?: { serve: (h: (r: Request) => Promise<Response>) => void } }).Deno
if (deno) deno.serve((req) => handle(req))

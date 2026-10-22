// The push-reminders Edge Function (supabase/functions/push-reminders),
// checked under Node: what it sends must decrypt the way a browser decrypts
// it (RFC 8291 — done here independently with node:crypto, not WebCrypto),
// its VAPID header must verify (RFC 8292), and it must refuse any key but
// the app's own.
import crypto from 'node:crypto'
import fs from 'node:fs'

const fn = await import('../../supabase/functions/push-reminders/index.ts')
const results = []
const check = (name, ok, extra = '') => { results.push(!!ok); console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`) }
const b64u = (b) => Buffer.from(b).toString('base64url')

// the private key, if this machine has it (frontend/.env.local)
const env = fs.existsSync(new URL('../.env.local', import.meta.url)) ? fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8') : ''
const jwk = JSON.parse(env.match(/^VAPID_PRIVATE_JWK=(.*)$/m)?.[1] ?? 'null')
const app = fs.readFileSync(new URL('../src/lib/reminders.ts', import.meta.url), 'utf8')
check('the app and the function use the same public key', app.includes(`'${fn.VAPID_PUBLIC_KEY}'`))
if (jwk) check('…and it is the public half of the private key in .env.local', b64u(Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')])) === fn.VAPID_PUBLIC_KEY)

// a browser's subscription: its own key pair + auth secret
const ua = crypto.createECDH('prime256v1'); ua.generateKeys()
const auth = crypto.randomBytes(16)
const sub = { p256dh: b64u(ua.getPublicKey()), auth: b64u(auth) }

/** What a browser does with the body (RFC 8291 / RFC 8188), in node:crypto. */
function decrypt(body) {
  const salt = body.subarray(0, 16), rs = body.readUInt32BE(16), idlen = body[20]
  const asPublic = body.subarray(21, 21 + idlen), sealed = body.subarray(21 + idlen)
  const shared = ua.computeSecret(asPublic)
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, auth, Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPublic]), 32))
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16))
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12))
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce)
  d.setAuthTag(sealed.subarray(sealed.length - 16))
  const plain = Buffer.concat([d.update(sealed.subarray(0, sealed.length - 16)), d.final()])
  let end = plain.length - 1
  while (end >= 0 && plain[end] === 0) end--
  return { rs, delim: plain[end], text: plain.subarray(0, end).toString() }
}

console.log('\n— encryption')
const msg = { title: 'Prepare slides — 准备幻灯片', body: '09:00–10:00 · Starts now', tag: 'block:x:2026-10-22T09:00' }
const body = Buffer.from(await fn.encryptPayload(new TextEncoder().encode(JSON.stringify(msg)), sub.p256dh, sub.auth))
const out = decrypt(body)
check('a browser decrypts the reminder exactly (Chinese text too)', out.text === JSON.stringify(msg) && out.delim === 2 && out.rs === 4096, out.text.slice(0, 60))
const again = Buffer.from(await fn.encryptPayload(new TextEncoder().encode('x'), sub.p256dh, sub.auth))
check('every message gets its own salt and key', !again.subarray(0, 16).equals(body.subarray(0, 16)))
const other = crypto.createECDH('prime256v1'); other.generateKeys()
const forOther = Buffer.from(await fn.encryptPayload(new TextEncoder().encode('secret'), b64u(other.getPublicKey()), b64u(auth)))
let leaked = true
try { decrypt(forOther) } catch { leaked = false }
check("a message for another device can't be read with this device's key", !leaked)

console.log('\n— the push key')
if (!jwk) console.log('  (no VAPID_PRIVATE_JWK in .env.local — key checks use a stand-in and are skipped where they need the real one)')
const strangerKey = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign'])
const stranger = await crypto.subtle.exportKey('jwk', strangerKey.privateKey)
let refused = false
try { await fn.loadVapid(stranger) } catch { refused = true }
check("another key is refused (the function can't be used to send for anyone else)", refused)
const strangerRes = await fn.handle(new Request('https://x/push-reminders', { method: 'POST', body: JSON.stringify({ vapid: stranger, messages: [] }) }))
check('…by the endpoint too (403)', strangerRes.status === 403)
const ping = await fn.handle(new Request('https://x/push-reminders'))
check('GET answers { planner: 1 } (how Settings sees it is deployed)', ping.status === 200 && (await ping.json()).planner === 1 && ping.headers.get('access-control-allow-origin') === '*')

if (jwk) {
  const key = await fn.loadVapid(jwk)
  const header = await fn.vapidHeader(key, 'https://fcm.googleapis.com')
  const [, t, k] = header.match(/^vapid t=([^,]+), k=(.+)$/) ?? []
  const [h, p, s] = t.split('.')
  const claims = JSON.parse(Buffer.from(p, 'base64url'))
  const pub = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y }, format: 'jwk' })
  const valid = crypto.verify('sha256', Buffer.from(`${h}.${p}`), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'))
  check('the VAPID header verifies with the public key (ES256)', valid && k === fn.VAPID_PUBLIC_KEY && JSON.parse(Buffer.from(h, 'base64url')).alg === 'ES256')
  check('…for the push service it goes to, for at most 24 h, with a contact', claims.aud === 'https://fcm.googleapis.com' && claims.exp - Date.now() / 1000 <= 86400 && claims.exp > Date.now() / 1000 && /^mailto:/.test(claims.sub))

  console.log('\n— sending')
  const seen = []
  const fake = async (url, init) => {
    seen.push({ url, init })
    return new Response('', { status: url.includes('/gone') ? 410 : url.includes('/down') ? 500 : 201 })
  }
  const messages = [
    { endpoint: 'https://fcm.googleapis.com/fcm/send/ok1', ...sub, payload: msg },
    { endpoint: 'https://web.push.apple.com/gone', ...sub, payload: msg },
    { endpoint: 'https://updates.push.services.mozilla.com/down', ...sub, payload: msg },
    { endpoint: 'https://evil.example.com/steal', ...sub, payload: msg },
  ]
  const res = await fn.handle(new Request('https://x/push-reminders', { method: 'POST', body: JSON.stringify({ vapid: jwk, messages }) }), fake)
  const r = await res.json()
  check('sends each reminder, reports devices that are gone and pushes that failed', r.planner === 1 && r.sent === 1 && JSON.stringify(r.gone) === JSON.stringify(['https://web.push.apple.com/gone']) && r.failed.length === 2, JSON.stringify(r))
  check('never contacts an address that isn\'t a push service', !seen.some((x) => x.url.includes('evil.example.com')) && seen.length === 3)
  const first = seen.find((x) => x.url.endsWith('ok1'))
  check('with the headers push services require (aes128gcm, TTL, VAPID)', first.init.headers['Content-Encoding'] === 'aes128gcm' && first.init.headers.TTL === '600' && /^vapid t=/.test(first.init.headers.Authorization))
  check('…and a body the device can decrypt', decrypt(Buffer.from(first.init.body)).text === JSON.stringify(msg))
}

console.log(`\n${results.filter(Boolean).length}/${results.length} push checks passed`)
if (results.some((ok) => !ok)) process.exitCode = 1

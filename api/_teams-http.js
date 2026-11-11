import { isIP } from 'node:net'

// Plumbing shared by the Teams endpoints: errors a caller can act on, CORS for
// the Teams web app, and reading the request.

// A refusal the caller can act on. Its message is written for the person
// using the app, and is shown to them as-is.
export class TeamsError extends Error {
  constructor(status, reason, message, problems = null) {
    super(message)
    this.status = status
    this.reason = reason
    // Each reason a request was refused, when there is more than one to show.
    this.problems = problems
  }
}

export const notFound = (message) => new TeamsError(404, 'not_found', message)
export const forbidden = (message) => new TeamsError(403, 'forbidden', message)
export const conflict = (reason, message) => new TeamsError(409, reason, message)
export const invalid = (message) => new TeamsError(400, 'invalid', message)
export const ineligible = (problems) =>
  new TeamsError(422, 'ineligible', problems.map(p => p.message).join(' '), problems)

// The Teams web app is served from its own origin. Native apps send no Origin
// header and are unaffected. Anything not on the list gets no CORS headers,
// so a browser refuses to hand it the response.
function allowedOrigins() {
  const configured = (process.env.TEAMS_ALLOWED_ORIGINS || '')
    .split(',').map(s => s.trim()).filter(Boolean)
  const local = process.env.VERCEL_ENV === 'production'
    ? []
    : ['http://localhost:8081', 'http://127.0.0.1:8081']
  return new Set([...configured, ...local])
}

// Returns true when the request was a preflight and has been answered.
export function applyCors(req, res) {
  const origin = req.headers.origin
  if (origin && allowedOrigins().has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Max-Age', '600')
  }
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return true
  }
  return false
}

export function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body
  if (typeof req.body === 'string' && req.body) {
    try {
      return JSON.parse(req.body)
    } catch {
      throw invalid('The request was not valid JSON.')
    }
  }
  return {}
}

// For limits on calls made before sign-in: who is calling, as far as we can
// tell without trusting anything the caller can write.
//
// X-Forwarded-For is client-supplied unless a proxy we trust replaces it.
// Vercel documents that it overwrites X-Forwarded-For and sets x-real-ip and
// x-vercel-forwarded-for itself; x-vercel-forwarded-for also survives another
// proxy in front of Vercel. So:
//   - on Vercel: x-vercel-forwarded-for, then x-real-ip, then the LAST
//     X-Forwarded-For entry (the one the nearest proxy appended, never one
//     the caller wrote first);
//   - anywhere else: the socket address, ignoring headers entirely, unless
//     TRUST_PROXY_HEADERS=1 says a trusted proxy sits in front.
// IPv6 addresses are cut to their /64, which one subscriber usually holds
// whole, so rotating within it does not mint new identities. An identity
// that is not an IP address at all falls into one shared 'unknown' bucket.
// Even a truthful address can be rotated across many hosts, which is why the
// signed-out actions also have a ceiling shared by every caller.
export function clientIp(req, env = process.env) {
  const trusted = env.VERCEL === '1' || env.TRUST_PROXY_HEADERS === '1'
  const header = (name) => String(req.headers?.[name] || '')
  const first = (v) => v.split(',')[0].trim()
  const last = (v) => v.split(',').map(x => x.trim()).filter(Boolean).pop() || ''
  const raw = trusted
    ? first(header('x-vercel-forwarded-for')) || first(header('x-real-ip')) || last(header('x-forwarded-for'))
    : String(req.socket?.remoteAddress || '')
  return normalizeIp(raw)
}

export function normalizeIp(raw) {
  let ip = String(raw || '').trim().replace(/^\[|\]$/g, '')
  if (ip.startsWith('::ffff:') && isIP(ip.slice(7)) === 4) ip = ip.slice(7)
  const kind = isIP(ip)
  if (kind === 4) return ip
  if (kind === 6) return `${expandIpv6(ip).slice(0, 4).join(':')}::/64`
  return 'unknown'
}

function expandIpv6(ip) {
  const [head, tail = ''] = ip.split('::')
  const a = head ? head.split(':') : []
  const b = tail ? tail.split(':') : []
  const groups = ip.includes('::') ? [...a, ...Array(8 - a.length - b.length).fill('0'), ...b] : a
  return groups.map(g => g.toLowerCase().replace(/^0+(?=.)/, ''))
}

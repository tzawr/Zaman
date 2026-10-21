// Plumbing shared by the Teams endpoints: errors a caller can act on, CORS for
// the Teams web app, and reading the request.

// A refusal the caller can act on. Its message is written for the person
// using the app, and is shown to them as-is.
export class TeamsError extends Error {
  constructor(status, reason, message) {
    super(message)
    this.status = status
    this.reason = reason
  }
}

export const notFound = (message) => new TeamsError(404, 'not_found', message)
export const forbidden = (message) => new TeamsError(403, 'forbidden', message)
export const conflict = (reason, message) => new TeamsError(409, reason, message)
export const invalid = (message) => new TeamsError(400, 'invalid', message)

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

// For limits on calls made before sign-in. Vercel puts the caller first.
export function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '')
  return forwarded.split(',')[0].trim() || req.socket?.remoteAddress || 'unknown'
}

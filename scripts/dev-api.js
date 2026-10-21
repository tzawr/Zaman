import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'

// Serves the api/ functions locally against the Firebase emulators, for the
// Teams app in development. Vercel does the same routing in production:
// api/<name>.js at /api/<name>, and api/teams/[action].js at /api/teams/<action>.
//
//   npm run dev:emulators   # in one terminal
//   npm run dev:api         # in another

process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8085'
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099'
process.env.GCLOUD_PROJECT ||= 'demo-hengam'

const PORT = Number(process.env.PORT || 3001)
const root = resolve(import.meta.dirname, '..')

function route(pathname) {
  const teams = pathname.match(/^\/api\/teams\/([A-Za-z]+)$/)
  if (teams) return { file: resolve(root, 'api/teams/[action].js'), query: { action: teams[1] } }
  const plain = pathname.match(/^\/api\/([a-z-]+)$/)
  if (plain && existsSync(resolve(root, `api/${plain[1]}.js`))) return { file: resolve(root, `api/${plain[1]}.js`), query: {} }
  return null
}

// The few pieces of Vercel's request and response helpers the handlers use.
function adapt(res) {
  res.status = (code) => { res.statusCode = code; return res }
  res.json = (body) => {
    if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(body))
    return res
  }
  return res
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  const match = route(url.pathname)
  adapt(res)
  if (!match) return res.status(404).json({ error: 'Not found' })

  let raw = ''
  for await (const chunk of req) raw += chunk
  req.query = { ...Object.fromEntries(url.searchParams), ...match.query }
  try {
    req.body = raw && String(req.headers['content-type']).includes('json') ? JSON.parse(raw) : raw
  } catch {
    req.body = raw
  }

  try {
    const { default: handler } = await import(pathToFileURL(match.file).href)
    await handler(req, res)
  } catch (err) {
    console.error(err)
    if (!res.headersSent) res.status(500).json({ error: 'dev-api handler crashed' })
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`api on http://127.0.0.1:${PORT} (emulators: firestore ${process.env.FIRESTORE_EMULATOR_HOST}, auth ${process.env.FIREBASE_AUTH_EMULATOR_HOST})`)
})

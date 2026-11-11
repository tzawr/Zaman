import { createServer } from 'node:http'

// Stand-ins for every paid or outbound provider the API talks to, so a test
// run never reaches them: Anthropic's Messages API (non-streaming) and Expo's
// push service. Each request is counted; the runner reports the counts so a
// run that unexpectedly "used AI" or "sent pushes" is visible.

export async function startSinks({ aiLatencyMs = 400 } = {}) {
  const counts = { ai: 0, push: 0, other: 0 }
  const server = createServer(async (req, res) => {
    let body = ''
    for await (const c of req) body += c
    res.setHeader('Content-Type', 'application/json')
    if (req.url.startsWith('/v1/messages')) {
      counts.ai++
      await new Promise(r => setTimeout(r, aiLatencyMs))
      return res.end(JSON.stringify({
        content: [{ type: 'text', text: '{"rules":[],"note":"mock"}' }],
        usage: { input_tokens: 800, output_tokens: 300 },
      }))
    }
    if (req.url.includes('/push/send')) {
      counts.push++
      const n = (() => { try { return JSON.parse(body).length } catch { return 0 } })()
      return res.end(JSON.stringify({ data: Array.from({ length: n }, () => ({ status: 'ok', id: 'mock' })) }))
    }
    counts.other++
    res.statusCode = 404
    res.end('{}')
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${server.address().port}`
  return {
    url,
    env: { ANTHROPIC_BASE_URL: url, ANTHROPIC_API_KEY: 'mock-key-not-real', EXPO_PUSH_URL: `${url}/--/api/v2/push/send`, EXPO_ACCESS_TOKEN: '' },
    counts,
    stop: () => new Promise(r => server.close(r)),
  }
}

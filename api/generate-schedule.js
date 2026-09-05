import { requireSignedIn, sendError } from './_firebase-admin.js'

// A prompt is a workspace's rules, roles and team — generous, but bounded.
// Without a cap this endpoint would forward whatever it is handed to a metered
// API.
const MAX_PROMPT_CHARS = 20000

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.VITE_ANTHROPIC_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' })
  }

  try {
    // This endpoint spends money on every call, so it is never open to the
    // internet: the caller must present a verified Firebase ID token.
    await requireSignedIn(req)
  } catch (err) {
    return sendError(res, err, 'Sign in to generate a schedule.')
  }

  try {
    const { prompt } = req.body || {}
    if (!prompt || typeof prompt !== 'string') return res.status(400).json({ error: 'Missing prompt' })
    if (prompt.length > MAX_PROMPT_CHARS) {
      return res.status(413).json({ error: 'Prompt is too long' })
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 6000,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      console.error('Anthropic error:', err)
      return res.status(response.status).json({ error: 'Anthropic API error', details: err })
    }

    const data = await response.json()
    const scheduleText = data.content?.[0]?.text || ''
    return res.status(200).json({ scheduleText })

  } catch (error) {
    console.error('Server error:', error)
    return res.status(500).json({ error: 'Server error', details: error.message })
  }
}

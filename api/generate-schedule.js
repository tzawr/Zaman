import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { initAdmin, requireSignedIn, sendError } from './_firebase-admin.js'

// A prompt is a workspace's rules, roles and team — generous, but bounded.
// Without a cap this endpoint would forward whatever it is handed to a metered
// API.
const MAX_PROMPT_CHARS = 20000

// Output is ~87% of the cost of a maxed-out call, so each task gets a ceiling
// sized to what it actually returns. Measured worst cases: a fully populated
// rules object for a 25-person team is ~2,000 tokens, and five recommendations
// are ~150. Anything larger is a runaway, not a result.
const TASK_LIMITS = {
  rules: 4000,
  recommendations: 1024,
}
const DEFAULT_MAX_TOKENS = 1024

// A signed-in account is not a blank cheque. Normal use is about ten calls a
// day; this stops a stuck loop or a scripted account from running up a bill.
const MAX_CALLS_PER_DAY = 50

async function checkAndCountUsage(uid) {
  const db = getFirestore()
  const today = new Date().toISOString().slice(0, 10)
  const ref = db.collection('aiUsage').doc(`${uid}_${today}`)

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const used = snap.exists ? Number(snap.data().calls) || 0 : 0
    if (used >= MAX_CALLS_PER_DAY) return { blocked: true, used }

    tx.set(ref, {
      uid,
      day: today,
      calls: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    return { blocked: false, used: used + 1 }
  })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.VITE_ANTHROPIC_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' })
  }

  let uid
  try {
    // This endpoint spends money on every call, so it is never open to the
    // internet: the caller must present a verified Firebase ID token.
    initAdmin()
    const decoded = await requireSignedIn(req)
    uid = decoded.uid
  } catch (err) {
    return sendError(res, err, 'Sign in to generate a schedule.')
  }

  try {
    const { prompt, task } = req.body || {}
    if (!prompt || typeof prompt !== 'string') return res.status(400).json({ error: 'Missing prompt' })
    if (prompt.length > MAX_PROMPT_CHARS) {
      return res.status(413).json({ error: 'Prompt is too long' })
    }

    const usage = await checkAndCountUsage(uid)
    if (usage.blocked) {
      return res.status(429).json({
        error: 'Daily limit reached',
        message: 'You have reached today’s schedule generation limit. It resets tomorrow.',
      })
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-5',
        max_tokens: TASK_LIMITS[task] || DEFAULT_MAX_TOKENS,
        // Both tasks are structured extraction, not reasoning. Low effort keeps
        // thinking tokens — which bill as output — down. Thinking stays on:
        // turning it off can leak stray tags into the JSON we parse.
        thinking: { type: 'adaptive' },
        output_config: { effort: 'low' },
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      console.error('Anthropic error:', err)
      return res.status(response.status).json({ error: 'Anthropic API error', details: err })
    }

    const data = await response.json()
    // With thinking on, the response carries thinking blocks before the text.
    const scheduleText = (data.content || []).find(block => block.type === 'text')?.text || ''
    return res.status(200).json({ scheduleText })

  } catch (error) {
    console.error('Server error:', error)
    return res.status(500).json({ error: 'Server error', details: error.message })
  }
}

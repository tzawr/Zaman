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

// Claude Opus 5, USD per token.
const INPUT_PER_TOKEN = 5 / 1_000_000
const OUTPUT_PER_TOKEN = 25 / 1_000_000

// A call cap cannot bound spend, because one call can cost 25x another. What
// actually protects the margin on a $20 plan is a spend cap: at realistic usage
// a heavy manager spends under $2 a month, so $5 leaves generous headroom while
// making the worst case a rounding error instead of a $180 loss.
const MONTHLY_BUDGET_USD = 5
// Secondary guard so a runaway burns the budget over days, not in one minute.
const MAX_CALLS_PER_DAY = 40

function monthKey() {
  return new Date().toISOString().slice(0, 7)
}

function dayKey() {
  return new Date().toISOString().slice(0, 10)
}

// Checked before the call, since the cost is not known until after it returns.
// One call may overshoot the budget by its own cost, which is capped by
// TASK_LIMITS at a few cents.
async function checkBudget(uid) {
  const db = getFirestore()
  const [monthSnap, daySnap] = await Promise.all([
    db.collection('aiUsage').doc(`${uid}_${monthKey()}`).get(),
    db.collection('aiUsage').doc(`${uid}_${dayKey()}`).get(),
  ])

  const spent = monthSnap.exists ? Number(monthSnap.data().spendUsd) || 0 : 0
  const callsToday = daySnap.exists ? Number(daySnap.data().calls) || 0 : 0

  if (spent >= MONTHLY_BUDGET_USD) return { blocked: true, reason: 'month' }
  if (callsToday >= MAX_CALLS_PER_DAY) return { blocked: true, reason: 'day' }
  return { blocked: false }
}

// Records what the call actually cost, from the usage the API reports.
async function recordUsage(uid, usage) {
  const db = getFirestore()
  const input = Number(usage?.input_tokens) || 0
  const output = Number(usage?.output_tokens) || 0
  const cost = input * INPUT_PER_TOKEN + output * OUTPUT_PER_TOKEN

  await Promise.all([
    db.collection('aiUsage').doc(`${uid}_${monthKey()}`).set({
      uid,
      period: monthKey(),
      spendUsd: FieldValue.increment(cost),
      inputTokens: FieldValue.increment(input),
      outputTokens: FieldValue.increment(output),
      calls: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }),
    db.collection('aiUsage').doc(`${uid}_${dayKey()}`).set({
      uid,
      period: dayKey(),
      calls: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }),
  ])
}

// The Pro gate lived only in the browser, so a free account calling this
// endpoint directly still spent money. Resolved here the same way the client
// resolves it: an active override wins, otherwise the user's own tier.
async function isProUser(uid) {
  const db = getFirestore()
  const [userSnap, overrideSnap] = await Promise.all([
    db.collection('users').doc(uid).get(),
    db.collection('adminOverrides').doc(uid).get(),
  ])

  const override = overrideSnap.exists ? overrideSnap.data() : null
  if (override?.tier) {
    const expiresAt = override.expiresAt?.toMillis?.() ?? null
    if (!expiresAt || expiresAt > Date.now()) {
      return String(override.tier).trim().toLowerCase() === 'pro'
    }
  }

  const tier = String(userSnap.exists ? userSnap.data().tier || '' : '').trim().toLowerCase()
  return tier === 'pro' || tier === 'business'
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Deliberately not VITE_-prefixed: that prefix marks a variable for the
  // browser bundle, and this key must never reach it.
  const apiKey = process.env.ANTHROPIC_API_KEY
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

    if (!(await isProUser(uid))) {
      return res.status(403).json({
        error: 'Pro required',
        message: 'AI rule parsing is available on Pro.',
      })
    }

    const budget = await checkBudget(uid)
    if (budget.blocked) {
      return res.status(429).json({
        error: 'Limit reached',
        message: budget.reason === 'month'
          ? 'You have reached this month’s AI usage limit. It resets at the start of next month.'
          : 'You have reached today’s schedule generation limit. It resets tomorrow.',
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
    // Charge what the call actually cost. Failures above never reach here, so a
    // failed call is not billed to the user's budget.
    await recordUsage(uid, data.usage).catch(err => console.error('usage record failed:', err))

    // With thinking on, the response carries thinking blocks before the text.
    const scheduleText = (data.content || []).find(block => block.type === 'text')?.text || ''
    return res.status(200).json({ scheduleText })

  } catch (error) {
    console.error('Server error:', error)
    return res.status(500).json({ error: 'Server error', details: error.message })
  }
}

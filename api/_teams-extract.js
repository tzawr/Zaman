import Anthropic from '@anthropic-ai/sdk'
import { FieldValue } from 'firebase-admin/firestore'
import { TeamsError } from './_teams-http.js'

// Reading a schedule from a PDF or a photo with Claude. Claude returns
// structured rows and says which parts it could not read clearly; nothing it
// returns becomes a shift without a manager reviewing it.
//
// Spend is capped per business per month, checked before each call, the way
// Hengam caps its own AI use.

const MODEL = 'claude-opus-5-5'
// Claude Opus 5.5, USD per token.
const INPUT_PER_TOKEN = 4 / 1_000_000
const OUTPUT_PER_TOKEN = 20 / 1_000_000
export const MONTHLY_IMPORT_BUDGET_USD = 5
export const MAX_AI_IMPORTS_PER_DAY = 20

export const AI_MEDIA_TYPES = {
  'application/pdf': 'document',
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/webp': 'image',
  'image/gif': 'image',
}

// Every field is required and a string: empty means "not shown". `unclear`
// names the fields Claude could not read with confidence.
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['shifts', 'notes'],
  properties: {
    shifts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['employee', 'date', 'weekday', 'start', 'end', 'position', 'location', 'unclear'],
        properties: {
          employee: { type: 'string' },
          date: { type: 'string' },
          weekday: { type: 'string' },
          start: { type: 'string' },
          end: { type: 'string' },
          position: { type: 'string' },
          location: { type: 'string' },
          unclear: { type: 'array', items: { type: 'string', enum: ['employee', 'date', 'times', 'position'] } },
        },
      },
    },
    notes: { type: 'string' },
  },
}

const SYSTEM = `You read work schedules from documents and photos and list every shift in them.

For each shift, write:
- employee: the name exactly as written, even if it looks misspelled.
- date: YYYY-MM-DD, only when the document shows a date for that shift. Use the year given below when the document leaves it out. Otherwise leave it empty.
- weekday: the day of the week as written (for example "Monday"), or empty.
- start and end: 24-hour HH:MM. An end earlier than the start is a shift that runs past midnight; write it as shown.
- position and location: when the document shows them, otherwise empty.
- unclear: the fields you could not read with confidence (handwriting, a cut-off cell, an ambiguous time such as "9-5" with no am or pm). Leave a field empty rather than guess, and list it here.

Leave out days off, holidays and blank cells. A schedule may show several weeks; list them all. If something on the page looks like a schedule but you cannot read it, say so in notes. The manager reviews every row before anything is used, so an honest gap is better than a confident mistake.`

const monthKey = (now) => now.toISOString().slice(0, 7)
const dayKey = (now) => now.toISOString().slice(0, 10)

async function checkBudget(db, bizId, now) {
  const [month, day] = await Promise.all([
    db.doc(`aiUsage/teams-${bizId}_${monthKey(now)}`).get(),
    db.doc(`aiUsage/teams-${bizId}_${dayKey(now)}`).get(),
  ])
  if ((Number(month.data()?.spendUsd) || 0) >= MONTHLY_IMPORT_BUDGET_USD) {
    throw new TeamsError(429, 'budget', 'This workspace has used this month’s photo and PDF imports. CSV and Excel imports still work.')
  }
  if ((Number(day.data()?.calls) || 0) >= MAX_AI_IMPORTS_PER_DAY) {
    throw new TeamsError(429, 'budget', 'That is today’s limit for photo and PDF imports. Try again tomorrow, or import a CSV or Excel file.')
  }
}

async function recordUsage(db, bizId, usage, now) {
  const input = (usage?.input_tokens || 0) + (usage?.cache_creation_input_tokens || 0) + (usage?.cache_read_input_tokens || 0)
  const output = usage?.output_tokens || 0
  const spendUsd = input * INPUT_PER_TOKEN + output * OUTPUT_PER_TOKEN
  const fields = { bizId, inputTokens: FieldValue.increment(input), outputTokens: FieldValue.increment(output), calls: FieldValue.increment(1), updatedAt: now }
  await Promise.all([
    db.doc(`aiUsage/teams-${bizId}_${monthKey(now)}`).set({ ...fields, spendUsd: FieldValue.increment(spendUsd) }, { merge: true }),
    db.doc(`aiUsage/teams-${bizId}_${dayKey(now)}`).set(fields, { merge: true }),
  ])
}

// Returns { rows, notes } in the shape shared/teams/imports.js prepares for
// review. `client` is injectable for tests.
export async function extractWithClaude({ db, bizId, mediaType, base64, weekStart, roster, now, client }) {
  const kind = AI_MEDIA_TYPES[mediaType]
  if (!kind) throw new TeamsError(400, 'invalid', 'Upload a PDF or a photo (JPEG, PNG, WebP or GIF).')
  await checkBudget(db, bizId, now)

  const anthropic = client || new Anthropic()
  const source = { type: 'base64', media_type: mediaType, data: base64 }
  let message
  try {
    // Streamed so a long multi-page schedule never hits a request timeout.
    message = await anthropic.beta.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      // If a safety classifier declines, the request is rerun on the
      // recommended fallback model rather than failing.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: [
          { type: kind, source },
          {
            type: 'text',
            text: `The week this schedule is for starts on Monday ${weekStart}; the year is ${weekStart.slice(0, 4)}. ` +
              `People on this team: ${roster.slice(0, 200).join(', ') || '(none yet)'}. ` +
              'These names can help you read unclear handwriting, but always write a name as it appears.',
          },
        ],
      }],
    }).finalMessage()
  } catch (err) {
    if (err instanceof Anthropic.BadRequestError) {
      throw new TeamsError(422, 'unreadable', 'This file could not be read. Try a clearer photo, or a PDF under 3 MB.')
    }
    if (err instanceof Anthropic.RateLimitError) {
      throw new TeamsError(503, 'busy', 'Reading files is busy right now. Try again in a minute.')
    }
    throw err
  }
  await recordUsage(db, bizId, message.usage, now)

  if (message.stop_reason === 'refusal') {
    throw new TeamsError(422, 'unreadable', 'This file could not be read as a schedule. Try a CSV or Excel export instead.')
  }
  if (message.stop_reason === 'max_tokens') {
    throw new TeamsError(422, 'too_large', 'This schedule is too long to read in one go. Split it into one file per week.')
  }
  const text = message.content.filter(b => b.type === 'text').map(b => b.text).join('')
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new TeamsError(502, 'unreadable', 'The file was read but the result could not be used. Try again.')
  }

  const rows = (parsed.shifts || []).map(s => {
    const unclear = new Set(s.unclear || [])
    return {
      name: s.employee,
      date: s.date || null,
      weekday: s.weekday || null,
      start: s.start || null,
      end: s.end || null,
      positionName: s.position || null,
      location: s.location || null,
      sure: { name: !unclear.has('employee'), date: !unclear.has('date'), times: !unclear.has('times') },
    }
  })
  return { rows, notes: String(parsed.notes || '').slice(0, 1000) }
}

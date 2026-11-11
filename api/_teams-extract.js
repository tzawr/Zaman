import Anthropic from '@anthropic-ai/sdk'
import { FieldValue } from 'firebase-admin/firestore'
import { TeamsError } from './_teams-http.js'
import { reserveAiBudget } from './_ai-budget.js'

// Reading a schedule from a PDF or a photo with Claude. Claude returns
// structured rows and says which parts it could not read clearly; nothing it
// returns becomes a shift without a manager reviewing it.
//
// Spend is capped per business per month, checked before each call, the way
// Hengam caps its own AI use.

// Reading a schedule is extraction, which Haiku does well at a fortieth of
// Opus's price: an import costs well under a cent.
const MODEL = 'claude-haiku-5-5'
// Claude Haiku 5.5, USD per token, for prompts of 100K tokens or fewer (a
// schedule's are a few thousand; longer prompts are billed at 5x).
const INPUT_PER_TOKEN = 0.1 / 1_000_000
const OUTPUT_PER_TOKEN = 0.5 / 1_000_000
export const MONTHLY_IMPORT_BUDGET_USD = 1
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
- unclear: the fields you could not read with confidence (handwriting, a cut-off cell, an ambiguous time). For a time with no am or pm, such as "9-5", write the usual working-hours reading (09:00 to 17:00) and list "times" here. Leave a field empty only when you cannot read it at all.

Leave out days off, holidays and blank cells. A schedule may show several weeks; list them all, and when days are named without dates, work out each date from the week start below (a second week follows the first). If something on the page looks like a schedule but you cannot read it, say so in notes. The manager reviews every row before anything is used, so an honest gap is better than a confident mistake.`

const monthKey = (now) => now.toISOString().slice(0, 7)
const dayKey = (now) => now.toISOString().slice(0, 10)

const BUDGET_MESSAGES = {
  month: 'This workspace has used this month’s photo and PDF imports. Word, Excel and CSV imports still work.',
  day: 'That is today’s limit for photo and PDF imports. Try again tomorrow, or import a Word, Excel or CSV file.',
}

// Worst case for one read: the full output ceiling, plus input bounded by the
// file size (a token is at least ~3 bytes of base64) up to the 100K tier.
const MAX_OUTPUT_TOKENS = 64000
const holdFor = (base64) => Math.min(100000, Math.ceil(String(base64 || '').length / 3)) * INPUT_PER_TOKEN + MAX_OUTPUT_TOKENS * OUTPUT_PER_TOKEN

// The check and a hold on the call's worst-case cost happen in one
// transaction, so a burst of imports cannot all pass the same check.
async function reserveBudget(db, bizId, base64, now) {
  const budget = await reserveAiBudget(db, {
    monthRef: db.doc(`aiUsage/teams-${bizId}_${monthKey(now)}`),
    dayRef: db.doc(`aiUsage/teams-${bizId}_${dayKey(now)}`),
    monthlyUsd: MONTHLY_IMPORT_BUDGET_USD,
    maxCallsPerDay: MAX_AI_IMPORTS_PER_DAY,
    holdUsd: holdFor(base64),
    monthFields: { bizId },
    dayFields: { bizId },
    stamp: now,
  })
  if (budget.blocked === 'busy') throw new TeamsError(503, 'busy', 'Reading files is busy right now. Try again in a minute.')
  if (budget.blocked) throw new TeamsError(429, 'budget', BUDGET_MESSAGES[budget.blocked])
  return budget
}

function costOf(usage) {
  const input = (usage?.input_tokens || 0) + (usage?.cache_creation_input_tokens || 0) + (usage?.cache_read_input_tokens || 0)
  const output = usage?.output_tokens || 0
  const tokens = { inputTokens: FieldValue.increment(input), outputTokens: FieldValue.increment(output) }
  return { costUsd: input * INPUT_PER_TOKEN + output * OUTPUT_PER_TOKEN, inputTokens: input, outputTokens: output, dayExtra: tokens }
}

// Returns { rows, notes } in the shape shared/teams/imports.js prepares for
// review. `client` is injectable for tests.
export async function extractWithClaude({ db, bizId, mediaType, base64, weekStart, roster, now, client }) {
  const kind = AI_MEDIA_TYPES[mediaType]
  if (!kind) throw new TeamsError(400, 'invalid', 'Upload a PDF or a photo (JPEG, PNG, WebP or GIF).')
  const budget = await reserveBudget(db, bizId, base64, now)

  const anthropic = client || new Anthropic()
  const source = { type: 'base64', media_type: mediaType, data: base64 }
  let message
  try {
    // Streamed so a long multi-page schedule never hits a request timeout.
    message = await anthropic.messages.stream({
      model: MODEL,
      // A month for a large team runs to some 50K tokens of rows.
      max_tokens: MAX_OUTPUT_TOKENS,
      thinking: { type: 'adaptive' },
      // Copying a table out needs little reasoning; low effort keeps the
      // thinking, and so the output bill, small.
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
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
    // Nothing was billed; give the hold and the day's call back.
    await budget.release().catch(e => console.error('import budget release failed:', e))
    if (err instanceof Anthropic.BadRequestError) {
      throw new TeamsError(422, 'unreadable', 'This file could not be read. Try a clearer photo, or a PDF under 3 MB.')
    }
    if (err instanceof Anthropic.RateLimitError) {
      throw new TeamsError(503, 'busy', 'Reading files is busy right now. Try again in a minute.')
    }
    throw err
  }
  await budget.settle(costOf(message.usage))

  if (message.stop_reason === 'refusal') {
    throw new TeamsError(422, 'unreadable', 'This file could not be read as a schedule. Try the Word or Excel file instead.')
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

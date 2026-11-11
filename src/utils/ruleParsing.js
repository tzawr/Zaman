// What happens to a manager's written scheduling rules (Settings → coverage
// rules, plus this week's special instructions) when a schedule is generated.
//
// They used to be dropped silently whenever parsing failed: the parser caught
// every error and returned null, and the week was built and saved as if the
// manager had written nothing. Now a failure stops generation and is shown,
// and building without the rules is something the manager chooses.

export class RuleParseError extends Error {
  /**
   * @param {'unavailable' | 'limit' | 'unreadable' | 'signin'} kind
   * @param {string} [message] server message, shown when it explains more
   */
  constructor(kind, message = '') {
    super(message || kind)
    this.name = 'RuleParseError'
    this.kind = kind
    this.serverMessage = message
  }
}

export function hasWrittenRules(coverageRulesText, specialInstructions) {
  return Boolean(String(coverageRulesText || '').trim() || String(specialInstructions || '').trim())
}

/** Maps a failed /api/generate-schedule response to a RuleParseError. */
export function errorForResponse(status, body = {}) {
  const message = body?.message || ''
  if (status === 401) return new RuleParseError('signin', message)
  if (status === 429) return new RuleParseError('limit', message)
  return new RuleParseError('unavailable', message)
}

/**
 * Pulls the rules object out of the model's reply. Throws 'unreadable' rather
 * than returning null, so a garbled reply is never mistaken for "no rules".
 */
export function extractRulesJson(text) {
  let clean = String(text || '').trim()
  if (clean.startsWith('```json')) clean = clean.replace(/^```json\n?/, '').replace(/\n?```$/, '')
  else if (clean.startsWith('```')) clean = clean.replace(/^```\n?/, '').replace(/\n?```$/, '')
  const first = clean.indexOf('{')
  const last = clean.lastIndexOf('}')
  if (first === -1 || last <= first) throw new RuleParseError('unreadable')
  let parsed
  try {
    parsed = JSON.parse(clean.slice(first, last + 1))
  } catch {
    throw new RuleParseError('unreadable')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new RuleParseError('unreadable')
  return parsed
}

/**
 * Decides the rules step before anything is generated.
 *  - 'none'    nothing written; nothing to apply
 *  - 'parse'   parse the rules (a failure must stop generation)
 *  - 'skipped' the manager chose to continue without them
 *  - 'plan'    their plan does not include written rules; generate, and say so
 */
export function rulesStep({ hasRules, planAllows, skipRules }) {
  if (!hasRules) return 'none'
  if (skipRules) return 'skipped'
  if (!planAllows) return 'plan'
  return 'parse'
}

/**
 * What to record on the generated schedule, so the screen and the saved copy
 * both say whether the written rules were used.
 */
export function rulesOutcome(step) {
  if (step === 'parse') return { rulesApplied: true, rulesSkippedReason: null }
  if (step === 'none') return { rulesApplied: null, rulesSkippedReason: null }
  return { rulesApplied: false, rulesSkippedReason: step === 'plan' ? 'plan' : 'manager_choice' }
}

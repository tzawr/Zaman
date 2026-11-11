import { FieldValue } from 'firebase-admin/firestore'

// Spend caps for the two paths that call Claude (Hengam's rule parsing and
// Teams' photo/PDF import).
//
// Both used to read the month's spend and the day's calls, then call Claude,
// then record usage. Nothing stopped N concurrent requests from all reading
// the same "under budget" numbers and all spending, so a burst could blow
// through both the daily call cap and the monthly spend cap.
//
// Now the check and a reservation happen in one transaction: the day's call
// is counted and the call's worst-case cost is held as pendingUsd before the
// provider is contacted. Concurrent requests serialize on those documents, so
// the caps hold no matter how many arrive at once. Afterwards the hold is
// settled to the real cost, or released if the call failed (a failed call is
// not billed, as before).
//
// If a function dies between reserve and settle, its hold stays in pendingUsd.
// Holds are a few cents against a multi-dollar budget, so that errs towards
// refusing slightly early, never towards overspending.

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {object} o
 * @param {FirebaseFirestore.DocumentReference} o.monthRef
 * @param {FirebaseFirestore.DocumentReference} o.dayRef
 * @param {number} o.monthlyUsd     spend cap for the month
 * @param {number} o.maxCallsPerDay call cap for the day
 * @param {number} o.holdUsd        worst-case cost of this one call
 * @param {object} o.monthFields    identifying fields written to the month doc
 * @param {object} o.dayFields      identifying fields written to the day doc
 * @param {Date|FirebaseFirestore.FieldValue} [o.stamp]
 * @returns {Promise<{ blocked: null | 'month' | 'day' | 'busy', settle?: Function, release?: Function }>}
 */
export async function reserveAiBudget(db, { monthRef, dayRef, monthlyUsd, maxCallsPerDay, holdUsd, monthFields, dayFields, stamp }) {
  const updatedAt = stamp || FieldValue.serverTimestamp()
  const hold = Math.max(0, Number(holdUsd) || 0)

  let blocked
  try {
    blocked = await db.runTransaction(async (tx) => {
    const [month, day] = await Promise.all([tx.get(monthRef), tx.get(dayRef)])
    const spent = Number(month.data()?.spendUsd) || 0
    const pending = Math.max(0, Number(month.data()?.pendingUsd) || 0)
    const calls = Number(day.data()?.calls) || 0
    // Like the old check, a call is allowed while spend is under the cap; one
    // call may overshoot by its own (bounded) cost. Holds of calls still in
    // flight count as spent, which is what makes the cap hold under bursts.
    if (spent + pending >= monthlyUsd) return 'month'
    if (calls >= maxCallsPerDay) return 'day'
    tx.set(monthRef, { ...monthFields, pendingUsd: FieldValue.increment(hold), updatedAt }, { merge: true })
    tx.set(dayRef, { ...dayFields, calls: FieldValue.increment(1), updatedAt }, { merge: true })
    return null
    })
  } catch (err) {
    // Many simultaneous calls on one budget make the transaction lose its
    // lock or exhaust its retries. That is a reason to refuse, never to spend
    // without a reservation: the caller answers "busy, try again".
    console.error('AI budget reservation failed:', err.message)
    blocked = 'busy'
  }
  if (blocked) return { blocked }

  let done = false
  return {
    blocked: null,
    /** Replaces the hold with what the call actually cost. */
    async settle({ costUsd, inputTokens = 0, outputTokens = 0, dayExtra = {} }) {
      if (done) return
      done = true
      const tokens = { inputTokens: FieldValue.increment(inputTokens), outputTokens: FieldValue.increment(outputTokens) }
      await Promise.all([
        monthRef.set({
          ...monthFields,
          ...tokens,
          spendUsd: FieldValue.increment(Number(costUsd) || 0),
          pendingUsd: FieldValue.increment(-hold),
          calls: FieldValue.increment(1),
          updatedAt,
        }, { merge: true }),
        Object.keys(dayExtra).length ? dayRef.set({ ...dayFields, ...dayExtra, updatedAt }, { merge: true }) : null,
      ])
    },
    /** The call failed before it cost anything: give back the hold and the day's call. */
    async release() {
      if (done) return
      done = true
      await Promise.all([
        monthRef.set({ pendingUsd: FieldValue.increment(-hold), updatedAt }, { merge: true }),
        dayRef.set({ calls: FieldValue.increment(-1), updatedAt }, { merge: true }),
      ])
    },
  }
}

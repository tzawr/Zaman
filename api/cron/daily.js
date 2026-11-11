import { getFirestore } from 'firebase-admin/firestore'
import { initAdmin, sendError } from '../_firebase-admin.js'
import { runDailyJob } from '../_teams-jobs.js'

// Run once a day by Vercel Cron (vercel.json). Vercel sends the project's
// CRON_SECRET as a bearer token; anything else is turned away, so the job
// cannot be triggered from outside.
export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  try {
    initAdmin()
    const db = getFirestore()
    const result = await runDailyJob(db, new Date())
    console.log('daily job', JSON.stringify(result))
    // Heartbeat for /api/ops/status: when the job last ran, and what failed.
    await db.doc('meta/dailyJob').set({ lastRunAt: new Date(), failed: result.failed || [] })
      .catch(err => console.error('daily job heartbeat failed:', err?.message || err))
    // A part that failed marks the run failed in Vercel's cron history.
    return res.status(result.failed ? 500 : 200).json(result)
  } catch (err) {
    return sendError(res, err)
  }
}

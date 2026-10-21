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
    const result = await runDailyJob(getFirestore(), new Date())
    console.log('daily job', JSON.stringify(result))
    return res.status(200).json(result)
  } catch (err) {
    return sendError(res, err)
  }
}

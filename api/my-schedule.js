import { getFirestore } from 'firebase-admin/firestore'
import { initAdmin, requireSignedIn, sendError } from './_firebase-admin.js'
import { consumeRateLimit, sendRateLimited } from './_rate-limit.js'
import { employeeScheduleView } from '../src/utils/employeeScheduleView.js'

// The employee portal used to read the manager's schedules straight from
// Firestore. A schedule document holds the whole team's week and rules cannot
// hide fields, so "employees see only their own shifts" was a promise the UI
// kept and the database did not. Employees now read through here, and the
// manager's current setting decides how much of each week they get.

const MAX_WEEKS = 52

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  let decoded
  try {
    initAdmin()
    decoded = await requireSignedIn(req)
  } catch (err) {
    return sendError(res, err, 'Sign in to see your schedule.')
  }

  const limit = await consumeRateLimit('my-schedule', decoded.uid, 120, 60 * 60)
  if (!limit.allowed) {
    return sendRateLimited(res, limit.retryAfterSeconds, 'Too many requests. Try again in a little while.')
  }

  try {
    const db = getFirestore()
    const userSnap = await db.collection('users').doc(decoded.uid).get()
    const user = userSnap.exists ? userSnap.data() : null
    if (user?.accountType !== 'employee' || !user.managerId || !user.linkedEmployeeId) {
      return res.status(403).json({
        blocked: true,
        reason: 'not_linked',
        message: 'This account is not linked to a workspace.',
      })
    }

    const [managerSnap, employeeSnap, schedulesSnap] = await Promise.all([
      db.collection('users').doc(user.managerId).get(),
      db.collection('employees').doc(user.linkedEmployeeId).get(),
      db.collection('schedules')
        .where('userId', '==', user.managerId)
        .orderBy('createdAt', 'desc')
        .limit(MAX_WEEKS)
        .get(),
    ])

    // The name comes from the manager's record, not the employee's own
    // profile: shifts are matched by name, and a name the employee could edit
    // would let them read a coworker's week.
    const employee = employeeSnap.exists ? employeeSnap.data() : null
    const employeeName = employee?.userId === user.managerId ? employee.name : undefined
    const fullView = managerSnap.exists && managerSnap.data().allowEmployeeFullView === true

    return res.status(200).json({
      employeeName: employeeName || user.employeeName || '',
      canSeeFullSchedule: fullView,
      schedules: schedulesSnap.docs.map(d =>
        employeeScheduleView({ id: d.id, ...d.data() }, { employeeName, fullView })),
    })
  } catch (err) {
    return sendError(res, err)
  }
}

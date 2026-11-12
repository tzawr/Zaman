import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { db } from '../firebase'
import { freshestRecord } from './freshestRecord'
import { withTeamsAvailability } from './teamsAvailability'

// The team as the scheduler sees it: each employee record with any newer
// availability or time off the employee entered in their own portal, and,
// for a workspace connected to Hengam Teams, Teams' availability and
// approved time off for the week. Generation and the checks after a manual
// edit both use this, so they judge a week by the same facts.

export async function mergeEmployeePortalAvailability(managerUid, team) {
  if (!managerUid || team.length === 0) return team
  try {
    const portalQuery = query(
      collection(db, 'users'),
      where('managerId', '==', managerUid),
      where('accountType', '==', 'employee')
    )
    const [portalSnap, managerSnap] = await Promise.all([
      getDocs(portalQuery),
      getDoc(doc(db, 'users', managerUid)),
    ])
    // The setting lives on the manager's own record. Each employee's portal
    // record carries a copy, but the employee can write that copy.
    if (managerSnap.data()?.allowEmployeeAvailabilityUpdates === false) return team
    const portalByEmployeeId = new Map()
    portalSnap.docs.forEach(portalDoc => {
      const data = portalDoc.data()
      if (data.linkedEmployeeId) portalByEmployeeId.set(data.linkedEmployeeId, data)
    })
    return team.map(emp => {
      const portal = portalByEmployeeId.get(emp.id)
      if (!portal) return emp
      // A manager's later edit to the employee record must beat an older
      // portal submission, and the other way round.
      const availability = freshestRecord([emp, portal], 'availability', 'availabilityUpdatedAt')
      const timeOff = freshestRecord([emp, portal], 'timeOff', 'timeOffUpdatedAt')
      return {
        ...emp,
        availability: availability?.availability || emp.availability,
        timeOff: timeOff?.timeOff || emp.timeOff,
        availabilityUpdatedAt: availability?.availabilityUpdatedAt || emp.availabilityUpdatedAt,
        availabilityUpdatedByType: availability?.availabilityUpdatedByType || emp.availabilityUpdatedByType,
      }
    })
  } catch {
    return team
  }
}

/** Portal and Teams merged; `error` is set when Teams could not be read. */
export async function loadSchedulingTeam(managerUid, employees, { teamsBizId, weekStart }) {
  const merged = await mergeEmployeePortalAvailability(managerUid, employees)
  return withTeamsAvailability(merged, { teamsBizId, weekStart })
}

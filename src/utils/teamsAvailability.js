import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../firebase'
import { applyTeamsToHengamEmployees } from '../../shared/teams/hengam.js'

// When a workspace is connected to Hengam Teams, the people on it keep their
// availability and time off there. Before generating a week, Hengam reads
// both and uses them in place of what its own records hold.
//
// Returns the employees unchanged, and says so, if Teams cannot be read: a
// generation should not fail because of the connection, but the manager
// should know it ran without the latest submissions.
export async function withTeamsAvailability(employees, { teamsBizId, weekStart }) {
  if (!teamsBizId) return { employees, usedTeams: false, error: null }
  try {
    const [availabilitySnap, timeOffSnap] = await Promise.all([
      getDocs(collection(db, 'businesses', teamsBizId, 'availability')),
      getDocs(query(collection(db, 'businesses', teamsBizId, 'timeOff'), where('status', '==', 'approved'))),
    ])
    const availabilityByStaffId = Object.fromEntries(availabilitySnap.docs.map(d => [d.id, d.data()]))
    const timeOffByStaffId = {}
    timeOffSnap.docs.forEach(d => {
      const r = { id: d.id, ...d.data() }
      ;(timeOffByStaffId[r.staffId] ||= []).push(r)
    })
    return {
      employees: applyTeamsToHengamEmployees(employees, { availabilityByStaffId, timeOffByStaffId, weekStart }),
      usedTeams: true,
      error: null,
    }
  } catch {
    return { employees, usedTeams: false, error: 'Could not read availability from Hengam Teams. This week was generated from Hengam’s own records.' }
  }
}

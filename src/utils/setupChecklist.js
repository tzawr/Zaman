// Single source of truth for "has this workspace been filled in enough to
// generate a schedule?". The onboarding wizard uses it to show progress; the
// generate page uses it to explain exactly what is still missing.

export const DAY_KEYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
]

export function employeeHasAvailability(employee) {
  const availability = employee?.availability
  if (!availability || typeof availability !== 'object') return false
  return Object.values(availability).some(
    day => day && typeof day === 'object' && day.available !== undefined
  )
}

export function countOpenDays(operatingHours) {
  if (!operatingHours || typeof operatingHours !== 'object') return 0
  return Object.values(operatingHours).filter(day => day?.open).length
}

// Returns one entry per requirement, in the order the wizard collects them.
export function getSetupStatus({ userData, employees = [] } = {}) {
  const roles = Array.isArray(userData?.roles) ? userData.roles : []
  const openDays = countOpenDays(userData?.operatingHours)
  const incomplete = employees.filter(employee => !employeeHasAvailability(employee))
  // Names drive the message, but an unnamed record still blocks completion —
  // otherwise a half-saved employee reports the workspace as ready.
  const missingAvailability = incomplete.map(employee => employee.name).filter(Boolean)

  return {
    roles: { key: 'roles', complete: roles.length > 0, count: roles.length },
    hours: { key: 'hours', complete: openDays > 0, openDays },
    team: { key: 'team', complete: employees.length > 0, count: employees.length },
    availability: {
      key: 'availability',
      // Availability can only be complete once somebody is on the team.
      complete: employees.length > 0 && incomplete.length === 0,
      missingNames: missingAvailability,
    },
  }
}

export function isSetupComplete(status) {
  return Object.values(status).every(item => item.complete)
}

// Joins names the way a person would read them: "Ali", "Ali and Tom",
// "Ali, Tom and Maria".
export function formatNameList(names, andWord = 'and') {
  const list = names.filter(Boolean)
  if (list.length === 0) return ''
  if (list.length === 1) return list[0]
  return `${list.slice(0, -1).join(', ')} ${andWord} ${list[list.length - 1]}`
}

// Turns the status into sentences like "You're missing Ali, Tom and Maria's
// availability". `tf` is the interpolating translator from useI18n().
export function describeMissingSetup(status, tf, t) {
  const problems = []

  if (!status.roles.complete) {
    problems.push({ key: 'roles', path: '/settings', message: tf('setupMissingRoles') })
  }
  if (!status.hours.complete) {
    problems.push({ key: 'hours', path: '/settings', message: tf('setupMissingHours') })
  }
  if (!status.team.complete) {
    problems.push({ key: 'team', path: '/employees', message: tf('setupMissingTeam') })
  } else if (!status.availability.complete) {
    problems.push({
      key: 'availability',
      path: '/employees',
      message: tf('setupMissingAvailability', {
        names: formatNameList(status.availability.missingNames, t('listAnd')),
      }),
    })
  }

  return problems
}

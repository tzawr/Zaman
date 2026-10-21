// What a linked employee is allowed to see of a schedule. A schedule document
// holds the whole team's week, and Firestore rules cannot hide fields, so an
// employee who may not see the full schedule must be handed a copy cut down on
// the server. This is that cut.

const DAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']

export function ownShiftsOnly(data, employeeName) {
  const days = {}
  for (const key of DAY_KEYS) {
    const day = data?.days?.[key]
    if (!day) continue
    days[key] = {
      date: day.date || '',
      shifts: (day.shifts || [])
        .filter(shift => shift?.employee === employeeName)
        .map(({ employee, start, end, role, hours }) => ({ employee, start, end, role: role || '', hours })),
    }
  }
  return { days }
}

// `content` is the same week again as raw JSON text, so it never leaves the
// server for an employee.
export function employeeScheduleView(schedule, { employeeName, fullView }) {
  return {
    id: schedule.id,
    weekStart: schedule.weekStart || '',
    data: fullView ? (schedule.data || { days: {} }) : ownShiftsOnly(schedule.data, employeeName),
  }
}

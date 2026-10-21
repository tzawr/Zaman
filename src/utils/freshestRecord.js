// Availability and time off can be written in two places: the manager edits the
// employee record, and a linked employee submits from their portal record. The
// newer of the two wins, field by field.

export function timestampMs(value) {
  if (!value) return 0
  if (typeof value.toMillis === 'function') return value.toMillis()
  if (typeof value.seconds === 'number') return value.seconds * 1000
  return 0
}

function hasValue(record, field) {
  if (!record?.[field]) return false
  if (Array.isArray(record[field])) return record[field].length > 0
  return Object.keys(record[field]).length > 0
}

export function freshestRecord(records, field, timestampField) {
  return records
    .filter(record => hasValue(record, field))
    .sort((a, b) => timestampMs(b[timestampField]) - timestampMs(a[timestampField]))[0]
}

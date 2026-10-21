// iCalendar (RFC 5545) for shifts: a subscription feed with every shift a
// person works, and a single shift to add to a calendar by hand. Times are
// written in UTC, which every calendar app converts to the viewer's zone.

const CRLF = '\r\n'

// Text values escape backslash, semicolon, comma and newline.
function escapeText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

// Lines longer than 75 octets are folded: a CRLF and a space before each
// continuation. Folding counts bytes, and never splits a UTF-8 character.
function fold(line) {
  const bytes = new TextEncoder().encode(line)
  if (bytes.length <= 75) return line
  const parts = []
  let current = ''
  let size = 0
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length
    const limit = parts.length ? 74 : 75
    if (size + n > limit) {
      parts.push(current)
      current = ''
      size = 0
    }
    current += ch
    size += n
  }
  parts.push(current)
  return parts.join(`${CRLF} `)
}

export function utcStamp(date) {
  return new Date(date).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

// events: [{ uid, start, end, summary, location?, description?, cancelled?, updatedAt? }]
export function buildCalendar({ name, events, now = new Date() }) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Hengam//Hengam Teams//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(name)}`,
    // How often a subscribed calendar should check back.
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ]
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${escapeText(e.uid)}`,
      `DTSTAMP:${utcStamp(e.updatedAt || now)}`,
      `DTSTART:${utcStamp(e.start)}`,
      `DTEND:${utcStamp(e.end)}`,
      `SUMMARY:${escapeText(e.summary)}`,
    )
    if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`)
    if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`)
    // A removed shift stays in the feed as cancelled for a while, so a
    // calendar that already has it takes it off rather than keeping it.
    lines.push(`STATUS:${e.cancelled ? 'CANCELLED' : 'CONFIRMED'}`, 'END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.map(fold).join(CRLF) + CRLF
}

// One shift as a calendar event.
export function shiftEvent(shift, { bizId, workplaceName }) {
  return {
    uid: `${bizId}-${shift.id}@teams.hengam.app`,
    start: shift.startAt,
    end: shift.endAt,
    summary: `${workplaceName}${shift.positionName ? ` · ${shift.positionName}` : ''}`,
    location: workplaceName,
    description: shift.notes || '',
    cancelled: shift.status === 'cancelled',
    updatedAt: shift.updatedAt,
  }
}

// A link that opens Google Calendar's new-event form filled in.
export function googleCalendarLink(event) {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.summary,
    dates: `${utcStamp(event.start)}/${utcStamp(event.end)}`,
    details: event.description || '',
    location: event.location || '',
  })
  return `https://calendar.google.com/calendar/render?${params}`
}

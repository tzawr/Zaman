// What each notification says, and the key that makes it unique. The key is
// the notification's document id, so the same event delivered twice (a
// retried request, a cron run that overlaps the last) is one notification.
//
// Messages are short enough for a lock screen and say what happened, to
// what, and when.

import { formatDateShort, formatShiftRange, formatWeekRange, relativeDay } from './time.js'
import { describeTimeOff } from './availability.js'

const shiftText = (s) => `${formatDateShort(s.date)}, ${formatShiftRange(s)}`

// Firestore document ids cannot contain slashes; everything else here is
// already id-safe.
const key = (...parts) => parts.join('_').replace(/\//g, '-').slice(0, 300)

export const messages = {
  schedulePublished: ({ bizId, businessName, weekStart, version, shiftCount }) => ({
    type: 'schedule_published',
    key: key('pub', bizId, weekStart, version),
    title: `${businessName}: schedule is out`,
    body: `${formatWeekRange(weekStart)}. You have ${shiftCount} ${shiftCount === 1 ? 'shift' : 'shifts'}.`,
    link: '/calendar',
  }),

  scheduleChanged: ({ bizId, businessName, weekStart, version }) => ({
    type: 'schedule_changed',
    key: key('chg', bizId, weekStart, version),
    title: `${businessName}: your schedule changed`,
    body: `Your shifts for ${formatWeekRange(weekStart)} were updated.`,
    link: '/calendar',
  }),

  shiftChanged: ({ bizId, businessName, shift }) => ({
    type: 'schedule_changed',
    key: key('shift', bizId, shift.id, shift.version),
    title: `${businessName}: shift ${shift.status === 'cancelled' ? 'removed' : 'changed'}`,
    body: shift.status === 'cancelled' ? `${shiftText(shift)} is no longer on your schedule.` : `Now ${shiftText(shift)}.`,
    link: shift.status === 'cancelled' ? '/calendar' : `/shift/${bizId}/${shift.id}`,
  }),

  shiftOffered: ({ bizId, businessName, offerId, offeredByName, shift }) => ({
    type: 'marketplace_shift',
    key: key('offer', bizId, offerId),
    title: `${businessName}: shift up for grabs`,
    body: `${offeredByName} is offering ${shiftText(shift)}.`,
    link: `/offer/${offerId}`,
  }),

  pickupRequested: ({ bizId, businessName, offerId, claimantUid, claimantName, offeredByName, shift }) => ({
    type: 'pickup_requested',
    key: key('claim', bizId, offerId, claimantUid),
    title: `${businessName}: pickup to approve`,
    body: `${claimantName} wants ${offeredByName}’s ${shiftText(shift)}.`,
    link: '/requests',
  }),

  pickupDecided: ({ bizId, businessName, offerId, approved, shift, forUid, role }) => ({
    type: 'pickup_decided',
    key: key('claimed', bizId, offerId, forUid),
    title: `${businessName}: ${role === 'offerer' ? 'your shift was picked up' : approved ? 'shift is yours' : 'pickup not approved'}`,
    body: role === 'offerer' ? `${shiftText(shift)} is off your schedule.`
      : approved ? `${shiftText(shift)} is on your schedule.`
        : role === 'superseded' ? `${shiftText(shift)} went to someone else.` : `You won’t be working ${shiftText(shift)}.`,
    link: role === 'offerer' || !approved ? '/requests' : '/calendar',
  }),

  swapRequested: ({ bizId, businessName, swapId, requesterName, give, get }) => ({
    type: 'swap_requested',
    key: key('swap', bizId, swapId),
    title: `${businessName}: ${requesterName} wants to swap`,
    body: `Your ${shiftText(get)} for their ${shiftText(give)}.`,
    link: '/requests',
  }),

  swapNeedsApproval: ({ bizId, businessName, swapId, requesterName, counterpartyName }) => ({
    type: 'swap_requested',
    key: key('swapok', bizId, swapId),
    title: `${businessName}: swap to approve`,
    body: `${requesterName} and ${counterpartyName} agreed to swap shifts.`,
    link: '/requests',
  }),

  swapDecided: ({ bizId, businessName, swapId, status, forUid }) => ({
    type: 'swap_decided',
    key: key('swapped', bizId, swapId, forUid),
    title: `${businessName}: swap ${{ completed: 'done', declined: 'declined', rejected: 'not approved', cancelled: 'cancelled' }[status] || status}`,
    body: status === 'completed' ? 'Both schedules are updated.' : 'Your shifts stay as they were.',
    link: status === 'completed' ? '/calendar' : '/requests',
  }),

  timeOffRequested: ({ bizId, businessName, request }) => ({
    type: 'time_off_requested',
    key: key('tor', bizId, request.id),
    title: `${businessName}: time off to approve`,
    body: `${request.staffName}: ${describeTimeOff(request)}.`,
    link: '/requests',
  }),

  timeOffDecided: ({ bizId, businessName, request, approved }) => ({
    type: 'time_off_decided',
    key: key('tod', bizId, request.id),
    title: `${businessName}: time off ${approved ? 'approved' : 'declined'}`,
    body: `${describeTimeOff(request)}.${request.managerNote ? ` “${request.managerNote}”` : ''}`,
    link: '/requests',
  }),

  shiftReminder: ({ bizId, businessName, shift, today }) => ({
    type: 'shift_reminder',
    key: key('rem', bizId, shift.id, shift.version),
    title: `${relativeDay(shift.date, today)} at ${businessName}`,
    body: `${formatShiftRange(shift)}${shift.positionName ? ` · ${shift.positionName}` : ''}.`,
    link: `/shift/${bizId}/${shift.id}`,
  }),
}

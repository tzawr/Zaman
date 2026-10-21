import { useEffect, useState } from 'react'
import { View } from 'react-native'
import OfferCard from '../../components/OfferCard'
import SwapCard from '../../components/SwapCard'
import TimeOffCard from '../../components/TimeOffCard'
import WorkplaceHeader from '../../components/WorkplaceHeader'
import { ApiError, callTeams } from '../../lib/api'
import { useAuth } from '../../state/auth'
import { useMyTimeOff, usePendingTimeOff, usePolicies } from '../../state/availability'
import { useApprovals, useMySwaps, useOpenOffers, usePendingClaims } from '../../state/market'
import { useRouter } from 'expo-router'
import { useToday } from '../../state/shifts'
import { useWorkspace } from '../../state/workspace'
import { formatDuration, formatShiftRange, relativeDay } from '../../../../shared/teams/time'
import {
  Banner, Button, Card, Divider, EmptyState, Screen, SectionTitle, SkeletonCard, Text,
} from '../../ui/components'

export default function Requests() {
  const today = useToday()
  const { user } = useAuth()
  const { activeId, isManager } = useWorkspace()
  const swaps = useMySwaps()
  const approvals = useApprovals()
  const offers = useOpenOffers()
  const router = useRouter()
  const policies = usePolicies()
  const myTimeOff = useMyTimeOff()
  const pendingTimeOff = usePendingTimeOff()
  const [notice, setNotice] = useState(null)
  const [busy, setBusy] = useState(null)

  async function act(id, action, body, success) {
    setBusy(id)
    setNotice(null)
    try {
      const result = await callTeams(action, { bizId: activeId, ...body })
      const message = typeof success === 'function' ? success(result) : success
      setNotice({ tone: result.message ? 'warning' : 'success', message: result.message || message })
    } catch (err) {
      setNotice({ tone: 'danger', message: err instanceof ApiError ? err.message : 'That did not work. Try again.' })
    } finally {
      setBusy(null)
    }
  }

  const loading = swaps.loading || approvals.loading || offers.items === null || myTimeOff.items === null || pendingTimeOff.items === null
  const myOffers = (offers.items || []).filter(o => o.offeredByUid === user?.uid)
  const myClaims = (offers.items || []).filter(o => o.claimantUids?.includes(user?.uid))
  const myOpenTimeOff = (myTimeOff.items || []).filter(r => r.status === 'pending' || (r.status === 'approved' && r.endDate >= today))
  const myPastTimeOff = (myTimeOff.items || []).filter(r => !myOpenTimeOff.includes(r)).slice(0, 5)
  const pendingForMe = isManager ? (pendingTimeOff.items || []) : []
  const nothing = !loading && !swaps.incoming.length && !swaps.outgoing.length && !myOffers.length
    && !myClaims.length && !approvals.offers.length && !approvals.swaps.length && !pendingForMe.length
    && !myOpenTimeOff.length && !myPastTimeOff.length && !swaps.history.length

  return (
    <View style={{ flex: 1 }}>
      <WorkplaceHeader title="Requests" />
      <Screen>
        <Banner tone={notice?.tone} message={notice?.message} />
        <Banner message={swaps.error || approvals.error || offers.error || myTimeOff.error} />
        <Button title="Request time off" icon="sun" variant="secondary" onPress={() => router.push('/timeoff-new')} />
        {loading ? <><SkeletonCard lines={2} /><SkeletonCard lines={2} /></> : null}

        {swaps.incoming.length ? <SectionTitle>Needs your answer</SectionTitle> : null}
        {swaps.incoming.map(s => (
          <SwapCard key={s.id} swap={s} today={today}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button title="Accept" style={{ flex: 1 }} loading={busy === `${s.id}:yes`} disabled={Boolean(busy)}
                onPress={() => act(`${s.id}:yes`, 'respondSwap', { swapId: s.id, accept: true },
                  s.requiresApproval ? 'Accepted. Your manager will approve it.' : 'Swapped. Both schedules are updated.')} />
              <Button title="Decline" variant="secondary" style={{ flex: 1 }} loading={busy === `${s.id}:no`} disabled={Boolean(busy)}
                onPress={() => act(`${s.id}:no`, 'respondSwap', { swapId: s.id, accept: false }, 'Declined.')} />
            </View>
          </SwapCard>
        ))}

        {isManager && (approvals.offers.length || approvals.swaps.length || pendingForMe.length) ? <SectionTitle>Needs your approval</SectionTitle> : null}
        {pendingForMe.map(r => (
          <TimeOffCard key={r.id} request={r} labels={policies?.labels} showName>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button title="Approve" style={{ flex: 1 }} loading={busy === `${r.id}:yes`} disabled={Boolean(busy)}
                onPress={() => act(`${r.id}:yes`, 'decideTimeOff', { timeOffId: r.id, approve: true }, (res) => res.clashingShifts?.length
                  ? `Approved. ${r.staffName} still has ${res.clashingShifts.length} ${res.clashingShifts.length === 1 ? 'shift' : 'shifts'} in that time; reassign ${res.clashingShifts.length === 1 ? 'it' : 'them'} from Manage.`
                  : 'Time off approved.')} />
              <Button title="Decline" variant="secondary" style={{ flex: 1 }} loading={busy === `${r.id}:no`} disabled={Boolean(busy)}
                onPress={() => act(`${r.id}:no`, 'decideTimeOff', { timeOffId: r.id, approve: false }, 'Time off declined.')} />
            </View>
          </TimeOffCard>
        ))}
        {isManager ? approvals.offers.map(o => (
          <PickupApproval key={o.id} offer={o} today={today} busy={busy} onAct={act} />
        )) : null}
        {isManager ? approvals.swaps.map(s => (
          <SwapCard key={s.id} swap={s} today={today}>
            <Text variant="caption" tone="muted">Both agreed. Approving swaps the two shifts together.</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button title="Approve" style={{ flex: 1 }} loading={busy === `${s.id}:yes`} disabled={Boolean(busy)}
                onPress={() => act(`${s.id}:yes`, 'decideSwap', { swapId: s.id, approve: true }, 'Swap approved.')} />
              <Button title="Reject" variant="danger" style={{ flex: 1 }} loading={busy === `${s.id}:no`} disabled={Boolean(busy)}
                onPress={() => act(`${s.id}:no`, 'decideSwap', { swapId: s.id, approve: false }, 'Swap rejected.')} />
            </View>
          </SwapCard>
        )) : null}

        {swaps.outgoing.length || myOffers.length || myClaims.length || myOpenTimeOff.length ? <SectionTitle>Your requests</SectionTitle> : null}
        {myOpenTimeOff.map(r => (
          <TimeOffCard key={r.id} request={r} labels={policies?.labels}>
            {r.status === 'pending' || r.startDate > today ? (
              <Button title={r.status === 'pending' ? 'Withdraw request' : 'Cancel time off'} variant="secondary"
                loading={busy === r.id} disabled={Boolean(busy)}
                onPress={() => act(r.id, 'cancelTimeOff', { timeOffId: r.id }, 'Cancelled.')} />
            ) : null}
          </TimeOffCard>
        ))}
        {swaps.outgoing.map(s => (
          <SwapCard key={s.id} swap={s} today={today}>
            {s.requesterUid === user?.uid ? (
              <Button title="Cancel swap request" variant="secondary" loading={busy === s.id} disabled={Boolean(busy)}
                onPress={() => act(s.id, 'cancelSwap', { swapId: s.id }, 'Swap request cancelled.')} />
            ) : null}
          </SwapCard>
        ))}
        {[...myOffers, ...myClaims].map(o => <OfferCard key={o.id} offer={o} today={today} />)}

        {swaps.history.length || myPastTimeOff.length ? <SectionTitle>Recent</SectionTitle> : null}
        {swaps.history.map(s => <SwapCard key={s.id} swap={s} today={today} />)}
        {myPastTimeOff.map(r => <TimeOffCard key={r.id} request={r} labels={policies?.labels} />)}

        {nothing ? (
          <EmptyState icon="inbox" title="No requests"
            message="Time off, shift offers, pickups and swaps you are part of show up here." />
        ) : null}
      </Screen>
    </View>
  )
}

// One offered shift with everyone who asked for it. Each claimant is checked
// against their schedule now, so the manager sees a problem before approving.
function PickupApproval({ offer, today, busy, onAct }) {
  const { activeId } = useWorkspace()
  const claims = usePendingClaims(offer.id)
  const s = offer.shift
  return (
    <Card>
      <Text variant="label">{offer.offeredByName} is giving away a shift</Text>
      <Text>{relativeDay(s.date, today)} · {formatShiftRange(s)} · {formatDuration(s.minutes)}{s.positionName ? ` · ${s.positionName}` : ''}</Text>
      {claims.items === null ? <Text tone="muted">Loading requests…</Text> : claims.items.map(c => (
        <View key={c.id} style={{ gap: 8 }}>
          <Divider />
          <Claimant bizId={activeId} offerId={offer.id} claim={c} busy={busy} onAct={onAct} />
        </View>
      ))}
    </Card>
  )
}

function Claimant({ bizId, offerId, claim, busy, onAct }) {
  const [check, setCheck] = useState(null)
  const key = `${offerId}:${claim.id}`
  useEffect(() => {
    let live = true
    callTeams('previewClaim', { bizId, offerId, claimantUid: claim.id })
      .then(v => { if (live) setCheck(v) })
      .catch(() => { if (live) setCheck(null) })
    return () => { live = false }
  }, [bizId, offerId, claim.id])
  return (
    <>
      <Text>{claim.name} wants it{claim.note ? `: “${claim.note}”` : '.'}</Text>
      {check && !check.ok ? <Banner tone="warning" message={check.problems.map(p => p.message).join(' ')} /> : null}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button title={`Give to ${claim.name}`} style={{ flex: 1 }} loading={busy === `${key}:yes`} disabled={Boolean(busy) || (check && !check.ok)}
          onPress={() => onAct(`${key}:yes`, 'decideClaim', { offerId, claimantUid: claim.id, approve: true }, `Shift given to ${claim.name}.`)} />
        <Button title="Decline" variant="secondary" style={{ flex: 1 }} loading={busy === `${key}:no`} disabled={Boolean(busy)}
          onPress={() => onAct(`${key}:no`, 'decideClaim', { offerId, claimantUid: claim.id, approve: false }, 'Request declined.')} />
      </View>
    </>
  )
}

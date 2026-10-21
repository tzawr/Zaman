import { useEffect, useState } from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { View } from 'react-native'
import { doc, onSnapshot } from 'firebase/firestore'
import { Feather } from '@expo/vector-icons'
import { ApiError, callTeams } from '../../lib/api'
import { db } from '../../lib/firebase'
import { closeModal } from '../../lib/next'
import { useAuth } from '../../state/auth'
import { useWorkspace } from '../../state/workspace'
import { formatDateLong, formatDuration, formatShiftRange } from '../../../../shared/teams/time'
import { Badge, Banner, Button, Card, Screen, SkeletonCard, Text, TextField } from '../../ui/components'
import { useTheme } from '../../ui/theme'

export default function OfferDetail() {
  const router = useRouter()
  const t = useTheme()
  const offerId = String(useLocalSearchParams().offerId)
  const { activeId } = useWorkspace()
  const { user } = useAuth()
  const [state, setState] = useState({ key: null, offer: undefined })
  const [eligibility, setEligibility] = useState({ key: null, value: null })
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(null)
  const key = `${activeId}/${offerId}`

  useEffect(() => {
    if (!activeId) return undefined
    return onSnapshot(doc(db, 'businesses', activeId, 'offers', offerId),
      (snap) => setState({ key, offer: snap.exists() ? snap.data() : null }),
      () => setState({ key, offer: null }))
  }, [activeId, offerId, key])

  const offer = state.key === key ? state.offer : undefined
  const mine = offer?.offeredByUid === user?.uid
  const asked = offer?.claimantUids?.includes(user?.uid)
  const open = offer && ['available', 'pending'].includes(offer.status)

  // Whether this person could take it, asked of the server before they tap.
  useEffect(() => {
    if (!open || mine || asked || !activeId) return undefined
    let live = true
    callTeams('previewClaim', { bizId: activeId, offerId })
      .then(v => { if (live) setEligibility({ key, value: v }) })
      .catch(() => { if (live) setEligibility({ key, value: { ok: true, problems: [] } }) })
    return () => { live = false }
  }, [open, mine, asked, activeId, offerId, key])
  const eligible = eligibility.key === key ? eligibility.value : null

  async function run(action, body, success) {
    setBusy(true)
    setError(null)
    try {
      const result = await callTeams(action, { bizId: activeId, offerId, ...body })
      setDone(success(result))
    } catch (err) {
      setError(err instanceof ApiError ? { message: err.message } : { message: 'That did not work. Try again.' })
    } finally {
      setBusy(false)
    }
  }

  if (offer === undefined) return <Screen><SkeletonCard lines={3} /></Screen>
  if (!offer) return <Screen><Banner tone="info" message="This offer no longer exists." /></Screen>
  const s = offer.shift

  return (
    <Screen>
      <Card>
        <Text variant="label" tone="muted">{formatDateLong(s.date)}</Text>
        <Text variant="title">{formatShiftRange(s)}</Text>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Badge label={formatDuration(s.minutes)} tone="accent" />
          {s.positionName ? <Badge label={s.positionName} tone="neutral" /> : null}
          <Badge label={offer.requiresApproval ? 'Manager approves' : 'Instant'} tone="neutral" />
        </View>
        <Text tone="muted">Offered by {mine ? 'you' : offer.offeredByName}.</Text>
        {offer.note ? <Text>“{offer.note}”</Text> : null}
      </Card>

      <Banner tone="success" message={done} />
      <Banner message={error?.message} />

      {!open ? (
        <Banner tone="info" message={offer.status === 'completed'
          ? `${offer.takenByUid === user?.uid ? 'You' : offer.takenByName} picked up this shift.`
          : 'This offer is closed.'} />
      ) : mine ? (
        <>
          <Text tone="muted">
            {offer.claimantUids?.length
              ? `${offer.claimantUids.length} ${offer.claimantUids.length === 1 ? 'person has' : 'people have'} asked for it. Your manager decides who gets it.`
              : 'Nobody has asked for it yet. It stays yours until someone picks it up.'}
          </Text>
          <Button title="Take it off the marketplace" variant="danger" loading={busy}
            onPress={() => run('cancelOffer', {}, () => { closeModal(router); return null })} />
        </>
      ) : asked ? (
        <>
          <Banner tone="info" message="You asked for this shift. Your manager will decide." />
          <Button title="Withdraw my request" variant="secondary" loading={busy}
            onPress={() => run('withdrawClaim', {}, () => 'Request withdrawn.')} />
        </>
      ) : eligible === null ? (
        <Card accessibilityLabel="Checking whether you can take this shift"><Text tone="muted">Checking your schedule…</Text></Card>
      ) : eligible.ok ? (
        <>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <Feather name="check-circle" size={18} color={t.color.success} />
            <Text style={{ color: t.color.success }}>This fits your schedule.</Text>
          </View>
          <TextField label="Note to your manager (optional)" value={note} onChangeText={setNote} />
          <Button title={offer.requiresApproval ? 'Ask for this shift' : 'Pick up this shift'} loading={busy}
            onPress={() => run('claimOffer', { note }, r => r.status === 'approved'
              ? 'It’s yours. It is on your schedule now.'
              : null)} />
        </>
      ) : (
        <Card>
          <Text variant="label">You can’t take this shift</Text>
          {eligible.problems.map((p, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
              <Feather name="x-circle" size={16} color={t.color.danger} style={{ marginTop: 2 }} />
              <Text style={{ flex: 1 }}>{p.message}</Text>
            </View>
          ))}
        </Card>
      )}
    </Screen>
  )
}

import { useState } from 'react'
import { Pressable, Switch, View } from 'react-native'
import { ApiError, callTeams } from '../lib/api'
import { usePolicies } from '../state/availability'
import { useWorkspace } from '../state/workspace'
import { TIME_OFF_CATEGORIES } from '../../../shared/teams/schema'
import { TIME_OFF_LABELS } from '../../../shared/teams/availability'
import { Banner, Button, Card, Divider, SectionTitle, SkeletonCard, Text, TextField } from '../ui/components'
import { useTheme } from '../ui/theme'

const TOGGLES = [
  ['pickupRequiresApproval', 'Approve shift pickups', 'Off: the first eligible person to ask gets the shift.'],
  ['swapRequiresApproval', 'Approve swaps', 'Off: a swap happens as soon as the other person accepts.'],
  ['employeeFullView', 'Show everyone the full schedule', 'Off: each person sees only their own shifts.'],
  ['employeesCanSubmitAvailability', 'Let people set their own availability', 'Off: only managers change it.'],
]
const LIMITS = [
  ['maxHoursPerWeek', 'Most hours per week', 'Blank for no limit.'],
  ['maxHoursPerDay', 'Most hours per day', 'Blank for no limit.'],
  ['minRestHours', 'Least rest between shifts (hours)', 'Blank for no minimum.'],
  ['offerCutoffHours', 'Stop trades this many hours before a shift', '0 to allow trades until it starts.'],
]

// The business's own rules for trading shifts, schedule visibility, hour
// limits and time off. The app does not know the law where the business
// operates, so the limits are whatever the business sets.
export default function PoliciesEditor() {
  const policies = usePolicies()
  const { activeId } = useWorkspace()
  if (!policies) return <SkeletonCard lines={4} />
  // Keyed by workplace only: a save must not reset the form and lose its
  // confirmation.
  return <Form key={activeId} policies={policies} />
}

function Form({ policies }) {
  const t = useTheme()
  const { activeId } = useWorkspace()
  const [toggles, setToggles] = useState(() => Object.fromEntries(TOGGLES.map(([k]) => [k, Boolean(policies[k])])))
  const [limits, setLimits] = useState(() => Object.fromEntries(LIMITS.map(([k]) => [k, policies[k] == null ? '' : String(policies[k])])))
  const [builtIns, setBuiltIns] = useState(() => TIME_OFF_CATEGORIES.filter(id => policies.timeOffCategories.includes(id)))
  const [custom, setCustom] = useState(() => (policies.customTimeOffCategories || []).map(c => c.label))
  const [newCategory, setNewCategory] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)

  async function save() {
    setBusy(true)
    setNotice(null)
    try {
      await callTeams('updatePolicies', {
        bizId: activeId, ...toggles, ...limits,
        builtInTimeOffCategories: builtIns,
        customTimeOffCategories: custom.map(label => ({ label })),
      })
      setNotice({ tone: 'success', message: 'Saved. These apply to every new request.' })
    } catch (err) {
      setNotice({ tone: 'danger', message: err instanceof ApiError ? err.message : 'Could not save.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <SectionTitle>Trading and visibility</SectionTitle>
      <Card style={{ paddingVertical: 4 }}>
        {TOGGLES.map(([key, label, hint], i) => (
          <View key={key}>
            {i > 0 ? <Divider /> : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text>{label}</Text>
                <Text variant="caption" tone="muted">{hint}</Text>
              </View>
              <Switch value={toggles[key]} onValueChange={(v) => setToggles(s => ({ ...s, [key]: v }))}
                accessibilityLabel={label} trackColor={{ true: t.color.accent }} />
            </View>
          </View>
        ))}
      </Card>

      <SectionTitle>Limits</SectionTitle>
      <Text variant="caption" tone="muted">
        Checked whenever someone picks up or swaps a shift. Hengam Teams does not know the labor rules where you operate; set the limits that apply to you.
      </Text>
      {LIMITS.map(([key, label, hint]) => (
        <TextField key={key} label={label} hint={hint} value={limits[key]} keyboardType="number-pad"
          onChangeText={(v) => setLimits(s => ({ ...s, [key]: v.replace(/[^0-9.]/g, '') }))} />
      ))}

      <SectionTitle>Kinds of time off</SectionTitle>
      <Card style={{ gap: 8 }}>
        {TIME_OFF_CATEGORIES.map(id => (
          <View key={id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text>{TIME_OFF_LABELS[id]}</Text>
            <Switch value={builtIns.includes(id)} accessibilityLabel={`Offer ${TIME_OFF_LABELS[id]} time off`} trackColor={{ true: t.color.accent }}
              onValueChange={(v) => setBuiltIns(list => (v ? [...list, id] : list.filter(x => x !== id)))} />
          </View>
        ))}
        {custom.map(label => (
          <View key={label} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text>{label}</Text>
            <Pressable onPress={() => setCustom(list => list.filter(x => x !== label))} accessibilityRole="button"
              accessibilityLabel={`Remove ${label}`} hitSlop={8}>
              <Text tone="danger">Remove</Text>
            </Pressable>
          </View>
        ))}
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
          <TextField style={{ flex: 1 }} label="Add your own" value={newCategory} onChangeText={setNewCategory} placeholder="Jury duty" />
          <Button title="Add" variant="secondary" style={{ minHeight: 50 }} disabled={!newCategory.trim()}
            onPress={() => { setCustom(list => [...new Set([...list, newCategory.trim()])]); setNewCategory('') }} />
        </View>
      </Card>

      <Banner tone={notice?.tone} message={notice?.message} />
      <Button title="Save settings" loading={busy} onPress={save} />
    </>
  )
}

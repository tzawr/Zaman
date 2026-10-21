import { useEffect, useState } from 'react'
import { Linking, Platform } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { ApiError, callTeams } from '../lib/api'
import { Banner, Button, Card, Screen, SkeletonCard, Text } from '../ui/components'

// Subscribing to a personal feed keeps every shift, from every workplace, in
// the person's own calendar app, updated as schedules change.
export default function CalendarSync() {
  const [url, setUrl] = useState(null)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [busy, setBusy] = useState(false)
  const [confirmRotate, setConfirmRotate] = useState(false)

  useEffect(() => {
    let live = true
    callTeams('calendarFeed')
      .then(r => { if (live) setUrl(r.url) })
      .catch(err => { if (live) setError(err instanceof ApiError ? err.message : 'Could not load your calendar link.') })
    return () => { live = false }
  }, [])

  const webcal = url?.replace(/^https?:/, 'webcal:')

  async function open(target) {
    try {
      await Linking.openURL(target)
    } catch {
      setNotice({ tone: 'warning', message: 'Could not open your calendar app. Copy the link and add it as a subscribed calendar instead.' })
    }
  }

  async function rotate() {
    setBusy(true)
    try {
      const r = await callTeams('calendarFeed', { rotate: true })
      setUrl(r.url)
      setConfirmRotate(false)
      setNotice({ tone: 'success', message: 'New link made. The old one stopped working; subscribe again with this one.' })
    } catch (err) {
      setNotice({ tone: 'danger', message: err instanceof ApiError ? err.message : 'Could not make a new link.' })
    } finally {
      setBusy(false)
    }
  }

  if (!url && !error) return <Screen><SkeletonCard lines={3} /></Screen>
  return (
    <Screen>
      <Banner message={error} />
      {url ? (
        <>
          <Text tone="muted">
            Add your shifts from every workplace to the calendar you already use. Changes show up there on their own, usually within an hour.
          </Text>
          <Button title="Add to Apple Calendar" icon="calendar" onPress={() => open(webcal)} />
          <Button title="Add to Google Calendar" icon="calendar" variant="secondary"
            onPress={() => open(`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`)} />
          <Button title="Copy link" icon="copy" variant="secondary" onPress={async () => {
            await Clipboard.setStringAsync(url)
            setNotice({ tone: 'success', message: 'Link copied. In Outlook or another app, add it as a calendar from the internet.' })
          }} />
          {Platform.OS === 'web' ? (
            <Button title="Download shifts (.ics)" icon="download" variant="ghost" onPress={() => open(url)} />
          ) : null}
          <Banner tone={notice?.tone} message={notice?.message} />
          <Card>
            <Text variant="label">Keep this link private</Text>
            <Text tone="muted">Anyone with it can see your shifts. If you shared it by mistake, make a new one; the old link stops working.</Text>
            {confirmRotate ? (
              <>
                <Button title="Make a new link" variant="danger" loading={busy} onPress={rotate} />
                <Button title="Keep this one" variant="ghost" onPress={() => setConfirmRotate(false)} />
              </>
            ) : (
              <Button title="Make a new link" variant="ghost" onPress={() => setConfirmRotate(true)} />
            )}
          </Card>
        </>
      ) : null}
    </Screen>
  )
}

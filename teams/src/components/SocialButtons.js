import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { appleAvailable, googleAvailable, signInWithApple, signInWithGoogle } from '../lib/socialSignIn'
import { authErrorMessage, isCancellation } from '../lib/authErrors'
import { Banner, Button } from '../ui/components'

// Continue with Google / Apple, offered only where the platform and the
// project's configuration actually support them.
export default function SocialButtons({ onSignedIn }) {
  const [apple, setApple] = useState(false)
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    appleAvailable().then(ok => { if (live) setApple(Boolean(ok)) }).catch(() => {})
    return () => { live = false }
  }, [])

  async function run(provider, fn) {
    setError('')
    setBusy(provider)
    try {
      await fn()
      onSignedIn?.()
    } catch (err) {
      if (!isCancellation(err)) setError(authErrorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  if (!googleAvailable && !apple) return null
  return (
    <View style={{ gap: 10 }}>
      {apple ? (
        <Button title="Continue with Apple" icon="smartphone" variant="secondary"
          loading={busy === 'apple'} disabled={Boolean(busy)} onPress={() => run('apple', signInWithApple)} />
      ) : null}
      {googleAvailable ? (
        <Button title="Continue with Google" icon="globe" variant="secondary"
          loading={busy === 'google'} disabled={Boolean(busy)} onPress={() => run('google', signInWithGoogle)} />
      ) : null}
      <Banner message={error} />
    </View>
  )
}

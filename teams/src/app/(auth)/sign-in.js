import { useRef, useState } from 'react'
import { Link, useLocalSearchParams, useRouter } from 'expo-router'
import { View } from 'react-native'
import SocialButtons from '../../components/SocialButtons'
import { authErrorMessage } from '../../lib/authErrors'
import { safeNext } from '../../lib/next'
import { useAuth } from '../../state/auth'
import { Banner, Button, Screen, Text, TextField } from '../../ui/components'

export default function SignIn() {
  const router = useRouter()
  const next = safeNext(useLocalSearchParams().next)
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const passwordRef = useRef(null)

  const done = () => router.replace(next || '/')

  async function submit() {
    setError('')
    if (!email.trim() || !password) {
      setError('Enter your email and password.')
      return
    }
    setBusy(true)
    try {
      await signIn({ email, password })
      done()
    } catch (err) {
      setError(authErrorMessage(err))
      setBusy(false)
    }
  }

  return (
    <Screen contentStyle={{ gap: 20 }}>
      <Text variant="title" accessibilityRole="header">Welcome back</Text>
      <View style={{ gap: 14 }}>
        <TextField label="Email" value={email} onChangeText={setEmail} autoCapitalize="none"
          autoComplete="email" keyboardType="email-address" textContentType="emailAddress"
          returnKeyType="next" onSubmitEditing={() => passwordRef.current?.focus()} />
        <TextField ref={passwordRef} label="Password" value={password} onChangeText={setPassword}
          secureTextEntry autoComplete="current-password" textContentType="password"
          returnKeyType="go" onSubmitEditing={submit} />
        <Banner message={error} />
        <Button title="Sign in" loading={busy} onPress={submit} />
        <Link href="/forgot-password" asChild>
          <Button title="Forgot your password?" variant="ghost" />
        </Link>
      </View>
      <SocialButtons onSignedIn={done} />
      <Link href={{ pathname: '/sign-up', params: next ? { next } : {} }} replace asChild>
        <Button title="New here? Create an account" variant="ghost" />
      </Link>
    </Screen>
  )
}

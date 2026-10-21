import { useRef, useState } from 'react'
import { Link, useLocalSearchParams, useRouter } from 'expo-router'
import { View } from 'react-native'
import SocialButtons from '../../components/SocialButtons'
import { authErrorMessage } from '../../lib/authErrors'
import { safeNext } from '../../lib/next'
import { useAuth } from '../../state/auth'
import { Banner, Button, Screen, Text, TextField } from '../../ui/components'

const MIN_PASSWORD = 8

export default function SignUp() {
  const router = useRouter()
  const next = safeNext(useLocalSearchParams().next)
  const { signUp } = useAuth()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const emailRef = useRef(null)
  const passwordRef = useRef(null)

  const done = () => router.replace(next || '/')

  async function submit() {
    setError('')
    const problems = {}
    if (!name.trim()) problems.name = 'Enter your name so your team knows who you are.'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) problems.email = 'Enter a valid email address.'
    if (password.length < MIN_PASSWORD) problems.password = `Use at least ${MIN_PASSWORD} characters.`
    setFieldErrors(problems)
    if (Object.keys(problems).length) return
    setBusy(true)
    try {
      await signUp({ name, email, password })
      done()
    } catch (err) {
      setError(authErrorMessage(err))
      setBusy(false)
    }
  }

  return (
    <Screen contentStyle={{ gap: 20 }}>
      <View style={{ gap: 6 }}>
        <Text variant="title" accessibilityRole="header">Create your account</Text>
        <Text tone="muted">One account works for every workplace, and for Hengam.</Text>
      </View>
      <View style={{ gap: 14 }}>
        <TextField label="Your name" value={name} onChangeText={setName} autoComplete="name"
          textContentType="name" error={fieldErrors.name} returnKeyType="next"
          onSubmitEditing={() => emailRef.current?.focus()} />
        <TextField ref={emailRef} label="Email" value={email} onChangeText={setEmail} autoCapitalize="none"
          autoComplete="email" keyboardType="email-address" textContentType="emailAddress"
          error={fieldErrors.email} returnKeyType="next" onSubmitEditing={() => passwordRef.current?.focus()} />
        <TextField ref={passwordRef} label="Password" value={password} onChangeText={setPassword}
          secureTextEntry autoComplete="new-password" textContentType="newPassword"
          hint={`At least ${MIN_PASSWORD} characters.`} error={fieldErrors.password}
          returnKeyType="go" onSubmitEditing={submit} />
        <Banner message={error} />
        <Button title="Create account" loading={busy} onPress={submit} />
      </View>
      <SocialButtons onSignedIn={done} />
      <Link href={{ pathname: '/sign-in', params: next ? { next } : {} }} replace asChild>
        <Button title="Already have an account? Sign in" variant="ghost" />
      </Link>
    </Screen>
  )
}

import { useEffect } from 'react'
import { Platform } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import Constants from 'expo-constants'
import * as Crypto from 'expo-crypto'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import { useRouter } from 'expo-router'
import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore'
import { callTeams } from './api'
import { db } from './firebase'

// Push on iOS and Android through Expo's push service. A device registers
// its Expo push token under users/{uid}/devices; the server sends to every
// device there and forgets ones that have been uninstalled. Signing out
// removes this phone's entry, so a shared phone stops getting the last
// person's notifications.

export const pushSupported = true

// Shown while the app is open, too: the banner is how people notice.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
})

const projectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID || Constants.expoConfig?.extra?.eas?.projectId

// The device entry this phone registered for each account, and its token,
// so signing out can remove it without asking Expo for the token again.
const registeredKey = (uid) => `hengam-teams-push-device:${uid}`
// Removals that could not reach the server at sign-out, retried later.
const PENDING_KEY = 'hengam-teams-push-forget'

async function readRegistration(uid) {
  const raw = await AsyncStorage.getItem(registeredKey(uid))
  try {
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

// On only when this phone is registered for this account: the permission
// alone may have been given by someone who signed in here before.
export async function pushStatus(uid) {
  if (!Device.isDevice || !projectId) return 'unsupported'
  const { granted, canAskAgain } = await Notifications.getPermissionsAsync()
  if (!granted) return canAskAgain ? 'off' : 'blocked'
  return uid && (await AsyncStorage.getItem(registeredKey(uid))) ? 'on' : 'off'
}

export async function enablePush(uid) {
  if (!Device.isDevice) return { ok: false, reason: 'simulator' }
  if (!projectId) return { ok: false, reason: 'unconfigured' }
  // Android 13+ shows the permission prompt only once a channel exists.
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      // AndroidImportance is re-exported two modules deep, past what the
      // import lint rule follows.
      // eslint-disable-next-line import/namespace
      name: 'Shifts and requests', importance: Notifications.AndroidImportance.DEFAULT,
    })
  }
  const current = await Notifications.getPermissionsAsync()
  const result = current.granted ? current : await Notifications.requestPermissionsAsync()
  if (!result.granted) return { ok: false, reason: 'denied' }
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId })
  const id = (await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, token)).slice(0, 32)
  await setDoc(doc(db, 'users', uid, 'devices', id), {
    platform: Platform.OS, token, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  })
  await AsyncStorage.setItem(registeredKey(uid), JSON.stringify({ id, token }))
  return { ok: true }
}

// Called before signing out, while the account can still delete its own
// device entry. Gives up after a few seconds so signing out never hangs
// offline; the removal is then queued and sent the next time the app opens.
export async function forgetDevice(uid) {
  const registration = await readRegistration(uid)
  if (!registration) return
  await AsyncStorage.removeItem(registeredKey(uid))
  try {
    await Promise.race([
      deleteDoc(doc(db, 'users', uid, 'devices', registration.id)),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), 4000)),
    ])
  } catch {
    // Entries from before the token was kept with the id cannot be retried.
    if (!registration.token) return
    const pending = JSON.parse((await AsyncStorage.getItem(PENDING_KEY)) || '[]')
    pending.push({ uid, token: registration.token })
    await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(pending.slice(-10)))
  }
}

// Sends any removal queued by an offline sign-out. The server checks the
// token, which only this phone has, since nobody may be signed in by then.
export async function retryForgottenDevices() {
  const pending = JSON.parse((await AsyncStorage.getItem(PENDING_KEY)) || '[]')
  if (!pending.length) return
  const left = []
  for (const entry of pending) {
    try {
      await callTeams('forgetDevice', entry, { signedIn: false })
    } catch {
      left.push(entry)
    }
  }
  await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(left))
}

// Tapping a notification opens the screen it is about.
export function usePushNavigation() {
  const router = useRouter()
  const response = Notifications.useLastNotificationResponse()
  useEffect(() => {
    const link = response?.notification?.request?.content?.data?.link
    if (typeof link === 'string' && link.startsWith('/')) {
      router.push(link)
      Notifications.clearLastNotificationResponseAsync().catch(() => {})
    }
  }, [response, router])
}

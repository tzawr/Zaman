import { useEffect } from 'react'
import { Platform } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import Constants from 'expo-constants'
import * as Crypto from 'expo-crypto'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import { useRouter } from 'expo-router'
import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore'
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

// The device entry this phone registered for each account, so signing out
// can remove it without asking Expo for the token again.
const registeredKey = (uid) => `hengam-teams-push-device:${uid}`

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
  await AsyncStorage.setItem(registeredKey(uid), id)
  return { ok: true }
}

// Called before signing out, while the account can still delete its own
// device entry. Gives up after a few seconds so signing out never hangs
// offline; the entry then stays until the app is uninstalled.
export async function forgetDevice(uid) {
  const id = await AsyncStorage.getItem(registeredKey(uid))
  if (!id) return
  await Promise.race([
    deleteDoc(doc(db, 'users', uid, 'devices', id)),
    new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), 4000)),
  ])
  await AsyncStorage.removeItem(registeredKey(uid))
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

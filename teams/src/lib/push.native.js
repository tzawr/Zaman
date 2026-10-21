import { useEffect } from 'react'
import { Platform } from 'react-native'
import Constants from 'expo-constants'
import * as Crypto from 'expo-crypto'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import { useRouter } from 'expo-router'
import { doc, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from './firebase'

// Push on iOS and Android through Expo's push service. A device registers
// its Expo push token under users/{uid}/devices; the server sends to every
// device there and forgets ones that have been uninstalled.

export const pushSupported = true

// Shown while the app is open, too: the banner is how people notice.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
})

const projectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID || Constants.expoConfig?.extra?.eas?.projectId

export async function pushStatus() {
  if (!Device.isDevice || !projectId) return 'unsupported'
  const { granted, canAskAgain } = await Notifications.getPermissionsAsync()
  return granted ? 'on' : canAskAgain ? 'off' : 'blocked'
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
  return { ok: true }
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

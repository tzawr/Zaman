import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useColorScheme } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'

// Hengam's palette: the deep navy and brand blue of the web app, with a light
// counterpart. Text colours clear 4.5:1 against every surface they sit on.

const shared = {
  radius: { sm: 8, md: 12, lg: 16, xl: 22, pill: 999 },
  space: (n) => n * 4,
  font: {
    title: { fontSize: 28, fontWeight: '700', letterSpacing: -0.6 },
    heading: { fontSize: 19, fontWeight: '600', letterSpacing: -0.3 },
    body: { fontSize: 16, fontWeight: '400' },
    label: { fontSize: 14, fontWeight: '600' },
    caption: { fontSize: 13, fontWeight: '400' },
  },
}

const palettes = {
  dark: {
    scheme: 'dark',
    bg: '#030816',
    surface: '#07111F',
    elevated: '#0B1730',
    pressed: '#101F3D',
    border: 'rgba(148, 163, 184, 0.18)',
    borderStrong: 'rgba(191, 219, 254, 0.28)',
    text: '#EAF2FF',
    textMuted: '#AAB6CB',
    textFaint: '#8391AB',
    accent: '#60A5FA',
    accentStrong: '#3B82F6',
    onAccent: '#030816',
    accentBg: 'rgba(96, 165, 250, 0.12)',
    success: '#34D399',
    successBg: 'rgba(16, 185, 129, 0.14)',
    warning: '#FBBF24',
    warningBg: 'rgba(245, 158, 11, 0.14)',
    danger: '#F87171',
    dangerBg: 'rgba(239, 68, 68, 0.14)',
    skeleton: 'rgba(148, 163, 184, 0.14)',
    overlay: 'rgba(3, 8, 22, 0.72)',
  },
  light: {
    scheme: 'light',
    bg: '#F7FAFF',
    surface: '#FFFFFF',
    elevated: '#EEF4FF',
    pressed: '#E3ECFB',
    border: 'rgba(30, 41, 59, 0.12)',
    borderStrong: 'rgba(30, 64, 175, 0.24)',
    text: '#06101F',
    textMuted: '#42516A',
    textFaint: '#5B6880',
    accent: '#1D4ED8',
    accentStrong: '#1E40AF',
    onAccent: '#FFFFFF',
    accentBg: 'rgba(37, 99, 235, 0.08)',
    success: '#065F46',
    successBg: 'rgba(16, 185, 129, 0.12)',
    warning: '#92400E',
    warningBg: 'rgba(245, 158, 11, 0.13)',
    danger: '#B91C1C',
    dangerBg: 'rgba(239, 68, 68, 0.1)',
    skeleton: 'rgba(15, 23, 42, 0.07)',
    overlay: 'rgba(6, 16, 31, 0.4)',
  },
}

const PREF_KEY = 'hengam-teams-theme'
const ThemeContext = createContext(null)

export function ThemeProvider({ children }) {
  const system = useColorScheme()
  const [preference, setPreferenceState] = useState('system')

  useEffect(() => {
    AsyncStorage.getItem(PREF_KEY).then((saved) => {
      if (saved === 'light' || saved === 'dark' || saved === 'system') setPreferenceState(saved)
    }).catch(() => {})
  }, [])

  const setPreference = useCallback((next) => {
    setPreferenceState(next)
    AsyncStorage.setItem(PREF_KEY, next).catch(() => {})
  }, [])

  const value = useMemo(() => {
    const scheme = preference === 'system' ? (system === 'light' ? 'light' : 'dark') : preference
    return { ...shared, color: palettes[scheme], preference, setPreference }
  }, [preference, system, setPreference])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  return useContext(ThemeContext)
}

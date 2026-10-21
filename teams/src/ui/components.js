import { forwardRef, useEffect, useState } from 'react'
import {
  ActivityIndicator, Animated, Platform, Pressable, ScrollView, StyleSheet, Text as RNText, TextInput, View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { useTheme } from './theme'

// The kit every screen is built from. Each control carries its accessibility
// role and label, keeps a 44pt touch target, and reads colour from the theme
// so light and dark need nothing per screen.

export function Text({ variant = 'body', tone = 'default', style, ...props }) {
  const t = useTheme()
  const color = { default: t.color.text, muted: t.color.textMuted, faint: t.color.textFaint,
    accent: t.color.accent, danger: t.color.danger, success: t.color.success }[tone]
  return <RNText style={[t.font[variant], { color }, style]} {...props} />
}

// A scrolling page, inset from the notch and home indicator, and held to a
// readable width on tablets and the web.
export function Screen({ children, scroll = true, padded = true, style, contentStyle, refreshControl }) {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const inner = (
    <View style={[{ width: '100%', maxWidth: 560, alignSelf: 'center', paddingHorizontal: padded ? 20 : 0, gap: 16,
      paddingTop: 16, paddingBottom: insets.bottom + 32 }, contentStyle]}>
      {children}
    </View>
  )
  if (!scroll) return <View style={[{ flex: 1, backgroundColor: t.color.bg }, style]}>{inner}</View>
  return (
    <ScrollView
      style={[{ flex: 1, backgroundColor: t.color.bg }, style]}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      refreshControl={refreshControl}
    >
      {inner}
    </ScrollView>
  )
}

export function Button({ title, onPress, variant = 'primary', loading = false, disabled = false, icon, accessibilityHint, style }) {
  const t = useTheme()
  const c = t.color
  const palette = {
    primary: { bg: c.accent, fg: c.onAccent, border: c.accent },
    secondary: { bg: c.elevated, fg: c.text, border: c.border },
    ghost: { bg: 'transparent', fg: c.accent, border: 'transparent' },
    danger: { bg: c.dangerBg, fg: c.danger, border: 'transparent' },
  }[variant]
  const inactive = disabled || loading
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={({ pressed }) => [{
        minHeight: 50, borderRadius: t.radius.md, paddingHorizontal: 18, borderWidth: 1,
        backgroundColor: palette.bg, borderColor: palette.border,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
        opacity: inactive ? 0.55 : pressed ? 0.82 : 1,
        transform: [{ scale: pressed && !inactive ? 0.985 : 1 }],
      }, style]}
    >
      {loading
        ? <ActivityIndicator color={palette.fg} />
        : <>
            {icon ? <Feather name={icon} size={18} color={palette.fg} /> : null}
            <RNText style={[t.font.label, { fontSize: 16, color: palette.fg }]}>{title}</RNText>
          </>}
    </Pressable>
  )
}

export const TextField = forwardRef(function TextField({ label, error, hint, style, ...props }, ref) {
  const t = useTheme()
  const [focused, setFocused] = useState(false)
  return (
    <View style={[{ gap: 6 }, style]}>
      {label ? <Text variant="label" tone="muted" nativeID={`${label}-label`}>{label}</Text> : null}
      <TextInput
        ref={ref}
        accessibilityLabel={label}
        accessibilityLabelledBy={label ? `${label}-label` : undefined}
        placeholderTextColor={t.color.textFaint}
        onFocus={(e) => { setFocused(true); props.onFocus?.(e) }}
        onBlur={(e) => { setFocused(false); props.onBlur?.(e) }}
        style={[t.font.body, {
          minHeight: 50, borderRadius: t.radius.md, paddingHorizontal: 14,
          backgroundColor: t.color.surface, color: t.color.text, borderWidth: 1.5,
          borderColor: error ? t.color.danger : focused ? t.color.accent : t.color.border,
        }, Platform.OS === 'web' && { outlineStyle: 'none' }]}
        {...props}
      />
      {error
        ? <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">{error}</Text>
        : hint ? <Text variant="caption" tone="faint">{hint}</Text> : null}
    </View>
  )
})

export function Card({ children, style, onPress, accessibilityLabel }) {
  const t = useTheme()
  const base = { backgroundColor: t.color.surface, borderRadius: t.radius.lg, borderWidth: 1,
    borderColor: t.color.border, padding: 16, gap: 10 }
  if (!onPress) return <View style={[base, style]}>{children}</View>
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [base, pressed && { backgroundColor: t.color.pressed }, style]}>
      {children}
    </Pressable>
  )
}

export function ListRow({ title, subtitle, icon, right, onPress, accessibilityLabel, destructive }) {
  const t = useTheme()
  const content = (
    <>
      {icon ? (
        <View style={{ width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
          backgroundColor: destructive ? t.color.dangerBg : t.color.accentBg }}>
          <Feather name={icon} size={18} color={destructive ? t.color.danger : t.color.accent} />
        </View>
      ) : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={destructive && { color: t.color.danger }} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text variant="caption" tone="muted" numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      {right}
      {onPress && !right ? <Feather name="chevron-right" size={18} color={t.color.textFaint} /> : null}
    </>
  )
  const style = { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 8 }
  if (!onPress) return <View style={style}>{content}</View>
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel || title}
      style={({ pressed }) => [style, { opacity: pressed ? 0.7 : 1 }]}>
      {content}
    </Pressable>
  )
}

export function Divider() {
  const t = useTheme()
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.color.border }} />
}

export function Badge({ label, tone = 'accent' }) {
  const t = useTheme()
  const colors = {
    accent: [t.color.accentBg, t.color.accent], success: [t.color.successBg, t.color.success],
    warning: [t.color.warningBg, t.color.warning], danger: [t.color.dangerBg, t.color.danger],
    neutral: [t.color.elevated, t.color.textMuted],
  }[tone]
  return (
    <View style={{ backgroundColor: colors[0], borderRadius: t.radius.pill, paddingHorizontal: 10, paddingVertical: 3 }}>
      <RNText style={[t.font.caption, { color: colors[1], fontWeight: '600' }]}>{label}</RNText>
    </View>
  )
}

export function Avatar({ name, size = 40 }) {
  const t = useTheme()
  const initials = String(name || '?').split(' ').filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('')
  return (
    <View accessibilityElementsHidden importantForAccessibility="no"
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: t.color.accentBg,
        alignItems: 'center', justifyContent: 'center' }}>
      <RNText style={{ color: t.color.accent, fontWeight: '700', fontSize: size * 0.38 }}>{initials || '?'}</RNText>
    </View>
  )
}

// A soft pulse in the shape of what is loading, so the layout does not jump
// when the data arrives.
export function Skeleton({ width = '100%', height = 16, radius = 8, style }) {
  const t = useTheme()
  const [pulse] = useState(() => new Animated.Value(0.5))
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(pulse, { toValue: 0.5, duration: 700, useNativeDriver: Platform.OS !== 'web' }),
    ]))
    loop.start()
    return () => loop.stop()
  }, [pulse])
  return <Animated.View accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    style={[{ width, height, borderRadius: radius, backgroundColor: t.color.skeleton, opacity: pulse }, style]} />
}

export function SkeletonCard({ lines = 2 }) {
  return (
    <Card accessibilityLabel="Loading">
      <Skeleton width="45%" height={18} />
      {Array.from({ length: lines }, (_, i) => <Skeleton key={i} width={i === lines - 1 ? '70%' : '100%'} />)}
    </Card>
  )
}

export function EmptyState({ icon = 'inbox', title, message, action }) {
  const t = useTheme()
  return (
    <View style={{ alignItems: 'center', paddingVertical: 36, paddingHorizontal: 12, gap: 10 }}>
      <View style={{ width: 56, height: 56, borderRadius: 18, backgroundColor: t.color.accentBg,
        alignItems: 'center', justifyContent: 'center', marginBottom: 4 }}>
        <Feather name={icon} size={24} color={t.color.accent} />
      </View>
      <Text variant="heading" style={{ textAlign: 'center' }}>{title}</Text>
      {message ? <Text tone="muted" style={{ textAlign: 'center', maxWidth: 340 }}>{message}</Text> : null}
      {action ? <View style={{ marginTop: 8, alignSelf: 'stretch' }}>{action}</View> : null}
    </View>
  )
}

// Inline message for an error or a notice, announced to screen readers.
export function Banner({ tone = 'danger', message, onRetry }) {
  const t = useTheme()
  if (!message) return null
  const [bg, fg, icon] = {
    danger: [t.color.dangerBg, t.color.danger, 'alert-circle'],
    warning: [t.color.warningBg, t.color.warning, 'alert-triangle'],
    success: [t.color.successBg, t.color.success, 'check-circle'],
    info: [t.color.accentBg, t.color.accent, 'info'],
  }[tone]
  return (
    <View accessibilityRole="alert" accessibilityLiveRegion="polite"
      style={{ backgroundColor: bg, borderRadius: t.radius.md, padding: 12, flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
      <Feather name={icon} size={18} color={fg} style={{ marginTop: 1 }} />
      <Text style={{ flex: 1, color: fg }}>{message}</Text>
      {onRetry ? (
        <Pressable onPress={onRetry} accessibilityRole="button" accessibilityLabel="Try again" hitSlop={10}>
          <Text variant="label" style={{ color: fg }}>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

export function SectionTitle({ children, action }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
      <Text variant="label" tone="muted" accessibilityRole="header" style={{ textTransform: 'uppercase', letterSpacing: 0.6, fontSize: 12 }}>
        {children}
      </Text>
      {action}
    </View>
  )
}

export function Segmented({ options, value, onChange, accessibilityLabel }) {
  const t = useTheme()
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel}
      style={{ flexDirection: 'row', backgroundColor: t.color.elevated, borderRadius: t.radius.md, padding: 3, gap: 3 }}>
      {options.map((opt) => {
        const selected = opt.value === value
        return (
          <Pressable key={opt.value} onPress={() => onChange(opt.value)} accessibilityRole="radio"
            accessibilityState={{ selected }} accessibilityLabel={opt.label}
            style={{ flex: 1, minHeight: 40, borderRadius: t.radius.sm, alignItems: 'center', justifyContent: 'center',
              backgroundColor: selected ? t.color.surface : 'transparent',
              borderWidth: selected ? 1 : 0, borderColor: t.color.border }}>
            <RNText style={[t.font.label, { color: selected ? t.color.text : t.color.textMuted }]}>{opt.label}</RNText>
          </Pressable>
        )
      })}
    </View>
  )
}

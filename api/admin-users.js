import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminDb, requireServerAdmin, sendError } from './_firebase-admin.js'

function expiresFromDuration(duration) {
  if (duration === 'forever') return null
  const days = { '30': 30, '90': 90, '365': 365 }[String(duration)] || 30
  return Timestamp.fromDate(new Date(Date.now() + days * 24 * 60 * 60 * 1000))
}

function timestampMs(value) {
  if (!value) return null
  if (typeof value.toMillis === 'function') return value.toMillis()
  if (typeof value.seconds === 'number') return value.seconds * 1000
  return null
}

function activeOverride(override) {
  if (!override?.tier) return false
  const expiresAt = timestampMs(override.expiresAt)
  return !expiresAt || expiresAt > Date.now()
}

function resolveTier(user, override) {
  if (activeOverride(override)) return override.tier === 'pro' ? 'pro' : 'free'
  return user?.tier === 'pro' || user?.tier === 'business' ? 'pro' : 'free'
}

async function listUsers(res) {
  const db = adminDb()
  const [usersSnap, overridesSnap] = await Promise.all([
    db.collection('users').get(),
    db.collection('adminOverrides').get(),
  ])
  const overrides = Object.fromEntries(overridesSnap.docs.map(docSnap => [docSnap.id, docSnap.data()]))
  const users = usersSnap.docs.map(docSnap => {
    const user = docSnap.data()
    const override = overrides[docSnap.id] || null
    return {
      id: docSnap.id,
      email: user.email || '',
      displayName: user.displayName || '',
      tier: resolveTier(user, override),
      userTier: user.tier || 'free',
      override,
    }
  })
  return res.status(200).json({ users })
}

async function grantPro(req, res, adminUid) {
  const { uid, duration = '30', reason = 'admin grant' } = req.body || {}
  if (!uid) return res.status(400).json({ error: 'Missing uid' })
  await adminDb().collection('adminOverrides').doc(uid).set({
    tier: 'pro',
    expiresAt: expiresFromDuration(duration),
    reason,
    grantedBy: adminUid,
    grantedAt: FieldValue.serverTimestamp(),
  })
  return res.status(200).json({ ok: true })
}

async function revokeOverride(req, res) {
  const { uid } = req.body || {}
  if (!uid) return res.status(400).json({ error: 'Missing uid' })
  await adminDb().collection('adminOverrides').doc(uid).delete()
  return res.status(200).json({ ok: true })
}

async function createPromo(req, res, adminUid) {
  const { code, durationDays = 30, maxUses = null, expiresAt = null } = req.body || {}
  const cleanCode = String(code || '').trim().toUpperCase()
  if (!cleanCode) return res.status(400).json({ error: 'Missing code' })
  await adminDb().collection('promoCodes').doc(cleanCode).set({
    code: cleanCode,
    tier: 'pro',
    durationDays: durationDays === 'forever' ? null : Number(durationDays),
    maxUses: maxUses === '' || maxUses == null ? null : Number(maxUses),
    usedCount: 0,
    expiresAt: expiresAt ? Timestamp.fromDate(new Date(`${expiresAt}T23:59:59`)) : null,
    active: true,
    createdAt: FieldValue.serverTimestamp(),
    createdBy: adminUid,
  }, { merge: true })
  return res.status(200).json({ ok: true })
}

export default async function handler(req, res) {
  try {
    const decoded = await requireServerAdmin(req)
    if (req.method === 'GET') return listUsers(res)
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    const action = req.body?.action
    if (action === 'grantPro') return grantPro(req, res, decoded.uid)
    if (action === 'revokeOverride') return revokeOverride(req, res)
    if (action === 'createPromo') return createPromo(req, res, decoded.uid)
    return res.status(400).json({ error: 'Unknown action' })
  } catch (err) {
    return sendError(res, err)
  }
}

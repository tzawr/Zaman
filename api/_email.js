// Transactional email through Resend's REST API. Off until RESEND_API_KEY is
// set, so nothing is ever sent from a preview or test by accident.
//
// Mail goes out from the sending subdomain mail.hengam.app (Resend's advice:
// a subdomain keeps sending reputation apart from the main domain), signed
// d=mail.hengam.app (relaxed DMARC alignment with hengam.app) with a return
// path on send.mail.hengam.app. Nothing touches the apex MX, SPF or DKIM
// records that iCloud+ uses for hello@hengam.app, and replies go there.

const RESEND_URL = 'https://api.resend.com/emails'
const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/

export const emailFrom = (env = process.env) => env.EMAIL_FROM || 'HENGAM <notifications@mail.hengam.app>'
export const emailReplyTo = (env = process.env) => env.EMAIL_REPLY_TO || 'hello@hengam.app'
export const securityFrom = (env = process.env) => env.EMAIL_FROM_SECURITY || 'HENGAM Security <security@mail.hengam.app>'
export const appOrigin = (env = process.env) => (env.APP_ORIGIN || 'https://hengam.app').replace(/\/+$/, '')
export const emailEnabled = (env = process.env) => Boolean(env.RESEND_API_KEY) && env.EMAIL_DISABLED !== '1'

export function validEmail(value) {
  const email = typeof value === 'string' ? value.trim() : ''
  return email.length <= 254 && EMAIL_RE.test(email) ? email : null
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

/** Sends one email. Returns { sent: false, reason: 'disabled' } when email is off. */
export async function sendEmail({ to, subject, html, text, tag, from = null }, { env = process.env, fetchImpl = fetch } = {}) {
  if (!emailEnabled(env)) return { sent: false, reason: 'disabled' }
  const recipient = validEmail(to)
  if (!recipient) throw new Error('email: invalid recipient')
  // Staging and tests: only listed addresses or @domains may receive mail.
  const allow = String(env.EMAIL_ALLOWED_RECIPIENTS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  if (allow.length && !allow.some(a => (a.startsWith('@') ? recipient.toLowerCase().endsWith(a) : recipient.toLowerCase() === a))) {
    return { sent: false, reason: 'not_allowed' }
  }
  const res = await fetchImpl(RESEND_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: from || emailFrom(env), to: [recipient], reply_to: emailReplyTo(env), subject, html, text,
      ...(tag ? { tags: [{ name: 'type', value: tag }] } : {}),
    }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`email provider answered ${res.status}`)
  const body = await res.json().catch(() => ({}))
  return { sent: true, id: body?.id || null }
}

// ---- Design system: one layout for every HENGAM email.
//
// Light, single column, 560px max, system fonts, one primary button. Table
// layout for old clients, inline styles only (no <style> reliance), the logo
// as a PNG, a hidden preheader, and dir/lang set for Persian.

const COPY = {
  en: {
    footer: 'HENGAM · Shift scheduling for small teams',
    help: 'Questions? Reply to this email or write to hello@hengam.app.',
    prefs: 'Notification settings',
    why: {
      schedule: 'You get this because you are on a team that schedules with HENGAM.',
      reminders: 'You get this because shift reminders are on.',
      requests: 'You get this because it needs your attention on HENGAM.',
      team: 'You get this because you manage a team on HENGAM.',
      billing: 'You get this about your HENGAM plan.',
      account: 'You get this because you have a HENGAM account.',
      security: 'This is a security notice about your HENGAM account. It is always sent.',
      invite: 'You get this because a manager invited this address. If you were not expecting it, ignore it.',
    },
    open: 'Open HENGAM',
  },
  fa: {
    footer: 'HENGAM · برنامه‌ریزی شیفت برای تیم‌های کوچک',
    help: 'سؤالی دارید؟ به همین ایمیل پاسخ دهید یا به hello@hengam.app بنویسید.',
    prefs: 'تنظیمات اعلان‌ها',
    why: {
      schedule: 'این ایمیل را دریافت می‌کنید چون عضو تیمی هستید که با HENGAM برنامه‌ریزی می‌کند.',
      reminders: 'این ایمیل را دریافت می‌کنید چون یادآوری شیفت روشن است.',
      requests: 'این ایمیل را دریافت می‌کنید چون موضوعی در HENGAM منتظر شماست.',
      team: 'این ایمیل را دریافت می‌کنید چون مدیر تیمی در HENGAM هستید.',
      billing: 'این ایمیل درباره طرح HENGAM شماست.',
      account: 'این ایمیل را دریافت می‌کنید چون حساب HENGAM دارید.',
      security: 'این یک اطلاعیه امنیتی درباره حساب HENGAM شماست و همیشه ارسال می‌شود.',
      invite: 'این ایمیل را دریافت می‌کنید چون مدیری این نشانی را دعوت کرده است. اگر انتظارش را نداشتید، آن را نادیده بگیرید.',
    },
    open: 'باز کردن HENGAM',
  },
}

/**
 * Renders one email. `paragraphs` are plain text (escaped here), `action` is
 * { url, label }. Returns { subject, html, text }.
 */
export function layout({ lang = 'en', subject, preheader = '', heading, paragraphs = [], action = null, reason = 'account', origin = appOrigin(), showPrefs = true }) {
  const c = COPY[lang === 'fa' ? 'fa' : 'en']
  const dir = lang === 'fa' ? 'rtl' : 'ltr'
  const align = lang === 'fa' ? 'right' : 'left'
  const font = lang === 'fa' ? 'Vazirmatn,Tahoma,-apple-system,Segoe UI,Arial,sans-serif' : '-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif'
  const safeUrl = action && /^https:\/\//.test(action.url) ? action.url : null
  const why = c.why[reason] || c.why.account
  const prefsUrl = `${origin}/profile#notifications`
  const p = paragraphs.filter(Boolean).map(t => `<p style="margin:0 0 14px;font-size:16px;line-height:1.6;color:#334155">${escapeHtml(t)}</p>`).join('')
  const btn = safeUrl ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 6px"><tr><td style="border-radius:10px;background:#3b5bdb"><a href="${escapeHtml(safeUrl)}" style="display:inline-block;padding:13px 22px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px">${escapeHtml(action.label || c.open)}</a></td></tr></table>
<p style="margin:8px 0 0;font-size:12px;line-height:1.5;color:#64748b;word-break:break-all">${escapeHtml(safeUrl)}</p>` : ''
  const html = `<!doctype html><html lang="${lang}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:${font}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preheader || paragraphs[0] || '')}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9"><tr><td align="center" style="padding:28px 14px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px" dir="${dir}">
<tr><td style="padding:0 4px 16px;text-align:${align}"><img src="${origin}/email-logo.png" width="128" height="32" alt="HENGAM" style="display:inline-block;border:0;height:32px;width:128px"></td></tr>
<tr><td style="background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;padding:30px 26px;text-align:${align}">
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.35;color:#0f172a;font-weight:700">${escapeHtml(heading || subject)}</h1>
${p}${btn}
</td></tr>
<tr><td style="padding:18px 6px 0;text-align:${align};font-size:12px;line-height:1.6;color:#64748b">
<p style="margin:0 0 6px">${escapeHtml(why)}</p>
<p style="margin:0 0 6px">${escapeHtml(c.help)}</p>
${showPrefs ? `<p style="margin:0 0 6px"><a href="${escapeHtml(prefsUrl)}" style="color:#3b5bdb">${escapeHtml(c.prefs)}</a></p>` : ''}
<p style="margin:10px 0 0;color:#94a3b8">${escapeHtml(c.footer)}</p>
</td></tr></table></td></tr></table></body></html>`
  const text = [heading || subject, '', ...paragraphs.filter(Boolean), ...(safeUrl ? ['', `${action.label || c.open}: ${safeUrl}`] : []), '', '--', why, c.help, ...(showPrefs ? [`${c.prefs}: ${prefsUrl}`] : []), c.footer].join('\n')
  return { subject, html, text }
}

const OPEN_LABEL = {
  en: { teams: 'Open in HENGAM Teams', web: 'Open HENGAM', security: 'Reset password' },
  fa: { teams: 'باز کردن در HENGAM Teams', web: 'باز کردن HENGAM', security: 'بازنشانی رمز عبور' },
}

/** A notification (schedule, request, team, billing, security) as an email. */
export function notificationEmail({ lang = 'en', type, category, title, body, actionUrl, origin = appOrigin() }) {
  const l = lang === 'fa' ? 'fa' : 'en'
  const label = type === 'password_changed' ? OPEN_LABEL[l].security
    : /teams\.hengam\.app/.test(actionUrl || '') ? OPEN_LABEL[l].teams : OPEN_LABEL[l].web
  return layout({
    lang: l, subject: title, heading: title, paragraphs: [body], preheader: body,
    action: actionUrl && type !== 'account_deleted' ? { url: actionUrl, label } : null,
    reason: category, origin, showPrefs: !['security', 'account'].includes(category),
  })
}

export function inviteEmail({ businessName, employeeName, link, language = 'en', origin = appOrigin() }) {
  const fa = language === 'fa'
  const biz = String(businessName || '').trim() || (fa ? 'مدیر شما' : 'Your manager')
  const who = String(employeeName || '').trim()
  return fa
    ? layout({ lang: 'fa', reason: 'invite', origin, showPrefs: false,
      subject: `دعوت به برنامه کاری ${biz} در HENGAM`, heading: `${biz} شما را به HENGAM دعوت کرد`,
      paragraphs: [`سلام${who ? ` ${who}` : ''}،`, 'با پیوستن به تیم، برنامه شیفت‌هایتان را می‌بینید و زمان‌های در دسترس بودنتان را می‌فرستید.', 'این لینک فقط یک بار کار می‌کند.'],
      action: { url: link, label: 'پیوستن به تیم' } })
    : layout({ lang: 'en', reason: 'invite', origin, showPrefs: false,
      subject: `${biz} invited you to their schedule on HENGAM`, heading: `${biz} invited you to HENGAM`,
      paragraphs: [`Hi${who ? ` ${who}` : ''},`, 'Join the team to see your shifts and send your availability.', 'This link works once.'],
      action: { url: link, label: 'Join the team' } })
}

export function welcomeEmail({ name, origin = appOrigin(), language = 'en' }) {
  const who = String(name || '').trim()
  const link = `${origin}/dashboard`
  return language === 'fa'
    ? layout({ lang: 'fa', reason: 'account', origin, showPrefs: true,
      subject: 'به HENGAM خوش آمدید', heading: `به HENGAM خوش آمدید${who ? `، ${who}` : ''}`,
      paragraphs: ['فضای کاری شما آماده است.', 'تیم را اضافه کنید، ساعت‌های کاری را تنظیم کنید و اولین برنامه هفته را بسازید.', 'سؤالی دارید؟ به همین ایمیل پاسخ دهید.'],
      action: { url: link, label: 'رفتن به داشبورد' } })
    : layout({ lang: 'en', reason: 'account', origin, showPrefs: true,
      subject: 'Welcome to HENGAM', heading: `Welcome to HENGAM${who ? `, ${who}` : ''}`,
      paragraphs: ['Your workspace is ready.', 'Add your team, set your hours, and build your first week.', 'Questions? Just reply to this email.'],
      action: { url: link, label: 'Open your dashboard' } })
}

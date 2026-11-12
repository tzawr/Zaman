// Transactional email through Resend's REST API. Off until RESEND_API_KEY is
// set, so nothing is ever sent from a preview or test by accident.
//
// Mail goes out as HENGAM <notifications@hengam.app>, signed for hengam.app
// with Resend's DKIM key and a return path on send.hengam.app. Neither touches
// the apex MX, SPF or DKIM records that iCloud+ uses for hello@hengam.app,
// and replies go to hello@hengam.app.

const RESEND_URL = 'https://api.resend.com/emails'
const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/

export const emailFrom = (env = process.env) => env.EMAIL_FROM || 'HENGAM <notifications@hengam.app>'
export const emailReplyTo = (env = process.env) => env.EMAIL_REPLY_TO || 'hello@hengam.app'
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
export async function sendEmail({ to, subject, html, text, tag }, { env = process.env, fetchImpl = fetch } = {}) {
  if (!emailEnabled(env)) return { sent: false, reason: 'disabled' }
  const recipient = validEmail(to)
  if (!recipient) throw new Error('email: invalid recipient')
  const res = await fetchImpl(RESEND_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: emailFrom(env), to: [recipient], reply_to: emailReplyTo(env), subject, html, text,
      ...(tag ? { tags: [{ name: 'type', value: tag }] } : {}),
    }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`email provider answered ${res.status}`)
  const body = await res.json().catch(() => ({}))
  return { sent: true, id: body?.id || null }
}

// ---- Templates: short, plain, English with a Persian version when asked.

const shell = (dir, lang, inner) => `<!doctype html><html lang="${lang}" dir="${dir}"><body style="margin:0;background:#f5f6f8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
<div style="max-width:520px;margin:0 auto;padding:32px 24px"><div style="font-weight:800;letter-spacing:.08em;font-size:14px;color:#4f46e5">HENGAM</div>
<div style="background:#fff;border-radius:14px;padding:28px 24px;margin-top:16px;line-height:1.55;font-size:15px">${inner}</div>
<p style="font-size:12px;color:#64748b;margin-top:16px">HENGAM · hello@hengam.app</p></div></body></html>`
const button = (href, label) => `<p style="margin:24px 0"><a href="${escapeHtml(href)}" style="background:#4f46e5;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:700;display:inline-block">${escapeHtml(label)}</a></p>`

export function inviteEmail({ businessName, employeeName, link, language = 'en' }) {
  const biz = String(businessName || '').trim() || 'your manager'
  const who = String(employeeName || '').trim()
  if (language === 'fa') {
    return {
      subject: `دعوت به برنامه کاری ${biz} در HENGAM`,
      text: `سلام${who ? ` ${who}` : ''}،\n\n${biz} شما را به HENGAM دعوت کرده تا برنامه شیفت‌هایتان را ببینید.\n\nبرای پیوستن این لینک را باز کنید:\n${link}\n\nاگر انتظار این ایمیل را نداشتید، آن را نادیده بگیرید.`,
      html: shell('rtl', 'fa', `<p>سلام${who ? ` ${escapeHtml(who)}` : ''}،</p><p>${escapeHtml(biz)} شما را به HENGAM دعوت کرده تا برنامه شیفت‌هایتان را ببینید.</p>${button(link, 'پیوستن به تیم')}<p style="font-size:13px;color:#64748b">اگر انتظار این ایمیل را نداشتید، آن را نادیده بگیرید.</p>`),
    }
  }
  return {
    subject: `${biz} invited you to their schedule on HENGAM`,
    text: `Hi${who ? ` ${who}` : ''},\n\n${biz} invited you to HENGAM to see your shifts.\n\nJoin here:\n${link}\n\nIf you weren't expecting this, you can ignore it.`,
    html: shell('ltr', 'en', `<p>Hi${who ? ` ${escapeHtml(who)}` : ''},</p><p>${escapeHtml(biz)} invited you to HENGAM to see your shifts.</p>${button(link, 'Join the team')}<p style="font-size:13px;color:#64748b">If you weren't expecting this, you can ignore it.</p>`),
  }
}

export function welcomeEmail({ name, origin, language = 'en' }) {
  const who = String(name || '').trim()
  const link = `${origin}/dashboard`
  if (language === 'fa') {
    return {
      subject: 'به HENGAM خوش آمدید',
      text: `سلام${who ? ` ${who}` : ''}،\n\nفضای کاری شما آماده است. تیم را اضافه کنید، ساعت‌ها را تنظیم کنید و اولین برنامه هفته را بسازید:\n${link}\n\nسؤالی دارید؟ به همین ایمیل پاسخ دهید.`,
      html: shell('rtl', 'fa', `<p>سلام${who ? ` ${escapeHtml(who)}` : ''}،</p><p>فضای کاری شما آماده است. تیم را اضافه کنید، ساعت‌ها را تنظیم کنید و اولین برنامه هفته را بسازید.</p>${button(link, 'رفتن به داشبورد')}<p>سؤالی دارید؟ به همین ایمیل پاسخ دهید.</p>`),
    }
  }
  return {
    subject: 'Welcome to HENGAM',
    text: `Hi${who ? ` ${who}` : ''},\n\nYour workspace is ready. Add your team, set your hours, and build your first week:\n${link}\n\nQuestions? Just reply to this email.`,
    html: shell('ltr', 'en', `<p>Hi${who ? ` ${escapeHtml(who)}` : ''},</p><p>Your workspace is ready. Add your team, set your hours, and build your first week.</p>${button(link, 'Open your dashboard')}<p>Questions? Just reply to this email.</p>`),
  }
}

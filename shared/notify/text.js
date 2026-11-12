// What a notification says, in English or Persian, from the small set of
// facts stored with it. Used by the email sender and by the web
// notification center, so both say the same thing.
//
// Facts are deliberately plain and safe to store: workplace name, dates,
// shift times, a person's display name, and an outcome. Never message
// bodies people typed, emails or tokens.

const asUtc = (iso) => new Date(`${iso}T00:00:00Z`)
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
const addDays = (iso, n) => { const d = asUtc(iso); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const locale = (lang) => (lang === 'fa' ? 'fa-IR-u-nu-latn' : 'en-US')
const fmt = (lang, opts) => new Intl.DateTimeFormat(locale(lang), { timeZone: 'UTC', ...opts })

export function dayText(iso, lang) {
  return isDate(iso) ? fmt(lang, { weekday: 'short', month: 'short', day: 'numeric' }).format(asUtc(iso)) : ''
}
export function weekText(iso, lang) {
  if (!isDate(iso)) return ''
  const f = fmt(lang, { month: 'short', day: 'numeric' })
  return `${f.format(asUtc(iso))} – ${f.format(asUtc(addDays(iso, 6)))}`
}
const time = (hhmm) => (typeof hhmm === 'string' && /^\d{2}:\d{2}$/.test(hhmm) ? hhmm : '')
const shift = (f, lang) => [dayText(f.date, lang), time(f.start) && time(f.end) ? `${time(f.start)}–${time(f.end)}` : ''].filter(Boolean).join(lang === 'fa' ? '، ' : ', ')
// Isolates keep names and Latin text from scrambling Persian sentences.
const iso = (s) => `⁨${String(s ?? '').slice(0, 80)}⁩`

const T = {
  schedule_published: {
    en: (f) => ({ title: `${f.biz}: schedule is out`, body: `${weekText(f.weekStart, 'en')}.${f.count != null ? ` You have ${f.count} ${f.count === 1 ? 'shift' : 'shifts'}.` : ''}` }),
    fa: (f) => ({ title: `${iso(f.biz)}: برنامه کاری منتشر شد`, body: `${weekText(f.weekStart, 'fa')}.${f.count != null ? ` شما ${f.count} شیفت دارید.` : ''}` }),
  },
  schedule_changed: {
    en: (f) => (f.date
      ? { title: `${f.biz}: shift ${f.cancelled ? 'removed' : 'changed'}`, body: f.cancelled ? `${shift(f, 'en')} is no longer on your schedule.` : `Now ${shift(f, 'en')}.` }
      : { title: `${f.biz}: your schedule changed`, body: `Your shifts for ${weekText(f.weekStart, 'en')} were updated.` }),
    fa: (f) => (f.date
      ? { title: `${iso(f.biz)}: شیفت ${f.cancelled ? 'حذف شد' : 'تغییر کرد'}`, body: f.cancelled ? `${shift(f, 'fa')} دیگر در برنامه شما نیست.` : `اکنون ${shift(f, 'fa')}.` }
      : { title: `${iso(f.biz)}: برنامه شما تغییر کرد`, body: `شیفت‌های شما برای ${weekText(f.weekStart, 'fa')} به‌روز شد.` }),
  },
  shift_reminder: {
    en: (f) => ({ title: `Upcoming shift at ${f.biz}`, body: `${shift(f, 'en')}.` }),
    fa: (f) => ({ title: `شیفت پیش رو در ${iso(f.biz)}`, body: `${shift(f, 'fa')}.` }),
  },
  marketplace_shift: {
    en: (f) => ({ title: `${f.biz}: a shift is up for grabs`, body: `${f.who ? `${f.who} offered ` : ''}${shift(f, 'en')}.` }),
    fa: (f) => ({ title: `${iso(f.biz)}: یک شیفت برای برداشتن آزاد است`, body: `${shift(f, 'fa')}.` }),
  },
  pickup_requested: {
    en: (f) => ({ title: `${f.biz}: pickup request`, body: `${f.who ? `${f.who} wants ` : 'Someone wants '}${shift(f, 'en')}.` }),
    fa: (f) => ({ title: `${iso(f.biz)}: درخواست برداشتن شیفت`, body: `${f.who ? `${iso(f.who)} ` : ''}${shift(f, 'fa')} را می‌خواهد.` }),
  },
  pickup_decided: {
    en: (f) => ({ title: `${f.biz}: pickup ${f.approved ? 'approved' : 'declined'}`, body: `${shift(f, 'en')}.` }),
    fa: (f) => ({ title: `${iso(f.biz)}: برداشتن شیفت ${f.approved ? 'تأیید شد' : 'رد شد'}`, body: `${shift(f, 'fa')}.` }),
  },
  swap_requested: {
    en: (f) => ({ title: `${f.biz}: swap request`, body: f.who ? `${f.who} asked to swap a shift.` : 'A swap needs a decision.' }),
    fa: (f) => ({ title: `${iso(f.biz)}: درخواست جابه‌جایی شیفت`, body: f.who ? `${iso(f.who)} درخواست جابه‌جایی شیفت داده است.` : 'یک جابه‌جایی منتظر تصمیم است.' }),
  },
  swap_decided: {
    en: (f) => ({ title: `${f.biz}: swap ${f.approved ? 'done' : 'not done'}`, body: f.approved ? 'Your schedule has been updated.' : 'Nothing changed on your schedule.' }),
    fa: (f) => ({ title: `${iso(f.biz)}: جابه‌جایی ${f.approved ? 'انجام شد' : 'انجام نشد'}`, body: f.approved ? 'برنامه شما به‌روز شد.' : 'برنامه شما تغییری نکرد.' }),
  },
  time_off_requested: {
    en: (f) => ({ title: `${f.biz}: time-off request`, body: `${f.who ? `${f.who} asked for time off` : 'Someone asked for time off'}${f.date ? ` from ${dayText(f.date, 'en')}` : ''}.` }),
    fa: (f) => ({ title: `${iso(f.biz)}: درخواست مرخصی`, body: `${f.who ? `${iso(f.who)} ` : ''}درخواست مرخصی داده است${f.date ? ` از ${dayText(f.date, 'fa')}` : ''}.` }),
  },
  time_off_decided: {
    en: (f) => ({ title: `${f.biz}: time off ${f.approved ? 'approved' : 'declined'}`, body: f.date ? `From ${dayText(f.date, 'en')}.` : '' }),
    fa: (f) => ({ title: `${iso(f.biz)}: مرخصی ${f.approved ? 'تأیید شد' : 'رد شد'}`, body: f.date ? `از ${dayText(f.date, 'fa')}.` : '' }),
  },
  invite_accepted: {
    en: (f) => ({ title: `${f.who || 'Your employee'} joined your team`, body: 'They can now see their shifts and send you their availability.' }),
    fa: (f) => ({ title: `${f.who ? iso(f.who) : 'کارمند شما'} به تیم پیوست`, body: 'اکنون می‌تواند شیفت‌هایش را ببیند و زمان‌های در دسترس بودنش را برایتان بفرستد.' }),
  },
  availability_changed: {
    en: (f) => ({ title: `${f.who || 'An employee'} updated their availability`, body: 'Check it before you build the next schedule.' }),
    fa: (f) => ({ title: `${f.who ? iso(f.who) : 'یکی از کارمندان'} زمان‌های در دسترس بودنش را به‌روز کرد`, body: 'پیش از ساختن برنامه بعدی آن را بررسی کنید.' }),
  },
  plan_activated: {
    en: (f) => ({ title: 'HENGAM Pro is active', body: f.until ? `Your Pro access runs until ${dayText(f.until, 'en')}.` : 'Your Pro features are ready to use.' }),
    fa: (f) => ({ title: 'HENGAM Pro فعال شد', body: f.until ? `دسترسی Pro شما تا ${dayText(f.until, 'fa')} فعال است.` : 'امکانات Pro آماده استفاده است.' }),
  },
  password_changed: {
    en: () => ({ title: 'Your HENGAM password was changed', body: 'If this was you, there is nothing to do. If not, reset your password now and reply to this email.' }),
    fa: () => ({ title: 'رمز عبور HENGAM شما تغییر کرد', body: 'اگر خودتان این کار را کرده‌اید، کاری لازم نیست. اگر نه، همین حالا رمز عبور را بازنشانی کنید و به این ایمیل پاسخ دهید.' }),
  },
  account_deleted: {
    en: () => ({ title: 'Your HENGAM account was deleted', body: 'Your account and its data have been removed. If you did not ask for this, reply to this email right away.' }),
    fa: () => ({ title: 'حساب HENGAM شما حذف شد', body: 'حساب و داده‌های آن حذف شد. اگر شما این درخواست را نداده‌اید، فوراً به این ایمیل پاسخ دهید.' }),
  },
}

/** Title and body for a notification, or null when the type has no text. */
export function notificationText(type, facts = {}, lang = 'en') {
  const t = T[type]
  if (!t) return null
  const f = { ...facts, biz: facts.biz || (lang === 'fa' ? 'محل کار شما' : 'Your workplace') }
  return (t[lang] || t.en)(f)
}

export const KNOWN_TYPES = Object.keys(T)

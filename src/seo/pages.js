// Single source of truth for page metadata.
// Used at runtime by <SeoManager /> and at build time by scripts/generate-seo-pages.js
// so the crawlable HTML and the SPA never disagree.

// Change this one constant (or set VITE_SITE_URL) when the custom domain moves.
// eslint-disable-next-line no-undef
const envUrl = typeof process !== 'undefined' ? process.env?.VITE_SITE_URL : undefined

export const SITE_URL = envUrl || 'https://hengam.app'

export const SITE_NAME = 'Hengam'
export const OG_IMAGE = '/og.png'
export const TWITTER_HANDLE = '@hengamapp'

// Public, indexable pages. `crumbs` drives both the visible breadcrumb trail
// and the BreadcrumbList structured data.
export const PUBLIC_PAGES = {
  '/': {
    title: 'Hengam — AI shift scheduling for cafes, restaurants, and retail',
    description:
      'Hengam turns plain-English coverage rules, availability, and target hours into a checked weekly shift schedule — and explains any week that cannot work.',
    crumbs: [],
    priority: '1.0',
    changefreq: 'weekly',
  },
  '/about': {
    title: 'About Hengam — why we built a constraint-based scheduler',
    description:
      'Hengam was built for shift managers who lose hours every week to spreadsheets. Learn how our AI rule parsing and deterministic scheduling engine work.',
    crumbs: [{ name: 'About', path: '/about' }],
    priority: '0.6',
    changefreq: 'monthly',
  },
  '/pricing': {
    title: 'Pricing — Hengam shift scheduling software',
    description:
      'Start free with Hengam. Compare the Free and Pro plans for AI rule parsing, unlimited schedules, team invites, and CSV, PNG, and PDF exports.',
    crumbs: [{ name: 'Pricing', path: '/pricing' }],
    priority: '0.9',
    changefreq: 'monthly',
  },
  '/security': {
    title: 'Security — how Hengam protects your team data',
    description:
      'How Hengam secures workspace and employee data: encrypted transport, scoped database rules, verified accounts, and least-privilege access.',
    crumbs: [{ name: 'Security', path: '/security' }],
    priority: '0.6',
    changefreq: 'monthly',
  },
  '/privacy': {
    title: 'Privacy Policy — Hengam',
    description:
      'What data Hengam collects, how it is used to build your schedules, how long it is kept, and how to request deletion.',
    crumbs: [{ name: 'Privacy', path: '/privacy' }],
    priority: '0.3',
    changefreq: 'yearly',
  },
  '/terms': {
    title: 'Terms of Service — Hengam',
    description:
      'The terms that govern your use of Hengam, including account responsibilities, acceptable use, billing, and cancellation.',
    crumbs: [{ name: 'Terms', path: '/terms' }],
    priority: '0.3',
    changefreq: 'yearly',
  },
  '/signin': {
    title: 'Sign in to Hengam',
    description: 'Sign in to your Hengam workspace to build, review, and share this week’s schedule.',
    crumbs: [],
    priority: '0.4',
    changefreq: 'yearly',
  },
  '/signup': {
    title: 'Create your free Hengam account',
    description: 'Create a free Hengam workspace and build your first checked weekly schedule in minutes. No credit card required.',
    crumbs: [],
    priority: '0.8',
    changefreq: 'yearly',
  },
}

// Signed-in product surfaces. Real titles for humans, noindex for crawlers —
// these pages are behind auth and have nothing to rank for.
export const PRIVATE_PAGES = {
  '/dashboard': 'Dashboard',
  '/onboarding': 'Set up your workspace',
  '/employees': 'Your team',
  '/settings': 'Workspace settings',
  '/schedule': 'Build a schedule',
  '/schedules': 'Schedule history',
  '/invite': 'Invite your team',
  '/my-schedule': 'My schedule',
  '/my-availability': 'My availability',
  '/profile': 'Profile',
  '/admin/users': 'Admin — users',
  '/verify-email': 'Verify your email',
  '/forgot-password': 'Reset your password',
}

export function metaForPath(pathname) {
  const path = pathname !== '/' && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
  if (PUBLIC_PAGES[path]) return { path, indexable: true, ...PUBLIC_PAGES[path] }

  for (const [prefix, label] of Object.entries(PRIVATE_PAGES)) {
    if (path === prefix || path.startsWith(`${prefix}/`)) {
      return {
        path,
        indexable: false,
        title: `${label} — ${SITE_NAME}`,
        description: 'Your Hengam workspace.',
        crumbs: [],
      }
    }
  }

  if (path.startsWith('/invite/') || path.startsWith('/verify-email/')) {
    return {
      path,
      indexable: false,
      title: `${SITE_NAME}`,
      description: 'Your Hengam workspace.',
      crumbs: [],
    }
  }

  return {
    path,
    indexable: false,
    notFound: true,
    title: `Page not found — ${SITE_NAME}`,
    description: 'That page does not exist. Head back to the Hengam home page.',
    crumbs: [],
  }
}

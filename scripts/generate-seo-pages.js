// Runs after `vite build`.
//
// A single-page app normally serves one index.html for every URL, so every page
// shares one title, one description, and one canonical tag in the raw HTML.
// This script writes a real HTML file per public route — same app bundle, but
// with that route's head tags baked in — plus sitemap.xml and 404.html.
// Vercel's `cleanUrls` serves /about from about.html before the SPA rewrite.
//
// vercel.json rewrites only the signed-in app routes to the SPA shell, so a URL
// that matches neither a generated page nor an app route falls through to
// 404.html with a real 404 status. When you add a route to App.jsx, add it here
// (public) or to that rewrite list (signed-in) — otherwise it will 404.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PUBLIC_PAGES, SITE_URL, SITE_NAME, OG_IMAGE, TWITTER_HANDLE } from '../src/seo/pages.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
const indexPath = join(dist, 'index.html')

if (!existsSync(indexPath)) {
  console.error('[seo] dist/index.html not found — run `vite build` first.')
  process.exit(1)
}

const template = readFileSync(indexPath, 'utf8')
const escape = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function headFor(path, meta) {
  const url = `${SITE_URL}${path === '/' ? '/' : path}`
  const image = `${SITE_URL}${OG_IMAGE}`
  const breadcrumbs = meta.crumbs?.length
    ? `\n    <script type="application/ld+json">${JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_URL}/` },
          ...meta.crumbs.map((crumb, index) => ({
            '@type': 'ListItem',
            position: index + 2,
            name: crumb.name,
            item: `${SITE_URL}${crumb.path}`,
          })),
        ],
      })}</script>`
    : ''

  return { url, image, breadcrumbs }
}

function render(path, meta, { noindex = false, canonical = true } = {}) {
  const { url, image, breadcrumbs } = headFor(path, meta)
  let html = template

  html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${escape(meta.title)}</title>`)
  html = html.replace(
    /<meta name="description" content="[\s\S]*?" \/>/,
    `<meta name="description" content="${escape(meta.description)}" />`,
  )
  html = html.replace(
    /<link rel="canonical" href="[\s\S]*?" \/>\n?\s*/,
    // A 404 gets no canonical: it would point a crawler at a dead URL.
    canonical ? `<link rel="canonical" href="${url}" />\n    ` : '',
  )
  html = html.replace(
    /<meta name="robots" content="[\s\S]*?" \/>/,
    `<meta name="robots" content="${noindex ? 'noindex, follow' : 'index, follow, max-image-preview:large'}" />`,
  )
  html = html.replace(
    /<meta property="og:type" content="[\s\S]*?" \/>/,
    `<meta property="og:type" content="${path === '/' ? 'website' : 'article'}" />`,
  )
  html = html.replace(
    /<meta property="og:title" content="[\s\S]*?" \/>/,
    `<meta property="og:title" content="${escape(meta.title)}" />`,
  )
  html = html.replace(
    /<meta property="og:description" content="[\s\S]*?" \/>/,
    `<meta property="og:description" content="${escape(meta.description)}" />`,
  )
  html = html.replace(
    /<meta property="og:url" content="[\s\S]*?" \/>/,
    `<meta property="og:url" content="${url}" />`,
  )
  html = html.replace(
    /<meta property="og:image" content="[\s\S]*?" \/>/,
    `<meta property="og:image" content="${image}" />`,
  )
  html = html.replace(
    /<meta name="twitter:title" content="[\s\S]*?" \/>/,
    `<meta name="twitter:title" content="${escape(meta.title)}" />`,
  )
  html = html.replace(
    /<meta name="twitter:description" content="[\s\S]*?" \/>/,
    `<meta name="twitter:description" content="${escape(meta.description)}" />`,
  )
  html = html.replace(
    /<meta name="twitter:site" content="[\s\S]*?" \/>/,
    `<meta name="twitter:site" content="${TWITTER_HANDLE}" />`,
  )
  if (breadcrumbs) html = html.replace('</head>', `${breadcrumbs}\n  </head>`)

  return html
}

const written = []
for (const [path, meta] of Object.entries(PUBLIC_PAGES)) {
  const file = path === '/' ? 'index.html' : `${path.replace(/^\//, '')}.html`
  writeFileSync(join(dist, file), render(path, meta), 'utf8')
  written.push(file)
}

// Custom 404, served by Vercel for anything the SPA rewrite does not catch.
writeFileSync(
  join(dist, '404.html'),
  render('/404', {
    title: `Page not found — ${SITE_NAME}`,
    description: 'That page does not exist. Head back to the Hengam home page.',
    crumbs: [],
  }, { noindex: true, canonical: false }),
  'utf8',
)
written.push('404.html')

const today = new Date().toISOString().slice(0, 10)
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${Object.entries(PUBLIC_PAGES)
  .map(([path, meta]) => {
    const loc = `${SITE_URL}${path === '/' ? '/' : path}`
    return `  <url>
    <loc>${loc}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${meta.changefreq || 'monthly'}</changefreq>
    <priority>${meta.priority || '0.5'}</priority>
  </url>`
  })
  .join('\n')}
</urlset>
`
writeFileSync(join(dist, 'sitemap.xml'), sitemap, 'utf8')
written.push('sitemap.xml')

console.log(`[seo] wrote ${written.length} files: ${written.join(', ')}`)

import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { metaForPath, OG_IMAGE, SITE_NAME, SITE_URL, TWITTER_HANDLE } from '../seo/pages'

// Every tag this component owns is marked so we can replace the previous
// route's tags without touching the ones baked into index.html.
const OWNED = 'data-seo-managed'

function setTag(selector, create, attrs) {
  let el = document.head.querySelector(selector)
  if (!el) {
    el = create()
    el.setAttribute(OWNED, '')
    document.head.appendChild(el)
  }
  Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value))
  return el
}

function setMeta(name, content, isProperty = false) {
  const attr = isProperty ? 'property' : 'name'
  setTag(`meta[${attr}="${name}"]`, () => document.createElement('meta'), {
    [attr]: name,
    content,
  })
}

function setJsonLd(id, data) {
  const selector = `script[type="application/ld+json"][data-ld="${id}"]`
  const existing = document.head.querySelector(selector)
  if (!data) {
    if (existing) existing.remove()
    return
  }
  const el = existing || document.createElement('script')
  el.type = 'application/ld+json'
  el.setAttribute('data-ld', id)
  el.setAttribute(OWNED, '')
  el.textContent = JSON.stringify(data)
  if (!existing) document.head.appendChild(el)
}

export function SeoManager() {
  const { pathname } = useLocation()

  useEffect(() => {
    const meta = metaForPath(pathname)
    const url = `${SITE_URL}${meta.path === '/' ? '' : meta.path}`
    const image = `${SITE_URL}${OG_IMAGE}`

    document.title = meta.title

    setMeta('description', meta.description)
    setMeta('robots', meta.indexable ? 'index, follow, max-image-preview:large' : 'noindex, follow')

    // A 404 has no canonical of its own — pointing one at a dead URL just
    // invites a crawler to treat it as a real page.
    const canonical = document.head.querySelector('link[rel="canonical"]')
    if (meta.notFound) {
      if (canonical) canonical.remove()
    } else {
      setTag('link[rel="canonical"]', () => document.createElement('link'), {
        rel: 'canonical',
        href: url,
      })
    }

    setMeta('og:type', meta.path === '/' ? 'website' : 'article', true)
    setMeta('og:site_name', SITE_NAME, true)
    setMeta('og:title', meta.title, true)
    setMeta('og:description', meta.description, true)
    setMeta('og:url', url, true)
    setMeta('og:image', image, true)
    setMeta('og:image:width', '1200', true)
    setMeta('og:image:height', '630', true)
    setMeta('og:image:alt', `${SITE_NAME} — shift scheduling that checks itself`, true)

    setMeta('twitter:card', 'summary_large_image')
    setMeta('twitter:site', TWITTER_HANDLE)
    setMeta('twitter:title', meta.title)
    setMeta('twitter:description', meta.description)
    setMeta('twitter:image', image)

    setJsonLd(
      'breadcrumbs',
      meta.crumbs && meta.crumbs.length
        ? {
            '@context': 'https://schema.org',
            '@type': 'BreadcrumbList',
            itemListElement: [
              { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
              ...meta.crumbs.map((crumb, index) => ({
                '@type': 'ListItem',
                position: index + 2,
                name: crumb.name,
                item: `${SITE_URL}${crumb.path}`,
              })),
            ],
          }
        : null,
    )
  }, [pathname])

  return null
}

export default SeoManager

import { Link, useLocation } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { metaForPath } from '../seo/pages'
import { useI18n } from '../i18n'

// Visible trail for public sub-pages. The matching BreadcrumbList JSON-LD is
// emitted by <SeoManager /> from the same `crumbs` definition.
function Breadcrumbs() {
  const { pathname } = useLocation()
  const { t } = useI18n()
  const meta = metaForPath(pathname)

  if (!meta.indexable || !meta.crumbs?.length) return null

  return (
    <nav className="breadcrumbs" aria-label={t('breadcrumbLabel')}>
      <ol className="breadcrumb-list">
        <li className="breadcrumb-item">
          <Link to="/">{t('breadcrumbHome')}</Link>
          <ChevronRight size={13} aria-hidden="true" />
        </li>
        {meta.crumbs.map((crumb, index) => {
          const isLast = index === meta.crumbs.length - 1
          return (
            <li className="breadcrumb-item" key={crumb.path}>
              {isLast ? (
                <span aria-current="page">{crumb.name}</span>
              ) : (
                <>
                  <Link to={crumb.path}>{crumb.name}</Link>
                  <ChevronRight size={13} aria-hidden="true" />
                </>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

export default Breadcrumbs

import { motion as Motion } from 'framer-motion'

function PageHero({ eyebrow, title, subtitle, children }) {
  return (
    <Motion.div
      className="page-hero"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
    >
      <div className="page-hero-glow" aria-hidden />
      <div className="page-hero-content">
        {eyebrow && (
          <div className="page-hero-eyebrow">{eyebrow}</div>
        )}
        <h1 className="page-hero-title">
          {title}
        </h1>
        {subtitle && (
          <p className="page-hero-subtitle">{subtitle}</p>
        )}
        {children && (
          <div className="page-hero-extra">{children}</div>
        )}
      </div>
    </Motion.div>
  )
}

export default PageHero

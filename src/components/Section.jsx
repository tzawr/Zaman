import { motion } from 'framer-motion'

function Section({ title, subtitle, icon: Icon, children, delay = 0, className = '' }) {
  return (
    <motion.section
      className={`app-section ${className}`}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: 'easeOut' }}
    >
      {(title || subtitle) && (
        <div className="app-section-header">
          {Icon && (
            <div className="app-section-icon">
              <Icon size={18} />
            </div>
          )}
          <div>
            {title && <h2 className="app-section-title">{title}</h2>}
            {subtitle && <p className="app-section-subtitle">{subtitle}</p>}
          </div>
        </div>
      )}
      <div className="app-section-body">
        {children}
      </div>
    </motion.section>
  )
}

export default Section
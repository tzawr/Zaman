import { useI18n } from '../i18n'

function Logo({ size = 40, showText = true, className = '' }) {
  const { language } = useI18n()
  const label = language === 'fa' ? 'هنگام' : 'hengam'

  return (
    <span className={`app-logo ${className}`} aria-label="Hengam">
      <svg
        className="app-logo-icon"
        viewBox="0 0 120 120"
        width={size}
        height={size}
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path
          d="M 30 90 L 30 30 Q 30 25 35 25 L 60 25 Q 90 25 90 60 Q 90 90 60 90 Q 45 90 45 75 Q 45 60 60 60"
          fill="none"
          stroke="currentColor"
          strokeWidth="7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="68" cy="65" r="5" fill="currentColor" />
      </svg>
      {showText && <span className="app-logo-wordmark">{label}</span>}
    </span>
  )
}

export default Logo

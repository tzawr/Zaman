import { useRef, useState } from 'react'
import { Clock, AlertTriangle, TrendingUp, TrendingDown, Minus, Sparkles, X, Plus, Trash2 } from 'lucide-react'
import { useI18n } from '../i18n'

const DAYS = [
  { key: 'monday', labelKey: 'dayMonShort', fullLabelKey: 'dayMonday' },
  { key: 'tuesday', labelKey: 'dayTueShort', fullLabelKey: 'dayTuesday' },
  { key: 'wednesday', labelKey: 'dayWedShort', fullLabelKey: 'dayWednesday' },
  { key: 'thursday', labelKey: 'dayThuShort', fullLabelKey: 'dayThursday' },
  { key: 'friday', labelKey: 'dayFriShort', fullLabelKey: 'dayFriday' },
  { key: 'saturday', labelKey: 'daySatShort', fullLabelKey: 'daySaturday' },
  { key: 'sunday', labelKey: 'daySunShort', fullLabelKey: 'daySunday' },
]

const DAY_KEY_BY_NAME = Object.fromEntries(DAYS.map(day => [day.key, day]))

function colorForEmployee(name) {
  const colors = [
    { bg: 'rgba(30, 64, 175, 0.18)', border: 'rgba(96, 165, 250, 0.26)', text: '#BFDBFE', lightText: '#1D4ED8', lightBg: 'rgba(96, 165, 250, 0.12)' },
    { bg: 'rgba(77, 92, 124, 0.18)', border: 'rgba(148, 163, 184, 0.24)', text: '#CBD5E1', lightText: '#475569', lightBg: 'rgba(148, 163, 184, 0.12)' },
    { bg: 'rgba(67, 56, 202, 0.2)', border: 'rgba(174, 132, 184, 0.28)', text: '#C7D2FE', lightText: '#4338CA', lightBg: 'rgba(99, 102, 241, 0.12)' },
    { bg: 'rgba(96, 165, 250, 0.14)', border: 'rgba(96, 165, 250, 0.28)', text: '#FDE68A', lightText: '#B45309', lightBg: 'rgba(245, 158, 11, 0.13)' },
    { bg: 'rgba(96, 165, 250, 0.12)', border: 'rgba(96, 165, 250, 0.25)', text: '#BFDBFE', lightText: '#2563EB', lightBg: 'rgba(96, 165, 250, 0.1)' },
    { bg: 'rgba(15, 31, 62, 0.74)', border: 'rgba(96, 165, 250, 0.2)', text: '#DBEAFE', lightText: '#1E3A8A', lightBg: 'rgba(30, 64, 175, 0.1)' },
    { bg: 'rgba(124, 45, 18, 0.16)', border: 'rgba(251, 146, 60, 0.24)', text: '#FED7AA', lightText: '#C2410C', lightBg: 'rgba(251, 146, 60, 0.11)' },
    { bg: 'rgba(88, 28, 135, 0.16)', border: 'rgba(167, 139, 250, 0.24)', text: '#DDD6FE', lightText: '#6D28D9', lightBg: 'rgba(167, 139, 250, 0.11)' },
  ]
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return colors[Math.abs(hash) % colors.length]
}

function formatIssue(issue, t) {
  const text = String(issue || '')
  const dayMatch = text.match(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday):\s*(.*)$/i)
  const scopeKey = dayMatch ? dayMatch[1].toLowerCase() : null
  const scope = scopeKey && DAY_KEY_BY_NAME[scopeKey] ? t(DAY_KEY_BY_NAME[scopeKey].fullLabelKey) : null
  const detail = dayMatch ? dayMatch[2] : text

  if (/opening/i.test(detail)) {
    return {
      title: scope ? `${scope} ${t('openingCoverage')}` : t('openingCoverage'),
      body: detail
        .replace(/needs at least/i, 'requires at least')
        .replace(/only (\d+) found/i, 'only $1 eligible shift is currently scheduled'),
      action: t('reviewOpeningAction'),
    }
  }

  if (/closing/i.test(detail)) {
    return {
      title: scope ? `${scope} ${t('closingCoverage')}` : t('closingCoverage'),
      body: detail
        .replace(/needs at least/i, 'requires at least')
        .replace(/only (\d+) found/i, 'only $1 eligible shift is currently scheduled'),
      action: t('reviewClosingAction'),
    }
  }

  if (/staff from/i.test(detail)) {
    return {
      title: scope ? `${scope} ${t('staffingLevel')}` : t('staffingLevel'),
      body: detail
        .replace(/^needs/i, 'Requires')
        .replace(/only (\d+) on shift/i, 'only $1 people are currently on shift'),
      action: t('reviewStaffingAction'),
    }
  }

  if (/scheduled twice/i.test(detail)) {
    return {
      title: scope ? `${scope} ${t('duplicateShift')}` : t('duplicateShift'),
      body: detail.replace(/is scheduled twice on the same day/i, 'has more than one shift on the same day'),
      action: t('reviewDuplicateAction'),
    }
  }

  if (/outside availability/i.test(detail)) {
    return {
      title: scope ? `${scope} ${t('availabilityConflict')}` : t('availabilityConflict'),
      body: detail,
      action: t('reviewAvailabilityAction'),
    }
  }

  if (/only .* scheduled but target/i.test(text) || /no unused available days remain/i.test(text)) {
    const person = text.split(':')[0]
    return {
      title: `${person} ${t('targetHours')}`,
      body: text.replace(/add shifts on:/i, 'available unused days:'),
      action: t('reviewTargetAction'),
    }
  }

  return {
    title: scope ? `${scope} ${t('scheduleReview')}` : t('scheduleReview'),
    body: detail,
    action: t('reviewDefaultAction'),
  }
}

function formatTime(time24, language = 'en') {
  if (!time24) return ''
  const [h, m] = time24.split(':').map(Number)
  if (language === 'fa') {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`.replace(/\d/g, d => Number(d).toLocaleString('fa-IR'))
  }
  const period = h >= 12 ? 'PM' : 'AM'
  const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h
  return m === 0 ? `${displayH}${period.toLowerCase()}` : `${displayH}:${String(m).padStart(2, '0')}${period.toLowerCase()}`
}

function formatDayDate(dateStr, language = 'en') {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString(language === 'fa' ? 'fa-IR' : 'en-US', { month: 'short', day: 'numeric' })
}

function calcHours(start, end) {
  if (!start || !end) return 0
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  let hours = (eh + em / 60) - (sh + sm / 60)
  if (hours < 0) hours += 24
  return Math.round(hours * 10) / 10
}

function ScheduleTable({ data, employees = [], roles = [], onUpdate, highlightFilter = null }) {
  const { t, language } = useI18n()
  const [editing, setEditing] = useState(null) // { dayKey, shift } or { dayKey, shift: null } for new
  const newShiftCounter = useRef(0)
  
  if (!data || !data.days) return null

  const hasHighlight = Boolean(highlightFilter?.type && highlightFilter?.value)
  const matchesHighlight = (item = {}) => {
    if (!hasHighlight) return true
    if (highlightFilter.type === 'role') return item.role === highlightFilter.value
    if (highlightFilter.type === 'employee') return item.employee === highlightFilter.value
    return true
  }

  function handleShiftClick(dayKey, shift) {
    setEditing({ dayKey, shift: { ...shift } })
  }

  function handleAddShift(dayKey) {
    newShiftCounter.current += 1
    setEditing({
      dayKey,
      shift: {
        id: `new-${newShiftCounter.current}`,
        employee: '',
        role: '',
        start: '09:00',
        end: '17:00',
        hours: 8
      },
      isNew: true
    })
  }

  function closeModal() {
    setEditing(null)
  }

  function saveShift(updatedShift) {
    if (!editing || !onUpdate) return
    
    const newData = JSON.parse(JSON.stringify(data))
    const day = newData.days[editing.dayKey]
    
    // Recalculate hours
    updatedShift.hours = calcHours(updatedShift.start, updatedShift.end)
    
    if (editing.isNew) {
      day.shifts.push(updatedShift)
    } else {
      const idx = day.shifts.findIndex(s => s.id === editing.shift.id)
      if (idx >= 0) day.shifts[idx] = updatedShift
    }
    
    // Recalculate summary
    recalculateSummary(newData, employees)
    
    onUpdate(newData)
    setEditing(null)
  }

  function deleteShift() {
    if (!editing || !onUpdate) return
    
    const newData = JSON.parse(JSON.stringify(data))
    const day = newData.days[editing.dayKey]
    day.shifts = day.shifts.filter(s => s.id !== editing.shift.id)
    
    recalculateSummary(newData, employees)
    
    onUpdate(newData)
    setEditing(null)
  }

  return (
<div 
  id="schedule-export-target"
  className={`schedule-table-wrapper ${onUpdate ? 'schedule-editable' : ''}`}
>        <div className="schedule-table">
        {DAYS.map(day => {
          const dayData = data.days[day.key] || { shifts: [], emptySlots: [], date: '' }
          const emptySlots = dayData.emptySlots || []
          const hasGaps = emptySlots.length > 0
          const hasShifts = dayData.shifts && dayData.shifts.length > 0

          return (
            <div key={day.key} className="schedule-day-column">
              <div className="schedule-day-header">
                <div className="schedule-day-name">{t(day.labelKey)}</div>
                <div className="schedule-day-date">{formatDayDate(dayData.date, language)}</div>
                {hasGaps && (
                  <div className="schedule-day-warning">
                    <AlertTriangle size={12} />
                  </div>
                )}
              </div>

              <div className="schedule-day-shifts">
                {hasShifts ? (
                  [...dayData.shifts].sort((a, b) => a.start.localeCompare(b.start)).map(shift => {
                    const color = colorForEmployee(shift.employee)
                    return (
                      <div
                        key={shift.id}
                        className={`schedule-shift ${hasHighlight && !matchesHighlight(shift) ? 'schedule-shift-muted' : ''}`}
                        style={{
                          '--shift-bg': color.bg,
                          '--shift-border': color.border,
                          '--shift-text': color.text,
                          '--shift-light-bg': color.lightBg,
                          '--shift-light-text': color.lightText,
                        }}
                        onClick={() => onUpdate && handleShiftClick(day.key, shift)}
                      >
                        <div className="schedule-shift-name">{shift.employee}</div>
                        <div className="schedule-shift-role">{shift.role}</div>
                        <div className="schedule-shift-time">
                          <Clock size={11} />
                          <span>{formatTime(shift.start, language)} — {formatTime(shift.end, language)}</span>
                        </div>
                        <div className="schedule-shift-hours">{shift.hours}h</div>
                      </div>
                    )
                  })
                ) : emptySlots.length === 0 && (
                  <div className="schedule-shift-empty">{t('noShifts')}</div>
                )}

                {emptySlots.map((slot, i) => (
                  <div
                    key={`empty-${i}`}
                    className="schedule-shift schedule-shift-empty-slot"
                    onClick={() => onUpdate && handleAddShift(day.key)}
                  >
                    <div className="schedule-shift-empty-slot-role">
                      {slot.role || t('openShift')}
                    </div>
                    <div className="schedule-shift-time">
                      <Clock size={11} />
                      <span>{formatTime(slot.start, language)} — {formatTime(slot.end, language)}</span>
                    </div>
                    {onUpdate && (
                      <div className="schedule-shift-empty-slot-cta">{t('assign')}</div>
                    )}
                  </div>
                ))}

                {onUpdate && (
                  <button
                    className="schedule-add-shift"
                    onClick={() => handleAddShift(day.key)}
                    aria-label={`${t('addShift')} ${t(day.labelKey)}`}
                  >
                    <Plus size={14} />
                    <span>{t('addShift')}</span>
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Summary */}
      {data.summary && data.summary.length > 0 && (
        <div className="schedule-summary">
          <h4 className="schedule-summary-title">
            <Sparkles size={16} />
            <span>{t('hoursSummary')}</span>
          </h4>
          <div className="schedule-summary-grid">
            {data.summary.map(s => {
              const color = colorForEmployee(s.employee)
              const isOver = s.difference > 0
              const isUnder = s.difference < 0
              const isOnTarget = s.difference === 0
              const TrendIcon = isOver ? TrendingUp : isUnder ? TrendingDown : Minus
              const trendClass = isOver ? 'over' : isUnder ? 'under' : 'on-target'
              
              return (
                <div
                  key={s.employee}
                  className={`schedule-summary-card ${hasHighlight && !matchesHighlight(s) ? 'schedule-summary-card-muted' : ''}`}
                >
                  <div className="schedule-summary-avatar" style={{
                    '--shift-bg': color.bg,
                    '--shift-border': color.border,
                    '--shift-text': color.text,
                    '--shift-light-bg': color.lightBg,
                    '--shift-light-text': color.lightText,
                  }}>
                    {s.employee[0]?.toUpperCase()}
                  </div>
                  <div className="schedule-summary-info">
                    <div className="schedule-summary-name">{s.employee}</div>
                    <div className="schedule-summary-role">{s.role}</div>
                  </div>
                  <div className="schedule-summary-hours">
                    <div className="schedule-summary-value">
                      {s.scheduledHours}
                      <span className="schedule-summary-target">/ {s.targetHours}h</span>
                    </div>
                    <div className={`schedule-summary-trend ${trendClass}`}>
                      <TrendIcon size={12} />
                      <span>
                        {isOnTarget ? t('onTarget') : `${s.difference > 0 ? '+' : ''}${s.difference}h`}
                      </span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Issues */}
      {data.issues && data.issues.length > 0 && (
        <div className="schedule-issues">
          <h4 className="schedule-issues-title">
            <AlertTriangle size={16} />
            <span>{t('scheduleReview')}</span>
          </h4>
          <div className="schedule-issues-list">
            {data.issues.map((issue, i) => {
              const formatted = formatIssue(issue, t)
              return (
                <div className="schedule-issue-card" key={i}>
                  <div className="schedule-issue-heading">{formatted.title}</div>
                  <p>{formatted.body}</p>
                  <span>{formatted.action}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Recommendations */}
      {data.recommendations && data.recommendations.length > 0 && (
        <div className="schedule-recommendations">
          <h4 className="schedule-recommendations-title">
            <Sparkles size={16} />
            <span>{t('hengamRecommendations')}</span>
          </h4>
          <div className="schedule-recommendations-list">
            {data.recommendations.map((rec, i) => (
              <div className="schedule-recommendation-card" key={i}>{rec}</div>
            ))}
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editing && (
        <EditShiftModal
          editing={editing}
          employees={employees}
          roles={roles}
          onSave={saveShift}
          onDelete={editing.isNew ? null : deleteShift}
          onClose={closeModal}
          t={t}
        />
      )}
    </div>
  )
}

// ===== EDIT MODAL =====
function EditShiftModal({ editing, employees, roles, onSave, onDelete, onClose, t }) {
  const [shift, setShift] = useState({ ...editing.shift })

  function handleSave() {
    if (!shift.employee || !shift.start || !shift.end) {
      return
    }
    onSave(shift)
  }

  const dayLabel = DAY_KEY_BY_NAME[editing.dayKey]?.fullLabelKey
    ? t(DAY_KEY_BY_NAME[editing.dayKey].fullLabelKey)
    : editing.dayKey

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card shift-modal" onClick={(e) => e.stopPropagation()}>
        <div className="shift-modal-header">
          <h3 className="modal-title">
            {editing.isNew ? t('addShift') : t('editShift')}
          </h3>
          <button className="modal-close-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        
        <p className="shift-modal-day">{dayLabel}</p>

        <div className="shift-modal-field">
          <label className="shift-modal-label">{t('employee')}</label>
          <select
            className="input"
            value={shift.employee}
            onChange={(e) => {
              const emp = employees.find(x => x.name === e.target.value)
              setShift({ 
                ...shift, 
                employee: e.target.value,
                role: emp?.role || shift.role
              })
            }}
          >
            <option value="">{t('selectEmployee')}</option>
            {employees.map(emp => (
              <option key={emp.id} value={emp.name}>{emp.name}</option>
            ))}
          </select>
        </div>

        <div className="shift-modal-field">
          <label className="shift-modal-label">{t('role')}</label>
          <select
            className="input"
            value={shift.role}
            onChange={(e) => setShift({ ...shift, role: e.target.value })}
          >
            <option value="">{t('selectRole')}</option>
            {roles.map(r => (
              <option key={r.id} value={r.name}>{r.name}</option>
            ))}
          </select>
        </div>

        <div className="shift-modal-row">
          <div className="shift-modal-field">
            <label className="shift-modal-label">{t('start')}</label>
            <input
              type="time"
              className="input"
              value={shift.start}
              onChange={(e) => setShift({ ...shift, start: e.target.value })}
            />
          </div>
          <div className="shift-modal-field">
            <label className="shift-modal-label">{t('end')}</label>
            <input
              type="time"
              className="input"
              value={shift.end}
              onChange={(e) => setShift({ ...shift, end: e.target.value })}
            />
          </div>
        </div>

        <div className="shift-modal-preview">
          <Clock size={14} />
          <span>{t('total')}: {calcHours(shift.start, shift.end)}h</span>
        </div>

        <div className="shift-modal-actions">
          {onDelete && (
            <button 
              className="danger-button shift-modal-delete"
              onClick={onDelete}
            >
              <Trash2 size={14} />
              <span>{t('delete')}</span>
            </button>
          )}
          <div className="shift-modal-right">
            <button className="secondary-button" onClick={onClose}>
              {t('cancel')}
            </button>
            <button 
              className="add-button"
              onClick={handleSave}
              disabled={!shift.employee || !shift.start || !shift.end}
            >
              {editing.isNew ? t('addShift') : t('save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ===== Recalc summary =====
function recalculateSummary(data, employees) {
  const totals = {}
  
  Object.values(data.days).forEach(day => {
    (day.shifts || []).forEach(shift => {
      if (!totals[shift.employee]) {
        totals[shift.employee] = { 
          employee: shift.employee, 
          role: shift.role, 
          scheduledHours: 0,
          targetHours: 0,
          difference: 0
        }
      }
      totals[shift.employee].scheduledHours += Number(shift.hours) || 0
    })
  })
  
  // Add target hours + people not scheduled
  employees.forEach(emp => {
    if (!totals[emp.name]) {
      totals[emp.name] = { 
        employee: emp.name, 
        role: emp.role, 
        scheduledHours: 0,
        targetHours: emp.targetHours || 0,
        difference: -(emp.targetHours || 0)
      }
    } else {
      totals[emp.name].targetHours = emp.targetHours || 0
      totals[emp.name].difference = totals[emp.name].scheduledHours - (emp.targetHours || 0)
    }
    
    // Round
    totals[emp.name].scheduledHours = Math.round(totals[emp.name].scheduledHours * 10) / 10
    totals[emp.name].difference = Math.round(totals[emp.name].difference * 10) / 10
  })
  
  data.summary = Object.values(totals)
}

export default ScheduleTable

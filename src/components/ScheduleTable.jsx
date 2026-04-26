import { useState } from 'react'
import { Clock, AlertTriangle, TrendingUp, TrendingDown, Minus, Sparkles, X, Plus, Trash2 } from 'lucide-react'

const DAYS = [
  { key: 'monday', label: 'Mon' },
  { key: 'tuesday', label: 'Tue' },
  { key: 'wednesday', label: 'Wed' },
  { key: 'thursday', label: 'Thu' },
  { key: 'friday', label: 'Fri' },
  { key: 'saturday', label: 'Sat' },
  { key: 'sunday', label: 'Sun' },
]

function colorForEmployee(name) {
  const colors = [
    { bg: 'rgba(99, 102, 241, 0.12)', border: 'rgba(99, 102, 241, 0.3)', text: '#A5B4FC' },
    { bg: 'rgba(139, 92, 246, 0.12)', border: 'rgba(139, 92, 246, 0.3)', text: '#C4B5FD' },
    { bg: 'rgba(236, 72, 153, 0.12)', border: 'rgba(236, 72, 153, 0.3)', text: '#F9A8D4' },
    { bg: 'rgba(16, 185, 129, 0.12)', border: 'rgba(16, 185, 129, 0.3)', text: '#6EE7B7' },
    { bg: 'rgba(245, 158, 11, 0.12)', border: 'rgba(245, 158, 11, 0.3)', text: '#FCD34D' },
    { bg: 'rgba(14, 165, 233, 0.12)', border: 'rgba(14, 165, 233, 0.3)', text: '#7DD3FC' },
    { bg: 'rgba(239, 68, 68, 0.12)', border: 'rgba(239, 68, 68, 0.3)', text: '#FCA5A5' },
    { bg: 'rgba(168, 85, 247, 0.12)', border: 'rgba(168, 85, 247, 0.3)', text: '#D8B4FE' },
  ]
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return colors[Math.abs(hash) % colors.length]
}

function formatTime(time24) {
  if (!time24) return ''
  const [h, m] = time24.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h
  return m === 0 ? `${displayH}${period.toLowerCase()}` : `${displayH}:${String(m).padStart(2, '0')}${period.toLowerCase()}`
}

function formatDayDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function calcHours(start, end) {
  if (!start || !end) return 0
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  let hours = (eh + em / 60) - (sh + sm / 60)
  if (hours < 0) hours += 24
  return Math.round(hours * 10) / 10
}

function ScheduleTable({ data, employees = [], roles = [], onUpdate }) {
  const [editing, setEditing] = useState(null) // { dayKey, shift } or { dayKey, shift: null } for new
  
  if (!data || !data.days) return null

  function handleShiftClick(dayKey, shift) {
    setEditing({ dayKey, shift: { ...shift } })
  }

  function handleAddShift(dayKey) {
    setEditing({
      dayKey,
      shift: {
        id: `new-${Date.now()}`,
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
                <div className="schedule-day-name">{day.label}</div>
                <div className="schedule-day-date">{formatDayDate(dayData.date)}</div>
                {hasGaps && (
                  <div className="schedule-day-warning">
                    <AlertTriangle size={12} />
                  </div>
                )}
              </div>

              <div className="schedule-day-shifts">
                {hasShifts ? (
                  dayData.shifts.map(shift => {
                    const color = colorForEmployee(shift.employee)
                    return (
                      <div
                        key={shift.id}
                        className="schedule-shift"
                        style={{
                          background: color.bg,
                          borderColor: color.border,
                          color: color.text,
                        }}
                        onClick={() => onUpdate && handleShiftClick(day.key, shift)}
                      >
                        <div className="schedule-shift-name">{shift.employee}</div>
                        <div className="schedule-shift-role">{shift.role}</div>
                        <div className="schedule-shift-time">
                          <Clock size={11} />
                          <span>{formatTime(shift.start)} — {formatTime(shift.end)}</span>
                        </div>
                        <div className="schedule-shift-hours">{shift.hours}h</div>
                      </div>
                    )
                  })
                ) : emptySlots.length === 0 && (
                  <div className="schedule-shift-empty">No shifts</div>
                )}

                {emptySlots.map((slot, i) => (
                  <div
                    key={`empty-${i}`}
                    className="schedule-shift schedule-shift-empty-slot"
                    onClick={() => onUpdate && handleAddShift(day.key)}
                  >
                    <div className="schedule-shift-empty-slot-role">
                      {slot.role || 'Open shift'}
                    </div>
                    <div className="schedule-shift-time">
                      <Clock size={11} />
                      <span>{formatTime(slot.start)} — {formatTime(slot.end)}</span>
                    </div>
                    {onUpdate && (
                      <div className="schedule-shift-empty-slot-cta">Assign +</div>
                    )}
                  </div>
                ))}

                {onUpdate && (
                  <button
                    className="schedule-add-shift"
                    onClick={() => handleAddShift(day.key)}
                    aria-label={`Add shift on ${day.label}`}
                  >
                    <Plus size={14} />
                    <span>Add shift</span>
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
            <span>Hours Summary</span>
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
                <div key={s.employee} className="schedule-summary-card">
                  <div className="schedule-summary-avatar" style={{
                    background: color.bg,
                    borderColor: color.border,
                    color: color.text,
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
                        {isOnTarget ? 'On target' : `${s.difference > 0 ? '+' : ''}${s.difference}h`}
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
            <span>Schedule Issues</span>
          </h4>
          <ul className="schedule-issues-list">
            {data.issues.map((issue, i) => (
              <li key={i}>{issue}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Recommendations */}
      {data.recommendations && data.recommendations.length > 0 && (
        <div className="schedule-recommendations">
          <h4 className="schedule-recommendations-title">
            <Sparkles size={16} />
            <span>AI Recommendations</span>
          </h4>
          <ul className="schedule-recommendations-list">
            {data.recommendations.map((rec, i) => (
              <li key={i}>{rec}</li>
            ))}
          </ul>
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
        />
      )}
    </div>
  )
}

// ===== EDIT MODAL =====
function EditShiftModal({ editing, employees, roles, onSave, onDelete, onClose }) {
  const [shift, setShift] = useState({ ...editing.shift })

  function handleSave() {
    if (!shift.employee || !shift.start || !shift.end) {
      return
    }
    onSave(shift)
  }

  const dayLabel = editing.dayKey.charAt(0).toUpperCase() + editing.dayKey.slice(1)

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card shift-modal" onClick={(e) => e.stopPropagation()}>
        <div className="shift-modal-header">
          <h3 className="modal-title">
            {editing.isNew ? 'Add shift' : 'Edit shift'}
          </h3>
          <button className="modal-close-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        
        <p className="shift-modal-day">{dayLabel}</p>

        <div className="shift-modal-field">
          <label className="shift-modal-label">Employee</label>
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
            <option value="">Select employee...</option>
            {employees.map(emp => (
              <option key={emp.id} value={emp.name}>{emp.name}</option>
            ))}
          </select>
        </div>

        <div className="shift-modal-field">
          <label className="shift-modal-label">Role</label>
          <select
            className="input"
            value={shift.role}
            onChange={(e) => setShift({ ...shift, role: e.target.value })}
          >
            <option value="">Select role...</option>
            {roles.map(r => (
              <option key={r.id} value={r.name}>{r.name}</option>
            ))}
          </select>
        </div>

        <div className="shift-modal-row">
          <div className="shift-modal-field">
            <label className="shift-modal-label">Start</label>
            <input
              type="time"
              className="input"
              value={shift.start}
              onChange={(e) => setShift({ ...shift, start: e.target.value })}
            />
          </div>
          <div className="shift-modal-field">
            <label className="shift-modal-label">End</label>
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
          <span>Total: {calcHours(shift.start, shift.end)}h</span>
        </div>

        <div className="shift-modal-actions">
          {onDelete && (
            <button 
              className="danger-button shift-modal-delete"
              onClick={onDelete}
            >
              <Trash2 size={14} />
              <span>Delete</span>
            </button>
          )}
          <div className="shift-modal-right">
            <button className="secondary-button" onClick={onClose}>
              Cancel
            </button>
            <button 
              className="add-button"
              onClick={handleSave}
              disabled={!shift.employee || !shift.start || !shift.end}
            >
              {editing.isNew ? 'Add shift' : 'Save'}
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
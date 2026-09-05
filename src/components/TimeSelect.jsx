const MINUTES = ['00', '15', '30', '45']

// Shared 12-hour time control used for both employee availability and
// workspace operating hours so the two read identically.
function TimeSelect({ value, disabled, onChange }) {
  const [rawH = '09', rawM = '00'] = (value || '09:00').split(':')
  const totalH = parseInt(rawH, 10)
  const period = totalH < 12 ? 'AM' : 'PM'
  const h12 = totalH === 0 ? 12 : totalH > 12 ? totalH - 12 : totalH
  const m = MINUTES.includes(rawM) ? rawM : '00'

  function emit(newH12, newM, newPeriod) {
    let h24
    if (newPeriod === 'AM') h24 = newH12 === 12 ? 0 : newH12
    else h24 = newH12 === 12 ? 12 : newH12 + 12
    onChange(`${String(h24).padStart(2, '0')}:${newM}`)
  }

  return (
    <div className={`time-select${disabled ? ' disabled' : ''}`}>
      <select className="time-select-hour" value={h12} disabled={disabled}
        onChange={e => emit(parseInt(e.target.value, 10), m, period)}>
        {[12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(h => (
          <option key={h} value={h}>{h}</option>
        ))}
      </select>
      <span className="time-select-colon">:</span>
      <select className="time-select-min" value={m} disabled={disabled}
        onChange={e => emit(h12, e.target.value, period)}>
        {MINUTES.map(min => <option key={min} value={min}>{min}</option>)}
      </select>
      <button type="button" className="time-select-ampm" disabled={disabled}
        onClick={() => emit(h12, m, period === 'AM' ? 'PM' : 'AM')}>
        {period}
      </button>
    </div>
  )
}

export default TimeSelect
export { MINUTES }

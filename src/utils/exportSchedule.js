import html2canvas from 'html2canvas'
import jsPDF from 'jspdf'

export function exportToCSV(data, weekStart) {
    if (!data || !data.days) return
    
    const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
    const DAY_LABELS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    
    // Collect all unique employees from shifts
    const employeeSet = new Map()
    DAYS.forEach(dayKey => {
      const day = data.days[dayKey]
      if (!day || !day.shifts) return
      day.shifts.forEach(shift => {
        if (!employeeSet.has(shift.employee)) {
          employeeSet.set(shift.employee, shift.role)
        }
      })
    })
    
    // Also include people from summary (in case they're scheduled 0 hrs)
    if (data.summary) {
      data.summary.forEach(s => {
        if (!employeeSet.has(s.employee)) {
          employeeSet.set(s.employee, s.role)
        }
      })
    }
    
    const employees = Array.from(employeeSet.entries()).map(([name, role]) => ({ name, role }))
    
    const rows = []
    
    // Header row: Employee | Role | Mon (date) | Tue (date) | ... | Total
    const headerRow = ['Employee', 'Role']
    DAYS.forEach((dayKey, i) => {
      const date = data.days[dayKey]?.date || ''
      headerRow.push(`${DAY_LABELS[i]}${date ? ` (${date})` : ''}`)
    })
    headerRow.push('Total Hours')
    headerRow.push('Target Hours')
    headerRow.push('Difference')
    rows.push(headerRow)
    
    // One row per employee
    employees.forEach(emp => {
      const row = [emp.name, emp.role]
      let totalHours = 0
      
      DAYS.forEach(dayKey => {
        const day = data.days[dayKey]
        const shifts = (day?.shifts || []).filter(s => s.employee === emp.name)
        
        if (shifts.length === 0) {
          row.push('')
        } else {
          // Format all shifts for this employee this day
          const cellText = shifts.map(s => {
            totalHours += Number(s.hours) || 0
            return `${s.start}-${s.end} (${s.hours}h)`
          }).join(' | ')
          row.push(cellText)
        }
      })
      
      // Find summary info for this employee
      const summary = data.summary?.find(s => s.employee === emp.name)
      row.push(Math.round(totalHours * 10) / 10)
      row.push(summary?.targetHours ?? '')
      row.push(summary?.difference ?? '')
      
      rows.push(row)
    })
    
    // Empty row, then issues
    if (data.issues && data.issues.length > 0) {
      rows.push([])
      rows.push(['SCHEDULE ISSUES'])
      data.issues.forEach(issue => rows.push([issue]))
    }
    
    // Empty row, then recommendations
    if (data.recommendations && data.recommendations.length > 0) {
      rows.push([])
      rows.push(['RECOMMENDATIONS'])
      data.recommendations.forEach(rec => rows.push([rec]))
    }
    
    const csv = rows.map(row => 
      row.map(cell => {
        const str = String(cell ?? '')
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`
        }
        return str
      }).join(',')
    ).join('\n')
    
    downloadFile(csv, `schedule-${weekStart || 'export'}.csv`, 'text/csv;charset=utf-8;')
  }

// ========== PNG EXPORT ==========
export async function exportToPNG(elementId, weekStart) {
  const source = document.getElementById(elementId)
  if (!source) {
    throw new Error('Schedule element not found')
  }
  const { element, cleanup } = prepareExportElement(source)
  
  try {
    const canvas = await html2canvas(element, {
      backgroundColor: '#0A0A0B',
      scale: 2,
      logging: false,
      useCORS: true,
      width: element.scrollWidth,
      height: element.scrollHeight,
      windowWidth: 1600,
      windowHeight: element.scrollHeight,
      scrollX: 0,
      scrollY: 0,
    })
  
    canvas.toBlob(blob => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `schedule-${weekStart || 'export'}.png`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      setTimeout(() => URL.revokeObjectURL(url), 100)
    })
  } finally {
    cleanup()
  }
}

export async function exportToPDF(elementId, weekStart) {
    const source = document.getElementById(elementId)
    if (!source) {
      throw new Error('Schedule element not found')
    }
    const { element, cleanup } = prepareExportElement(source)
    
    let canvas
    try {
      canvas = await html2canvas(element, {
        backgroundColor: '#0A0A0B',
        scale: 2,
        logging: false,
        useCORS: true,
        width: element.scrollWidth,
        height: element.scrollHeight,
        windowWidth: 1600,
        windowHeight: element.scrollHeight,
        scrollX: 0,
        scrollY: 0,
      })
    } finally {
      cleanup()
    }
    
    // Standard landscape A4 in points
    const pdfWidth = 842
    const pdfHeight = 595
    const margin = 20
    const usableWidth = pdfWidth - margin * 2
    
    // Scale the canvas to fit page width
    const ratio = usableWidth / canvas.width
    const scaledHeight = canvas.height * ratio
    const usableHeight = pdfHeight - margin * 2
    
    const pdf = new jsPDF({
      orientation: 'landscape',
      unit: 'pt',
      format: 'a4'
    })
    
    // Fill background
    pdf.setFillColor(10, 10, 11)
    pdf.rect(0, 0, pdfWidth, pdfHeight, 'F')
    
    if (scaledHeight <= usableHeight) {
      // Fits on one page
      const imgData = canvas.toDataURL('image/png')
      pdf.addImage(imgData, 'PNG', margin, margin, usableWidth, scaledHeight)
    } else {
      // Multi-page — slice the canvas
      const pageCanvasHeight = usableHeight / ratio // equivalent pixels in original canvas
      let yOffset = 0
      let pageCount = 0
      
      while (yOffset < canvas.height) {
        if (pageCount > 0) {
          pdf.addPage()
          pdf.setFillColor(10, 10, 11)
          pdf.rect(0, 0, pdfWidth, pdfHeight, 'F')
        }
        
        const sliceHeight = Math.min(pageCanvasHeight, canvas.height - yOffset)
        
        // Create a slice canvas
        const sliceCanvas = document.createElement('canvas')
        sliceCanvas.width = canvas.width
        sliceCanvas.height = sliceHeight
        const ctx = sliceCanvas.getContext('2d')
        ctx.fillStyle = '#0A0A0B'
        ctx.fillRect(0, 0, canvas.width, sliceHeight)
        ctx.drawImage(
          canvas,
          0, yOffset, canvas.width, sliceHeight,
          0, 0, canvas.width, sliceHeight
        )
        
        const sliceData = sliceCanvas.toDataURL('image/png')
        pdf.addImage(sliceData, 'PNG', margin, margin, usableWidth, sliceHeight * ratio)
        
        yOffset += sliceHeight
        pageCount++
      }
    }
    
    pdf.save(`schedule-${weekStart || 'export'}.pdf`)
  }

// ========== HELPER ==========
function prepareExportElement(source) {
  const clone = source.cloneNode(true)
  clone.removeAttribute('id')
  clone.classList.add('schedule-export-clone')
  clone.style.maxWidth = 'none'
  clone.style.height = 'auto'
  clone.style.overflow = 'visible'
  clone.style.position = 'fixed'
  clone.style.left = '0'
  clone.style.top = '0'
  clone.style.zIndex = '-1'
  clone.style.pointerEvents = 'none'
  clone.style.background = '#0A0A0B'

  document.body.appendChild(clone)

  clone.querySelectorAll('*').forEach(node => {
    node.style.animation = 'none'
    node.style.transition = 'none'
    if (node.classList.contains('schedule-table-wrapper')) {
      node.style.maxWidth = 'none'
      node.style.overflow = 'visible'
      node.style.width = 'auto'
    }
    if (node.classList.contains('schedule-table')) {
      node.style.gridTemplateColumns = 'repeat(7, minmax(158px, 1fr))'
      node.style.minWidth = '1180px'
      node.style.width = 'auto'
    }
  })

  // Measure after forcing desktop grid
  clone.style.width = `${clone.scrollWidth}px`

  return {
    element: clone,
    cleanup: () => clone.remove(),
  }
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  setTimeout(() => URL.revokeObjectURL(url), 100)
}

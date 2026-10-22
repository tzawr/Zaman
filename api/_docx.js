import { XlsxError, decode, readZip } from './_xlsx.js'

// Reads the tables of a Word (.docx) file into rows of strings, the way
// readXlsx reads a sheet. Managers often send a schedule as a Word table;
// reading it here costs nothing, where a photo of it would need AI.
//
// A cell spanning several columns fills them all with its text, and a cell
// merged down from the row above repeats that row's text, so names and days
// stay lined up with their columns.

// The text of a cell: runs joined, paragraphs and line breaks as spaces.
function cellText(xml) {
  const paragraphs = [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map(([p]) => p
    // Tabs and line breaks become spaces between the runs either side.
    .replace(/<w:(?:tab|br|cr)\b[^>]*\/>/g, '<w:t> </w:t>')
    .match(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>/g)
    ?.map(t => t.replace(/^<w:t[^>]*>|<\/w:t>$/g, '')).join('') || '')
  return decode(paragraphs.join(' ')).replace(/\s+/g, ' ').trim()
}

function readTable(xml) {
  const rows = []
  for (const tr of xml.matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>/g)) {
    const row = []
    for (const tc of tr[0].matchAll(/<w:tc[ >][\s\S]*?<\/w:tc>/g)) {
      const span = Number(tc[0].match(/<w:gridSpan w:val="(\d+)"/)?.[1] || 1)
      // vMerge without restart continues the cell above.
      const continued = /<w:vMerge\s*\/>|<w:vMerge w:val="continue"\s*\/>/.test(tc[0])
      const col = row.length
      const text = continued ? (rows[rows.length - 1]?.[col] ?? '') : cellText(tc[0])
      for (let i = 0; i < Math.min(span, 31); i++) row.push(text)
    }
    if (row.some(Boolean)) rows.push(row)
  }
  return rows
}

// Every table in the document, in order. Tables nested inside a cell are
// read as part of that cell's text, which is rare in a schedule.
export function readDocxTables(buffer) {
  const file = readZip(Buffer.from(buffer), 'Word')
  const xml = file('word/document.xml')
  if (!xml) throw new XlsxError('This Word file has no document in it.')
  const tables = []
  let depth = 0
  let start = -1
  for (const m of xml.matchAll(/<w:tbl>|<w:tbl [^>]*>|<\/w:tbl>/g)) {
    if (m[0] === '</w:tbl>') {
      depth--
      if (depth === 0 && start >= 0) tables.push(readTable(xml.slice(start, m.index)))
    } else if (depth++ === 0) {
      start = m.index
    }
  }
  return tables.filter(t => t.length)
}

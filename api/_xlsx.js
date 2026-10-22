import { inflateRawSync } from 'node:zlib'

// Reads the first worksheet of an .xlsx file into rows of strings. An .xlsx
// is a zip of XML; this reads just what a schedule needs (shared strings and
// one sheet's cell values) with Node's own zlib, so no spreadsheet library
// with its own parsing bugs ships to the server.
//
// Numbers come back as their stored text: dates as Excel serial numbers and
// times as fractions of a day, which shared/teams/imports.js understands.

const MAX_ENTRY_BYTES = 20 * 1024 * 1024
const MAX_ENTRIES = 2000

export class XlsxError extends Error {}

// The entries of a zip file, by name. `kind` names the file in errors
// ("Excel", "Word").
export function readZip(buf, kind = 'Excel') {
  // The end-of-central-directory record is in the last 64KB.
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new XlsxError(`This is not ${kind === 'Excel' ? 'an' : 'a'} ${kind} file.`)
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  if (count > MAX_ENTRIES) throw new XlsxError('This file has too many parts to be a schedule.')
  const entries = new Map()
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new XlsxError(`This ${kind} file is damaged.`)
    const method = buf.readUInt16LE(p + 10)
    const compressed = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const local = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    entries.set(name, { method, compressed, local })
    p += 46 + nameLen + extraLen + commentLen
  }
  return (name) => {
    const e = entries.get(name)
    if (!e) return null
    const start = e.local + 30 + buf.readUInt16LE(e.local + 26) + buf.readUInt16LE(e.local + 28)
    const data = buf.subarray(start, start + e.compressed)
    if (e.method === 0) return data.toString('utf8')
    if (e.method !== 8) throw new XlsxError(`This ${kind} file uses compression that is not supported.`)
    try {
      return inflateRawSync(data, { maxOutputLength: MAX_ENTRY_BYTES }).toString('utf8')
    } catch {
      throw new XlsxError(`This ${kind} file is too large or damaged.`)
    }
  }
}

export const decode = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&amp;/g, '&')

// All the text of an element, rich-text runs included.
const textOf = (xml) => decode([...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m => m[1]).join(''))

function columnIndex(ref) {
  const letters = ref.match(/^[A-Z]+/)?.[0] || 'A'
  return [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1
}

export function readXlsx(buffer) {
  const file = readZip(Buffer.from(buffer))
  const workbook = file('xl/workbook.xml')
  if (!workbook) throw new XlsxError('This is not an Excel workbook.')

  // The first sheet in the workbook, found through its relationship.
  const firstRid = workbook.match(/<sheet\b[^>]*\br:id="([^"]+)"/)?.[1]
  const rels = file('xl/_rels/workbook.xml.rels') || ''
  const target = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map(m => m[0])
    .find(r => r.includes(`Id="${firstRid}"`))?.match(/Target="([^"]+)"/)?.[1]
  const sheetPath = target ? (target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`) : 'xl/worksheets/sheet1.xml'
  const sheet = file(sheetPath)
  if (!sheet) throw new XlsxError('This workbook has no worksheet.')

  const shared = [...(file('xl/sharedStrings.xml') || '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => textOf(m[1]))

  const rows = []
  for (const rowMatch of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = []
    for (const c of rowMatch[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1]
      const body = c[2] || ''
      const ref = attrs.match(/\br="([A-Z]+\d+)"/)?.[1]
      const type = attrs.match(/\bt="([^"]+)"/)?.[1]
      const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1]
      let value = ''
      if (type === 's') value = shared[Number(v)] ?? ''
      else if (type === 'inlineStr') value = textOf(body)
      else if (type === 'b') value = v === '1' ? 'TRUE' : 'FALSE'
      else if (v !== undefined) value = decode(v)
      row[ref ? columnIndex(ref) : row.length] = value.trim()
    }
    rows.push(Array.from(row, x => x ?? ''))
  }
  return rows.filter(r => r.some(c => c !== ''))
}

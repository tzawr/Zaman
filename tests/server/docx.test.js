import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readDocxTables } from '../../api/_docx.js'
import { XlsxError } from '../../api/_xlsx.js'
import { interpretTable } from '../../shared/teams/imports.js'
import { zip } from './_zip.js'

const run = (text) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`
const cell = (text, props = '') => `<w:tc><w:tcPr>${props}</w:tcPr><w:p>${run(text)}</w:p></w:tc>`
const row = (...cells) => `<w:tr>${cells.join('')}</w:tr>`
const table = (...rows) => `<w:tbl><w:tblPr/>${rows.join('')}</w:tbl>`
const docx = (body) => zip({ 'word/document.xml': `<w:document><w:body>${body}</w:body></w:document>` })

test('reads every table, with merged cells lined up', () => {
  const file = docx(
    '<w:p>' + run('Promenade 10.19-11.1.2026') + '</w:p>' +
    table(
      row(cell('Name'), cell('Mon'), cell('Tue'), cell('Wed')),
      // A run split across two text nodes, and a tab between two parts.
      row(cell('Ali', '<w:vMerge w:val="restart"/>'), '<w:tc><w:p>' + run('10:30') + run('a-7p') + '</w:p></w:tc>', cell('OFF'), cell('Closing', '<w:gridSpan w:val="1"/>')),
      row(cell('', '<w:vMerge/>'), cell('6a-2p'), cell('6a-2p'), cell('6a-2p')),
      row(cell('Janet &amp; Co'), cell('Training all week', '<w:gridSpan w:val="3"/>')),
    ) +
    table(row(cell('Name'), cell('Mon'), cell('Tue'), cell('Wed')), row(cell('Ali'), cell('2p-close'), cell(''), cell('9-5'))),
  )
  const tables = readDocxTables(file)
  assert.equal(tables.length, 2)
  assert.deepEqual(tables[0], [
    ['Name', 'Mon', 'Tue', 'Wed'],
    ['Ali', '10:30a-7p', 'OFF', 'Closing'],
    ['Ali', '6a-2p', '6a-2p', '6a-2p'],
    ['Janet & Co', 'Training all week', 'Training all week', 'Training all week'],
  ])
  assert.deepEqual(tables[1][1], ['Ali', '2p-close', '', '9-5'])
})

test('a file with no table, and a file that is not Word', () => {
  assert.deepEqual(readDocxTables(docx('<w:p>' + run('No table here') + '</w:p>')), [])
  assert.throws(() => readDocxTables(Buffer.from('not a zip at all')), (err) => err instanceof XlsxError && /not a Word file/.test(err.message))
})

test('weekday-only columns that repeat run into the next week', () => {
  const header = ['Name', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue']
  const read = interpretTable([header, ['Ali', '', '', '', '', '', '', '', '9-5', '9-5']], { weekStart: '2026-10-19' })
  assert.deepEqual(read.rows.map(r => r.date), ['2026-10-26', '2026-10-27'])
})

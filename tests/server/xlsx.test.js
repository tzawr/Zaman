import { test } from 'node:test'
import assert from 'node:assert/strict'
import { XlsxError, readXlsx } from '../../api/_xlsx.js'
import { zip } from './_zip.js'

const workbook = (sheetXml, shared = []) => zip({
  'xl/workbook.xml': '<workbook><sheets><sheet name="Week" sheetId="1" r:id="rId1"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/></Relationships>',
  'xl/sharedStrings.xml': `<sst>${shared.map(s => `<si>${s}</si>`).join('')}</sst>`,
  'xl/worksheets/sheet1.xml': `<worksheet><sheetData>${sheetXml}</sheetData></worksheet>`,
})

test('reads shared strings, rich text, inline strings, numbers, and gaps', () => {
  const file = workbook(
    '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="D1" t="inlineStr"><is><t>End</t></is></c></row>' +
    '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>46322</v></c><c r="C2"><v>0.375</v></c><c r="D2" t="str"><v>17:00</v></c></row>' +
    '<row r="3"/>',
    ['<t>Name</t>', '<t>Date</t>', '<r><t>Ana </t></r><r><t xml:space="preserve">Lima &amp; Co</t></r>'],
  )
  assert.deepEqual(readXlsx(file), [
    ['Name', 'Date', '', 'End'],
    ['Ana Lima & Co', '46322', '0.375', '17:00'],
  ])
})

test('anything that is not a workbook is refused with a reason', () => {
  assert.throws(() => readXlsx(Buffer.from('Name,Date\nAna,1')), XlsxError)
  assert.throws(() => readXlsx(zip({ 'hello.txt': 'hi' })), /not an Excel workbook/)
})

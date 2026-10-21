import { deflateRawSync } from 'node:zlib'

// A tiny zip writer, enough to build test workbooks without a library.
export function zip(files) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const [name, text] of Object.entries(files)) {
    const nameBuf = Buffer.from(name)
    const data = deflateRawSync(Buffer.from(text))
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8)
    local.writeUInt32LE(data.length, 18); local.writeUInt16LE(nameBuf.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10)
    central.writeUInt32LE(data.length, 20); central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(offset, 42)
    locals.push(local, nameBuf, data)
    centrals.push(central, nameBuf)
    offset += 30 + nameBuf.length + data.length
  }
  const cd = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 10)
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, end])
}

// A one-sheet workbook from rows of strings, as Excel writes it.
export function workbookOf(rows) {
  const col = (i) => String.fromCharCode(65 + i)
  const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  const sheet = rows.map((r, i) => `<row r="${i + 1}">${r.map((v, j) => `<c r="${col(j)}${i + 1}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`).join('')}</row>`).join('')
  return zip({
    'xl/workbook.xml': '<workbook><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': `<worksheet><sheetData>${sheet}</sheetData></worksheet>`,
  })
}

import { Platform } from 'react-native'
import * as DocumentPicker from 'expo-document-picker'

// Lets the manager choose a schedule file and returns it as base64, ready to
// send. On the web the picker reads the file itself; on phones the file is
// read from where the picker copied it.

export const IMPORT_TYPES = [
  'text/csv', 'text/plain', 'application/pdf', 'image/*',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]
const MAX_BYTES = 3 * 1024 * 1024

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  // In slices, so a large file does not overflow the call stack.
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return globalThis.btoa(binary)
}

export async function pickScheduleFile() {
  const result = await DocumentPicker.getDocumentAsync({ type: IMPORT_TYPES, copyToCacheDirectory: true, base64: true })
  if (result.canceled || !result.assets?.length) return null
  const asset = result.assets[0]
  if (asset.size && asset.size > MAX_BYTES) {
    const err = new Error('That file is over 3 MB. Export just the week you need, or take a smaller photo.')
    err.code = 'too_large'
    throw err
  }
  let data
  if (Platform.OS === 'web') {
    data = asset.base64 || (asset.uri.startsWith('data:') ? asset.uri : null)
    if (data?.startsWith('data:')) data = data.slice(data.indexOf(',') + 1)
    if (!data && asset.file) data = toBase64(await asset.file.arrayBuffer())
  } else {
    const { File } = await import('expo-file-system')
    data = toBase64(await new File(asset.uri).arrayBuffer())
  }
  return { name: asset.name, mimeType: asset.mimeType || '', data }
}

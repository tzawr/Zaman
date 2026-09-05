import assert from 'node:assert/strict'
import test from 'node:test'
import { getSetupStatus, isSetupComplete, formatNameList } from './setupChecklist.js'

const ready = {
  userData: { roles: ['Barista'], operatingHours: { monday: { open: true } } },
  employees: [{ name: 'Ava', availability: { monday: { available: true } } }],
}

test('a fully configured workspace reads as complete', () => {
  assert.equal(isSetupComplete(getSetupStatus(ready)), true)
})

test('each missing piece is reported on its own', () => {
  const missing = (input) => Object.entries(getSetupStatus(input))
    .filter(([, item]) => !item.complete)
    .map(([key]) => key)

  assert.deepEqual(missing({}), ['roles', 'hours', 'team', 'availability'])
  assert.deepEqual(missing({ ...ready, userData: { ...ready.userData, roles: [] } }), ['roles'])
  assert.deepEqual(missing({ ...ready, userData: { ...ready.userData, operatingHours: { monday: { open: false } } } }), ['hours'])
  assert.deepEqual(missing({ ...ready, employees: [] }), ['team', 'availability'])
})

test('an employee saved without a name still blocks completion', () => {
  const status = getSetupStatus({ ...ready, employees: [{ availability: {} }] })
  assert.equal(status.availability.complete, false)
  assert.deepEqual(status.availability.missingNames, [])
})

test('missing names read like a sentence', () => {
  assert.equal(formatNameList(['Ali']), 'Ali')
  assert.equal(formatNameList(['Ali', 'Tom']), 'Ali and Tom')
  assert.equal(formatNameList(['Ali', 'Tom', 'Maria']), 'Ali, Tom and Maria')
  assert.equal(formatNameList([]), '')
})

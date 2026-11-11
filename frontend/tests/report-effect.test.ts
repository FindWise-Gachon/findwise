import assert from 'node:assert/strict'
import test from 'node:test'
import { reportEffects } from '../src/map/reportEffect.ts'
import type { SearchedRecord } from '../src/map/searchRecord.ts'

const original: SearchedRecord['cells'] = [[20, .6], [24, .4]]
const first: SearchedRecord = {
  version: 1, kind: 'searched', caseKey: 'case', id: 'first', duplicateKey: 'first',
  rawText: 'First report', reason: 'Area checked', reviewer: 'Reviewer', point: [-119.5, 37.7], radius: 50,
  searchedAtUtc: '2026-11-01T12:00:00.000Z', approvedAtUtc: '2026-11-01T12:15:00.000Z',
  runKey: 'run-a', stepSeconds: 1800, sequence: 1, changed: true, cells: [[20, .5], [24, .5]],
}
const second: SearchedRecord = { ...first, id: 'second', sequence: 2, cells: [[20, .4], [24, .6]] }

test('uses each approval’s immediate predecessor at the same run and time', () => {
  const records = [second, { ...first, runKey: 'run-b' }, { ...first, stepSeconds: 3600 }, first]
  assert.deepEqual(reportEffects(records, first.runKey, first.stepSeconds, original), [
    { report: first, before: original },
    { report: second, before: first.cells },
  ])
})

test('does not attribute a change when the approval order or cells cannot be matched', () => {
  const effects = (records: SearchedRecord[]) => reportEffects(records, first.runKey, first.stepSeconds, original)
  assert.deepEqual(effects([second]), [])
  assert.deepEqual(effects([first, { ...first, id: 'duplicate' }, second]), [])
  assert.deepEqual(effects([first, { ...second, cells: [[21, .4], [24, .6]] }]), [{ report: first, before: original }])
})

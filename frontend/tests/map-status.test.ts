import test from 'node:test'
import assert from 'node:assert/strict'
import { mapStatusReducer } from '../src/map/status.ts'

test('the first idle event connects a clean attempt', () => {
  assert.equal(mapStatusReducer('loading', 'idle'), 'connected')
})

test('idle cannot hide a data error before or after the first connection', () => {
  for (const previous of ['loading', 'connected'] as const) {
    const failed = mapStatusReducer(previous, 'error')
    assert.equal(failed, 'data-error')
    assert.equal(mapStatusReducer(failed, 'idle'), 'data-error')
  }
})

test('retry starts a fresh attempt after a startup or data error', () => {
  const startupError = mapStatusReducer('loading', 'startup-error')
  assert.equal(startupError, 'startup-error')
  assert.equal(mapStatusReducer(startupError, 'idle'), 'startup-error')
  for (const failed of [startupError, 'data-error'] as const) {
    const retry = mapStatusReducer(failed, 'retry')
    assert.equal(retry, 'loading')
    assert.equal(mapStatusReducer(retry, 'idle'), 'connected')
  }
})

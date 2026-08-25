import test from 'node:test'
import assert from 'node:assert/strict'
import { fullTopic, parsePayload, parseTopic, UmhAdapter } from './umh.js'
import type { UmhConfig } from './types.js'

const config: UmhConfig = {
  brokers: ['127.0.0.1:9092'],
  schemaRegistryUrl: 'http://registry.test',
  clientId: 'dsh-uns-test',
  requestTimeoutMs: 1000,
}

test('parseTopic extracts contract segment', () => {
  assert.equal(parseTopic('umh.v1.plant.area._raw.temp').contract, '_raw')
  assert.equal(parseTopic('umh.v1.plant.area._timeseries-number_v1.temp').contract, '_timeseries-number_v1')
})

test('parseTopic returns undefined contract for non-contract topics', () => {
  assert.equal(parseTopic('umh.v1.plant.area.temp').contract, undefined)
})

test('parseTopic keeps non-prefixed topics intact', () => {
  const parsed = parseTopic('custom.topic')
  assert.equal(parsed.path, 'custom.topic')
  assert.equal(parsed.contract, undefined)
})

test('fullTopic is idempotent on prefixed paths', () => {
  assert.equal(fullTopic('plant.area.temp'), 'umh.v1.plant.area.temp')
  assert.equal(fullTopic('umh.v1.plant.area.temp'), 'umh.v1.plant.area.temp')
})

test('parsePayload unwraps umh value envelopes', () => {
  const payload = Buffer.from(JSON.stringify({ timestamp_ms: 1700000000000, value: 42 }))
  assert.deepEqual(parsePayload(payload), { value: 42, timestampMs: 1700000000000 })
})

test('parsePayload passes objects without value field through', () => {
  const payload = Buffer.from(JSON.stringify({ temperature: 21.5 }))
  assert.deepEqual(parsePayload(payload), { value: { temperature: 21.5 } })
})

test('parsePayload falls back to raw string for invalid JSON', () => {
  assert.deepEqual(parsePayload(Buffer.from('not-json')), { value: 'not-json' })
})

test('describe queries schema registry for non-raw contracts', async () => {
  const calls: string[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (url: RequestInfo | URL) => {
    calls.push(String(url))
    return {
      ok: true,
      status: 200,
      json: async () => ({ subject: '_timeseries-number_v1-timeseries-number', version: 3 }),
    } as unknown as Response
  }) as typeof fetch
  try {
    const adapter = new UmhAdapter(config)
    const info = await adapter.describe('plant._timeseries-number_v1.temp')
    assert.equal(calls[0], 'http://registry.test/subjects/_timeseries-number_v1-timeseries-number/versions/latest')
    assert.equal(info.path, 'umh.v1.plant._timeseries-number_v1.temp')
    assert.equal(info.contract, '_timeseries-number_v1')
    assert.match(info.fields?.[0]?.type ?? '', /timeseries-number/)
  } finally {
    globalThis.fetch = original
  }
})

test('describe skips schema registry for raw and missing contracts', async () => {
  const calls: string[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (url: RequestInfo | URL) => {
    calls.push(String(url))
    throw new Error('should not be called')
  }) as typeof fetch
  try {
    const adapter = new UmhAdapter(config)
    await adapter.describe('plant._raw.temp')
    await adapter.describe('plant.temp')
    assert.equal(calls.length, 0)
  } finally {
    globalThis.fetch = original
  }
})

test('history explains the TimescaleDB requirement instead of failing silently', async () => {
  const adapter = new UmhAdapter(config)
  await assert.rejects(adapter.history(), /TimescaleDB|uns_watch/)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { SuposAdapter, pickString, toNode, toPoint, unwrapArray } from './supos.js'
import type { SuposConfig } from './types.js'

const config: SuposConfig = {
  apiUrl: 'http://supos.test',
  apiKey: 'test-key',
  timeoutMs: 1000,
  writeField: 'value',
}

interface RecordedCall {
  url: string
  method: string
  body: unknown
}

test('unwrapArray passes arrays through', () => {
  assert.deepEqual(unwrapArray([1, 2]), [1, 2])
})

test('unwrapArray unwraps common envelope keys', () => {
  assert.deepEqual(unwrapArray({ data: ['a'] }), ['a'])
  assert.deepEqual(unwrapArray({ result: ['b'] }), ['b'])
  assert.deepEqual(unwrapArray({ rows: ['c'] }), ['c'])
})

test('unwrapArray recurses into nested data envelopes', () => {
  assert.deepEqual(unwrapArray({ data: { rows: ['d'] } }), ['d'])
})

test('unwrapArray returns empty for unusable payloads', () => {
  assert.deepEqual(unwrapArray(null), [])
  assert.deepEqual(unwrapArray('text'), [])
  assert.deepEqual(unwrapArray({ data: { other: 1 } }), [])
})

test('pickString respects key priority and skips empties', () => {
  assert.equal(pickString({ a: '', b: 'x' }, ['a', 'b']), 'x')
  assert.equal(pickString({ a: 'first', b: 'second' }, ['a', 'b']), 'first')
  assert.equal(pickString({}, ['a']), undefined)
  assert.equal(pickString({ a: 5 }, ['a']), undefined)
})

test('toNode maps pathType to kind and extracts fields', () => {
  const node = toNode({
    path: '/Enterprise/Site',
    alias: 'site-alias',
    pathType: 2,
    fields: [{ name: 'temp', type: 'double', unit: 'C' }, { name: 'bad' }],
  })
  assert.equal(node.path, '/Enterprise/Site')
  assert.equal(node.alias, 'site-alias')
  assert.equal(node.kind, 'file')
  assert.deepEqual(node.fields, [
    { name: 'temp', type: 'double', unit: 'C' },
    { name: 'bad', type: undefined, unit: undefined },
  ])
})

test('toNode kind mapping for folder and template', () => {
  assert.equal(toNode({ path: '/x', pathType: 0 }).kind, 'folder')
  assert.equal(toNode({ path: '/x', pathType: 1 }).kind, 'template')
  assert.equal(toNode({ path: '/x' }).kind, undefined)
})

test('toPoint maps timestamp aliases and value fallbacks', () => {
  const point = toPoint({ path: '/p', timeStamp: 1700000000000, value: 42 })
  assert.equal(point.timestampMs, 1700000000000)
  assert.equal(point.value, 42)

  const coerced = toPoint({ topic: '/q', timestamp: '1700000000001' })
  assert.equal(coerced.path, '/q')
  assert.equal(coerced.timestampMs, 1700000000001)

  const fallback = toPoint({ alias: '/r' })
  assert.equal(fallback.value, fallback.raw)
  assert.equal(fallback.timestampMs, undefined)
})

test('browse request shape and mapping', async () => {
  const calls: RecordedCall[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (url: RequestInfo | URL, req?: RequestInit) => {
    calls.push({ url: String(url), method: req?.method ?? 'GET', body: JSON.parse(String(req?.body)) })
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: [{ path: '/a', pathType: 0 }] }),
    } as unknown as Response
  }) as typeof fetch
  try {
    const adapter = new SuposAdapter(config)
    const nodes = await adapter.browse('/a', 10)
    assert.equal(calls[0].url, 'http://supos.test/open-api/uns/condition/tree')
    assert.equal(calls[0].method, 'POST')
    assert.deepEqual(calls[0].body, { pageSize: 10, key: '/a' })
    assert.equal(nodes[0]?.path, '/a')
    assert.equal(nodes[0]?.kind, 'folder')
  } finally {
    globalThis.fetch = original
  }
})

test('read posts paths array to batchQuery/byPath', async () => {
  const calls: RecordedCall[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (url: RequestInfo | URL, req?: RequestInit) => {
    calls.push({ url: String(url), method: req?.method ?? 'GET', body: JSON.parse(String(req?.body)) })
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify([{ path: '/a', value: 1, timeStamp: 123 }]),
    } as unknown as Response
  }) as typeof fetch
  try {
    const adapter = new SuposAdapter(config)
    const points = await adapter.read(['/a', '/b'])
    assert.equal(calls[0].url, 'http://supos.test/open-api/uns/file/current/batchQuery/byPath')
    assert.deepEqual(calls[0].body, ['/a', '/b'])
    assert.equal(points[0]?.value, 1)
    assert.equal(points[0]?.timestampMs, 123)
  } finally {
    globalThis.fetch = original
  }
})

test('history includes range fields when provided', async () => {
  const calls: RecordedCall[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (url: RequestInfo | URL, req?: RequestInit) => {
    calls.push({ url: String(url), method: req?.method ?? 'GET', body: JSON.parse(String(req?.body)) })
    return { ok: true, status: 200, text: async () => JSON.stringify([]) } as unknown as Response
  }) as typeof fetch
  try {
    const adapter = new SuposAdapter(config)
    await adapter.history('/a', 100, 200, 50)
    assert.equal(calls[0].url, 'http://supos.test/open-api/uns/file/history/batch/query')
    assert.deepEqual(calls[0].body, { paths: ['/a'], limit: 50, startTime: 100, endTime: 200 })
  } finally {
    globalThis.fetch = original
  }
})

test('write builds entry with configured field and optional timestamp', async () => {
  const calls: RecordedCall[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (url: RequestInfo | URL, req?: RequestInit) => {
    calls.push({ url: String(url), method: req?.method ?? 'GET', body: JSON.parse(String(req?.body)) })
    return { ok: true, status: 200, text: async () => '' } as unknown as Response
  }) as typeof fetch
  try {
    const adapter = new SuposAdapter(config)
    await adapter.write('/a', 7, 999, undefined)
    assert.equal(calls[0].url, 'http://supos.test/open-api/uns/file/current/batchUpdate')
    assert.deepEqual(calls[0].body, [{ path: '/a', value: 7, timeStamp: 999 }])
  } finally {
    globalThis.fetch = original
  }
})

test('describe uses byPath first and falls back when record is empty', async () => {
  const calls: RecordedCall[] = []
  const original = globalThis.fetch
  let respondEmpty = true
  globalThis.fetch = (async (url: RequestInfo | URL) => {
    calls.push({ url: String(url), method: 'GET', body: undefined })
    const payload = respondEmpty ? {} : { data: { path: '/a', pathType: 2 } }
    return { ok: true, status: 200, text: async () => JSON.stringify(payload) } as unknown as Response
  }) as typeof fetch
  try {
    const adapter = new SuposAdapter(config)
    await adapter.describe('/a')
    assert.equal(calls.length, 2)
    assert.match(calls[0].url, /\/open-api\/uns\/file\/byPath\?path=%2Fa$/)
    assert.match(calls[1].url, /\/open-api\/uns\/file\/%2Fa$/)

    respondEmpty = false
    calls.length = 0
    const node = await adapter.describe('/a')
    assert.equal(calls.length, 1)
    assert.equal(node.path, '/a')
    assert.equal(node.kind, 'file')
  } finally {
    globalThis.fetch = original
  }
})

test('non-ok responses throw with status and body snippet', async () => {
  const original = globalThis.fetch
  globalThis.fetch = (async () =>
    ({ ok: false, status: 500, text: async () => 'boom' }) as unknown as Response) as typeof fetch
  try {
    const adapter = new SuposAdapter(config)
    await assert.rejects(adapter.read(['/a']), /HTTP 500: boom/)
  } finally {
    globalThis.fetch = original
  }
})

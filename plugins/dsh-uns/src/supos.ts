import type { SuposConfig, UnsAdapter, UnsFieldDef, UnsNodeInfo, UnsPoint } from './types.js'

interface HttpLike {
  ok: boolean
  status: number
  json(): Promise<unknown>
}

function unwrapArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>
    for (const key of ['data', 'result', 'rows', 'list', 'records']) {
      const candidate = obj[key]
      if (Array.isArray(candidate)) return candidate
    }
    if (obj.data && typeof obj.data === 'object') return unwrapArray(obj.data)
  }
  return []
}

function pickString(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return undefined
}

export class SuposAdapter implements UnsAdapter {
  constructor(private readonly config: SuposConfig) {}

  private url(path: string): string {
    const base = this.config.apiUrl.replace(/\/+$/, '')
    return `${base}${path}`
  }

  private async call(path: string, method: string, body?: unknown): Promise<HttpLike & { payload: unknown }> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs)
    try {
      const response = await fetch(this.url(path), {
        method,
        headers: {
          apikey: this.config.apiKey,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      })
      let payload: unknown = null
      const text = await response.text()
      if (text.length > 0) {
        try {
          payload = JSON.parse(text)
        } catch {
          payload = text
        }
      }
      if (!response.ok) {
        throw new Error(`supOS ${method} ${path} -> HTTP ${response.status}: ${text.slice(0, 400)}`)
      }
      return { ok: response.ok, status: response.status, json: async () => payload, payload }
    } finally {
      clearTimeout(timer)
    }
  }

  async browse(prefix: string | undefined, limit: number): Promise<UnsNodeInfo[]> {
    const body: Record<string, unknown> = { pageSize: limit }
    if (prefix !== undefined && prefix.length > 0) body.key = prefix
    const result = await this.call('/open-api/uns/condition/tree', 'POST', body)
    const rows = unwrapArray(result.payload)
    return rows.slice(0, limit).map((row) => this.toNode(row as Record<string, unknown>))
  }

  async describe(path: string): Promise<UnsNodeInfo> {
    const encoded = encodeURIComponent(path)
    const byPath = await this.call(`/open-api/uns/file/byPath?path=${encoded}`, 'GET')
    const record = (byPath.payload && typeof byPath.payload === 'object'
      ? ((byPath.payload as Record<string, unknown>).data ?? byPath.payload)
      : {}) as Record<string, unknown>
    if (record.path || record.alias || record.name) return this.toNode(record)
    const fallback = await this.call(`/open-api/uns/file/${encodeURIComponent(path)}`, 'GET')
    const fallbackRecord = (fallback.payload && typeof fallback.payload === 'object'
      ? ((fallback.payload as Record<string, unknown>).data ?? fallback.payload)
      : {}) as Record<string, unknown>
    return this.toNode(fallbackRecord)
  }

  async read(paths: string[]): Promise<UnsPoint[]> {
    const result = await this.call('/open-api/uns/file/current/batchQuery/byPath', 'POST', paths)
    const rows = unwrapArray(result.payload)
    return rows.map((row) => this.toPoint(row as Record<string, unknown>))
  }

  async write(path: string, value: unknown, timestampMs: number | undefined, field: string | undefined): Promise<void> {
    const fieldName = field ?? this.config.writeField
    const entry: Record<string, unknown> = { path }
    entry[fieldName] = value
    if (timestampMs !== undefined) entry.timeStamp = timestampMs
    await this.call('/open-api/uns/file/current/batchUpdate', 'POST', [entry])
  }

  async history(path: string, startMs: number | undefined, endMs: number | undefined, limit: number): Promise<UnsPoint[]> {
    const body: Record<string, unknown> = { paths: [path], limit }
    if (startMs !== undefined) body.startTime = startMs
    if (endMs !== undefined) body.endTime = endMs
    const result = await this.call('/open-api/uns/file/history/batch/query', 'POST', body)
    const rows = unwrapArray(result.payload)
    return rows.map((row) => this.toPoint(row as Record<string, unknown>))
  }

  async watch(topics: string[], durationMs: number, limit: number): Promise<UnsPoint[]> {
    const mqttUrl = this.config.mqttUrl
    if (!mqttUrl) throw new Error('supOS watch requires config.supos.mqttUrl (EMQX broker address)')
    const mqttModule = (await import('mqtt')) as unknown as { connectAsync?: typeof import('mqtt').connectAsync; default?: { connectAsync: typeof import('mqtt').connectAsync } }
    const connectAsync = mqttModule.connectAsync ?? mqttModule.default?.connectAsync
    if (!connectAsync) throw new Error('mqtt package failed to load')
    const filters = topics.map((topic) => topic.replace(/^\/+/, ''))
    const client = await connectAsync(mqttUrl, { connectTimeout: this.config.timeoutMs })
    const points: UnsPoint[] = []
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, durationMs)
        client.on('message', (topic, payload) => {
          let parsed: unknown = payload.toString()
          try {
            parsed = JSON.parse(parsed as string)
          } catch {}
          points.push({ path: topic, value: parsed, raw: parsed })
          if (points.length >= limit) {
            clearTimeout(timer)
            resolve()
          }
        })
        for (const filter of filters) {
          const full = `${filter}/#`
          client.subscribe(full, () => {})
          client.subscribe(filter, () => {})
        }
      })
    } finally {
      await client.endAsync(true)
    }
    return points.slice(0, limit)
  }

  private toNode(record: Record<string, unknown>): UnsNodeInfo {
    const path = pickString(record, ['path', 'fullPath', 'namePath']) ?? ''
    const alias = pickString(record, ['alias', 'pathName', 'id'])
    const pathType = typeof record.pathType === 'number' ? record.pathType : undefined
    const kind = pathType === 0 ? 'folder' : pathType === 1 ? 'template' : pathType === 2 ? 'file' : undefined
    const fieldsRaw = Array.isArray(record.fields) ? record.fields : []
    const fields: UnsFieldDef[] = fieldsRaw.map((field) => {
      const f = field as Record<string, unknown>
      return {
        name: String(f.name ?? ''),
        type: typeof f.type === 'string' ? f.type : undefined,
        unit: typeof f.unit === 'string' ? f.unit : undefined,
      }
    })
    return { path, alias, kind, fields }
  }

  private toPoint(record: Record<string, unknown>): UnsPoint {
    const path = pickString(record, ['path', 'topic', 'alias']) ?? ''
    const timeRaw = record.timeStamp ?? record.timestamp ?? record.time
    const timestampMs = typeof timeRaw === 'number' ? timeRaw : Number(timeRaw) || undefined
    return {
      path,
      value: record.value ?? record.currentValue ?? record,
      timestampMs,
      quality: record.status ?? record.qos,
      raw: record,
    }
  }
}

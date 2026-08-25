import type { Kafka } from 'kafkajs'
import type { UmhConfig, UnsAdapter, UnsNodeInfo, UnsPoint } from './types.js'

const UMH_PREFIX = 'umh.v1.'

interface ParsedTopic {
  path: string
  contract?: string
}

function parseTopic(topic: string): ParsedTopic {
  if (!topic.startsWith(UMH_PREFIX)) return { path: topic }
  const rest = topic.slice(UMH_PREFIX.length)
  const segments = rest.split('.')
  const contractIndex = segments.findIndex((segment) => segment.startsWith('_'))
  return {
    path: topic,
    contract: contractIndex >= 0 ? segments[contractIndex] : undefined,
  }
}

function fullTopic(path: string): string {
  return path.startsWith(UMH_PREFIX) ? path : `${UMH_PREFIX}${path}`
}

function parsePayload(value: Buffer): { value: unknown; timestampMs?: number } {
  try {
    const parsed = JSON.parse(value.toString('utf8')) as Record<string, unknown>
    if (parsed && typeof parsed === 'object' && 'value' in parsed) {
      return {
        value: parsed.value,
        timestampMs: typeof parsed.timestamp_ms === 'number' ? parsed.timestamp_ms : undefined,
      }
    }
    return { value: parsed }
  } catch {
    return { value: value.toString('utf8') }
  }
}

export class UmhAdapter implements UnsAdapter {
  private kafka: Kafka | null = null

  constructor(private readonly config: UmhConfig) {}

  private async client(): Promise<Kafka> {
    if (!this.kafka) {
      const { Kafka: Client } = await import('kafkajs')
      this.kafka = new Client({
        clientId: this.config.clientId,
        brokers: this.config.brokers,
        requestTimeout: this.config.requestTimeoutMs,
        retry: { retries: 2 },
      })
    }
    return this.kafka
  }

  private async listUnsTopics(): Promise<string[]> {
    const admin = (await this.client()).admin()
    await admin.connect()
    try {
      const topics = await admin.listTopics()
      return topics.filter((topic) => topic.startsWith(UMH_PREFIX)).sort()
    } finally {
      await admin.disconnect()
    }
  }

  async browse(prefix: string | undefined, limit: number): Promise<UnsNodeInfo[]> {
    let topics = await this.listUnsTopics()
    if (prefix !== undefined && prefix.length > 0) {
      const normalized = fullTopic(prefix)
      topics = topics.filter((topic) => topic.startsWith(normalized))
    }
    return topics.slice(0, limit).map((topic) => {
      const parsed = parseTopic(topic)
      return { path: parsed.path, kind: 'topic' as const, contract: parsed.contract }
    })
  }

  async describe(path: string): Promise<UnsNodeInfo> {
    const topic = fullTopic(path)
    const parsed = parseTopic(topic)
    const segments = topic.split('.')
    const contractSegment = segments.find((segment) => segment.startsWith('_'))
    let schemaSummary: unknown
    if (contractSegment && contractSegment !== '_raw') {
      const subject = `${contractSegment}-timeseries-number`
      const response = await fetch(
        `${this.config.schemaRegistryUrl.replace(/\/+$/, '')}/subjects/${encodeURIComponent(subject)}/versions/latest`,
      )
      if (response.ok) schemaSummary = await response.json()
    }
    return {
      path: topic,
      kind: 'topic',
      contract: parsed.contract,
      fields: schemaSummary
        ? [{ name: 'schema', type: JSON.stringify(schemaSummary).slice(0, 500) }]
        : undefined,
    }
  }

  async read(paths: string[]): Promise<UnsPoint[]> {
    const topics = paths.map(fullTopic)
    const admin = (await this.client()).admin()
    await admin.connect()
    const seekOffsets = new Map<string, number>()
    try {
      for (const topic of topics) {
        const offsets = await admin.fetchTopicOffsets(topic)
        const partition = offsets.find((o) => o.partition === 0) ?? offsets[0]
        if (partition) seekOffsets.set(topic, Number(partition.high) - 1)
      }
    } finally {
      await admin.disconnect()
    }
    return this.consumeOnce(topics, seekOffsets, 5000, topics.length)
  }

  async write(path: string, value: unknown, timestampMs?: number): Promise<void> {
    const producer = (await this.client()).producer()
    await producer.connect()
    try {
      await producer.send({
        topic: fullTopic(path),
        messages: [{ value: JSON.stringify({ timestamp_ms: timestampMs ?? Date.now(), value }) }],
      })
    } finally {
      await producer.disconnect()
    }
  }

  async history(): Promise<UnsPoint[]> {
    throw new Error(
      'UMH Core does not store history itself; deploy the TimescaleDB historian and query it via SQL, or use uns_watch for live data',
    )
  }

  async watch(topics: string[], durationMs: number, limit: number): Promise<UnsPoint[]> {
    return this.consumeOnce(topics.map(fullTopic), undefined, durationMs, limit)
  }

  private consumeOnce(
    topics: string[],
    seekOffsets: Map<string, number> | undefined,
    durationMs: number,
    limit: number,
  ): Promise<UnsPoint[]> {
    return new Promise<UnsPoint[]>(async (resolve, reject) => {
      const consumer = (await this.client()).consumer({ groupId: `dsh-uns-${Date.now()}`, minBytes: 1 })
      const points: UnsPoint[] = []
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        resolve(points.slice(0, limit))
        consumer.disconnect().catch(() => {})
      }
      const timer = setTimeout(finish, Math.max(durationMs, 500))
      try {
        await consumer.subscribe({ topics, fromBeginning: false })
        if (seekOffsets) {
          for (const [topic, offset] of seekOffsets) {
            if (offset >= 0) await consumer.seek({ topic, partition: 0, offset: String(offset) })
          }
        }
        await consumer.run({
          eachMessage: async ({ topic, message }) => {
            if (!message.value) return
            const parsed = parsePayload(message.value)
            points.push({
              path: topic,
              value: parsed.value,
              timestampMs: parsed.timestampMs ?? (message.timestamp ? Number(message.timestamp) : undefined),
            })
            if (points.length >= limit) {
              clearTimeout(timer)
              finish()
            }
          },
        })
      } catch (error) {
        clearTimeout(timer)
        if (!settled) {
          settled = true
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      }
    })
  }
}

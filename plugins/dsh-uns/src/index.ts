import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { UnsAdapter, UnsConfig } from './types.js'
import { SuposAdapter } from './supos.js'
import { UmhAdapter } from './umh.js'

export const name = 'dsh-uns'

export const inject = ['tools']

export interface Config extends UnsConfig {}

export const Config: z<UnsConfig> = z.object({
  provider: z.union(['supos', 'umh']).default('supos'),
  supos: z.object({
    apiUrl: z.string().default('http://localhost'),
    apiKey: z.string().default(''),
    mqttUrl: z.string(),
    timeoutMs: z.number().default(15000),
    writeField: z.string().default('value'),
  }),
  umh: z.object({
    brokers: z.array(z.string()).default(['127.0.0.1:9092']),
    schemaRegistryUrl: z.string().default('http://127.0.0.1:8081'),
    clientId: z.string().default('dsh-uns'),
    requestTimeoutMs: z.number().default(10000),
  }),
})

const pathParam = {
  type: 'string' as const,
  description: 'UNS path; supOS uses /-separated tree paths, UMH uses umh.v1.* topics (prefix optional)',
}
const limitDefault = 'defaults to 20'

export function apply(ctx: Context, config: UnsConfig) {
  const adapter: UnsAdapter = config.provider === 'umh' ? new UmhAdapter(config.umh) : new SuposAdapter(config.supos)
  ctx.tools.register(
    defineTool({
      name: 'uns_browse',
      description:
        'Browse the industrial Unified Namespace tree. Lists folders/files (supOS) or topics (UMH) under an optional prefix.',
      parameters: {
        prefix: { type: 'string', description: `Optional path/topic prefix to filter by. ${limitDefault} results.` },
        limit: { type: 'number', description: 'Max entries to return.' },
      },
      output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
      async execute(args) {
        const nodes = await adapter.browse(args.prefix, args.limit ?? 20)
        return JSON.stringify(nodes, null, 2)
      },
    }),
  )
  ctx.tools.register(
    defineTool({
      name: 'uns_read',
      description: 'Read the latest value of one or more UNS tags/topics.',
      parameters: {
        paths: { type: 'array', description: 'Array of UNS paths to read (batch supported).' },
      },
      output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
      async execute(args) {
        const points = await adapter.read(args.paths as string[])
        return JSON.stringify(points, null, 2)
      },
    }),
  )
  ctx.tools.register(
    defineTool({
      name: 'uns_write',
      description: 'Write a value to a UNS tag/topic. On UMH the topic must exist or auto-create must be on; _raw contract has no validation.',
      parameters: {
        path: pathParam,
        value: { description: 'Value to write (number/string/boolean/JSON).' },
        timestampMs: { type: 'number', description: 'Optional timestamp in ms; defaults to now.' },
        field: { type: 'string', description: 'supOS only: field name inside the file instance if not the configured default.' },
      },
      output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
      async execute(args) {
        await adapter.write(args.path, args.value, args.timestampMs, args.field)
        return `written ${args.path}`
      },
    }),
  )
  ctx.tools.register(
    defineTool({
      name: 'uns_history',
      description: 'Query historical values of a tag. Supported on supOS out of the box; UMH requires an external TimescaleDB historian.',
      parameters: {
        path: pathParam,
        startMs: { type: 'number', description: 'Range start in epoch ms.' },
        endMs: { type: 'number', description: 'Range end in epoch ms.' },
        limit: { type: 'number', description: `Max rows. ${limitDefault}.` },
      },
      output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
      async execute(args) {
        const points = await adapter.history(args.path, args.startMs, args.endMs, args.limit ?? 20)
        return JSON.stringify(points, null, 2)
      },
    }),
  )
  ctx.tools.register(
    defineTool({
      name: 'uns_watch',
      description:
        'Subscribe to live data for a bounded time window and return everything received. Use for real-time inspection instead of a persistent subscription.',
      parameters: {
        topics: { type: 'array', description: 'Array of UNS paths/topics to watch.' },
        durationMs: { type: 'number', description: 'How long to collect, ms; defaults to 3000.' },
        limit: { type: 'number', description: 'Stop early after this many messages.' },
      },
      output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
      async execute(args) {
        const points = await adapter.watch(args.topics as string[], args.durationMs ?? 3000, args.limit ?? 100)
        return JSON.stringify(points, null, 2)
      },
    }),
  )
  ctx.tools.register(
    defineTool({
      name: 'uns_describe',
      description: 'Describe a tag/topic: fields and types (supOS file instance) or contract/schema info (UMH via Schema Registry).',
      parameters: { path: pathParam },
      output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
      async execute(args) {
        const info = await adapter.describe(args.path)
        return JSON.stringify(info, null, 2)
      },
    }),
  )

  ctx.logger.info(`[${name}] provider=%s ready`, config.provider)
}

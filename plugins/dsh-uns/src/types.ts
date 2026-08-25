export interface UnsPoint {
  path: string
  value: unknown
  timestampMs?: number
  quality?: unknown
  raw?: unknown
}

export type UnsNodeKind = 'folder' | 'file' | 'template' | 'topic'

export interface UnsNodeInfo {
  path: string
  alias?: string
  kind?: UnsNodeKind
  fields?: UnsFieldDef[]
  contract?: string
}

export interface UnsFieldDef {
  name: string
  type?: string
  unit?: string
}

export interface SuposConfig {
  apiUrl: string
  apiKey: string
  mqttUrl?: string
  timeoutMs: number
  writeField: string
}

export interface UmhConfig {
  brokers: string[]
  schemaRegistryUrl: string
  clientId: string
  requestTimeoutMs: number
}

export interface UnsConfig {
  provider: 'supos' | 'umh'
  supos: SuposConfig
  umh: UmhConfig
}

export interface UnsAdapter {
  browse(prefix: string | undefined, limit: number): Promise<UnsNodeInfo[]>
  read(paths: string[]): Promise<UnsPoint[]>
  write(path: string, value: unknown, timestampMs: number | undefined, field: string | undefined): Promise<void>
  history(path: string, startMs: number | undefined, endMs: number | undefined, limit: number): Promise<UnsPoint[]>
  watch(topics: string[], durationMs: number, limit: number): Promise<UnsPoint[]>
  describe(path: string): Promise<UnsNodeInfo>
}

# dsh-uns

DeepSeek Harness 插件：让 dsh agent 通过一套统一工具读写工业 UNS（统一命名空间）数据。支持双后端：

- **supOS / Open supOS**（REST `/open-api` + EMQX MQTT）
- **UMH Core**（Redpanda Kafka 直连 + Schema Registry）

## 安装

当前为孵化期（随主页仓 [shine-233/dsh-industrial](https://github.com/shine-233/dsh-industrial) 发布），将本仓库克隆到本地后，在宿主 profile 中指向 `plugins/dsh-uns` 目录加载。成熟后按 ADR-003 迁出为独立仓，届时安装方式变为：

```sh
dsh plugin --profile web add github:shine-233/dsh-uns
```

## 配置（`~/.dsh/settings.yaml` 或 profile 配置）

```yaml
dsh-uns:
  provider: supos          # 或 umh
  supos:
    apiUrl: http://your-supos-host   # 能访问 /open-api 的入口
    apiKey: your-kong-key-auth-key
    mqttUrl: mqtt://your-emqx:1883   # uns_watch 需要
    timeoutMs: 15000
    writeField: value                # 写值时默认字段名
  umh:
    brokers: ["127.0.0.1:9092"]      # UMH Core 的 Redpanda
    schemaRegistryUrl: http://127.0.0.1:8081
    clientId: dsh-uns
    requestTimeoutMs: 10000
```

## 工具

| 工具 | 说明 | supOS 实现 | UMH 实现 |
|---|---|---|---|
| `uns_browse` | 浏览命名空间树/主题列表 | `POST /open-api/uns/condition/tree` | Kafka Admin `listTopics()` 过滤 `umh.v1.*` |
| `uns_read` | 批量读实时值 | `POST /open-api/uns/file/current/batchQuery/byPath` | 读每主题最后一条（seek 到 end-1） |
| `uns_write` | 写一个值 | `POST /open-api/uns/file/current/batchUpdate` | produce `{timestamp_ms,value}` |
| `uns_history` | 历史查询 | `POST /open-api/uns/file/history/batch/query` | 未实现（需外接 TimescaleDB，报提示） |
| `uns_watch` | 有界时间窗订阅实时流 | MQTT 订阅 `path/#` | Kafka consumer 限时消费 |
| `uns_describe` | 位号字段/契约详情 | `GET /open-api/uns/file/byPath` | Schema Registry subject |

## 已知边界

- supOS 部分请求体形状按社区版源码推导（`UnsOpenApi` / `UnsDataController`），不同版本可能需微调 `src/supos.ts`；错误会原样透传 HTTP 状态与响应体，便于定位。
- UMH 的 Kafka advertised 地址是 `127.0.0.1:9092`，插件需与 umh-core 同主机运行。
- UMH `_xxx_v1` 契约受 Schema Registry 校验，写入不合规 payload 会被下游拒绝；写 `_raw` 无约束。

## 开发

```sh
pnpm install        # harness 依赖为 optional peer，由 dsh 宿主提供
pnpm run build      # 输出 lib/
```

本地类型检查使用 `src/shims.d.ts` 模拟 `@deepseek-ai/*` API；在真实 dsh checkout 内联调时以宿主模块为准。

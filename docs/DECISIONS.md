# 技术决策记录

格式：背景 → 决策 → 理由 → 后果。

## ADR-001 插件语言选型：TypeScript 为唯一插件语言

**背景**：需要决定 dsh-industrial 系列软件的实现语言。候选 Go / Rust / Java / TypeScript。

**决策**：dsh 原生插件一律 TypeScript；未来独立的边缘组件（采集器、网关）用 Go；Rust 仅用于协议栈热点路径且需先有性能证据；Java 不用于新项目。

**理由**：
1. dsh 宿主是 Node.js ≥22.19 运行时，Cordis 插件体系为 TS。非 TS 无法作为原生插件加载，这是硬约束。
2. Go 与 UMH/Benthos 生态同栈（可对照 umh-core 源码），单二进制部署适合工控机，并发模型适配数据管道——独立组件首选。
3. Rust 开发成本最高，仅在自研 OPC UA Server、Sparkplug 编解码等确证的性能瓶颈场景引入。
4. supOS 用 Java 是企业历史选择，对新项目无借鉴意义。

**后果**：团队需维护 TS + (可选) Go 双栈；TS 侧依赖 dsh developer preview 的 API 稳定性风险（0.1.x 有破坏性变更可能），发布时锁定 commit。

## ADR-002 不合并、不重构 UMH/supOS 平台本身

**背景**：曾考虑"结合两个平台重构"。源码研究结论：UMH Core 约 12.5 万行 Go（另有约 12 万行测试），supOS 后端约 6.8 万行 Java，技术栈与数据面完全不同（Kafka vs MQTT+REST），重写等于重建一个 IIoT 平台。

**决策**：平台层保持原样使用；在 dsh 插件层做统一抽象——一套工具（browse/read/write/history/watch/describe），双适配器实现。

**理由**：
1. 两平台的差异恰恰是资产：UMH 强在 Kafka 数据面与契约治理，supOS 强在 REST CRUD 与中文生态，按项目选用。
2. 插件层抽象成本 ~千行级，重构平台成本 ~十万行级，收益相同（agent 统一操作界面）。
3. 上游仍在快速演进（UMH fsm/fsmv2 过渡期、supOS CE 刚起步），跟随上游优于分叉。

**后果**：supOS 部分 API 请求体形状靠源码推导（UnsOpenApi.java），版本升级时需回归测试；已在 RESEARCH.md 记录证据路径。

## ADR-003 仓库策略：主页仓 + 一插件一仓库

**背景**：dsh 官方插件模板明确"一插件一仓库是生态惯例"（`dsh plugin add github:you/repo` 要求包在根目录）。

**决策**：本仓（dsh-industrial）作为项目主页，承载研究档案、决策记录、路线图；`plugins/` 下孵化插件，成熟后迁出为独立仓，本仓保留文档。

**理由**：兼顾记录集中管理与发布约定合规。

## ADR-004 dsh-uns 工具面设计：六个有界工具而非持久订阅

**背景**：agent 工具调用是一次性请求-响应模型，无法持有长连接。

**决策**：提供 `uns_browse / uns_read / uns_write / uns_history / uns_watch / uns_describe` 六个无状态工具；实时性需求用 `uns_watch`（有界时间窗收集消息后返回）表达。

**理由**：
- 有界窗口把"订阅"降维成"读取"，agent 可组合、可审计；
- UMH 读最新值实现为 seek 到 end-1 单分区读一条（利用其 auto-create 单分区特性）；supOS 读走内存缓存接口 getLastMsg 语义的 open-api 批量端点。

**后果**：毫秒级高频流不适合经 agent 消费，那类场景应由平台规则引擎/Node-RED 处理，agent 只做巡检、诊断、编排。

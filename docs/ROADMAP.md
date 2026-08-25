# 路线图、插件候选池与风险登记

> 更新：2026-08-25。状态标记：✅ 完成 / 🟡 进行中 / ⬜ 未开始。

## 一、路线图

### M0 尽调与选型 ✅

- 两平台源码级研究（`RESEARCH.md`）：UMH Core ~12.5 万行 Go / supOS ~6.8 万行 Java，接入面、认证模型、质量债全部落档。
- 技术决策（`DECISIONS.md`）：ADR-001~004（TS 选型、不重构平台、仓库策略、六工具设计）。

### M1 dsh-uns v0.1 骨架 🟡

| 项 | 状态 | 说明 |
|---|---|---|
| 六工具注册（browse/read/write/history/watch/describe） | ✅ | `src/index.ts` |
| supOS 适配器（REST `/open-api` + EMQX MQTT watch） | ✅ | `src/supos.ts` |
| UMH 适配器（Kafka 直连 + Schema Registry describe） | ✅ | `src/umh.ts`；history 有意报错引导外接 TimescaleDB |
| tsc 构建与模块加载验证 | ✅ | `pnpm run build` 通过，lib/ 正常产出 |
| 真实平台实例冒烟实测 | ⬜ | **当前最大缺口**：所有端点形状按源码推导，未经真实请求验证 |

### M2 实测与固化 ⬜

- docker compose 起 Open supOS CE 与 umh-core 各一套，逐工具冒烟（含错误透传路径）。
- 按实测修正 `supos.ts` 请求体/响应解包偏差（`unwrapArray` 兜底键名以真实响应为准）。
- ✅ 单测：`pnpm test` 42/42（2026-08-25，纯函数 + mock fetch 请求形状与错误透传 + WS/写值/历史协议构造器）。
- ✅ 静态对账（2026-08-25，源码级）：逐 DTO 核对 `UnsTreeCondition`/`UpdateFileDTO`/`HistoryValueRequest`/`UnsWebsocketHandler`，修复 v0.2 两处致命协议错误（write 误用 path、history 误造 paths/startTime 结构），watch 改平台 WS 订阅。**静态对账不能替代实测**，M2 冒烟仍为发布 v1.0 的硬性门槛。
- ✅ 管理面封装（v0.4.0）：`uns_admin` 覆盖节点/模板/标签 CRUD、schema 查询、打标摘标（`CreateFileDto`/`CreateTemplateVo`/`MakeLabelDto` 等 DTO 对账完成）；`enableManagement` 默认关闭，破坏性操作不默认暴露给 agent。
- ✅ 全量对账收尾（v0.5.0）：逐 Controller 扫描全部 `/open-api/**` 端点，补 blob 值读取（`FileBlobDataQueryDto`）与事件流有界订阅（`/open-api/uns/event/ws` cmd=5，服务端 cmd=6 发布未实现）；平台治理面（user/todo/plugin/systemConfig/menu/auth）与 `/open-api/rest/sql`（R4）明确排除。`/open-api/**` 至此无未决端点。
- 发布前锁定 dsh developer preview API 版本（ADR-001 后果条款）。

### M3 迁出与发布 ✅（2026-08-25 迁出完成）

- 已按 ADR-003 迁出为独立仓 [shine-233/dsh-uns](https://github.com/shine-233/dsh-uns)（git subtree split 保留插件提交历史，包在根目录满足 `dsh plugin add github:` 约定），本仓保留文档与状态表，`plugins/` 目录已移除。
- 剩余：真实平台实测通过后打 tag v0.1.0；可选 npm 发布（`dsh` 生态安装以 github: 为准，npm 非必需）。

### M4 生态扩展 ⬜

- 见候选池。优先级依真实使用反馈排序，不做预支开发。
- 2026-08-25 新增配套面板 [dsh-uns-dashboard](https://github.com/shine-233/dsh-uns-dashboard)：Node 代理后端复用 dsh-uns 适配器（mock/supos/umh 三源），前端零构建；真实平台接入仍以 M2 实测为前提。

## 二、插件候选池

| 候选 | 解决什么 | 依赖前提 | 备注 |
|---|---|---|---|
| dsh-historian | 补 UMH history 缺口：TimescaleDB SQL 桥（supOS 直通 `/open-api/rest/sql` 亦可复用） | umh-core historian 部署 | M1 实测中若历史查询高频出现则提前 |
| dsh-opcua | OPC UA Client 工具面（browse/read/write/subscribe→有界窗口） | node-opcua 成熟度可接受 | 工业现场最普遍协议，预计优先级最高 |
| dsh-sparkplug-b | Sparkplug B 主题/payload 解码工具 | protobuf 编解码 | Sparkplug 依赖 MQTT broker 侧生态，评估后再定 TS/Go |
| dsh-edge-gw | 独立边缘采集组件（Go 单二进制，工控机部署） | 前 3 项稳定后 | ADR-001：仅此层允许 Go |

## 三、风险登记

| # | 风险 | 等级 | 缓解 |
|---|---|---|---|
| R1 | supOS open-api 请求/响应形状靠源码推导（UnsOpenApi.java），上游演进即漂移 | 高 | M2 实测固化；错误原样透传 HTTP 状态与响应体便于定位；升级时回归 |
| R2 | UMH Kafka advertised=127.0.0.1，跨主机不可直连 | 高（部署面） | 文档明示同主机约束；远程场景走平台自身管理面而非本插件 |
| R3 | dsh 0.1.x developer preview API 破坏性变更 | 中 | 发布锁 commit；`shims.d.ts` 隔离类型，联调以宿主模块为准 |
| R4 | supOS 社区版安全债（硬编码凭据、`/open-api/rest/sql` 任意 SQL 直通） | 中（非本插件缺陷，但同域暴露） | 生产部署必须网络隔离 + 自建网关白名单；插件不封装 sql 直通能力 |
| R5 | kafkajs/mqtt 为运行时动态 import，缺包时错误信息可能晦涩 | 低 | 已做加载失败显式报错；M2 加缺包冒烟用例 |
| R6 | UMH `_xxx_v1` 契约 Schema Registry 校验拒绝不合规写入 | 信息 | 已在插件 README「已知边界」声明，属平台预期行为 |

## 四、明确不做

- 不重构/分叉 UMH、supOS 平台本身（ADR-002）。
- 不做毫秒级高频流消费——agent 只做巡检、诊断、编排（ADR-004）；该场景由平台规则引擎（如 Node-RED）承接。
- 不持久订阅：一切实时性需求经 `uns_watch` 有界窗口表达（ADR-004）。

# UMH Core 与 supOS CE 源码研究档案

> 研究日期：2026-08-25。源码快照：umh-core @ main（CHANGELOG 0.44.35）、supOS-backend @ main（浅克隆）。
> 本地路径：`C:\Users\Zz\Documents\projects\uns-research\`（united-manufacturing-hub/、supOS-backend/）。

## 一、UMH Core（Go）

规模：非测试 695 文件 / ~124,600 行；测试 567 文件 / ~119,700 行（≈1:1）。

### 架构
- 入口 `cmd/main.go` 加载 `/data/config.yaml` → `pkg/control/loop.go` 单线程控制循环（K8s 控制器模式），tick 依次 Reconcile 10 个 FSM Manager（S6/Benthos/Container/Redpanda/DataFlowComponent/ProtocolConverter/TopicBrowser 等）。
- Benthos DFC = S6 子进程（`pkg/service/benthos/benthos.go:323 GenerateS6ConfigForBenthos`），每实例独立 metrics 端口（9000-9999，`pkg/portmanager`）。
- Redpanda 二进制打进镜像，作为一个 S6 服务；Kafka :9092 监听 0.0.0.0 但 **advertised 127.0.0.1**（`pkg/config/redpandaserviceconfig/generator.go:104-110`）；Schema Registry :8081；Admin :9644。默认无 SASL/TLS（developer_mode）。

### UNS 模型
- 主题约定 `umh.v1.<location>.<contract>[.<virtual_path>].<tag>`（`docs/usage/unified-namespace/topic-convention.md:20-32`），解析在 `pkg/communicator/models/mgmtconfig/location.go:69 FromTopicString`。
- 数据契约 `_raw` 内置；模型添加自动生成契约 `_<name>_v1`（`pkg/communicator/actions/add-datamodel.go:204`）。**契约只增不删**（`pkg/config/datacontract.go:22-54`），模型版本 append-only（`pkg/config/datamodel.go:74-77`）。
- 校验链：`pkg/datamodel/validator.go`（结构/引用/循环检测）→ `translator.go:91` 翻译成 JSON Schema → 注册进内嵌 Schema Registry → 运行时由 benthos-umh UNS output 插件逐条校验。

### 外部接入面（插件对接依据）
| 通道 | 端口 | 能力 | 约束 |
|---|---|---|---|
| Kafka | 9092 | 读/写/订阅/回放(7d) | 零认证；advertised 127.0.0.1 → 仅同主机 |
| Schema Registry | 8081 | 契约 schema 查询 | HTTP 无认证 |
| GraphQL | 8090 | 只读浏览 topics/topic() | 默认关闭，需 agent.graphql.enabled |
| MgmtConsole API | 云端 443 | 全功能管理 | 私有协议 + AUTH_TOKEN，不适合本地插件 |

### 优缺点
- ✅ 工程纪律顶级：CI 门禁、Ginkgo/Testcontainers、性能 benchmark、FSM 文件布局全库同构。
- ❌ topic browser 数据经 hex-in-S6-log 传递（`pkg/service/topicbrowser/parse.go:84+`，8KB 行截断风险）；fsm/fsmv2 双轨过渡（USE_FSMV2_* feature flags）；本地可编程性弱（无 REST 写 API）。

## 二、supOS CE 后端（Java 17 + Spring Boot 3.1）

规模：874 Java 文件（main 843 / test 31）/ ~67,700 行。

### 架构
- **模块化单体**：bootstrap 是唯一启动模块，其余 adapter-* 是进程内包（`bootstrap/pom.xml` L20-73）；模块间通信靠 Spring Event 总线 + MQTT 数据面，无 MQ 中间件。
- 数据管道：adapter-mqtt 订阅 EMQX `#` 通配（`UnsMessageConsumer.init()` L177-243）→ 解析/白名单校验 → BigQueue 磁盘削峰 → 批量 SaveDataEvent → PG/Timescale/TDengine handler 落库；计算型主题结果回流总线闭环。

### UNS 模型
- 主表 `uns_namespace`（`UnityNamespace/.../dao/po/UnsPo.java`）：layRec/path/parentId 三重冗余存树；pathType 0文件夹/1模板/2文件；fields(jsonb) 即位号定义（name/type/unit/lowerLimit/upperLimit）。
- ISA-95 层级仅靠文件夹嵌套约定表达，后端无强约束。

### REST API 面（48 个 Controller；inter-/open-/service-api 三分）
| 能力 | 端点 | 出处 |
|---|---|---|
| 树查询 | `GET /inter-api/supos/uns/tree`、`POST /open-api/uns/condition/tree` | UnsApiController.java L71/L104、UnsOpenApi L182 |
| 详情 | `GET /open-api/uns/file/{alias}`、`GET /open-api/uns/file/byPath?path=` | UnsOpenApi L115/L121 |
| 读实时值 | `POST /open-api/uns/file/current/batchQuery[/byPath]` | UnsOpenApi L164/L170、UnsDataController L35 |
| 写值 | `POST /open-api/uns/file/current/batchUpdate`（≤100/次，转 MQTT 统一管道） | UnsDataController L29、UnsDataService L76-150 |
| 历史 | `POST /open-api/uns/file/history/batch/query`；直通 SQL `POST /open-api/rest/sql` | UnsOpenApi L192、TimeSequenceQueryController L20-26 |
| WS 订阅 | `/open-api/uns/ws`、`/open-api/uns/event/ws` | WebSocketConfig L23-25、WSConfig L23 |

- 认证：浏览器侧 Keycloak OAuth2 + Cookie `supos_community_token` + Kong auth-checker Lua 插件回调校验；机器侧 `/open-api/**` 走 Kong key-auth（请求头 `apikey`，`KongAdapterService.addApiKey` L382-413）。key 由前端"主题详情→数据操作→获取 ApiKey"签发。
- 实时值读取是内存缓存优先（`UnsQueryService.getLastMsg` L944-1014），热数据 O(1)。

### 优缺点
- ✅ UNS 语义完整、REST 契约清晰有 Swagger、单体运维简单、网关内外 API 边界划分清楚。
- ❌ 测试 3.6% 且根 pom `<maven.test.skip>true</maven.test.skip>`；1700 行级上帝类 ×3；硬编码凭据（EMQX admin/public、API Key 明文 Constants.java L240-241、Keycloak secret 在 application.yml L95）；`/open-api/rest/sql` 任意 SQL 直通；Sa-Token/Flyway 声明未用、README 与事实不符；schema 靠幂等 SQL 手工续写无版本迁移；内网 nexus 依赖（pom L255-268）外部构建可能失败。
- 后端无任何 MCP/AI 实现（i18n 词条与 Kong 白名单 `/copilotkit` 是外围痕迹）；官方 MCP Server 为独立项目 `FREEZONEX/mcp-server-supos`（npm: mcp-server-supos）。

## 三、结论速查

1. 平台选型：要 Kafka 数据面/契约治理/轻边缘 → UMH；要 REST CRUD/中文生态/组态报表全家桶 → supOS。
2. 插件对接：UMH 走 Kafka 同主机直连；supOS 走 `/open-api` + apikey，实时订阅补 MQTT。
3. 两家都不是"成熟稳定"级别：UMH 工程好但产品过渡期；supOS 功能全但质量债重。生产使用均需自建回归与安全加固（尤其 supOS 的凭据与 SQL 端点）。

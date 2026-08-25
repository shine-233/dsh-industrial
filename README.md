# dsh-industrial

DeepSeek Harness（dsh）工业方向插件系列的项目主页：研究档案、技术决策、路线图，以及插件孵化区。

## 为什么有这个项目

工业数据底座（UNS / 工厂操作系统）正在成为 AI Agent 的新数据源。我们对两个主要开源方案做了源码级尽调——**UMH Core**（Go，Kafka 数据面）与 **Open supOS CE**（Java，REST/MQTT 数据面）——结论是不重构平台本身，而是做一层 dsh 插件抽象，让 agent 用一套统一工具操作任一平台的 UNS。

## 目录

```
├── docs/
│   ├── RESEARCH.md     # 两平台源码研究档案（含文件路径证据）
│   ├── DECISIONS.md    # 技术决策记录（语言选型/架构/仓库策略）
│   └── ROADMAP.md      # 路线图、插件候选池、风险登记
└── plugins/
    └── dsh-uns/        # 首个插件：统一 UNS 访问（supOS + UMH 双适配器）
```

## 当前状态

- **dsh-uns v0.1**：骨架完成。6 个工具（browse/read/write/history/watch/describe）、双适配器、tsc 构建与模块加载验证通过。待真实平台实例实测。
- 语言策略：插件 = TypeScript（dsh 宿主约束）；未来独立边缘组件 = Go。

## 快速开始

```sh
cd plugins/dsh-uns
pnpm install && pnpm run build
```

详见 plugins/dsh-uns/README.md。

## 相关资料

- 平台：https://github.com/united-manufacturing-hub/united-manufacturing-hub 、https://github.com/supOS-Project/supOS-backend
- dsh：https://github.com/deepseek-ai/deepseek-harness
- 插件模板：https://github.com/sunshine-lang/dsh-plugin-template
- 官方 MCP 参考：thingsboard/thingsboard-mcp（120+ 工具的成熟范例）、mcp-server-supos

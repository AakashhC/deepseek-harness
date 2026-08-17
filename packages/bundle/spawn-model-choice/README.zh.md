# `@deepseek-ai/dsh-spawn-model-choice`

[English](README.md) | 中文

在每次生成子代理（subagent）之前，询问人类应使用哪个模型和推理力度（reasoning effort）。

[`cordis.patch.yml`](cordis.patch.yml) 在已组合的 profile 之上插入一行（`spawn-model-choice` → [`src/spawn-model-choice.mjs`](src/spawn-model-choice.mjs)）。profile 组合器通过 `dsh.bundle.patch` 清单字段解析该 patch；本包除插件本身外没有运行时 API。

## 安装

将 bundle 加入 profile 的 `dsh.profile.bundles` 列表并重启 harness：

```jsonc
// $DSH_HOME/profiles/<name>/package.json（或 profile manifest）
{
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-spawn-model-choice"
      ]
    }
  }
}
```

修改后重启 `dsh`（或 `dsh web` 服务）。不使用 `~/.dsh` 插件路径——bundle 优先从安装目录解析，其次是 profile 目录。

## 范围

**仅限根 spawn 选择。** Web 侧 `userQuestions` 仅对精确的实时根代理受理提问（否则 `DELEGATED_CALLER`/`CALLER_NOT_LIVE`），因此嵌套 spawn（子→孙）不会触发选择器，直接沿用其已有/默认策略。

## 功能

包装 `ctx.subagents.start` / `ctx.subagents.startContinuable`（`subagent` 工具与 `run_code` 的 `tools.subagent` 都会调用的精确接入点），拦截每个未显式携带模型选择的 spawn，通过 `ctx.userQuestions.ask` 询问人类使用哪个模型/推理力度。

菜单完全动态构建：

- 通过 `ctx.llm.listProviders()` / `ctx.llm.listModels(providerId)` 获取已配置的 providers/models；
- 推理力度来自权威的 `ctx.llm.resolveModelInfo()` 路由元数据（适配器首选顺序，反映合并后的设置/覆盖），回退到设置文档（`yaml` 解析 `llm-pi-ai.providers` + `llm-deepseek`）和 `pi-ai` 目录（`@earendil-works/pi-ai/providers/all` 的 `getBuiltinModels`，兼容 `Array` / `Map` / 普通对象，并处理 `CATALOG_ALIAS`）；
- 成本来自 `pi-ai` 目录（`cost.input` + `cost.output` 按每 1M 混合），仅在已定价时显示为 ` (est. $X.XX/1M)`（混合估算，诚实定价）。

设置文档中声明的 `reasoningEfforts` 对该模型是权威的——目录仅作为未声明模型的回退。设置中声明的任意层级（`"max"`、`"zen"` 等）都会被提供、展示并可被解析。

人类通过 harness 自带的 `ctx.userQuestions.ask` 对话框作答。自由文本（如 `"deepseek v4 flash at high effort"`）先确定性解析（精确 id/name、唯一模糊、已声明 effort id 及 `xtra`/`deep` 等上位同义词），仅模糊文本进入有界 LLM 解释（≤12 条候选）；无法解析时会再询问一次，仍无法解析则保持 fail-open。选项按 `group` 分组（`Tiers` vs `More models`，需要 `user-questions` 选项分组变更才渲染分组标题，否则保持平铺）。

## 配置参考

所有键均为可选；省略 `config` 即使用默认值。通过后续的 patch 层（profile 或 home 的 `cordis.patch.yml`）在插入行上配置。patch 会替换整行 `config`，需重述保留的字段。

| 键 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `enabled` | `boolean` | `true` | 总开关。`false` 时挂载但不包装任何调用。 |
| `askForSpawn` | `boolean` | `true` | `true` 时每次缺少显式 `agentOptions` 的 spawn 都会弹窗；`false` 时永不询问。 |
| `parentModelRecommendation` | `boolean` | `true` | `true` 时用父模型做一次廉价的 `llmText` 分类（`simple`/`medium`/`hard`，匹配 `\bhard\b` / `\bsimple\b`），将对应档位标记为 **(Recommended)** 并置顶。`false` 时不调用 LLM。 |
| `askWhenExplicit` | `boolean` | `false` | `false` 时已携带显式模型选择（仅 `provider`/`model`/`reasoningEffort`，`maxTokens` 等尺寸键不算）的 spawn 不会被拦截；`true` 时也会询问。 |
| `maxManualOptions` | `number` | `3` | 在三个档位之外额外列出的非默认模型数量，按成本从低到高，每个使用其最深的已声明力度。 |
| `qualityRank` | `Record<string, number>` | `{}` | 可选质量排名 —— `"provider/model": number`。有排名时 **Correctness** 档位取排名最高者，否则取最高价路由。 |
| `recommender` | `{ provider, model, reasoningEffort? } \| undefined` | `undefined` | 分类调用的可选路由；未设置时使用父模型在其最低已声明力度上的判断。 |
| `logFile` | `string \| undefined` | `undefined` | 可选的调试日志文件路径（bundle 默认 OFF，禁用）。设置路径后启用，通过 `node:fs/promises` 异步追加，1MB 轮转，永不抛错、永不阻塞，日志经 `cleanText` 脱敏。 |

在 `profiles/<name>/cordis.patch.yml` 中覆盖示例：

```yaml
- id: spawn-model-choice
  config:
    enabled: true
    askForSpawn: true
    parentModelRecommendation: true
    askWhenExplicit: false
    maxManualOptions: 3
    qualityRank:
      deepseek/deepseek-chat: 10
    recommender:
      provider: deepseek
      model: deepseek-chat
      reasoningEffort: low
    # logFile: /tmp/spawn-model-choice.log
```

## 行为说明

- **全链路 fail-open。** 任何错误、abort、无用户、缺失 `ctx.llm`/`ctx.userQuestions`、嵌套 spawn（`DELEGATED_CALLER`/`CALLER_NOT_LIVE`）、无效/过期选择（经 `ctx.llm.resolveCallConfig` 校验）或自由文本无法解析时，spawn 按 harness 原有逻辑继续执行。`withAgentOptions` 永不原地修改输入，返回新对象。`off` 保留在原始 effort 列表中，仅在档位/注入需要真实力度时排除。
- **诚实定价与档位语义。** 仅当 `entry.priced === true` 时显示 `priceSuffix`（` (est. $X.XX/1M)`，零成本显示 ` (est. $0.00/1M)`）；`UNKNOWN_COST`（`null`）永不渲染为数字。`Balanced` 为配置的默认模型及其已配置力度；`Correctness` 为有排名时 `qualityRank` 最高者否则最高价路由的最深力度；`Cost` 为最低估算价格的最低力度。每档描述即陈述其判定标准。未知价格模型永不成为档位。
- **动态目录与缓存。** 提供商/模型/力度/成本列表按 `apply` 缓存，并在 `llm/adapters-updated` 事件时失效（而非每次 spawn 重建）；`pi-ai` 目录按路由索引一次（无 O(N²)）。`getBuiltinModels` 动态导入，`yaml` 动态导入解析设置文档。力度权威来源为 `ctx.llm.resolveModelInfo()`。
- **三档位 + 手动列表与分组。** 父模型 verdict 将对应档位标记为 `(Recommended)` 并置顶。手动列表通过 `skipEntries` 去重，标签在注册前经 `uniqueChoiceLabel` 决定（`base` → `base (provider)` → `base (provider/model)`），最多 `maxManualOptions` 个最便宜剩余模型；所有选项带 `group`（`Tiers` / `More models`，需 `user-questions` 分组变更才渲染标题，否则平铺）。
- **自由文本 + 追问。** 自由文本先确定性解析（`deterministicMatch` + `effortFromText`，含 `xtra`/`deep` 等同义词），仅模糊文本进入有界 shortlist（≤12, `boundedTable`）的 LLM 解释。`llmText` 仅消费 `text-delta`（`block-end` 携带相同完整块，重复追加会翻倍），处理终结 `finish` 块（`reason.kind: error|aborted` → 抛错；无 finish → 抛错，永不空输出），支持 `system` + `reasoningEffort` 选项。`llmJson` 提取首个 `{…}`，失败则一次有界重试。`resolveCustomAnswer` 使用可选 `recommender` 路由否则父模型最低力度。若无法映射则再询问一次，仍失败则放行。
- **每问独立的 `choiceMap` 与幂等包装。** 每次提问拥有独立 `Map<label, choice>`，并发永不串扰。包装通过 `Symbol.for('spawn-model-choice.wrapped')` 幂等，`dispose` 仅在仍为本插件包装时还原。`hasExplicitModelChoice` 仅检查 `provider`/`model`/`reasoningEffort`。
- **诚实文案与日志。** 对话框 `detail` 行包含 `"Skipping or dismissing uses the configured default model."` 等提示。`cleanText`/`summarizeTask` 脱敏截断。文件日志由 `logFile` 按需开启（默认 OFF），启用后经 `cleanText` 脱敏、1MB 轮转。

## 为什么需要

子代理在未显式指定 `agentOptions` 时会继承一个冻结的路由——父代理的模型/力度被固化在委派调用中。若无此插件，即使任务需要更深推理或更便宜模型，每次 spawn 也会静默复用配置的默认值。本插件在每次 spawn 前（可选、fail-open）询问人类，并将选中的 `agentOptions`（`provider`、`model`、`reasoningEffort`）注入到真正的 `start`/`startContinuable` 之前。

## 已知限制

- `ctx.llm.stream` 的 text-delta / `block-end` 解析以及 `\bhard\b` / `\bsimple\b` 判定与当前 `dsh-llm` 流形状耦合。
- 自由文本解析需要父模型路由（`request.parent.options` 或默认模型）；没有时无法判定，直接放行。

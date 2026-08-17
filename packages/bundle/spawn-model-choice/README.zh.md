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

## 功能

包装 `ctx.subagents.start` / `ctx.subagents.startContinuable`（`subagent` 工具与 `run_code` 的 `tools.subagent` 都会调用的精确接入点），拦截每个未显式携带 `agentOptions` 的 spawn，通过 `ctx.userQuestions.ask` 询问人类使用哪个模型/推理力度。

菜单完全动态构建：

- 通过 `ctx.llm.listProviders()` / `ctx.llm.listModels(providerId)` 获取已配置的 providers/models；
- 通过 `yaml` 解析设置文档（`ctx.settings.documentPath`，`llm-pi-ai.providers` + `llm-deepseek`）以及皮层 `pi-ai` 目录（`@earendil-works/pi-ai/providers/all` 的 `getBuiltinModels`，兼容 `Array` / `Map` / 普通对象，并处理 `CATALOG_ALIAS`）获取推理力度与成本；
- 成本来自 `pi-ai` 目录（`cost.input` + `cost.output` 按每 1M 混合），仅在已定价时显示。

设置文档中声明的 `reasoningEfforts` 对该模型是权威的——目录仅作为未声明模型的回退。设置中声明的任意层级（`"max"`、`"zen"` 等）都会被提供、展示并可被解析。

人类通过 harness 自带的 `ctx.userQuestions.ask` 对话框作答。自由文本（如 `"deepseek v4 flash at high effort"`）由父模型对照实时表格解析；无法解析时会再询问一次，仍无法解析则保持 fail-open。

## 配置参考

所有键均为可选；省略 `config` 即使用默认值。通过后续的 patch 层（profile 或 home 的 `cordis.patch.yml`）在插入行上配置。patch 会替换整行 `config`，需重述保留的字段。

| 键 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `enabled` | `boolean` | `true` | 总开关。`false` 时挂载但不包装任何调用。 |
| `askForSpawn` | `boolean` | `true` | `true` 时每次缺少显式 `agentOptions` 的 spawn 都会弹窗；`false` 时永不询问。 |
| `parentModelRecommendation` | `boolean` | `true` | `true` 时用父模型做一次廉价的 `llmText` 分类（`simple`/`medium`/`hard`，匹配 `\bhard\b` / `\bsimple\b`），将对应档位标记为 **(Recommended)** 并置顶。`false` 时不调用 LLM。 |
| `askWhenExplicit` | `boolean` | `false` | `false` 时已携带显式 `agentOptions` 的 spawn 不会被拦截；`true` 时也会询问。 |
| `maxManualOptions` | `number` | `3` | 在三个档位之外额外列出的非默认模型数量，按成本从低到高，每个使用其最深的已声明力度。 |
| `logFile` | `string \| undefined` | `undefined` | 可选的调试日志文件路径。未设置时不写文件；设置后通过 `node:fs/promises` 异步追加，1MB 轮转，永不抛错、永不阻塞。 |

在 `profiles/<name>/cordis.patch.yml` 中覆盖示例：

```yaml
- id: spawn-model-choice
  config:
    enabled: true
    askForSpawn: true
    parentModelRecommendation: true
    askWhenExplicit: false
    maxManualOptions: 3
    # logFile: /tmp/spawn-model-choice.log
```

## 行为说明

- **全链路 fail-open。** 任何错误、abort、无用户、缺失 `ctx.llm`/`ctx.userQuestions` 或自由文本无法解析时，spawn 按 harness 原有逻辑继续执行。`withAgentOptions` 永不原地修改输入，返回新对象。
- **诚实定价。** 仅当 `entry.priced === true` 时显示 `priceSuffix`；`UNKNOWN_COST`（`null`）永不渲染为数字。输入/输出成本按 `(input + output) / 2` 混合（USD/1M），档位通过带 null-cost 守卫的 `extremePick` 选取；未知价格的模型永不成为档位。价格保留两位小数。
- **动态目录。** 每次拦截时从实时 harness 状态与 `pi-ai` 目录重建 provider/model/effort/cost 列表；无硬编码。`getBuiltinModels` 从 `@earendil-works/pi-ai/providers/all` 动态导入，兼容 `Array`、`Map`、普通对象。`yaml` 动态导入并解析设置文档。
- **三档位 + 手动列表。** `Balanced` 为配置的默认模型及其默认 `reasoningEffort`；`Correctness` 为最贵模型的最深力度；`Cost` 为最便宜模型的最低力度。父模型 verdict（`\bhard\b` → Correctness，`\bsimple\b` → Cost，否则 Balanced）将对应档位标记为 `(Recommended)` 并附带可见理由（`judged hard`/`simple`/`medium`）置顶。手动列表通过 `skipEntries` 去重排除三档位已提供的模型，并通过 `addManualOption` 在标签冲突时追加 `(provider)` 后缀，最多追加 `maxManualOptions` 个最便宜的剩余模型。
- **自由文本 + 追问。** `llmJson` 提取返回中的首个 `{…}` JSON 对象；未找到则做**一次**有界重试，回显违规回复并提示 `"Your previous reply contained no JSON object. Reply with ONLY a JSON object…"`。`resolveCustomAnswer` 构建实时条目列表（`- provider/model (name); efforts: …`）并让父模型将自由文本映射到其中（理解同义词/缩写，effort 必须是该条目已声明的）。若无法映射，则向用户**再询问一次** `“<text>” does not match a configured model. Choose one:`；仍无法解析则放行。
- **每问独立的 `choiceMap`。** 每次提问拥有独立的 `Map<label, choice>`，并发 spawn 永不串扰。`withAgentOptions` 在选择无 effort 时保留原有显式 `reasoningEffort`；有 effort 的选择始终胜出。
- **诚实文案。** 对话框 `detail` 行包含 `"Skipping or dismissing uses the configured default model."`、默认基线（`<name> at <effort>` 或 `the configured default model`）以及 `"You can also type a model name and effort."` 提示。`cleanText`/`summarizeTask` 对用户来源字符串做净化（引号/换行替换、空白折叠、110 字符单词边界截断、标签 80 字符上限）。
- **日志。** 文件日志由 `logFile` 按需开启。启用后 `logLine` 通过 `node:fs/promises` 异步追加，1MB 轮转，永不抛错或阻塞。

## 为什么需要

子代理在未显式指定 `agentOptions` 时会继承一个冻结的路由——父代理的模型/力度被固化在委派调用中。若无此插件，即使任务需要更深推理或更便宜模型，每次 spawn 也会静默复用配置的默认值。本插件在每次 spawn 前（可选、fail-open）询问人类，并将选中的 `agentOptions`（`provider`、`model`、`reasoningEffort`）注入到真正的 `start`/`startContinuable` 之前。

## 已知限制

- `ctx.llm.stream` 的 text-delta / `block-end` 解析以及 `\bhard\b` / `\bsimple\b` 判定与当前 `dsh-llm` 流形状耦合。
- 自由文本解析需要父模型路由（`request.parent.options` 或默认模型）；没有时无法判定，直接放行。

# `@deepseek-ai/dsh-spawn-model-choice`

English | [中文](README.zh.md)

Ask the human which model + reasoning effort each spawned subagent should use — before the spawn happens.

[`cordis.patch.yml`](cordis.patch.yml) inserts a single row (`spawn-model-choice` → [`src/spawn-model-choice.mjs`](src/spawn-model-choice.mjs)) over the composed profile. The profile composer resolves the patch through the `dsh.bundle.patch` manifest field; the package has no runtime API beyond the plugin itself.

## Install

Add the bundle to the profile's `dsh.profile.bundles` list and restart the harness:

```jsonc
// $DSH_HOME/profiles/<name>/package.json (or the profile manifest)
{
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-spawn-model-choice"
        // ...other bundles, then the user's cordis.patch.yml
      ]
    }
  }
}
```

Or, if the profile keeps its manifest elsewhere, add `@deepseek-ai/dsh-spawn-model-choice` to the `dsh.profile.bundles` array that `loadProfile` reads. After editing, restart `dsh` (or the `dsh web` server). No `~/.dsh` plugin paths are used — the bundle is resolved from the installation first, then the profile directory.

## What it does

Wraps `ctx.subagents.start` / `ctx.subagents.startContinuable` — the exact seam both the `subagent` tool and `run_code`'s `tools.subagent` call — so every spawn without explicit `agentOptions` is intercepted and the human is asked which model + reasoning effort to use.

The menu is built **dynamically** from what the harness itself has configured:

- **Providers/models** via `ctx.llm.listProviders()` / `ctx.llm.listModels(providerId)`.
- **Reasoning efforts** from the settings document (`ctx.settings.documentPath`, parsed with `yaml`: `llm-pi-ai.providers` + `llm-deepseek` sections) and from the installed pi-ai catalog (`getBuiltinModels` from `@earendil-works/pi-ai/providers/all`, handling `Array` / `Map` / plain-object returns via `CATALOG_ALIAS`).
- **Costs** from the pi-ai catalog (`cost.input` + `cost.output` blended per-1M), shown only when priced.

Settings-declared `reasoningEfforts` are **authoritative** for that model — the catalog is only a fallback for undeclared models. Any level the settings declare (`"max"`, `"zen"`, anything) is offered, shown, and resolvable.

The human answers through the harness's own `ctx.userQuestions.ask` UI. Free-text answers (e.g. `"deepseek v4 flash at high effort"`) are resolved by the parent model against the live table; when unresolvable the plugin asks once more, then fails open.

## Config reference

All keys are optional; omitting `config` keeps the defaults. Configure them on the inserted row via a later patch layer (profile or home `cordis.patch.yml`) or via the bundle row's `config` if the profile overrides it. A patch replaces the whole `config`, so restate unchanged fields.

| Key | Type | Default | Description |
|---|---|---|---|
| `enabled` | `boolean` | `true` | Master switch. When `false`, the plugin mounts but does not wrap anything. |
| `askForSpawn` | `boolean` | `true` | When `true`, every spawn lacking explicit `agentOptions` triggers the ask. When `false`, never asks (useful to keep the plugin mounted but dormant). |
| `parentModelRecommendation` | `boolean` | `true` | When `true`, a cheap `llmText` classification call on the parent model judges task complexity (`simple`/`medium`/`hard` via `\bhard\b` / `\bsimple\b`) and tags the matching tier **(Recommended)** and moves it first. When `false`, the default order is used and no LLM call is made. |
| `askWhenExplicit` | `boolean` | `false` | When `false`, spawns that already carry explicit `agentOptions` (non-empty) are not intercepted. When `true`, they are asked too. |
| `maxManualOptions` | `number` | `3` | How many non-default models (those not already offered as Balanced/Correctness/Cost) to list individually, cheapest-first. Each is shown at its deepest declared effort. |
| `logFile` | `string \| undefined` | `undefined` | Optional file path for debug logging. When unset, file logging is disabled (no-op). When set, appends lines with `node:fs/promises` (`appendFile` + `1MB` rotation via `stat`/`unlink`), never throws, never blocks the spawn path. |

Example override in `profiles/<name>/cordis.patch.yml`:

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

## Behavior notes

- **Fail-open everywhere.** Any error, abort, absent user, missing `ctx.llm`/`ctx.userQuestions`, or unresolvable free text lets the spawn proceed exactly as the harness would have run it. Input `request` is never mutated — `withAgentOptions` returns a new object.
- **Honest pricing.** `priceSuffix` is shown only when `entry.priced === true`; `UNKNOWN_COST` (`null`) is never rendered as a number. The input/output blend is `(input + output) / 2` in USD per 1M tokens. Tiers (`Balanced`/`Correctness`/`Cost`) are picked via `extremePick` with a null-cost guard and the `priced` flag; unknown-price models are never tier picks. Prices are formatted to 2 decimals.
- **Dynamic catalog.** Provider/model/effort/cost lists are rebuilt on every intercept from the live harness state plus the pi-ai catalog; nothing is hardcoded. `getBuiltinModels` is dynamically imported from `@earendil-works/pi-ai/providers/all` and handles `Array`, `Map`, and plain-object returns. `yaml` is dynamically imported to parse the settings document.
- **Three tiers + manual list.** `Balanced` is the configured default model at its default `reasoningEffort`; `Correctness` is the priciest model at its deepest effort; `Cost` is the cheapest model at its lowest effort. The parent-model verdict (`\bhard\b` → Correctness, `\bsimple\b` → Cost, else Balanced) tags one tier `(Recommended)` with a visible rationale (`judged hard`/`simple`/`medium`) and moves it first. The manual list adds up to `maxManualOptions` cheapest remaining models (excluding the three tier models via `skipEntries` dedupe, provider-suffixed label disambiguation via `addManualOption` when a label collides).
- **Free-text + follow-up.** `llmJson` extracts the first `{…}` JSON object from the completion; if none is found it does **one** bounded retry echoing the offending reply with `"Your previous reply contained no JSON object. Reply with ONLY a JSON object…"`. `resolveCustomAnswer` builds the live entry list (`- provider/model (name); efforts: …`) and asks the parent model to map free text onto it (synonyms/shorthand understood, effort must belong to that entry). If the parent cannot map the text, the user is asked **once more** with `“<text>” does not match a configured model. Choose one:`; still unresolved, the spawn proceeds untouched.
- **Per-ask `choiceMap`.** Each ask owns its own `Map<label, choice>`, so concurrent spawns never collide. `withAgentOptions` preserves a pre-existing explicit `reasoningEffort` when the chosen entry has none; a chosen effort always wins.
- **Honest copy.** The dialogue's `detail` line includes `"Skipping or dismissing uses the configured default model."` plus the default baseline (`<name> at <effort>` or `the configured default model`) and a `"You can also type a model name and effort."` hint. `cleanText`/`summarizeTask` sanitize user-derived strings (quote/newline replacement, whitespace collapse, word-boundary truncation at 110 chars, 80-char label cap).
- **Logging.** File logging is opt-in via `logFile`. When enabled, `logLine` appends async via `node:fs/promises` and rotates at 1 MB; it never throws or blocks.

## Why

Children inherit a frozen route without explicit `agentOptions` — the parent's model/effort is baked into the delegation call. Without this plugin, every spawn silently reuses the configured default even when the task wants deeper reasoning or a cheaper model. This plugin asks the human per spawn (optional, fail-open) and injects the chosen `agentOptions` (`provider`, `model`, `reasoningEffort`) before the real `start`/`startContinuable` runs.

## Known limitations

- The `ctx.llm.stream` text-delta / `block-end` parsing and the `\bhard\b` / `\bsimple\b` verdicts are coupled to the current `dsh-llm` stream shape.
- Free-text resolution requires a parent model route (`request.parent.options` or the default model); without one the text cannot be judged and the spawn proceeds untouched.

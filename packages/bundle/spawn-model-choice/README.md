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

## Scope

**Root-spawn selection only.** The web question host admits a question only for the exact live runtime-root agent (`DELEGATED_CALLER` / `CALLER_NOT_LIVE` otherwise). Nested spawns (child → grandchild) therefore do **not** trigger the chooser and inherit their supplied/default policy, exactly as without this plugin. The plugin catches those delegated errors deliberately and proceeds untouched (root-only, documented in the header).

## What it does

Wraps `ctx.subagents.start` / `ctx.subagents.startContinuable` — the exact seam both the `subagent` tool and `run_code`'s `tools.subagent` call — so every spawn without explicit `agentOptions` is intercepted and the human is asked which model + reasoning effort to use.

The menu is built **dynamically** from what the harness itself has configured:

- **Providers/models** via `ctx.llm.listProviders()` / `ctx.llm.listModels(providerId)`.
- **Reasoning efforts** from the authoritative `ctx.llm.resolveModelInfo()` route metadata (adapter-preferred order, reflects merged settings/overrides), falling back to the settings document (`ctx.settings.documentPath`, parsed with `yaml`: `llm-pi-ai.providers` + `llm-deepseek` sections) and the pi-ai catalog (`getBuiltinModels` from `@earendil-works/pi-ai/providers/all`, handling `Array` / `Map` / plain-object returns via `CATALOG_ALIAS`). `off` is kept in the raw effort list and excluded only where tiers/injection need a real effort.
- **Costs** from the pi-ai catalog (`cost.input` + `cost.output` blended per-1M), shown only when priced as ` (est. $X.XX/1M)`. Prices are blended per-1M estimates (input+output / 2) and are honest — unknown prices are never rendered.

Settings-declared `reasoningEfforts` are **authoritative** for that model — the catalog is only a fallback for undeclared models. Any level the settings declare (`"max"`, `"zen"`, anything) is offered, shown, and resolvable.

The human answers through the harness's own `ctx.userQuestions.ask` UI. Free-text answers (e.g. `"deepseek v4 flash at high effort"`) resolve deterministically first (exact id/name, unique fuzzy, declared effort ids and superlative synonyms including `xtra`/`deep`), and only ambiguous text goes to a bounded LLM interpretation (shortlist ≤12). When unresolvable the plugin asks once more, then fails open.

## Config reference

All keys are optional; omitting `config` keeps the defaults. Configure them on the inserted row via a later patch layer (profile or home `cordis.patch.yml`) or via the bundle row's `config` if the profile overrides it. A patch replaces the whole `config`, so restate unchanged fields.

| Key | Type | Default | Description |
|---|---|---|---|
| `enabled` | `boolean` | `true` | Master switch. When `false`, the plugin mounts but does not wrap anything. |
| `askForSpawn` | `boolean` | `true` | When `true`, every spawn lacking explicit model choice triggers the ask. When `false`, never asks (useful to keep the plugin mounted but dormant). |
| `parentModelRecommendation` | `boolean` | `true` | When `true`, a cheap `llmText` classification call judges task complexity (`simple`/`medium`/`hard` via `\bhard\b` / `\bsimple\b`) and tags the matching tier **(Recommended)** and moves it first. When `false`, the default order is used and no LLM call is made. |
| `askWhenExplicit` | `boolean` | `false` | When `false`, spawns that already carry an explicit model choice (`provider`/`model`/`reasoningEffort` only — sizing keys like `maxTokens` do not count) are not intercepted. When `true`, they are asked too. |
| `maxManualOptions` | `number` | `1` | How many non-default models (those not already offered as the three tiers) to list individually, cheapest-first. Default 1 keeps the card at ≤4 visible options (3 tiers + 1 manual) for a money decision; configurable up to 10. Each is shown at its deepest declared effort. |
| `qualityRank` | `Record<string, number>` | `{}` | Optional quality ranking — `"provider/model": number`. When any entry is ranked, the **Correctness** tier picks the top-ranked entry; otherwise it picks the highest-priced route. Unranked entries never win when a rank exists. |
| `recommender` | `{ provider, model, reasoningEffort? } \| undefined` | `undefined` | Optional route for the classification call. When set, that route is used; otherwise the parent model at its **lowest declared effort** is used (the cheapest honest judgment this menu can make). |
| `logFile` | `string \| undefined` | `undefined` | Optional file path for redacted diagnostic logging. When unset, file logging is **disabled** (bundle default: OFF, no-op). When set to a path, appends lines with `node:fs/promises` (`appendFile` + `1MB` rotation via `stat`/`unlink`), never throws, never blocks the spawn path. Log lines are sanitized via `cleanText`. |

Example override in `profiles/<name>/cordis.patch.yml`:

```yaml
- id: spawn-model-choice
  config:
    enabled: true
    askForSpawn: true
    parentModelRecommendation: true
    askWhenExplicit: false
    maxManualOptions: 1
    qualityRank:
      deepseek/deepseek-chat: 10
      anthropic/claude-sonnet-4: 9
    recommender:
      provider: deepseek
      model: deepseek-chat
      reasoningEffort: low
    # logFile: /tmp/spawn-model-choice.log
```

## Behavior notes

- **Fail-open everywhere.** Any error, abort, absent user, missing `ctx.llm`/`ctx.userQuestions`, delegated (nested) spawn, invalid/stale choice (validated via `ctx.llm.resolveCallConfig` before injection), or unresolvable free text lets the spawn proceed exactly as the harness would have run it. Input `request` is never mutated — `withAgentOptions` returns a new object. `off` is kept in the raw effort list and excluded only where tiers/injection need a real effort; off-only entries never produce a "Deepest declared effort: undefined" row.
- **Honest tier semantics.** `Balanced` is the configured default model at its configured effort; `Correctness` is the top `qualityRank` entry at its deepest declared effort when any entry is ranked, otherwise the highest-priced route at its deepest effort; `Cost` is the lowest estimated price at its lowest effort. Each tier's description states its criterion (e.g. "Top quality rank (N) — …" vs "Highest-priced route — …" vs "Lowest estimated price — …" vs "Configured default — …"). Prices are blended per-1M estimates (` (est. $X.XX/1M)`) and shown only when priced; unknown-price models are never tier picks.
- **Client `group` integration.** Every option carries a `group` field for the wire type `AskUserQuestionOption`: tiers get `group: 'Tiers'`, manual options get `group: 'More models'`. The composer renders group headings when the `user-questions` option-groups change is present; without it options stay flat (additive, safe). Absent `group` = flat rendering.
- **Dynamic catalog.** Provider/model/effort/cost lists are resolved per-apply and cached, invalidated on the `llm/adapters-updated` event (not rebuilt per spawn). The pi-ai catalog is indexed once per route (no O(N²)). `getBuiltinModels` is dynamically imported from `@earendil-works/pi-ai/providers/all` and handles `Array`, `Map`, and plain-object returns. `yaml` is dynamically imported to parse the settings document. Efforts come from the authoritative `ctx.llm.resolveModelInfo()` route (adapter-preferred order, reflects merged settings/overrides), falling back to settings-document declarations then the pi-ai catalog.
- **Three tiers + manual list.** The parent-model verdict (`\bhard\b` → Correctness, `\bsimple\b` → Cost, else Balanced) tags one tier `(Recommended)` with a visible rationale (`judged hard`/`simple`/`medium`) and moves it first. The manual list adds up to `maxManualOptions` cheapest remaining models (excluding the three tier models via `skipEntries` dedupe). Labels are decided **before** registration via `uniqueChoiceLabel` (displayed label can never decode to nothing): base → `base (provider)` → `base (provider/model)` collision ladder. `priceSuffix` renders ` (est. $0.00/1M)` for zero-cost priced entries (cost 0 is real, not unknown).
- **Free-text + follow-up.** Free text resolves deterministically first (`deterministicMatch` + `effortFromText` — declared ids verbatim + superlative synonyms incl. `xtra`/`deep` → deepest declared, `min` → lowest); only ambiguous text goes to a bounded LLM shortlist (≤12, `boundedTable`). `llmText` consumes only `text-delta` (a `block-end` carries the same fully assembled block — appending both would double the text), handles terminal `finish` chunks (`reason.kind: error|aborted` → throw; no finish → throw, never empty output), and accepts `system` + `reasoningEffort` options. `llmJson` extracts the first `{…}` JSON object from the completion; if none is found it does **one** bounded retry quoting the offending reply. `resolveCustomAnswer` uses the optional `recommender` config route else the parent model at its lowest declared effort. If the parent cannot map the text, the user is asked **once more** with `“<text>” does not match a configured model. Choose one:`; still unresolved, the spawn proceeds untouched.
- **Per-ask `choiceMap` + idempotent wrapping.** Each ask owns its own `Map<label, choice>`, so concurrent spawns never collide. Wrapping is idempotent via `Symbol.for('spawn-model-choice.wrapped')` and dispose restore only unwraps when the installed methods are still this plugin's wrappers. `hasExplicitModelChoice` checks only `provider`/`model`/`reasoningEffort` — sizing keys like `maxTokens` no longer suppress the chooser.
- **Honest copy.** The dialogue's `detail` line includes `"Skipping or dismissing uses the configured default model."` plus the default baseline (`<name> at <effort>` or `the configured default model`) and a `"You can also type a model name and effort."` hint. `cleanText`/`summarizeTask` sanitize user-derived strings (quote/newline replacement, whitespace collapse, word-boundary truncation at 110 chars, 80-char label cap).
- **Logging.** File logging is opt-in via `logFile` (bundle default: OFF). When enabled, `logLine` appends async via `node:fs/promises` and rotates at 1 MB; it never throws or blocks. Log lines are sanitized via `cleanText`; `logFile` can redirect/disable.

## Why

Children inherit a frozen route without explicit `agentOptions` — the parent's model/effort is baked into the delegation call. Without this plugin, every spawn silently reuses the configured default even when the task wants deeper reasoning or a cheaper model. This plugin asks the human per spawn (optional, fail-open) and injects the chosen `agentOptions` (`provider`, `model`, `reasoningEffort`) before the real `start`/`startContinuable` runs.

## Known limitations

- The `ctx.llm.stream` text-delta / `block-end` parsing and the `\bhard\b` / `\bsimple\b` verdicts are coupled to the current `dsh-llm` stream shape.
- Free-text resolution requires a parent model route (`request.parent.options` or the default model); without one the text cannot be judged and the spawn proceeds untouched.

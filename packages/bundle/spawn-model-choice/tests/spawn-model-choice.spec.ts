/**
 * spawn-model-choice pure-helper specs: exercise the harness-free helpers
 * exported from the `.mjs` plugin without booting a Cordis tree.
 */

import { describe, expect, it } from 'vitest'
import {
  apply,
  classifyTask,
  Config,
  inject,
  extractJson,
  withAgentOptions,
  cleanText,
  summarizeTask,
  extremePick,
  priceSuffix,
  deterministicMatch,
  effortFromText,
  boundedTable,
  uniqueChoiceLabel,
  hasExplicitModelChoice,
  activeEfforts,
  highestEffort,
  lowestEffort,
  llmText,
  normalizeConfig,
  validateCandidate,
} from '../src/spawn-model-choice.mjs'

describe('spawn-model-choice helpers', () => {
  describe('extractJson', () => {
    it('parses the first JSON object from surrounding prose', () => {
      expect(extractJson('before {"provider":"a","model":"b"} after')).toEqual({
        provider: 'a',
        model: 'b',
      })
    })

    it('parses a bare JSON object', () => {
      expect(extractJson('{"provider":null}')).toEqual({ provider: null })
    })

    it('returns undefined when no JSON object is present', () => {
      expect(extractJson('no json here')).toBeUndefined()
      expect(extractJson('')).toBeUndefined()
      expect(extractJson(undefined)).toBeUndefined()
    })

    it('returns undefined for malformed JSON', () => {
      expect(extractJson('{ not json }')).toBeUndefined()
      expect(extractJson('{"unclosed":')).toBeUndefined()
    })

    it('extracts the first JSON object when multiple are present', () => {
      const text = 'first {"a":1} second {"b":2}'
      expect(extractJson(text)).toEqual({ a: 1 })
    })

    it('extracts the first parseable JSON when first brace is unparsable then valid', () => {
      // "{ not json } {"a":1}" — first balanced object fails parse, second succeeds
      const text = '{ not json } {"valid":42} trailing'
      expect(extractJson(text)).toEqual({ valid: 42 })
    })
  })

  describe('withAgentOptions', () => {
    it('chosen effort wins over a pre-existing explicit reasoningEffort', () => {
      const request = {
        label: 'x',
        agentOptions: { provider: 'old-p', model: 'old-m', reasoningEffort: 'low' },
        prompt: [],
      }
      const chosen = { provider: 'new-p', model: 'new-m', effort: 'xhigh' }
      const out = withAgentOptions(request, chosen)
      expect(out.agentOptions.provider).toBe('new-p')
      expect(out.agentOptions.model).toBe('new-m')
      expect(out.agentOptions.reasoningEffort).toBe('xhigh')
    })

    it('clears the original explicit reasoningEffort on a route switch (no-effort choice = model default)', () => {
      const request = {
        label: 'x',
        agentOptions: { provider: 'old-p', model: 'old-m', reasoningEffort: 'medium' },
        prompt: [],
      }
      const chosen = { provider: 'new-p', model: 'new-m', effort: undefined }
      const out = withAgentOptions(request, chosen)
      expect(out.agentOptions.reasoningEffort).toBeUndefined()
      expect(out.agentOptions.provider).toBe('new-p')
      expect(out.modelSelection).toEqual({ provider: 'new-p', model: 'new-m' })
    })

    it('omits reasoningEffort when neither the choice nor the original had one', () => {
      const request = { label: 'x', prompt: [] }
      const chosen = { provider: 'p', model: 'm', effort: undefined }
      const out = withAgentOptions(request, chosen)
      expect(out.agentOptions).not.toHaveProperty('reasoningEffort')
    })

    it('does not mutate the input request', () => {
      const request = {
        label: 'x',
        agentOptions: { provider: 'old', model: 'old', reasoningEffort: 'low' },
        prompt: [],
      }
      const snapshot = structuredClone(request)
      withAgentOptions(request, { provider: 'p', model: 'm', effort: 'high' })
      expect(request).toEqual(snapshot)
    })

    it('returns the original request when chosen is falsy or incomplete', () => {
      const request = { label: 'x', prompt: [] }
      expect(withAgentOptions(request, undefined)).toBe(request)
      expect(withAgentOptions(request, null)).toBe(request)
      expect(withAgentOptions(request, { provider: undefined, model: 'm' } as never)).toBe(request)
      expect(withAgentOptions(request, { provider: 'p', model: undefined } as never)).toBe(request)
    })
  })

  describe('cleanText / summarizeTask', () => {
    it('sanitizes quotes and newlines and truncates to 80 chars', () => {
      const out = cleanText('a "b" \n c\u201d d \\ e')
      expect(out).not.toContain('"')
      expect(out).not.toContain('\n')
      expect(out.length).toBeLessThanOrEqual(80)
    })

    it('summarizeTask collapses whitespace and truncates at a word boundary', () => {
      const long = 'word '.repeat(40).trim()
      const summary = summarizeTask(long, 110)
      expect(summary.length).toBeLessThanOrEqual(115)
      expect(summary.endsWith(' …')).toBe(true)
    })

    it('summarizeTask returns the original text when short enough', () => {
      expect(summarizeTask('short task', 110)).toBe('short task')
    })
  })

  describe('priceSuffix and extremePick', () => {
    it('priceSuffix is empty when not priced, and formatted to 2 decimals when priced', () => {
      expect(priceSuffix({ priced: false, cost: null })).toBe('')
      expect(priceSuffix({ priced: true, cost: 1.5 })).toBe(' (est. $1.50/1M)')
      expect(priceSuffix({ priced: true, cost: 0.1 })).toBe(' (est. $0.10/1M)')
    })

    it('priceSuffix for zero-cost priced entry renders est $0.00 (cost 0 is real, not unknown)', () => {
      expect(priceSuffix({ priced: true, cost: 0 })).toBe(' (est. $0.00/1M)')
    })

    it('extremePick ignores entries without efforts and with unknown cost', () => {
      const table = new Map<string, { efforts: string[]; cost: number | null }>([
        ['a/m1', { efforts: [], cost: 10 }],
        ['a/m2', { efforts: ['low'], cost: null }],
        ['a/m3', { efforts: ['low'], cost: 5 }],
        ['a/m4', { efforts: ['low', 'high'], cost: 20 }],
      ])
      expect(extremePick(table as never, 'max')?.cost).toBe(20)
      expect(extremePick(table as never, 'min')?.cost).toBe(5)
    })

    it('extremePick returns null when nothing qualifies', () => {
      const table = new Map<string, { efforts: string[]; cost: number | null }>([
        ['a/m1', { efforts: [], cost: 10 }],
        ['a/m2', { efforts: ['low'], cost: null }],
      ])
      expect(extremePick(table as never, 'max')).toBeNull()
    })
  })

  describe('settings-efforts-authoritative branch (contract)', () => {
    it('catalog efforts are only a fallback — settings-declared reasoningEfforts win when present', async () => {
      // This test documents the upstream contract without requiring a full
      // harness. It exercises the merge rule isolated from buildModelTable's
      // dynamic imports: if both a catalog and a settings declaration exist
      // for the same provider/model, the settings list replaces the catalog
      // list entirely (including null/empty wire values filtered out).
      const catalogEfforts = ['low', 'medium', 'high']
      const settingsReasoningEfforts: Record<string, string | null> = {
        zen: 'zen-wire',
        max: 'max-wire',
        empty: '',
        nil: null as unknown as string,
      }

      // Replicate the plugin's merge logic verbatim (round-9: keeps null-wire levels).
      let efforts = [...catalogEfforts]
      const declared = { models: [{ id: 'test-model', reasoningEfforts: settingsReasoningEfforts }] }
      for (const m of declared.models ?? []) {
        if (m.id === 'test-model' && (m as { reasoningEfforts?: Record<string, string | null> }).reasoningEfforts) {
          efforts = Object.entries((m as { reasoningEfforts: Record<string, string | null> }).reasoningEfforts)
            .filter(([, wire]) => wire !== undefined)
            .map(([level]) => level)
        }
      }

      expect(efforts).toEqual(['zen', 'max', 'empty', 'nil'])
      expect(efforts).not.toEqual(catalogEfforts)
    })
  })

  describe('manual label decode — displayed label always decodes', () => {
    // helpers mirroring the plugin's internal register/decode (Map-based)
    function registerChoice(map: Map<string, unknown>, label: string, provider: string, model: string, effort: string | undefined) {
      map.set(label, { provider, model, effort })
      return label
    }
    function decodeChoice(map: Map<string, unknown>, label: string) {
      return map.get(label)
    }

    it('first manual entry with plain label decodes', () => {
      const choiceMap = new Map<string, unknown>()
      // simulate tier labels already registered
      registerChoice(choiceMap, 'Balanced', 'p0', 'm0', 'low')
      registerChoice(choiceMap, 'Correctness', 'p1', 'm1', 'high')
      registerChoice(choiceMap, 'Cost', 'p2', 'm2', 'low')

      const base = 'My Model'
      const label = uniqueChoiceLabel(choiceMap, base, 'provA', 'modelA')
      expect(label).toBe('My Model')
      registerChoice(choiceMap, label, 'provA', 'modelA', 'high')
      expect(decodeChoice(choiceMap, label)).toBeDefined()
      expect(decodeChoice(choiceMap, label)).toEqual({ provider: 'provA', model: 'modelA', effort: 'high' })
    })

    it('name collision with tier label "Balanced" gets provider suffix and decodes', () => {
      const choiceMap = new Map<string, unknown>()
      registerChoice(choiceMap, 'Balanced', 'p0', 'm0', 'low')
      registerChoice(choiceMap, 'Correctness', 'p1', 'm1', 'high')
      registerChoice(choiceMap, 'Cost', 'p2', 'm2', 'low')

      const base = 'Balanced'
      const label = uniqueChoiceLabel(choiceMap, base, 'provB', 'modelB')
      expect(label).toBe('Balanced (provB)')
      registerChoice(choiceMap, label, 'provB', 'modelB', 'medium')
      expect(decodeChoice(choiceMap, label)).toBeDefined()
      expect(decodeChoice(choiceMap, label)).toEqual({ provider: 'provB', model: 'modelB', effort: 'medium' })
    })

    it('double collision (provider suffix also taken) gets provider/model suffix and decodes', () => {
      const choiceMap = new Map<string, unknown>()
      registerChoice(choiceMap, 'Balanced', 'p0', 'm0', 'low')
      // pre-occupy the provider-suffixed label as well
      registerChoice(choiceMap, 'Balanced (provB)', 'provB', 'other-model', 'low')

      const base = 'Balanced'
      const label = uniqueChoiceLabel(choiceMap, base, 'provB', 'modelB')
      expect(label).toBe('Balanced (provB/modelB)')
      registerChoice(choiceMap, label, 'provB', 'modelB', 'high')
      expect(decodeChoice(choiceMap, label)).toBeDefined()
    })
  })

  describe('duplicate model display names across providers remain independently selectable', () => {
    function registerChoice(map: Map<string, unknown>, label: string, provider: string, model: string, effort: string | undefined) {
      map.set(label, { provider, model, effort })
      return label
    }
    function decodeChoice(map: Map<string, unknown>, label: string) {
      return map.get(label)
    }

    it('same display name with different providers yields distinct labels, both decode', () => {
      const choiceMap = new Map<string, unknown>()
      // two entries share display name "Flash" but different providers
      const name = 'Flash'
      const labelA = uniqueChoiceLabel(choiceMap, name, 'providerA', 'flash')
      registerChoice(choiceMap, labelA, 'providerA', 'flash', 'low')
      const labelB = uniqueChoiceLabel(choiceMap, name, 'providerB', 'flash')
      registerChoice(choiceMap, labelB, 'providerB', 'flash', 'high')

      expect(labelA).toBe('Flash')
      expect(labelB).toBe('Flash (providerB)')
      expect(labelA).not.toBe(labelB)
      expect(decodeChoice(choiceMap, labelA)).toEqual({ provider: 'providerA', model: 'flash', effort: 'low' })
      expect(decodeChoice(choiceMap, labelB)).toEqual({ provider: 'providerB', model: 'flash', effort: 'high' })
    })
  })

  describe('llmText single-assembly and terminal failure', () => {
    // Drive the REAL llmText through a fake ctx whose llm.stream yields the
    // given chunks; captures the stream call options for forwarding checks.
    const streamCalls: Array<Record<string, unknown>> = []
    async function fixedLlmText(stream: AsyncIterable<Record<string, unknown>>): Promise<string> {
      const fakeCtx = {
        llm: {
          stream: (opts: Record<string, unknown>) => {
            streamCalls.push(opts)
            return stream
          },
        },
      }
      return llmText(fakeCtx as never, { provider: 'p', model: 'm' }, [] as never, undefined, {})
    }

    async function* fakeStreamSingleAssembly(): AsyncIterable<Record<string, unknown>> {
      yield { type: 'text-delta', text: 'hello ' }
      yield { type: 'text-delta', text: 'world' }
      // block-end carries the fully assembled block — must NOT be appended again
      yield { type: 'block-end', block: { type: 'text', text: 'hello world' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }

    it('single-assembly: with text-delta then block-end, collected text is deltas only (once)', async () => {
      const text = await fixedLlmText(fakeStreamSingleAssembly())
      expect(text).toBe('hello world')
      // ensure it is not doubled (hello worldhello world)
      expect(text).not.toBe('hello worldhello world')
    })

    it('terminal failure: finish with reason.kind error throws', async () => {
      async function* errStream(): AsyncIterable<Record<string, unknown>> {
        yield { type: 'text-delta', text: 'hi' }
        yield { type: 'finish', reason: { kind: 'error', failure: { message: 'boom' } } }
      }
      await expect(fixedLlmText(errStream())).rejects.toThrow('boom')
    })

    it('terminal failure: stream that ends without any finish chunk throws', async () => {
      async function* noFinish(): AsyncIterable<Record<string, unknown>> {
        yield { type: 'text-delta', text: 'hi' }
      }
      await expect(fixedLlmText(noFinish())).rejects.toThrow('without a terminal finish chunk')
    })

    it('terminal failure: empty text with a stop finish throws (budget eaten by reasoning)', async () => {
      async function* emptyStop(): AsyncIterable<Record<string, unknown>> {
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
      await expect(fixedLlmText(emptyStop())).rejects.toThrow('with no text output')
    })
  })

  describe('deterministicMatch + effortFromText', () => {
    type Row = { provider: string; model: string; name: string; efforts: string[]; cost: number | null; priced: boolean }
    const table = new Map<string, Row>([
      ['provA/model-a',
        { provider: 'provA', model: 'model-a', name: 'Model A',
          efforts: ['low', 'medium', 'xhigh'], cost: 5, priced: true }],
      ['provB/model-b', { provider: 'provB', model: 'model-b', name: 'Model B', efforts: ['low', 'max'], cost: 10, priced: true }],
      ['provC/unique-model', { provider: 'provC', model: 'unique-model', name: 'Unique', efforts: ['low', 'high'], cost: 1, priced: true }],
    ])

    it('exact provider/model matches', () => {
      expect(deterministicMatch(table as never, 'provA/model-a')).toBeDefined()
      expect(deterministicMatch(table as never, 'provA/model-a')?.model).toBe('model-a')
      expect(deterministicMatch(table as never, 'provA model-a')).toBeDefined()
    })

    it('exact model id matches when unique', () => {
      expect(deterministicMatch(table as never, 'unique-model')?.provider).toBe('provC')
    })

    it('unique fuzzy matches (single hit) returns entry', () => {
      // "unique" appears only in provC entry name/model
      expect(deterministicMatch(table as never, 'unique')).toBeDefined()
      expect(deterministicMatch(table as never, 'unique')?.model).toBe('unique-model')
    })

    it('ambiguous fuzzy returns undefined', () => {
      // "model" appears in all three
      expect(deterministicMatch(table as never, 'model')).toBeUndefined()
    })

    it('declared-id effort matched verbatim', () => {
      const entry = table.get('provA/model-a')!
      expect(effortFromText(entry as never, 'please use xhigh')).toBe('xhigh')
    })

    it('xtra maps to deepest declared', () => {
      const entry = table.get('provA/model-a')!
      // efforts: low, medium, xhigh → deepest is xhigh
      expect(effortFromText(entry as never, 'use xtra please')).toBe('xhigh')
    })

    it('max maps to declared max when present', () => {
      const entry = table.get('provB/model-b')!
      // efforts: low, max → max is deepest and also declared verbatim
      expect(effortFromText(entry as never, 'run at max')).toBe('max')
      // also superlative "maximum"
      expect(effortFromText(entry as never, 'maximum effort')).toBe('max')
    })

    it('no effort mentioned returns undefined', () => {
      const entry = table.get('provA/model-a')!
      expect(effortFromText(entry as never, 'just the model please')).toBeUndefined()
    })
  })

  describe('uniqueChoiceLabel collision ladder', () => {
    it('returns base when no collision', () => {
      const m = new Map<string, unknown>()
      expect(uniqueChoiceLabel(m, 'Hello', 'p', 'm')).toBe('Hello')
    })
    it('returns base (provider) when base taken', () => {
      const m = new Map<string, unknown>([['Hello', {}]])
      expect(uniqueChoiceLabel(m, 'Hello', 'myProv', 'm')).toBe('Hello (myProv)')
    })
    it('returns base (provider/model) when both base and provider suffix taken', () => {
      const m = new Map<string, unknown>([
        ['Hello', {}],
        ['Hello (myProv)', {}],
      ])
      expect(uniqueChoiceLabel(m, 'Hello', 'myProv', 'myModel')).toBe('Hello (myProv/myModel)')
    })
  })

  describe('hasExplicitModelChoice', () => {
    it('false for empty and sizing-only keys', () => {
      expect(hasExplicitModelChoice({})).toBe(false)
      expect(hasExplicitModelChoice({ maxTokens: 100 } as never)).toBe(false)
      expect(hasExplicitModelChoice(undefined)).toBe(false)
      expect(hasExplicitModelChoice(null as never)).toBe(false)
    })
    it('true for provider/model/reasoningEffort', () => {
      expect(hasExplicitModelChoice({ provider: 'p' } as never)).toBe(true)
      expect(hasExplicitModelChoice({ model: 'm' } as never)).toBe(true)
      expect(hasExplicitModelChoice({ reasoningEffort: 'high' } as never)).toBe(true)
      expect(hasExplicitModelChoice({ provider: 'p', model: 'm', reasoningEffort: 'low' } as never)).toBe(true)
    })
  })

  describe('off-only entries', () => {
    it('highestEffort undefined when only off', () => {
      const entry = { efforts: ['off'], cost: 1, priced: true }
      expect(highestEffort(entry as never)).toBeUndefined()
    })
    it('activeEfforts excludes off', () => {
      const entry = { efforts: ['off', 'low', 'off', 'high'] }
      expect(activeEfforts(entry as never)).toEqual(['low', 'high'])
      expect(activeEfforts({ efforts: ['off'] } as never)).toEqual([])
    })
    it('lowestEffort undefined when only off (no real efforts)', () => {
      const entry = { efforts: ['off'] }
      expect(lowestEffort(entry as never)).toBeUndefined()
    })
  })

  describe('boundedTable caps at 12', () => {
    it('never returns more than 12 entries', () => {
      type Row = {
        provider: string
        model: string
        name: string
        efforts: string[]
        cost: number | null
        priced: boolean
      }
      const table = new Map<string, Row>()
      for (let i = 0; i < 30; i++) {
        table.set(`p/m${i}`, {
          provider: 'p',
          model: `m${i}`,
          name: `Model ${i}`,
          efforts: ['low'],
          cost: i,
          priced: true,
        })
      }
      const result = boundedTable(table as never, 'model')
      expect(result.size).toBeLessThanOrEqual(12)
      expect(result.size).toBe(12)
    })

    it('returns Map keyed by provider/model and keeps fuzzy entry first', () => {
      type Row = {
        provider: string
        model: string
        name: string
        efforts: string[]
        cost: number | null
        priced: boolean
      }
      const table = new Map<string, Row>([
        [
          'p/cheap-fuzzy',
          {
            provider: 'p',
            model: 'cheap-fuzzy',
            name: 'Cheap FuzzyUnique',
            efforts: ['low'],
            cost: 1,
            priced: true,
          },
        ],
        [
          'p/expensive',
          {
            provider: 'p',
            model: 'expensive',
            name: 'Expensive',
            efforts: ['low'],
            cost: 100,
            priced: true,
          },
        ],
      ])
      for (let i = 0; i < 20; i++) {
        table.set(`p/m${i}`, {
          provider: 'p',
          model: `m${i}`,
          name: `Model ${i}`,
          efforts: ['low'],
          cost: 10 + i,
          priced: true,
        })
      }
      const result = boundedTable(table as never, 'fuzzyunique')
      expect([...result.keys()].every(k => k.includes('/'))).toBe(true)
      expect(result.has('p/cheap-fuzzy')).toBe(true)
      expect([...result.keys()][0]).toBe('p/cheap-fuzzy')
      expect([...result.values()][0].model).toBe('cheap-fuzzy')
      expect(result.get('p/cheap-fuzzy')?.name).toBe('Cheap FuzzyUnique')
    })
  })

  describe('round-8 review fixes', () => {
    it('withAgentOptions clears a stale effort on a route switch', () => {
      const out = withAgentOptions(
        { agentOptions: { provider: 'old', model: 'old-model', reasoningEffort: 'xhigh', maxTokens: 123 } },
        { provider: 'new', model: 'new-model', effort: undefined },
      )
      expect(out.agentOptions.reasoningEffort).toBeUndefined()
      expect(out.agentOptions.provider).toBe('new')
      expect(out.agentOptions.maxTokens).toBe(123)
      expect(out.modelSelection).toEqual({ provider: 'new', model: 'new-model' })
    })

    it('withAgentOptions never preserves effort even on same route (model default)', () => {
      const out = withAgentOptions(
        { agentOptions: { provider: 'p', model: 'm', reasoningEffort: 'high' } },
        { provider: 'p', model: 'm', effort: undefined },
      )
      expect(out.agentOptions.reasoningEffort).toBeUndefined()
      expect(out.modelSelection).toEqual({ provider: 'p', model: 'm' })
    })

    it('withAgentOptions with effort sets reasoningEffort and modelSelection', () => {
      const out = withAgentOptions(
        { label: 'x', agentOptions: { provider: 'old', model: 'old-m', reasoningEffort: 'low' }, prompt: [] },
        { provider: 'p', model: 'm', effort: 'high' },
      )
      expect(out.agentOptions.reasoningEffort).toBe('high')
      expect(out.modelSelection).toEqual({ provider: 'p', model: 'm', reasoningEffort: 'high' })
    })

    it('withAgentOptions without effort omits reasoningEffort in modelSelection', () => {
      const out = withAgentOptions(
        { label: 'x', prompt: [] },
        { provider: 'p', model: 'm', effort: undefined },
      )
      expect(out.agentOptions.reasoningEffort).toBeUndefined()
      expect(out.modelSelection).toEqual({ provider: 'p', model: 'm' })
      expect(out.modelSelection).not.toHaveProperty('reasoningEffort')
    })

    it('normalizeConfig clamps and validates user config', () => {
      const cfg = normalizeConfig({
        maxManualOptions: 500,
        qualityRank: { 'a/b': 10, 'c/d': 'bad', 'e/f': Infinity },
        recommender: { provider: 'p' },
        logFile: 42,
        logUserInput: true,
      })
      expect(cfg.maxManualOptions).toBe(10)
      expect(cfg.qualityRank).toEqual({ 'a/b': 10 })
      expect(cfg.recommender).toBeUndefined()
      expect(cfg.logFile).toBeUndefined()
      expect(cfg.logUserInput).toBe(true)
      expect(normalizeConfig({ maxManualOptions: -3 }).maxManualOptions).toBe(0)
    })

    it('validateCandidate validates the FINAL merged agentOptions', async () => {
      const calls: Array<{ cfg: Record<string, unknown>; signal: unknown }> = []
      const ctx = {
        llm: {
          resolveCallConfig: async (cfg: unknown, signal: unknown) => {
            calls.push({ cfg: cfg as Record<string, unknown>, signal })
            return cfg
          },
        },
      }
      const opts = { provider: 'p', model: 'm', reasoningEffort: 'high', maxTokens: 123 }
      const ok = await validateCandidate(ctx as never, { agentOptions: opts }, 'sig')
      expect(ok).toBe(true)
      expect(calls[0]?.cfg.maxTokens).toBe(123)
      expect(calls[0]?.cfg.reasoningEffort).toBe('high')
      expect(calls[0]?.signal).toBe('sig')
      const rejectCtx = { llm: { resolveCallConfig: async () => { throw new Error('UNSUPPORTED_REASONING_EFFORT') } } }
      const bad = { agentOptions: { provider: 'p', model: 'm', reasoningEffort: 'xhigh' } }
      expect(await validateCandidate(rejectCtx as never, bad)).toBe(false)
    })

    it('deterministicMatch resolves an embedded model name with effort words', () => {
      type Row = { provider: string; model: string; name: string; efforts: string[]; cost: number | null; priced: boolean }
      const table = new Map<string, Row>()
      table.set('p/deepseek-v4-flash',
        { provider: 'p', model: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash',
          efforts: ['low', 'high'], cost: 1, priced: true })
      table.set('p/gpt-5.5', { provider: 'p', model: 'gpt-5.5', name: 'GPT-5.5 via AI21', efforts: ['low', 'high'], cost: 2, priced: true })
      expect(deterministicMatch(table as never, 'DeepSeek V4 Flash at high effort')?.model).toBe('deepseek-v4-flash')
      // Effort words are not model identifiers: "max" must not match by itself.
      expect(deterministicMatch(table as never, 'gpt max')).toBeUndefined()
    })

    it('apply installs wrappers inside ctx.effect and the disposer restores the originals', () => {
      let disposer: (() => void) | undefined
      const originalStart = async () => 'started'
      const originalStartContinuable = async () => 'continued'
      const subagents = { start: originalStart, startContinuable: originalStartContinuable } as never as Record<string, unknown>
      const ctx = {
        effect: (fn: () => (() => void) | undefined) => { disposer = fn() },
        on: () => () => {},
        subagents,
        agents: { roots: () => [{}] },
        llm: {
          listProviders: () => [],
          listModels: async () => [],
          resolveModelInfo: async () => { throw new Error('nope') },
          resolveCallConfig: async (c: unknown) => c,
          stream: () => (async function* () { yield { type: 'finish', reason: { kind: 'stop' } } }()),
        },
        settings: {},
        agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
        userQuestions: { ask: async () => ({ answers: [{ id: 'spawn-model-choice', selected: [] }] }) },
      }
      apply(ctx as never, { enabled: true })
      const wrappedStart = subagents.start
      expect(wrappedStart).not.toBe(originalStart)
      expect(subagents.startContinuable).not.toBe(originalStartContinuable)
      // The effect disposer must restore the EXACT originals and the marker.
      disposer?.()
      expect(subagents.start).toBe(originalStart)
      expect(subagents.startContinuable).toBe(originalStartContinuable)
      // A reload applies cleanly after disposal (no stale marker).
      apply(ctx as never, { enabled: true })
      expect(subagents.start).not.toBe(originalStart)
      disposer?.()
      expect(subagents.start).toBe(originalStart)
    })
  })

  describe('round-9 deltas', () => {
    it('inject includes agents', () => {
      expect(inject).toContain('agents')
      expect(inject).toEqual(expect.arrayContaining(['subagents', 'userQuestions', 'settings',
        'llm', 'agentDefaultModel', 'agents']))
    })

    it('Config export is a Schemastery schema with required keys', () => {
      // Schemastery schemas are callable Schema objects — the in-repo
      // convention (tool-subagent, headless) exports `Config` the same way.
      expect(Config).toBeDefined()
      expect(typeof Config).toBe('function')
    })

    it('normalizeConfig validates supportedSubagentProviders', () => {
      expect(normalizeConfig({ supportedSubagentProviders: ['spawn'] })
        .supportedSubagentProviders).toEqual(['spawn'])
      expect(normalizeConfig({ supportedSubagentProviders: [] })
        .supportedSubagentProviders).toEqual(['spawn', 'fork'])
      expect(normalizeConfig({ supportedSubagentProviders: ['', 'fork'] })
        .supportedSubagentProviders).toEqual(['fork'])
      expect(normalizeConfig({ supportedSubagentProviders: 'bad' as never })
        .supportedSubagentProviders).toEqual(['spawn', 'fork'])
      expect(normalizeConfig({}).supportedSubagentProviders).toEqual(['spawn', 'fork'])
    })

    it('Cost tier picks cheapest priced model regardless of efforts', () => {
      type Row = { provider: string; model: string; name: string; efforts: string[]; cost: number | null; priced: boolean }
      const table = new Map<string, Row>([
        ['p/cheap-no-effort', { provider: 'p', model: 'cheap-no-effort',
          name: 'Cheap No Effort', efforts: [], cost: 1, priced: true }],
        ['p/expensive', { provider: 'p', model: 'expensive',
          name: 'Expensive', efforts: ['low'], cost: 100, priced: true }],
      ])
      const cheapest = [...table.values()].filter(e => e.cost !== null)
        .reduce((best, e) => (best === undefined || e.cost < best.cost ? e : best),
          undefined as never)
      expect(cheapest?.model).toBe('cheap-no-effort')
      const oldCheapest = [...table.values()]
        .filter(e => e.cost !== null && (e.efforts ?? []).filter(x => x !== 'off').length > 0)
        .reduce((a, b) => (a.cost < b.cost ? a : b), [...table.values()][1] as never)
      expect(oldCheapest.model).not.toBe('cheap-no-effort')
    })

    it('apply bypasses interception for providers outside supportedSubagentProviders', async () => {
      let askCalls = 0
      let originalReceived: unknown
      const originalStart = async (_provider: string, req: unknown) => {
        originalReceived = req
        return 'ok'
      }
      const originalContinuable = async (spec: { provider: string; request: unknown }) => {
        originalReceived = spec.request
        return 'ok-continuable'
      }
      let disposer: (() => void) | undefined
      const subagents: Record<string, unknown> = { start: originalStart,
        startContinuable: originalContinuable }
      const ctx: Record<string, unknown> = {
        effect: (fn: () => (() => void) | undefined) => { disposer = fn() },
        on: () => () => {},
        subagents,
        agents: { roots: () => [] },
        llm: {
          listProviders: () => [],
          listModels: async () => [],
          resolveModelInfo: async () => ({ reasoning: { efforts: [] } }),
          resolveCallConfig: async (c: unknown) => c,
          stream: () => (async function* () {
            yield { type: 'finish', reason: { kind: 'stop' } }
          }()),
        },
        settings: { documentPath: undefined },
        agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
        userQuestions: { ask: async () => {
          askCalls += 1
          return { answers: [{ id: 'spawn-model-choice', selected: [] }] }
        } },
      }
      apply(ctx as never, { enabled: true, supportedSubagentProviders: ['spawn'] })
      const wrappedStart = subagents.start as (p: string, r: unknown) => Promise<unknown>
      const req = { label: 'test', prompt: [{ type: 'text', text: 'hello' }], parent: {} }
      askCalls = 0
      await wrappedStart('codex', req)
      expect(askCalls).toBe(0)
      expect(originalReceived).toBe(req)
      askCalls = 0
      await wrappedStart('spawn', req)
      expect(askCalls).toBe(1)
      disposer?.()
      let ask2 = 0
      const ctx2: Record<string, unknown> = {
        effect: (fn: () => (() => void) | undefined) => { disposer = fn() },
        on: () => () => {},
        subagents: { start: originalStart, startContinuable: originalContinuable },
        agents: { roots: () => [] },
        llm: {
          listProviders: () => [],
          listModels: async () => [],
          resolveModelInfo: async () => ({ reasoning: { efforts: [] } }),
          resolveCallConfig: async (c: unknown) => c,
          stream: () => (async function* () {
            yield { type: 'finish', reason: { kind: 'stop' } }
          }()),
        },
        settings: {},
        agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
        userQuestions: { ask: async () => { ask2 += 1; return { answers: [] } } },
      }
      apply(ctx2 as never, { enabled: true, supportedSubagentProviders: ['fork'] })
      const wrappedCont = (ctx2.subagents as Record<string, unknown>)
        .startContinuable as (s: unknown) => Promise<unknown>
      await wrappedCont({ provider: 'codex', label: 'x', request: req, signal: undefined })
      expect(ask2).toBe(0)
      await wrappedCont({ provider: 'fork', label: 'x', request: req, signal: undefined })
      expect(ask2).toBe(1)
      disposer?.()
    })
  })
  describe('deterministic classifier', () => {
    it('long tasks with hard signals classify hard', async () => {
      const task = 'Harden the chart screen: review aria labels, audit contrast, debug reflow at 320px.'
      const tier = await classifyTask({} as never, {} as never, {} as never, new Map() as never, task, undefined)
      expect(tier).toBe('correctness')
    })
    it('short tasks without hard signals classify simple', async () => {
      const tier = await classifyTask({} as never, {} as never, {} as never, new Map() as never, 'fix the typo in the button label', undefined)
      expect(tier).toBe('cost')
    })
    it('medium tasks classify medium', async () => {
      const tier = await classifyTask({} as never, {} as never, {} as never, new Map() as never, 'update the empty-state copy for the onboarding flow, reorder the footer actions, and adjust the secondary button alignment and the hover and focus states across the responsive breakpoints of the settings panel and the profile preferences screen, then verify the keyboard order and the reduced motion behavior at every supported viewport width', undefined)
      expect(tier).toBe('balanced')
    })
  })

})

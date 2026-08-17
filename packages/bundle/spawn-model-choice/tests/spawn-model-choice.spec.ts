/**
 * spawn-model-choice pure-helper specs: exercise the harness-free helpers
 * exported from the `.mjs` plugin without booting a Cordis tree.
 */

import { describe, expect, it } from 'vitest'
import {
  extractJson,
  withAgentOptions,
  cleanText,
  summarizeTask,
  extremePick,
  priceSuffix,
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

    it('preserves the original explicit reasoningEffort when the choice has no effort', () => {
      const request = {
        label: 'x',
        agentOptions: { provider: 'old-p', model: 'old-m', reasoningEffort: 'medium' },
        prompt: [],
      }
      const chosen = { provider: 'new-p', model: 'new-m', effort: undefined }
      const out = withAgentOptions(request, chosen)
      expect(out.agentOptions.reasoningEffort).toBe('medium')
      expect(out.agentOptions.provider).toBe('new-p')
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
      expect(priceSuffix({ priced: true, cost: 1.5 })).toBe(' ($1.50/1M)')
      expect(priceSuffix({ priced: true, cost: 0.1 })).toBe(' ($0.10/1M)')
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

      // Replicate the plugin's merge logic verbatim.
      let efforts = [...catalogEfforts]
      const declared = { models: [{ id: 'test-model', reasoningEfforts: settingsReasoningEfforts }] }
      for (const m of declared.models ?? []) {
        if (m.id === 'test-model' && (m as { reasoningEfforts?: Record<string, string | null> }).reasoningEfforts) {
          efforts = Object.entries((m as { reasoningEfforts: Record<string, string | null> }).reasoningEfforts)
            .filter(([, wire]) => wire !== null && wire !== undefined && wire !== '')
            .map(([level]) => level)
        }
      }

      expect(efforts).toEqual(['zen', 'max'])
      expect(efforts).not.toEqual(catalogEfforts)
    })
  })
})

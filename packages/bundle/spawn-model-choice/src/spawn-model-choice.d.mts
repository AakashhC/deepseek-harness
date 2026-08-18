/**
 * Ambient declaration for the plugin entry (`spawn-model-choice.mjs`).
 * The plugin is plain ESM JavaScript by design (loaded directly by the
 * cordis loader); this file gives TypeScript consumers — chiefly the
 * package's own spec — a typed view of its export surface.
 */

import type { Context } from '@deepseek-ai/cordis'

/** Model row shape produced by {@link buildModelTable}. */
export interface ModelEntry {
  provider: string
  model: string
  name: string
  efforts: string[]
  cost: number | null
  priced: boolean
}

export type ModelTable = Map<string, ModelEntry>

/** One registered choice card entry. */
export interface Choice {
  provider: string
  model: string
  effort?: string
}

export interface NormalizedConfig {
  enabled: boolean
  askForSpawn: boolean
  parentModelRecommendation: boolean
  askWhenExplicit: boolean
  maxManualOptions: number
  qualityRank: Record<string, number>
  recommender?: { provider: string; model: string; reasoningEffort?: string }
  logFile?: string
  logUserInput: boolean
  supportedSubagentProviders: string[]
}

export interface ChosenModel {
  provider: string
  model: string
  /** Explicit `undefined` means "model default" — never preserved from the original request. */
  effort?: string | undefined
}

export interface SpawnRequest {
  [key: string]: unknown
  label?: string
  prompt?: unknown
  agentOptions?: { provider?: string; model?: string; reasoningEffort?: string; [key: string]: unknown }
  modelSelection?: { provider?: string; model?: string; reasoningEffort?: string }
  signal?: AbortSignal
  parent?: unknown
}

export const name: string
export const inject: string[]

/** Schemastery schema for the plugin row config. */
export const Config: import('@deepseek-ai/schemastery').Schema

export function apply(ctx: Context, config?: unknown): void

export function activeEfforts(entry: Partial<ModelEntry>): string[]
export function lowestEffort(entry: Partial<ModelEntry>): string | undefined
export function highestEffort(entry: Partial<ModelEntry>): string | undefined
export function priceSuffix(entry: Partial<ModelEntry>): string
export function extremePick(table: ModelTable, mode: 'max' | 'min'): ModelEntry | undefined

export function cleanText(value: unknown): string
export function summarizeTask(text: string, max?: number): string

export function hasExplicitModelChoice(agentOptions: unknown): boolean
export function uniqueChoiceLabel(
  choiceMap: Map<string, unknown>,
  base: string,
  provider: string,
  model: string,
): string

export function extractJson(text: string | undefined): unknown
export function deterministicMatch(table: ModelTable, text: string): ModelEntry | undefined
export function effortFromText(entry: ModelEntry, text: string): string | undefined
export function boundedTable(table: ModelTable, text: string): ModelTable

export function llmText(
  ctx: Context,
  judge: { provider: string; model: string },
  messages: unknown[],
  signal?: unknown,
  options?: { system?: string; maxTokens?: number; effort?: string },
): Promise<string>

export function classifyTask(
  ctx: Context,
  cfg: NormalizedConfig,
  judge: { provider: string; model: string },
  table: ModelTable,
  task: string,
  signal?: unknown,
): Promise<'cost' | 'balanced' | 'correctness'>

export function withAgentOptions(
  request: SpawnRequest,
  chosen: ChosenModel | null | undefined,
): SpawnRequest
export function validateCandidate(ctx: Context, candidate: SpawnRequest, signal?: unknown): Promise<boolean>
export function normalizeConfig(config: unknown): NormalizedConfig

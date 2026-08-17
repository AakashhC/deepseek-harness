/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-spawn-model-choice`.
 * @module @deepseek-ai/dsh-spawn-model-choice/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-spawn-model-choice'

/** Cordis companion plugin name. */
export const name = 'spawn-model-choice-bundle-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

// No runtime invariant: the package is a static patch-list carrier plus a
// single Cordis plugin whose row is owned externally; it mounts no service
// beyond the choice plugin, emits no events, and owns no mutable relation to
// check. The inserted row's own correctness is covered by its fail-open
// contract and the pure-helper specs.
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))

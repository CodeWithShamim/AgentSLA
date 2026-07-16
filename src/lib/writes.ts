import { chainBackend } from './chain'
import { currentMode } from './reads'
import { store } from './store'
import type { Address } from './types'

/** Write layer — every call opens a transaction on the state ladder
 *  (FR-7.2). On StudioNet these are genlayer-js writeContract calls with
 *  live status polling; in fallback mode the simulation handles them. */

const onChain = () => currentMode() === 'studionet'

export const writes = {
  createTask: async (input: {
    title: string; slaText: string; criteria: string[]
    deadline: number; escrow: bigint
  }): Promise<{ hash: string; taskId?: number }> => {
    if (onChain()) return chainBackend!.createTask(input)
    return store.createTask(input)
  },

  acceptTask: async (id: number): Promise<string> =>
    onChain() ? chainBackend!.acceptTask(id) : store.acceptTask(id),

  submitDelivery: async (id: number, evidence: { url?: string; inline?: string }): Promise<string> =>
    onChain() ? chainBackend!.submitDelivery(id, evidence) : store.submitDelivery(id, evidence),

  fileAppeal: async (id: number, appellant: Address): Promise<string> =>
    onChain() ? chainBackend!.fileAppeal(id, appellant) : store.fileAppeal(id, appellant),

  /** Execute settlement after the appeal window closes (chain only —
   *  the simulation settles automatically on its clock). */
  finalize: async (id: number): Promise<string | null> =>
    onChain() ? chainBackend!.finalize(id) : null,

  resolveNeutral: async (id: number): Promise<string> =>
    onChain() ? chainBackend!.resolveNeutral(id) : store.resolveNeutral(id),

  cancelTask: async (id: number): Promise<string> =>
    onChain() ? chainBackend!.cancelTask(id) : store.cancelTask(id),

  reclaimExpired: async (id: number): Promise<string> =>
    onChain() ? chainBackend!.reclaimExpired(id) : store.reclaimExpired(id),

  /** Pull-payment exit: pays the caller's full claim as native GEN. */
  withdraw: async (side: 'buyer' | 'worker', simAddress: Address): Promise<string> =>
    onChain() ? chainBackend!.withdraw(side) : store.withdraw(simAddress),

  resetSimulation: () => store.reset(),
}

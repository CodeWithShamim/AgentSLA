import { store } from './store'
import type { Address } from './types'

/** Write layer — every call opens a transaction on the state ladder
 *  (FR-7.2). On Bradbury these become genlayer-js writeContract calls
 *  with status polling feeding the same TxRecord shape. */

export const writes = {
  createTask: (input: {
    title: string; slaText: string; criteria: string[]
    deadline: number; escrow: bigint
  }) => store.createTask(input),

  acceptTask: (id: number) => store.acceptTask(id),

  submitDelivery: (id: number, evidence: { url?: string; inline?: string }) =>
    store.submitDelivery(id, evidence),

  fileAppeal: (id: number, appellant: Address) => store.fileAppeal(id, appellant),

  resolveNeutral: (id: number) => store.resolveNeutral(id),

  cancelTask: (id: number) => store.cancelTask(id),

  reclaimExpired: (id: number) => store.reclaimExpired(id),

  resetSimulation: () => store.reset(),
}

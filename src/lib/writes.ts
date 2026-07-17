import { chainBackend } from './chain'
import { currentMode } from './reads'
import { store } from './store'
import type { Address } from './types'

/** Write layer — every call opens a transaction on the state ladder
 *  (FR-7.2). With a deployed contract these are always genlayer-js
 *  writeContract calls with live status polling — writes never fall back
 *  to the simulation; the local store only serves development builds with
 *  no deployment configured. */

const onChain = () => currentMode() === 'studionet'

export const writes = {
  createTask: async (input: {
    title: string; slaText: string; criteria: string[]
    deadline: number; escrow: bigint
  }): Promise<{ hash: string; taskId?: number }> => {
    if (onChain()) return chainBackend!.createTask(input)
    return store.createTask(input)
  },

  /** Milestone escrow (FR-9): one payable call opens 2-5 staged cases;
   *  the attached value must equal the sum of the milestone amounts. */
  createTaskGroup: async (input: {
    title: string; slaText: string; deadline: number
    milestones: { title: string; criteria: string[]; amount: bigint }[]
  }): Promise<{ hash: string; taskId?: number }> => {
    if (onChain()) return chainBackend!.createTaskGroup(input)
    return store.createTaskGroup(input)
  },

  acceptTask: async (id: number): Promise<string> =>
    onChain() ? chainBackend!.acceptTask(id) : store.acceptTask(id),

  /** Worker offers to do the task for `price` ≤ escrow (FR-8). */
  placeBid: async (id: number, price: bigint): Promise<string> =>
    onChain() ? chainBackend!.placeBid(id, price) : store.placeBid(id, price),

  /** Buyer awards a bid: escrow reprices to it, surplus refunds. */
  selectBid: async (id: number, worker: Address): Promise<string> =>
    onChain() ? chainBackend!.selectBid(id, worker) : store.selectBid(id, worker),

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

  /** Worker's honest fail-fast exit: refund escrow + forfeit bond now. */
  abandonTask: async (id: number): Promise<string> =>
    onChain() ? chainBackend!.abandonTask(id) : store.abandonTask(id),

  /** Pull-payment exit: pays the caller's full claim as native GEN. */
  withdraw: async (side: 'buyer' | 'worker', simAddress: Address): Promise<string> =>
    onChain() ? chainBackend!.withdraw(side) : store.withdraw(simAddress),

  resetSimulation: () => store.reset(),
}

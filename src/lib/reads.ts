import { useSyncExternalStore } from 'react'
import { store } from './store'
import type { Address, AgentRecord, Task, TxRecord, TxStep } from './types'

/** Read layer — view calls only, never a wallet prompt (FR-7.3).
 *  On Bradbury these become genlayer-js readContract wrappers with the
 *  same signatures; views don't change. */

const subscribe = (fn: () => void) => store.subscribe(fn)

let tasksCache: Task[] = []
let tasksVersion = -1
let version = 0
store.subscribe(() => { version++ })

export function useTasks(): Task[] {
  return useSyncExternalStore(subscribe, () => {
    if (tasksVersion !== version) {
      tasksCache = store.getTasks()
      tasksVersion = version
    }
    return tasksCache
  })
}

export function useTask(id: number): Task | undefined {
  useSyncExternalStore(subscribe, () => version)
  return store.getTask(id)
}

export function useAgent(address: Address): AgentRecord {
  useSyncExternalStore(subscribe, () => version)
  return store.getAgent(address)
}

export function useAgents(): AgentRecord[] {
  useSyncExternalStore(subscribe, () => version)
  return store.getAgents()
}

export function useTx(hash: string | null): { tx: TxRecord; step: TxStep } | null {
  useSyncExternalStore(subscribe, () => {
    if (!hash) return 'none'
    const tx = store.getTx(hash)
    return tx ? `${hash}:${store.txStep(tx)}` : 'none'
  })
  if (!hash) return null
  const tx = store.getTx(hash)
  return tx ? { tx, step: store.txStep(tx) } : null
}

export function useNow(): number {
  return useSyncExternalStore(subscribe, () => Math.floor(Date.now() / 1000)) * 1000
}

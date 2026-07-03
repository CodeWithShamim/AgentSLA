import { useSyncExternalStore } from 'react'
import { chainBackend } from './chain'
import { store } from './store'
import type { Address, AgentRecord, Task, TxRecord, TxStep } from './types'

/** Read layer — view calls only, never a wallet prompt (FR-7.3).
 *
 *  Dispatches to the live StudioNet backend when the deployed contract is
 *  reachable; the local protocol simulation stays behind the scenes as a
 *  transparent fallback. */

export type Mode = 'studionet' | 'simulation'

export function currentMode(): Mode {
  if (chainBackend && !chainBackend.unreachable) return 'studionet'
  return 'simulation'
}

const onChain = () => currentMode() === 'studionet'

if (chainBackend) chainBackend.start()

let version = 0
store.subscribe(() => { version++ })
chainBackend?.subscribe(() => { version++ })

const subscribe = (fn: () => void) => {
  const un1 = store.subscribe(fn)
  const un2 = chainBackend?.subscribe(fn)
  return () => { un1(); un2?.() }
}

export function useMode(): Mode {
  useSyncExternalStore(subscribe, () => version)
  return currentMode()
}

let tasksCache: Task[] = []
let tasksVersion = -1

export function useTasks(): Task[] {
  return useSyncExternalStore(subscribe, () => {
    if (tasksVersion !== version) {
      tasksCache = onChain() ? chainBackend!.getTasks() : store.getTasks()
      tasksVersion = version
    }
    return tasksCache
  })
}

export function useTask(id: number): Task | undefined {
  useSyncExternalStore(subscribe, () => version)
  return onChain() ? chainBackend!.getTask(id) : store.getTask(id)
}

export function useAgent(address: Address): AgentRecord {
  useSyncExternalStore(subscribe, () => version)
  return onChain() ? chainBackend!.getAgent(address) : store.getAgent(address)
}

export function useAgents(): AgentRecord[] {
  useSyncExternalStore(subscribe, () => version)
  return onChain() ? chainBackend!.getAgents() : store.getAgents()
}

export function useTx(hash: string | null): { tx: TxRecord; step: TxStep } | null {
  useSyncExternalStore(subscribe, () => {
    if (!hash) return 'none'
    const backend = onChain() ? chainBackend! : store
    const tx = backend.getTx(hash)
    return tx ? `${hash}:${backend.txStep(tx)}` : 'none'
  })
  if (!hash) return null
  const backend = onChain() ? chainBackend! : store
  const tx = backend.getTx(hash)
  return tx ? { tx, step: backend.txStep(tx) } : null
}

export function useNow(): number {
  return useSyncExternalStore(subscribe, () => Math.floor(Date.now() / 1000)) * 1000
}

/** Resolves display names for on-chain addresses (falls back to sim directory). */
export function liveAgentName(address: string): string | null {
  return onChain() ? chainBackend!.nameOf(address) : null
}

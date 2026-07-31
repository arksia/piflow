import { useSyncExternalStore } from 'react'
import { getStoreVersion, store, subscribeStore } from './ws'

export function useStore() {
  useSyncExternalStore(subscribeStore, getStoreVersion, getStoreVersion)
  return store
}

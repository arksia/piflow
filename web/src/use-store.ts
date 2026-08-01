import { useSyncExternalStore } from 'react'
import { getStoreVersion, store, subscribeStore } from './client'

export function useStore() {
  useSyncExternalStore(subscribeStore, getStoreVersion, getStoreVersion)
  return store
}

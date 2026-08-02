import { useSyncExternalStore } from 'react'
import { getStoreVersion, store, subscribeStore } from './store'

export function useStore() {
  useSyncExternalStore(subscribeStore, getStoreVersion, getStoreVersion)
  return store
}

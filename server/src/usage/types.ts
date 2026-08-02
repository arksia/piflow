import type { UsageWindow } from '@piflow/protocol'

export interface ProviderUsageSnapshot {
  plan?: string
  windows: UsageWindow[]
}

export interface Credential {
  key?: string
  access?: string
}

export interface UsageAdapter {
  /** pi provider ids this adapter handles */
  providers: readonly string[]
  fetch: (cred: Credential) => Promise<ProviderUsageSnapshot | null>
}

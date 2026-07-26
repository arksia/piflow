export interface UsageWindow {
  /** Window length in minutes. Zero represents a billing-period total. */
  minutes: number
  limit: number
  used: number
  remaining: number
  resetTime?: string
}

export interface UsageReport {
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
  fetch: (cred: Credential) => Promise<UsageReport | null>
}

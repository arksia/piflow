import type { UsageAdapter } from './types'

interface KimiQuota {
  limit?: number | string
  remaining?: number | string
  resetTime?: string
  used?: number | string
}

interface KimiLimit {
  detail?: KimiQuota
  window?: {
    duration?: number
    timeUnit?: string
  }
}

interface KimiUsageResponse {
  limits?: KimiLimit[]
  usage?: KimiQuota
  user?: {
    membership?: {
      level?: string
    }
  }
}

// Kimi For Coding subscription: https://api.kimi.com/coding/v1/usages
// Shape: rolling windows in limits[] plus the billing-period total in usage.
export const kimiCoding: UsageAdapter = {
  providers: ['kimi-coding'],

  async fetch(cred) {
    const key = cred.key ?? cred.access
    if (!key)
      return null
    const res = await globalThis.fetch('https://api.kimi.com/coding/v1/usages', {
      headers: { authorization: `Bearer ${key}` },
    })
    if (!res.ok)
      return null
    const j = await res.json() as KimiUsageResponse

    return {
      plan: j.user?.membership?.level?.replace(/^LEVEL_/, ''),
      windows: [
        ...(j.limits ?? []).map(l => ({
          minutes: l.window?.timeUnit === 'TIME_UNIT_MINUTE' ? (l.window.duration ?? 0) : 0,
          limit: Number(l.detail?.limit ?? 0),
          used: Number(l.detail?.used ?? 0),
          remaining: Number(l.detail?.remaining ?? 0),
          resetTime: l.detail?.resetTime,
        })),
        ...(j.usage?.limit
          ? [
              {
                minutes: 0,
                limit: Number(j.usage.limit),
                used: Number(j.usage.used),
                remaining: Number(j.usage.remaining),
                resetTime: j.usage.resetTime,
              },
            ]
          : []),
      ],
    }
  },
}

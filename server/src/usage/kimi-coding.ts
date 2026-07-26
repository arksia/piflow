import type { UsageAdapter } from "./types.js";

// Kimi For Coding 订阅：https://api.kimi.com/coding/v1/usages
// 结构：5h 窗口(limits[]) + 周期总额度(usage)，limit 为百分比
export const kimiCoding: UsageAdapter = {
  providers: ["kimi-coding"],

  async fetch(cred) {
    const key = cred.key ?? cred.access;
    if (!key) return null;
    const res = await globalThis.fetch("https://api.kimi.com/coding/v1/usages", {
      headers: { authorization: `Bearer ${key}` },
    });
    if (!res.ok) return null;
    const j = (await res.json()) as any;

    return {
      plan: j.user?.membership?.level?.replace(/^LEVEL_/, ""),
      windows: [
        ...(j.limits ?? []).map((l: any) => ({
          minutes: l.window?.timeUnit === "TIME_UNIT_MINUTE" ? l.window.duration : 0,
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
    };
  },
};

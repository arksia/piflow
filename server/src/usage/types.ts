export interface UsageWindow {
  /** 窗口长度（分钟），0 = 周期总额度（如每周） */
  minutes: number;
  limit: number;
  used: number;
  remaining: number;
  resetTime?: string;
}

export interface UsageReport {
  plan?: string;
  windows: UsageWindow[];
}

export interface Credential {
  key?: string;
  access?: string;
}

export interface UsageAdapter {
  /** pi provider ids this adapter handles */
  providers: readonly string[];
  fetch(cred: Credential): Promise<UsageReport | null>;
}

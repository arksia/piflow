import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { kimiCoding } from "./kimi-coding.js";
import type { Credential, UsageAdapter, UsageReport } from "./types.js";

// 新 provider 的用量支持 = 在这里多注册一个适配器
const adapters: UsageAdapter[] = [kimiCoding];

const cache = new Map<string, { at: number; data: UsageReport | null }>();
const TTL = 30_000;

async function readCredential(provider: string): Promise<Credential | null> {
  const dir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi/agent");
  const auth = JSON.parse(await readFile(join(dir, "auth.json"), "utf8"));
  const c = auth[provider];
  if (!c) return null;
  return { key: c.key ?? c.apiKey, access: c.access ?? c.token };
}

export async function getUsage(provider: string): Promise<UsageReport | null> {
  const cached = cache.get(provider);
  if (cached && Date.now() - cached.at < TTL) return cached.data;

  const adapter = adapters.find((a) => a.providers.includes(provider));
  const cred = adapter ? await readCredential(provider).catch(() => null) : null;
  const data = adapter && cred ? await adapter.fetch(cred).catch(() => null) : null;

  cache.set(provider, { at: Date.now(), data });
  return data;
}

export type { UsageReport, UsageWindow } from "./types.js";

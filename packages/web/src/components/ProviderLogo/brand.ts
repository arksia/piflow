import type { CSSProperties } from 'react'

export interface ModelIdentity { provider: string, id: string }
export type ProviderBrand = 'claude' | 'openai' | 'gemini' | 'deepseek' | 'unknown'

// Transport providers are explicit: compatible custom endpoints are not OpenAI branding.
const providerBrands: Record<string, ProviderBrand> = {
  'anthropic': 'claude',
  'openai': 'openai',
  'openai-codex': 'openai',
  'google': 'gemini',
  'google-gemini-cli': 'gemini',
  'google-antigravity': 'gemini',
  'google-vertex': 'gemini',
  'deepseek': 'deepseek',
}
export function providerBrand(provider?: string): ProviderBrand {
  return provider ? providerBrands[provider.toLowerCase()] ?? 'unknown' : 'unknown'
}

/** Match configured ids exactly; an ambiguous bare model id stays unknown. */
export function configuredModel(value: string | undefined, models: readonly ModelIdentity[]): ModelIdentity | undefined {
  if (!value)
    return undefined
  const matches = models.filter(model => `${model.provider}/${model.id}` === value || model.id === value)
  if (matches.length === 1)
    return matches[0]
  const slash = value.indexOf('/')
  return slash > 0 ? { provider: value.slice(0, slash), id: value.slice(slash + 1) } : undefined
}

export const brandColors: Record<ProviderBrand, string> = { claude: '#d99576', openai: '#65c5a5', gemini: '#8c9fff', deepseek: '#668fff', unknown: '#9c96b5' }
export function brandStyle(brand: ProviderBrand): CSSProperties {
  return { '--agent-color': brandColors[brand] } as CSSProperties
}

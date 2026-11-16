import type { ModelRuntime } from '@earendil-works/pi-coding-agent'
import type { ProviderInfo } from '@piflow/protocol'

type ProviderRuntime = Pick<ModelRuntime, 'getModels' | 'getProviderAuthStatus' | 'getProviders' | 'listCredentials'>

export async function listProviders(runtime: ProviderRuntime): Promise<ProviderInfo[]> {
  const credentialTypes = new Map<string, ProviderInfo['credentialType']>()
  try {
    for (const credential of await runtime.listCredentials())
      credentialTypes.set(credential.providerId, credential.type)
  }
  catch {
    // A broken credential file must not hide the provider catalog.
  }

  const modelCounts = new Map<string, number>()
  for (const model of runtime.getModels())
    modelCounts.set(model.provider, (modelCounts.get(model.provider) ?? 0) + 1)

  return runtime.getProviders().map((provider) => {
    const status = runtime.getProviderAuthStatus(provider.id)
    return {
      id: provider.id,
      name: provider.name,
      authTypes: [
        ...(provider.auth.apiKey?.login ? ['api_key' as const] : []),
        ...(provider.auth.oauth ? ['oauth' as const] : []),
      ],
      ...(provider.auth.oauth?.name ? { oauthName: provider.auth.oauth.name } : {}),
      ...(credentialTypes.has(provider.id) ? { credentialType: credentialTypes.get(provider.id) } : {}),
      ...status,
      modelCount: modelCounts.get(provider.id) ?? 0,
    }
  })
}

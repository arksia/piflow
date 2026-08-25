import type { PackageManager } from '@earendil-works/pi-coding-agent'
import type { ExtensionSourceInfo } from '@piflow/protocol'
import { DefaultPackageManager, getAgentDir, SettingsManager } from '@earendil-works/pi-coding-agent'

export interface ExtensionManager {
  list: () => ExtensionSourceInfo[]
  install: (source: string, local?: boolean) => Promise<void>
  remove: (source: string, local?: boolean) => Promise<boolean>
}

/**
 * Management surface for pi extensions. Independent of any open session:
 * settings live in agentDir (global) and cwd/.pi (project), so listing and
 * configuring sources works before the first session exists.
 */
export function createExtensionManager(cwd: string, agentDir = getAgentDir()): ExtensionManager {
  const settingsManager = SettingsManager.create(cwd, agentDir)
  const packageManager = new DefaultPackageManager({ cwd, agentDir, settingsManager })
  return wrapPackageManager(packageManager)
}

function wrapPackageManager(packageManager: PackageManager): ExtensionManager {
  return {
    list: () => packageManager.listConfiguredPackages().map(pkg => ({
      source: pkg.source,
      scope: pkg.scope,
      filtered: pkg.filtered,
      ...(pkg.installedPath !== undefined ? { installedPath: pkg.installedPath } : {}),
    })),
    install: async (source, local) => {
      await packageManager.installAndPersist(source, { local })
    },
    remove: (source, local) => packageManager.removeAndPersist(source, { local }),
  }
}

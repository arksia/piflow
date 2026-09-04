import type { PackageManager } from '@earendil-works/pi-coding-agent'
import type { ExtensionSourceInfo } from '@piflow/protocol'
import { DefaultPackageManager, getAgentDir, SettingsManager } from '@earendil-works/pi-coding-agent'

export interface ExtensionManager {
  list: (cwd: string, projectTrusted: boolean) => ExtensionSourceInfo[]
  install: (cwd: string, source: string, scope: 'global' | 'project', projectTrusted: boolean) => Promise<void>
  remove: (cwd: string, source: string, scope: 'global' | 'project', projectTrusted: boolean) => Promise<boolean>
}

/**
 * Management surface for pi extensions. Independent of any open session:
 * settings live in agentDir (global) and cwd/.pi (project), so listing and
 * configuring sources works before the first session exists.
 */
export function createExtensionManager(agentDir = getAgentDir()): ExtensionManager {
  function packageManager(cwd: string, projectTrusted: boolean): PackageManager {
    const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted })
    return new DefaultPackageManager({ cwd, agentDir, settingsManager })
  }
  return {
    list: (cwd, projectTrusted) => packageManager(cwd, projectTrusted).listConfiguredPackages().map(pkg => ({
      source: pkg.source,
      scope: pkg.scope,
      filtered: pkg.filtered,
      ...(pkg.installedPath !== undefined ? { installedPath: pkg.installedPath } : {}),
    })),
    install: async (cwd, source, scope, projectTrusted) => {
      await packageManager(cwd, projectTrusted).installAndPersist(source, { local: scope === 'project' })
    },
    remove: (cwd, source, scope, projectTrusted) => packageManager(cwd, projectTrusted).removeAndPersist(source, { local: scope === 'project' }),
  }
}

import type { ComposerCommandHit } from '@piflow/protocol'
import type { ManagedSession } from '../sessions/index'

export function composerCommands(input: {
  templates: readonly { name: string, description?: string, argumentHint?: string }[]
  extensions: readonly { name: string, description?: string }[]
  skills: readonly { name: string, description?: string }[]
}): ComposerCommandHit[] {
  return [
    ...input.templates.map(item => ({
      name: item.name,
      description: commandDescription(item.description, item.argumentHint),
      source: 'prompt' as const,
    })),
    ...input.extensions.map(item => ({
      name: item.name,
      description: item.description ?? '',
      source: 'extension' as const,
    })),
    ...input.skills.map(item => ({
      name: `skill:${item.name}`,
      description: item.description ?? '',
      source: 'skill' as const,
    })),
  ]
}

export function composerCommandsFromSession(managed: ManagedSession): ComposerCommandHit[] {
  const session = managed.runtime.session
  return composerCommands({
    templates: session.promptTemplates,
    extensions: session.extensionRunner.getRegisteredCommands().map(command => ({
      name: command.invocationName,
      description: command.description,
    })),
    skills: managed.runtime.services.settingsManager.getEnableSkillCommands()
      ? session.resourceLoader.getSkills().skills
      : [],
  })
}

function commandDescription(description?: string, argumentHint?: string) {
  if (argumentHint && description)
    return `${argumentHint} — ${description}`
  return argumentHint || description || ''
}

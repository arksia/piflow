import type { AgentSessionEvent, JsonAgentSessionEvent } from '@earendil-works/pi-coding-agent'

export function toJsonEvent(event: AgentSessionEvent): JsonAgentSessionEvent {
  if (event.type !== 'message_update')
    return event
  if (event.message.role !== 'assistant')
    throw new Error('message_update message is not an assistant message')

  const update = event.assistantMessageEvent
  if (update.type === 'toolcall_start') {
    const toolCall = update.partial.content[update.contentIndex]
    if (toolCall?.type !== 'toolCall')
      throw new Error(`toolcall_start content at index ${update.contentIndex} is not a tool call`)
    const { partial: _partial, ...delta } = update
    return {
      type: 'message_update',
      usage: event.message.usage,
      assistantMessageEvent: { ...delta, id: toolCall.id, toolName: toolCall.name },
    }
  }

  if (!('partial' in update)) {
    return {
      type: 'message_update',
      usage: event.message.usage,
      assistantMessageEvent: update,
    }
  }
  const { partial: _partial, ...delta } = update
  return {
    type: 'message_update',
    usage: event.message.usage,
    assistantMessageEvent: delta,
  }
}

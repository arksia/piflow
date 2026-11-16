import type { AgentMessage } from '@earendil-works/pi-agent-core'

function calls(message: AgentMessage) {
  if (message.role === 'bashExecution')
    return 1
  if (message.role !== 'assistant')
    return 0
  return message.content.filter(block => block.type === 'toolCall').length
}

// Tool calls since the previous user message. A reply is often split into a tool-call message and a later text message.
export function turnToolCount(messages: readonly AgentMessage[], index: number) {
  let count = 0
  for (let i = index; i >= 0; i--) {
    const message = messages[i]
    if (!message || message.role === 'user')
      break
    count += calls(message)
  }
  return count
}

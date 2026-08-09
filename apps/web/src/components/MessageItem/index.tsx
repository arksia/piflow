import type { ChatMessage, MessageBlock, TextBlock } from '@piflow/protocol'
import type { ToolState } from '../../session/state'
import { memo } from 'react'
import MarkdownView from '../MarkdownView'
import StreamingMarkdownView from '../StreamingMarkdownView'
import ToolCallCard from '../ToolCallCard'
import styles from './styles.module.css'

const blockIds = new WeakMap<MessageBlock, number>()
let nextBlockId = 1

interface Props {
  message: ChatMessage
  toolResults: Record<string, ToolState>
  live?: boolean
}

function time(timestamp?: number) {
  if (!timestamp)
    return ''
  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function MessageItem({ message, toolResults, live = false }: Props) {
  const content = message.content
  const blocks = Array.isArray(content) ? content : []
  const userText = typeof content === 'string'
    ? content
    : blocks
        .filter((block): block is TextBlock => block.type === 'text')
        .map(block => block.text)
        .join(' ')

  if (message.role === 'user') {
    return (
      <div className={`${styles.message} ${styles.user}`} data-user={userText}>
        <div className={styles.userBubble}>
          {typeof content === 'string'
            ? <span className={styles.userText}>{content}</span>
            : blocks.map((block) => {
                if (block.type === 'text')
                  return <span key={blockKey(block)} className={styles.userText}>{block.text}</span>
                if (block.type === 'image')
                  return <span key={blockKey(block)} className={styles.userImage}>[图片]</span>
                return null
              })}
        </div>
        <span className={styles.time}>{time(message.timestamp)}</span>
      </div>
    )
  }

  if (message.role === 'assistant') {
    return (
      <div className={`${styles.message} ${styles.assistant} ${live ? styles.live : ''}`}>
        {blocks.map((block, index) => {
          const key = live ? `live:${block.type}:${index}` : blockKey(block)
          if (block.type === 'text') {
            return live
              ? <StreamingMarkdownView key={key} text={block.text} />
              : <MarkdownView key={key} text={block.text} />
          }
          if (block.type === 'thinking') {
            return (
              <details key={key} className={styles.thinking}>
                <summary>思考过程</summary>
                <div className={styles.thinkingBody}>{block.thinking}</div>
              </details>
            )
          }
          if (block.type === 'toolCall')
            return <ToolCallCard key={block.id} call={block} state={toolResults[block.id]} />
          return null
        })}
        {message.stopReason === 'error'
          ? <div className={styles.messageError}>{message.errorMessage || '请求失败'}</div>
          : null}
      </div>
    )
  }

  if (message.role === 'bashExecution') {
    return (
      <div className={styles.message}>
        <ToolCallCard
          call={{ name: 'bash', arguments: { command: message.command }, id: `bash-${message.timestamp}` }}
          state={{
            result: { content: [{ type: 'text', text: message.output ?? '' }] },
            isError: message.exitCode !== 0,
          }}
        />
      </div>
    )
  }

  return null
}

export default memo(MessageItem, (prev, next) => {
  if (prev.message !== next.message || prev.live !== next.live)
    return false
  if (prev.toolResults === next.toolResults)
    return true
  // toolResults entries are replaced per tool id; only re-render when a
  // state this message actually displays has changed
  const blocks = Array.isArray(next.message.content) ? next.message.content : []
  for (const block of blocks) {
    if (block.type === 'toolCall' && prev.toolResults[block.id] !== next.toolResults[block.id])
      return false
  }
  return true
})

function blockKey(block: MessageBlock) {
  if (block.type === 'toolCall')
    return block.id
  let id = blockIds.get(block)
  if (!id) {
    id = nextBlockId++
    blockIds.set(block, id)
  }
  return `${block.type}:${id}`
}

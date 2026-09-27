import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { ToolState } from '../../session/state'
import { Sparkles, Wrench } from 'lucide-react'
import { memo, useEffect, useRef, useState } from 'react'
import { AccChevron } from '../../motion'
import ContentImage from '../ContentImage'
import MarkdownView from '../MarkdownView'
import StreamingMarkdownView from '../StreamingMarkdownView'
import ToolCallCard from '../ToolCallCard'
import styles from './styles.module.css'

const blockIds = new WeakMap<MessageBlock, number>()
let nextBlockId = 1

interface Props {
  message: AgentMessage
  toolResults: Record<string, ToolState>
  live?: boolean
}

type AssistantMessage = Extract<AgentMessage, { role: 'assistant' }>
type UserMessage = Extract<AgentMessage, { role: 'user' }>
type UserBlock = Exclude<UserMessage['content'], string>[number]
type MessageBlock = AssistantMessage['content'][number] | UserBlock
type TextBlock = Extract<MessageBlock, { type: 'text' }>
type ToolCallBlock = Extract<AssistantMessage['content'][number], { type: 'toolCall' }>
type AssistantPart
  = | { type: 'block', block: AssistantMessage['content'][number], index: number }
    | { type: 'tools', calls: ToolCallBlock[] }

function groupAssistant(blocks: AssistantMessage['content']) {
  const parts: AssistantPart[] = []
  let calls: ToolCallBlock[] = []
  const flush = () => {
    if (!calls.length)
      return
    parts.push({ type: 'tools', calls })
    calls = []
  }
  blocks.forEach((block, index) => {
    if (block.type === 'toolCall') {
      calls.push(block)
      return
    }
    flush()
    parts.push({ type: 'block', block, index })
  })
  flush()
  return parts
}

function time(timestamp?: number) {
  if (!timestamp)
    return ''
  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function MessageItem({ message, toolResults, live = false }: Props) {
  const content = 'content' in message ? message.content : ''
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
                  return <ContentImage key={blockKey(block)} image={block} alt="用户图片" />
                return null
              })}
        </div>
        <span className={styles.time}>{time(message.timestamp)}</span>
      </div>
    )
  }

  if (message.role === 'assistant') {
    return (
      <div className={styles.message}>
        {groupAssistant(message.content).map((part) => {
          if (part.type === 'tools') {
            if (part.calls.length === 1) {
              const call = part.calls[0]
              return <ToolCallCard key={call.id} call={call} state={toolResults[call.id]} />
            }
            return <ToolRunGroup key={part.calls[0].id} calls={part.calls} toolResults={toolResults} />
          }
          const { block, index } = part
          const key = live ? `live:${block.type}:${index}` : blockKey(block)
          if (block.type === 'text') {
            return live
              ? <StreamingMarkdownView key={key} text={block.text} />
              : <MarkdownView key={key} text={block.text} />
          }
          if (block.type === 'thinking')
            return <ThinkingBlock key={key} text={block.thinking} live={live} />
          if (block.type === 'image')
            return <ContentImage key={key} image={block} alt="助手图片" />
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
            result: { content: [{ type: 'text', text: message.output ?? '' }], details: {} },
            isError: message.exitCode !== 0,
          }}
        />
      </div>
    )
  }

  return null
}

function ToolRunGroup({ calls, toolResults }: { calls: ToolCallBlock[], toolResults: Record<string, ToolState> }) {
  const running = calls.some(call => toolResults[call.id]?.running)
  const failed = calls.filter(call => toolResults[call.id]?.isError).length
  const label = running
    ? '正在调用工具'
    : failed
      ? `调用了 ${calls.length} 个工具，${failed} 个失败`
      : `调用了 ${calls.length} 个工具`
  return (
    <div className={styles.tools}>
      <div className={styles.toolsLabel}>
        <Wrench size={14} aria-hidden="true" />
        {running
          ? <span className="t-shimmer" role="status" data-text={label}>{label}</span>
          : <span role="status">{label}</span>}
      </div>
      <div className={styles.toolsList}>
        {calls.map(call => (
          <ToolCallCard key={call.id} plain call={call} state={toolResults[call.id]} />
        ))}
      </div>
    </div>
  )
}

function ThinkingBlock({ text, live }: { text: string, live: boolean }) {
  const [manual, setManual] = useState<boolean | null>(null)
  const startedRef = useRef(0)
  const [seconds, setSeconds] = useState<number | null>(null)
  const expanded = manual ?? live

  useEffect(() => {
    if (live) {
      if (!startedRef.current)
        startedRef.current = Date.now()
      return
    }
    if (!startedRef.current)
      return
    setSeconds(Math.max(1, Math.round((Date.now() - startedRef.current) / 1000)))
  }, [live])

  const label = live ? '思考中' : seconds ? `思考了 ${seconds} 秒` : '已思考'
  return (
    <div className={`${styles.thinking} t-acc t-acc-trace`} data-open={String(expanded)}>
      <button
        type="button"
        className={`${styles.thinkingHead} t-acc-head`}
        aria-expanded={expanded}
        onClick={() => setManual(value => !(value ?? live))}
      >
        <Sparkles size={14} aria-hidden="true" />
        {live
          ? <span className="t-shimmer" role="status" data-text="思考中">思考中</span>
          : <span role="status">{label}</span>}
        <AccChevron />
      </button>
      <div className="t-acc-panel">
        <div className="t-acc-panel-inner">
          <div className={styles.thinkingBody}>{text}</div>
        </div>
      </div>
    </div>
  )
}

export default memo(MessageItem, (prev, next) => {
  if (prev.message !== next.message || prev.live !== next.live)
    return false
  if (prev.toolResults === next.toolResults)
    return true
  // toolResults entries are replaced per tool id; only re-render when a
  // state this message actually displays has changed
  const content = 'content' in next.message ? next.message.content : ''
  const blocks = Array.isArray(content) ? content : []
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

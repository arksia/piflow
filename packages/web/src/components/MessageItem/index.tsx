import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { ToolState } from '../../session/state'
import { Check, Copy, GitFork, Sparkles, Wrench } from 'lucide-react'
import { Fragment, memo, useEffect, useRef, useState } from 'react'
import { AccChevron } from '../../motion'
import { fetchForkPoints, forkSession } from '../../session/actions'
import ContentImage from '../ContentImage'
import IconButton from '../IconButton'
import MarkdownView from '../MarkdownView'
import Popover from '../Popover'
import StreamingMarkdownView from '../StreamingMarkdownView'
import ToolCallCard from '../ToolCallCard'
import styles from './styles.module.css'

const blockIds = new WeakMap<MessageBlock, number>()
let nextBlockId = 1

interface Props {
  message: AgentMessage
  toolResults: Record<string, ToolState>
  live?: boolean
  /** Last assistant reply keeps its clock visible. */
  showTime?: boolean
  sessionPath?: string
  /** Index among user messages at or before this one. -1 when there is nothing to fork. */
  forkOrdinal?: number
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
  const date = new Date(timestamp)
  const minutes = Math.floor((Date.now() - date.getTime()) / 60_000)
  if (!Number.isFinite(minutes) || minutes < 1)
    return '刚刚'
  if (minutes < 60)
    return `${minutes}m`
  if (minutes < 60 * 24)
    return `${Math.floor(minutes / 60)}h`
  return date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function MessageItem({ message, toolResults, live = false, showTime = false, sessionPath, forkOrdinal = -1 }: Props) {
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
      </div>
    )
  }

  if (message.role === 'assistant') {
    const parts = groupAssistant(message.content)
    let lastText = -1
    parts.forEach((part, index) => {
      if (part.type === 'block' && part.block.type === 'text' && part.block.text.trim())
        lastText = index
    })
    return (
      <div className={styles.message}>
        {parts.map((part, index) => {
          const node = renderAssistantPart(part, toolResults, live)
          if (!node || index !== lastText)
            return node
          return (
            <Fragment key={node.key}>
              {node}
              <MessageActions message={message} showTime={showTime} sessionPath={sessionPath} forkOrdinal={forkOrdinal} />
            </Fragment>
          )
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

function renderAssistantPart(part: AssistantPart, toolResults: Record<string, ToolState>, live: boolean) {
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
  if (prev.message !== next.message || prev.live !== next.live || prev.showTime !== next.showTime || prev.sessionPath !== next.sessionPath || prev.forkOrdinal !== next.forkOrdinal)
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

function messageBody(message: AssistantMessage) {
  return message.content.map(block => block.type === 'text' ? block.text : '').filter(Boolean).join('\n')
}

function messageFacts(message: AssistantMessage): [string, string][] {
  const tools = message.content.filter(block => block.type === 'toolCall').length
  return [
    ['tokens', message.usage.totalTokens.toLocaleString('zh-CN')],
    ['费用', `$${message.usage.cost.total.toFixed(4)}`],
    ['工具调用', String(tools)],
  ]
}

function MessageActions({
  message,
  showTime,
  sessionPath,
  forkOrdinal,
}: {
  message: AssistantMessage
  showTime: boolean
  sessionPath?: string
  forkOrdinal: number
}) {
  const [copied, setCopied] = useState(false)
  const [forkFailed, setForkFailed] = useState(false)
  const text = messageBody(message).trim()
  const facts = messageFacts(message)

  async function copyMessage() {
    if (!text)
      return
    try {
      await navigator.clipboard.writeText(text)
    }
    catch {
      return
    }
    setCopied(true)
    setTimeout(setCopied, 1500, false)
  }

  async function forkHere() {
    if (!sessionPath || forkOrdinal < 0)
      return
    try {
      const points = await fetchForkPoints(sessionPath)
      const point = points[forkOrdinal]
      if (!point)
        throw new Error('没有对应的分叉点')
      await forkSession(sessionPath, point.entryId)
    }
    catch {
      setForkFailed(true)
      setTimeout(setForkFailed, 1500, false)
    }
  }

  return (
    <div className={styles.actions}>
      <IconButton size="compact" label={copied ? '已复制' : '复制'} disabled={!text} onClick={() => void copyMessage()}>
        {copied ? <Check /> : <Copy />}
      </IconButton>
      <IconButton
        size="compact"
        label={forkFailed ? '分叉失败' : '从这里分叉'}
        disabled={!sessionPath || forkOrdinal < 0}
        onClick={() => void forkHere()}
      >
        <GitFork />
      </IconButton>
      <Popover
        label="消息统计"
        content={(
          <dl className={styles.rows}>
            {facts.map(([name, value]) => (
              <span key={name} className={styles.fact}>
                <dt>{name}</dt>
                <dd>{value}</dd>
              </span>
            ))}
          </dl>
        )}
      >
        <button
          type="button"
          className={styles.age}
          data-show={showTime || undefined}
        >
          {time(message.timestamp)}
        </button>
      </Popover>
    </div>
  )
}

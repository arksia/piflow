import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { ToolState } from '../../session/state'
import { Check, ChevronRight, Copy } from 'lucide-react'
import { memo, useState } from 'react'
import ContentImage from '../ContentImage'
import IconButton from '../IconButton'
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

function time(timestamp?: number) {
  if (!timestamp)
    return ''
  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function textOf(message: AgentMessage) {
  const content = 'content' in message ? message.content : ''
  if (typeof content === 'string')
    return content
  if (!Array.isArray(content))
    return ''
  return content
    .filter((block): block is TextBlock => block.type === 'text')
    .map(block => block.text)
    .join('\n')
    .trim()
}

function MessageItem({ message, toolResults, live = false }: Props) {
  const content = 'content' in message ? message.content : ''
  const blocks = Array.isArray(content) ? content : []
  const copyText = textOf(message)
  const stamp = time(message.timestamp)

  if (message.role === 'user') {
    const wide = copyText.includes('\n') || copyText.length > 36
    return (
      <div className={`${styles.message} ${styles.user}`}>
        <div className={`${styles.userBubble} ${wide ? styles.wide : ''}`}>
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
        <Meta stamp={stamp} copyText={copyText} />
      </div>
    )
  }

  if (message.role === 'assistant') {
    const err = message.stopReason === 'error' ? displayError(message.errorMessage) : ''
    return (
      <div className={`${styles.message} ${styles.assistant}`}>
        {blocks.length || err
          ? (
              <div className={styles.turn}>
                {blocks.map((block, index) => {
                  const key = live ? `live:${block.type}:${index}` : blockKey(block)
                  if (block.type === 'text') {
                    return live
                      ? <StreamingMarkdownView key={key} text={block.text} />
                      : <MarkdownView key={key} text={block.text} />
                  }
                  if (block.type === 'thinking')
                    return <ThinkingBlock key={key} text={block.thinking} live={live} />
                  if (block.type === 'toolCall')
                    return <ToolCallCard key={block.id} call={block} state={toolResults[block.id]} />
                  if (block.type === 'image')
                    return <ContentImage key={key} image={block} alt="助手图片" />
                  return null
                })}
                {err ? <FailAside text={err} /> : null}
              </div>
            )
          : null}
        <Meta stamp={stamp} copyText={copyText || err} />
      </div>
    )
  }

  if (message.role === 'bashExecution') {
    return (
      <div className={styles.message}>
        <div className={styles.turn}>
          <ToolCallCard
            call={{ name: 'bash', arguments: { command: message.command }, id: `bash-${message.timestamp}` }}
            state={{
              result: { content: [{ type: 'text', text: message.output ?? '' }], details: {} },
              isError: message.exitCode !== 0,
            }}
          />
        </div>
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
  const content = 'content' in next.message ? next.message.content : ''
  const blocks = Array.isArray(content) ? content : []
  for (const block of blocks) {
    if (block.type === 'toolCall' && prev.toolResults[block.id] !== next.toolResults[block.id])
      return false
  }
  return true
})

function Meta({ stamp, copyText }: { stamp: string, copyText: string }) {
  if (!stamp && !copyText)
    return null
  return (
    <div className={styles.meta}>
      {stamp ? <span className={styles.time}>{stamp}</span> : null}
      {copyText ? <CopyButton text={copyText} /> : null}
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  return (
    <span className={styles.copy}>
      <IconButton
        size="mini"
        label={done ? '已复制' : '复制'}
        onClick={() => {
          void navigator.clipboard.writeText(text)
          setDone(true)
          window.setTimeout(() => setDone(false), 1600)
        }}
      >
        {done ? <Check size={13} /> : <Copy size={13} />}
      </IconButton>
    </span>
  )
}

function FailAside({ text }: { text: string }) {
  return (
    <div className={`${styles.aside} ${styles.fail}`} role="status">
      <span className={styles.srOnly}>失败</span>
      <div className={styles.asideBody}>{text}</div>
    </div>
  )
}

function ThinkingBlock({ text, live }: { text: string, live: boolean }) {
  const [open, setOpen] = useState(live)
  const body = text.trim() || '…'
  return (
    <div
      className={`${styles.aside} ${styles.think} ${open ? styles.open : ''} ${live ? styles.live : ''}`}
      onClick={() => { if (!open) setOpen(true) }}
    >
      <button
        type="button"
        className={styles.toggle}
        aria-expanded={open}
        aria-label={open ? '收起思考' : '展开思考'}
        onClick={(event) => {
          event.stopPropagation()
          setOpen(value => !value)
        }}
      >
        <ChevronRight size={11} className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`} aria-hidden />
      </button>
      <div className={styles.asideBody}>{body}</div>
    </div>
  )
}

function displayError(raw?: string) {
  const text = raw?.trim() || '请求失败'
  const fromJson = messageFromJson(text)
  if (fromJson)
    return fromJson
  const stripped = text.replace(/^(?:error:\s*)?\d{3}\s+/i, '').trim()
  if (stripped && stripped !== text && !stripped.startsWith('{'))
    return stripped
  return text
}

function messageFromJson(text: string) {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start)
    return ''
  try {
    return pickMessage(JSON.parse(text.slice(start, end + 1)))
  }
  catch {
    return ''
  }
}

function pickMessage(value: unknown): string {
  if (typeof value === 'string')
    return value.trim()
  if (!value || typeof value !== 'object')
    return ''
  const record = value as Record<string, unknown>
  for (const key of ['message', 'error', 'msg', 'detail']) {
    const found = pickMessage(record[key])
    if (found)
      return found
  }
  return ''
}

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

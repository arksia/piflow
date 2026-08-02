import type { CSSProperties, KeyboardEvent } from 'react'
import type { SessionView, UsageWindow } from '../../session/types'
import { useEffect, useRef, useState } from 'react'
import { abort, requestUsage, sendPrompt, setModel, setThinking } from '../../session/actions'
import { useStore } from '../../session/use-store'
import styles from './styles.module.css'

interface Props {
  view: SessionView | null
  text: string
  focusVersion: number
  onTextChange: (text: string) => void
}

function formatWindow(window: UsageWindow) {
  const reset = window.resetTime ? new Date(window.resetTime) : null
  const when = reset
    ? window.minutes
      ? reset.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
      : reset.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
    : ''
  const label = window.minutes ? `${Math.round(window.minutes / 60)}h 窗口` : '周期额度'
  return `${label} · 剩 ${window.remaining}% · ${when} 重置`
}

export default function InputBar({ view, text, focusVersion, onTextChange }: Props) {
  const store = useStore()
  const [modelOpen, setModelOpen] = useState(false)
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const modelButtonRef = useRef<HTMLButtonElement>(null)
  const previousStreamingRef = useRef(view?.isStreaming)
  const modelGroups = new Map<string, typeof store.models>()
  for (const model of store.models) {
    const models = modelGroups.get(model.provider) ?? []
    models.push(model)
    modelGroups.set(model.provider, models)
  }

  const provider = view?.model?.provider
  const report = provider ? store.usage[provider] : null
  const usage = report?.supported ? report : null
  const quota = usage?.windows.length ? Math.min(...usage.windows.map(window => window.remaining)) : null
  const quotaTitle = usage?.windows.map(formatWindow).join('\n') ?? ''
  const contextPercent = Math.round(view?.context?.percent ?? 0)
  const contextLevel = contextPercent >= 85 ? styles.danger : contextPercent >= 70 ? styles.warning : styles.normal
  const contextTitle = view?.context
    ? `上下文已用 ${contextPercent}%（${formatTokens(view.context.tokens)} / ${formatTokens(view.context.contextWindow)}）`
    : ''
  const canSend = store.connected && text.trim().length > 0
  const ringStyle = { '--p': contextPercent } as CSSProperties

  const viewKey = view?.key
  const modelId = view?.model?.id
  const isStreaming = view?.isStreaming

  useEffect(() => {
    if (viewKey)
      requestUsage(viewKey)
  }, [viewKey, modelId])

  useEffect(() => {
    if (previousStreamingRef.current && !isStreaming && viewKey)
      requestUsage(viewKey, true)
    previousStreamingRef.current = isStreaming
  }, [isStreaming, viewKey])

  useEffect(() => {
    if (focusVersion)
      requestAnimationFrame(() => areaRef.current?.focus())
  }, [focusVersion])

  useEffect(() => {
    if (!modelOpen)
      return
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') {
        setModelOpen(false)
        modelButtonRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [modelOpen])

  function pickModel(selectedProvider: string, modelId: string) {
    if (view)
      setModel(view.key, selectedProvider, modelId)
    setModelOpen(false)
  }

  function toggleModels() {
    setModelOpen(open => !open)
    if (!modelOpen && view)
      requestUsage(view.key)
  }

  function cycleThinking() {
    if (!view)
      return
    const levels = view.thinkingLevels.length ? view.thinkingLevels : ['off', 'low', 'medium', 'high']
    const current = levels.indexOf(view.thinkingLevel ?? '')
    const next = levels[(current + 1) % levels.length]
    if (next)
      setThinking(view.key, next)
  }

  async function submit() {
    if (!canSend)
      return
    try {
      await sendPrompt(text.trim())
      onTextChange('')
      requestAnimationFrame(() => areaRef.current?.focus())
    }
    catch (error) {
      console.error('[piflow]', error)
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      void submit()
    }
  }

  return (
    <div className={styles.bar}>
      <div className={styles.column}>
        {view && (view.queue.steering.length || view.queue.followUp.length)
          ? (
              <div className={styles.queue}>
                队列中
                {' '}
                {view.queue.steering.length + view.queue.followUp.length}
                {' '}
                条 · 将在合适的时机送达
              </div>
            )
          : null}

        <div className={`${styles.box} ${view?.isStreaming ? styles.streaming : ''}`}>
          <textarea
            ref={areaRef}
            value={text}
            rows={2}
            placeholder="和 pi 说点什么…"
            onChange={event => onTextChange(event.target.value)}
            onKeyDown={onKeyDown}
          />
          <div className={styles.footer}>
            <div className={styles.left}>
              {view?.isStreaming
                ? (
                    <span className={styles.steer}>
                      <span className={styles.dot} />
                      回复中 · 发送将插队传达
                    </span>
                  )
                : view?.thinkingLevels.length
                  ? (
                      <button className={styles.thinking} title="切换思考强度" aria-label={`切换思考强度，当前${thinkingLabel(view.thinkingLevel)}`} onClick={cycleThinking}>
                        思考强度 ·
                        {' '}
                        {thinkingLabel(view.thinkingLevel)}
                      </button>
                    )
                  : null}
            </div>
            <div className={styles.right}>
              {quota !== null
                ? (
                    <span className={`${styles.quota} ${quota < 20 ? styles.low : ''}`} title={quotaTitle}>
                      {quota}
                      %
                    </span>
                  )
                : null}
              {view?.model
                ? (
                    <button
                      ref={modelButtonRef}
                      className={styles.model}
                      aria-haspopup="dialog"
                      aria-expanded={modelOpen}
                      onClick={toggleModels}
                    >
                      {view.model.name}
                    </button>
                  )
                : null}
              {view?.isStreaming
                ? (
                    <button
                      className={`${styles.button} ${styles.ring} ${styles.stop} ${contextLevel}`}
                      style={ringStyle}
                      title={`中断回复 · ${contextTitle}`}
                      aria-label="中断回复"
                      onClick={() => abort(view.key)}
                    >
                      <span className={styles.core}>■</span>
                    </button>
                  )
                : (
                    <button
                      className={`${styles.button} ${styles.ring} ${styles.send} ${contextLevel} ${canSend ? styles.ready : ''}`}
                      style={ringStyle}
                      title={contextTitle || '发送'}
                      aria-label="发送"
                      disabled={!canSend}
                      onClick={() => void submit()}
                    >
                      <span className={styles.core}>↑</span>
                    </button>
                  )}
            </div>
          </div>

          {modelOpen
            ? (
                <>
                  <div className={styles.scrim} aria-hidden onClick={() => setModelOpen(false)} />
                  <div className={styles.popover} role="dialog" aria-label="选择模型">
                    {[...modelGroups.entries()].map(([groupProvider, models]) => (
                      <div key={groupProvider} className={styles.providerGroup}>
                        <div className={styles.providerName}>{groupProvider}</div>
                        {models.map(model => (
                          <button
                            key={model.id}
                            className={`${styles.providerItem} ${view?.model?.id === model.id ? styles.current : ''}`}
                            onClick={() => pickModel(model.provider, model.id)}
                          >
                            {model.name}
                          </button>
                        ))}
                      </div>
                    ))}
                    {usage
                      ? (
                          <div className={styles.usage}>
                            {usage.windows.map(window => (
                              <div key={`${window.minutes}:${window.limit}:${window.resetTime ?? ''}`}>
                                {formatWindow(window)}
                              </div>
                            ))}
                          </div>
                        )
                      : null}
                  </div>
                </>
              )
            : null}
        </div>
      </div>
    </div>
  )
}

function formatTokens(value: number) {
  return value >= 1000 ? `${Math.round(value / 1000)}k` : `${value}`
}

const THINKING_LABELS: Record<string, string> = {
  off: '关闭',
  minimal: '极简',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
}

function thinkingLabel(level?: string | null) {
  return THINKING_LABELS[level ?? ''] ?? level ?? '自动'
}

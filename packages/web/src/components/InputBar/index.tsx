import type { ThinkingLevel } from '@earendil-works/pi-agent-core'
import type { UsageWindow } from '@piflow/protocol'
import type { ChangeEvent, DragEvent, KeyboardEvent } from 'react'
import type { DraftImage } from '../../session/persistence'
import type { SessionView } from '../../session/state'
import { MAX_PROMPT_IMAGE_BYTES as MAX_IMAGE_BYTES, MAX_PROMPT_IMAGES as MAX_IMAGES } from '@piflow/protocol'
import { ArrowUp, ImagePlus, ListX, Square, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { TextSwap, usePresence, useTabsPill } from '../../motion'
import { abort, abortCompaction, clearQueue, compact, requestUsage, sendPrompt, setAutoCompaction, setModel, setThinking } from '../../session/actions'
import { clearDraft, readDraft, saveDraftImages, saveDraftText } from '../../session/persistence'
import { useStore } from '../../session/use-store'
import IconButton from '../IconButton'
import styles from './styles.module.css'

interface Props {
  view: SessionView | null
  text: string
  focusVersion: number
  onTextChange: (text: string) => void
  draftKey: string
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

export default function InputBar({ view, text, focusVersion, onTextChange, draftKey }: Props) {
  const store = useStore()
  const [modelOpen, setModelOpen] = useState(false)
  const [thinkingOpen, setThinkingOpen] = useState(false)
  const [operationError, setOperationError] = useState<string | null>(null)
  const [aborting, setAborting] = useState(false)
  const [streamingBehavior, setStreamingBehavior] = useState<'steer' | 'followUp'>('steer')
  const [clearingQueue, setClearingQueue] = useState(false)
  const [compacting, setCompacting] = useState(false)
  const [images, setImages] = useState<DraftImage[]>([])
  const fileRef = useRef<HTMLInputElement>(null)
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const modelButtonRef = useRef<HTMLButtonElement>(null)
  const thinkingRef = useRef<HTMLDivElement>(null)
  const streamingTabsRef = useRef<HTMLDivElement>(null)
  const streamingPillRef = useTabsPill(streamingTabsRef, view?.isStreaming ? streamingBehavior : '')
  const modelMenu = usePresence(modelOpen, '--dropdown-close-dur', 150)
  const thinkingMenu = usePresence(thinkingOpen, '--dropdown-close-dur', 150)
  const previousStreamingRef = useRef(view?.isStreaming)
  const modelGroups = new Map<string, typeof store.models>()
  for (const model of store.models) {
    const models = modelGroups.get(model.provider) ?? []
    models.push(model)
    modelGroups.set(model.provider, models)
  }
  const scopedModels = new Map(view?.modelScope.map(scoped => [`${scoped.model.provider}/${scoped.model.id}`, scoped.thinkingLevel] as const) ?? [])

  const provider = view?.model?.provider
  const report = provider ? store.usage[provider] : null
  const usage = report?.supported ? report : null
  const quota = usage?.windows.length ? Math.min(...usage.windows.map(window => window.remaining)) : null
  const contextPercent = Math.round(view?.context?.percent ?? 0)
  const contextLevel = contextPercent >= 85 ? styles.danger : contextPercent >= 70 ? styles.warning : ''
  const canSend = store.connected && (text.trim().length > 0 || images.length > 0)
  const isLive = store.connected && !!view?.isStreaming
  const stopping = Boolean(view?.isCompacting || isLive)

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
    // Session changes replace attachments with that session's draft.
    // eslint-disable-next-line react/set-state-in-effect
    setImages(readDraft(draftKey).images)
  }, [draftKey])

  useEffect(() => {
    if (!modelOpen && !thinkingOpen)
      return
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key !== 'Escape')
        return
      if (modelOpen) {
        setModelOpen(false)
        modelButtonRef.current?.focus()
        return
      }
      setThinkingOpen(false)
    }
    function onPointerDown(event: PointerEvent) {
      if (thinkingOpen && event.target instanceof Node && !thinkingRef.current?.contains(event.target))
        setThinkingOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [modelOpen, thinkingOpen])

  function pickModel(selectedProvider: string, modelId: string) {
    if (!view)
      return
    setOperationError(null)
    void setModel(view.key, selectedProvider, modelId).catch(error => setOperationError(errorMessage(error)))
    setModelOpen(false)
  }

  function toggleModels() {
    setThinkingOpen(false)
    setModelOpen(open => !open)
    if (!modelOpen && view)
      requestUsage(view.key)
  }

  function pickThinking(level: ThinkingLevel) {
    if (!view)
      return
    setThinkingOpen(false)
    if (level === view.thinkingLevel)
      return
    setOperationError(null)
    void setThinking(view.key, level).catch(error => setOperationError(errorMessage(error)))
  }

  async function submit() {
    if (!canSend)
      return
    try {
      await sendPrompt(
        text.trim(),
        images.map(image => ({ type: image.type, data: image.data, mimeType: image.mimeType })),
        isLive ? streamingBehavior : undefined,
      )
      onTextChange('')
      clearDraft(draftKey)
      clearDraft(store.activeKey)
      setImages([])
      requestAnimationFrame(() => areaRef.current?.focus())
    }
    catch (error) {
      setOperationError(errorMessage(error))
    }
  }

  function addFiles(files: FileList | File[]) {
    const accepted = [...files].filter(file => file.type.startsWith('image/') && file.size <= MAX_IMAGE_BYTES).slice(0, MAX_IMAGES - images.length)
    for (const file of accepted) {
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = typeof reader.result === 'string' ? reader.result : ''
        const comma = dataUrl.indexOf(',')
        if (comma < 0)
          return
        setImages((current) => {
          const next = current.length >= MAX_IMAGES ? current : [...current, { id: crypto.randomUUID(), type: 'image', data: dataUrl.slice(comma + 1), mimeType: file.type, previewUrl: dataUrl } satisfies DraftImage]
          saveDraftImages(draftKey, next)
          return next
        })
      }
      reader.readAsDataURL(file)
    }
  }

  function stop() {
    if (!view || aborting)
      return
    setOperationError(null)
    setAborting(true)
    void abort(view.key)
      .catch(error => setOperationError(errorMessage(error)))
      .finally(() => setAborting(false))
  }

  function removeImage(id: string) {
    setImages((current) => {
      const next = current.filter(image => image.id !== id)
      saveDraftImages(draftKey, next)
      return next
    })
  }

  function clearPendingMessages() {
    if (!view || clearingQueue)
      return
    setOperationError(null)
    setClearingQueue(true)
    void clearQueue(view.key)
      .catch(error => setOperationError(errorMessage(error)))
      .finally(() => setClearingQueue(false))
  }

  function runCompact() {
    if (!view || compacting)
      return
    setOperationError(null)
    setCompacting(true)
    void compact(view.key).catch(error => setOperationError(errorMessage(error))).finally(() => setCompacting(false))
  }

  function stopCompaction() {
    if (!view)
      return
    setOperationError(null)
    void abortCompaction(view.key).catch(error => setOperationError(errorMessage(error)))
  }

  function toggleAutoCompaction() {
    if (!view)
      return
    setOperationError(null)
    void setAutoCompaction(view.key, !view.autoCompactionEnabled).catch(error => setOperationError(errorMessage(error)))
  }

  function dropImages(event: DragEvent<HTMLTextAreaElement>) {
    event.preventDefault()
    addFiles([...event.dataTransfer.files])
  }

  function pickImages(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files)
      addFiles(event.target.files)
    event.currentTarget.value = ''
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
        {operationError ? <div className={styles.error} role="alert">{operationError}</div> : null}
        {view && (view.queue.steering.length || view.queue.followUp.length)
          ? (
              <div className={styles.queue}>
                <div className={styles.queueGroups}>
                  {view.queue.steering.length
                    ? <QueueGroup label="立即引导" messages={view.queue.steering} />
                    : null}
                  {view.queue.followUp.length
                    ? <QueueGroup label="完成后继续" messages={view.queue.followUp} />
                    : null}
                </div>
                <IconButton label="清空全部队列" disabled={clearingQueue} onClick={clearPendingMessages}>
                  <ListX />
                </IconButton>
              </div>
            )
          : null}

        <div className={`${styles.box} ${isLive ? styles.streaming : ''}`}>
          <textarea
            ref={areaRef}
            value={text}
            rows={2}
            placeholder="和 pi 说点什么…"
            onChange={(event) => {
              onTextChange(event.target.value)
              saveDraftText(draftKey, event.target.value)
            }}
            onKeyDown={onKeyDown}
            onPaste={event => addFiles([...event.clipboardData.files])}
            onDragOver={event => event.preventDefault()}
            onDrop={dropImages}
          />
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={pickImages}
          />
          {images.length
            ? (
                <div className={styles.images}>
                  {images.map((image, index) => (
                    <button key={image.id} type="button" title="移除图片" aria-label={`移除图片 ${index + 1}`} onClick={() => removeImage(image.id)}>
                      <img src={image.previewUrl} alt={`待发送图片 ${index + 1}`} />
                      <X />
                    </button>
                  ))}
                </div>
              )
            : null}
          <div className={styles.footer}>
            <div className={styles.left}>
              {isLive
                ? (
                    <div ref={streamingTabsRef} className={`t-tabs ${styles.streamingMode}`} aria-label="运行中消息发送方式">
                      <span ref={streamingPillRef} className="t-tabs-pill" aria-hidden="true" />
                      <button className="t-tab" role="tab" aria-selected={streamingBehavior === 'steer'} onClick={() => setStreamingBehavior('steer')}>立即引导</button>
                      <button className="t-tab" role="tab" aria-selected={streamingBehavior === 'followUp'} onClick={() => setStreamingBehavior('followUp')}>完成后继续</button>
                    </div>
                  )
                : view?.thinkingLevels.length
                  ? (
                      <div ref={thinkingRef} className={styles.thinking}>
                        <button
                          type="button"
                          className={styles.thinkingTrigger}
                          title="思考强度"
                          aria-label={`思考强度，当前${thinkingLabel(view.thinkingLevel)}`}
                          aria-haspopup="menu"
                          aria-expanded={thinkingOpen}
                          onClick={() => {
                            setModelOpen(false)
                            setThinkingOpen(open => !open)
                          }}
                        >
                          思考 ·
                          {' '}
                          <TextSwap text={thinkingLabel(view.thinkingLevel)} />
                        </button>
                        {thinkingMenu.mounted
                          ? (
                              <div className={`${styles.thinkingMenu} t-dropdown ${thinkingMenu.className}`} data-origin="bottom-left" role="menu" aria-label="思考强度">
                                {view.thinkingLevels.map(level => (
                                  <button
                                    key={level}
                                    type="button"
                                    role="menuitemradio"
                                    aria-checked={view.thinkingLevel === level}
                                    onClick={() => pickThinking(level)}
                                  >
                                    {thinkingLabel(level)}
                                  </button>
                                ))}
                              </div>
                            )
                          : null}
                      </div>
                    )
                  : null}
            </div>
            <div className={styles.right}>
              {view?.context
                ? (
                    <div className={styles.meter} onMouseEnter={() => viewKey && requestUsage(viewKey)}>
                      <button type="button" className={`${styles.meterTrigger} ${contextLevel}`} aria-label={`上下文 ${contextPercent}%`} aria-describedby="composer-usage">
                        {`${contextPercent}%`}
                      </button>
                      <div className={styles.meterTip} id="composer-usage" role="tooltip">
                        {quota !== null
                          ? (
                              <div>
                                额度
                                {' '}
                                {quota}
                                %
                              </div>
                            )
                          : null}
                        {usage?.windows.map(window => (
                          <div key={`${window.minutes}:${window.limit}:${window.resetTime ?? ''}`}>{formatWindow(window)}</div>
                        ))}
                        <div>
                          上下文
                          {' '}
                          {contextPercent}
                          %
                          {' · '}
                          {formatTokens(view.context.tokens ?? 0)}
                          {' / '}
                          {formatTokens(view.context.contextWindow)}
                        </div>
                        {isLive
                          ? null
                          : (
                              <div className={styles.sessionActions}>
                                <button
                                  type="button"
                                  className={styles.chip}
                                  aria-pressed={view.autoCompactionEnabled}
                                  onClick={toggleAutoCompaction}
                                >
                                  {view.autoCompactionEnabled ? '自动压缩开' : '自动压缩关'}
                                </button>
                                <button type="button" className={styles.chip} disabled={compacting || view.isCompacting} onClick={runCompact}>
                                  {compacting || view.isCompacting ? '压缩中…' : '压缩上下文'}
                                </button>
                              </div>
                            )}
                      </div>
                    </div>
                  )
                : null}
              {view?.model
                ? (
                    <button
                      ref={modelButtonRef}
                      className={styles.model}
                      aria-haspopup="dialog"
                      aria-expanded={modelOpen}
                      aria-label={`选择模型，当前 ${view.model.id}`}
                      onClick={toggleModels}
                    >
                      {view.model.id}
                    </button>
                  )
                : null}
              <IconButton label="添加图片" onClick={() => fileRef.current?.click()}>
                <ImagePlus />
              </IconButton>
              <button
                type="button"
                className={`${styles.button} ${stopping ? styles.stop : `${styles.send} ${canSend ? styles.ready : ''}`}`}
                title={stopping ? (view?.isCompacting ? '中止压缩' : aborting ? '正在中断…' : '中断回复') : '发送'}
                aria-label={stopping ? (view?.isCompacting ? '中止压缩' : aborting ? '正在中断回复' : '中断回复') : '发送'}
                disabled={stopping ? aborting : !canSend}
                onClick={stopping ? (view?.isCompacting ? stopCompaction : stop) : () => void submit()}
              >
                <span className={styles.core}>
                  <span className="t-icon-swap" data-state={stopping ? 'b' : 'a'}>
                    <span className="t-icon" data-icon="a"><ArrowUp size={14} /></span>
                    <span className="t-icon" data-icon="b"><Square size={10} fill="currentColor" strokeWidth={0} /></span>
                  </span>
                </span>
              </button>
            </div>
          </div>

          {modelMenu.mounted
            ? (
                <>
                  <div className={styles.scrim} aria-hidden onClick={() => setModelOpen(false)} />
                  <div className={`${styles.popover} t-dropdown ${modelMenu.className}`} data-origin="bottom-right" role="dialog" aria-label="选择模型">
                    {[...modelGroups.entries()].map(([groupProvider, models]) => (
                      <div key={groupProvider} className={styles.providerGroup}>
                        <div className={styles.providerName}>{groupProvider}</div>
                        {models.map(model => (
                          <button
                            key={model.id}
                            className={`${styles.providerItem} ${view?.model?.id === model.id ? styles.current : ''}`}
                            onClick={() => pickModel(model.provider, model.id)}
                          >
                            {model.id}
                            {scopedModels.has(`${model.provider}/${model.id}`)
                              ? (
                                  <small>
                                    {' · '}
                                    {scopedModels.get(`${model.provider}/${model.id}`) ?? '固定'}
                                  </small>
                                )
                              : null}
                          </button>
                        ))}
                      </div>
                    ))}
                    {view?.modelDiagnostics.map(diagnostic => <div key={diagnostic.message} className={styles.diag}>{diagnostic.message}</div>)}
                  </div>
                </>
              )
            : null}
        </div>
      </div>
    </div>
  )
}

function errorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : '操作失败，请重试'
}

function QueueGroup({ label, messages }: { label: string, messages: readonly string[] }) {
  return (
    <div className={styles.queueGroup}>
      <span>{label}</span>
      <div className={styles.queueMessages}>
        {messages.map((message, index) => (
          // pi exposes queue entries as strings without stable ids.
          // eslint-disable-next-line react/no-array-index-key
          <div key={index} title={message}>{message}</div>
        ))}
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

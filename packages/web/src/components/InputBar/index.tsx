import type { ThinkingLevel } from '@earendil-works/pi-agent-core'
import type { ChangeEvent, DragEvent, KeyboardEvent } from 'react'
import type { DraftImage } from '../../session/persistence'
import type { SessionView } from '../../session/state'
import type { DropdownItem } from '../Dropdown'
import { MAX_PROMPT_IMAGE_BYTES as MAX_IMAGE_BYTES, MAX_PROMPT_IMAGES as MAX_IMAGES } from '@piflow/protocol'
import { ArrowUp, ChevronDown, ListX, Plus, Square, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { abort, abortCompaction, clearQueue, sendPrompt, setModel, setThinking } from '../../session/actions'
import { clearDraft, readDraft, saveDraftImages, saveDraftText } from '../../session/persistence'
import { useStore } from '../../session/use-store'
import BranchNavigator from '../BranchNavigator'
import Dropdown from '../Dropdown'
import IconButton from '../IconButton'
import styles from './styles.module.css'

interface Props {
  view: SessionView | null
  text: string
  focusVersion: number
  onTextChange: (text: string) => void
  draftKey: string
}

const RING_R = 6
const RING_C = 2 * Math.PI * RING_R

export default function InputBar({ view, text, focusVersion, onTextChange, draftKey }: Props) {
  const store = useStore()
  const [modelOpen, setModelOpen] = useState(false)
  const [operationError, setOperationError] = useState<string | null>(null)
  const [aborting, setAborting] = useState(false)
  const [clearingQueue, setClearingQueue] = useState(false)
  const [images, setImages] = useState<DraftImage[]>([])
  const fileRef = useRef<HTMLInputElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const modelGroups = new Map<string, typeof store.models>()
  for (const model of store.models) {
    const models = modelGroups.get(model.provider) ?? []
    models.push(model)
    modelGroups.set(model.provider, models)
  }
  const scopedModels = new Map(view?.modelScope.map(scoped => [`${scoped.model.provider}/${scoped.model.id}`, scoped.thinkingLevel] as const) ?? [])

  const contextPercent = Math.round(view?.context?.percent ?? 0)
  const contextLevel = contextPercent >= 85 ? styles.danger : contextPercent >= 70 ? styles.warning : ''
  const canSend = store.connected && (text.trim().length > 0 || images.length > 0)
  const isLive = store.connected && !!view?.isStreaming
  const stopping = Boolean(view?.isCompacting || isLive)
  const offlineLabel = store.connectionState === 'reconnecting' ? '重连中，发送暂不可用' : '连接中，发送暂不可用'
  const sendLabel = stopping
    ? (view?.isCompacting ? '中止压缩' : aborting ? '正在中断…' : '中断回复')
    : store.connected ? '发送' : offlineLabel
  const sendAria = stopping && !view?.isCompacting && aborting ? '正在中断回复' : sendLabel

  useEffect(() => {
    if (focusVersion)
      requestAnimationFrame(() => areaRef.current?.focus())
  }, [focusVersion])

  useEffect(() => {
    // Session changes replace attachments with that session's draft.
    // eslint-disable-next-line react/set-state-in-effect
    setImages(readDraft(draftKey).images)
  }, [draftKey])

  useLayoutEffect(() => {
    const input = areaRef.current
    const next = images.length > 0 || (input ? input.scrollHeight > 40 : false)
    const wide = styles.wide
    if (wide)
      boxRef.current?.classList.toggle(wide, next)
  }, [text, images.length])

  function pickModel(selectedProvider: string, modelId: string) {
    if (!view)
      return
    setOperationError(null)
    void setModel(view.key, selectedProvider, modelId).catch(error => setOperationError(errorMessage(error)))
  }

  function onModelOpenChange(next: boolean) {
    setModelOpen(next)
  }

  function pickThinking(level: ThinkingLevel) {
    if (!view)
      return
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
        isLive ? 'steer' : undefined,
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

  function stopCompaction() {
    if (!view)
      return
    setOperationError(null)
    void abortCompaction(view.key).catch(error => setOperationError(errorMessage(error)))
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

  const menuItems: DropdownItem[] = []
  if (view?.thinkingLevels.length) {
    menuItems.push({
      key: 'thinking',
      label: '思考',
      extra: thinkingLabel(view.thinkingLevel),
      children: view.thinkingLevels.map(level => ({
        key: level,
        label: thinkingLabel(level),
        selected: view.thinkingLevel === level,
        onClick: () => pickThinking(level),
      })),
    })
  }
  if (view?.model) {
    const current = view.model
    menuItems.push({
      key: 'model',
      label: '模型',
      extra: current.id,
      children: [...modelGroups.entries()].map(([groupProvider, models]) => ({
        key: groupProvider,
        type: 'group' as const,
        label: groupProvider,
        children: models.map(model => ({
          key: `${model.provider}/${model.id}`,
          label: model.id,
          extra: scopedModels.has(`${model.provider}/${model.id}`)
            ? <small>{` · ${scopedModels.get(`${model.provider}/${model.id}`) ?? '固定'}`}</small>
            : undefined,
          selected: current.id === model.id && current.provider === model.provider,
          onClick: () => pickModel(model.provider, model.id),
        })),
      })),
    })
  }
  for (const diagnostic of view?.modelDiagnostics ?? [])
    menuItems.push({ key: diagnostic.message, label: diagnostic.message, disabled: true })

  return (
    <div className={styles.bar}>
      <div className={styles.column}>
        {operationError ? <div className={styles.error} role="alert">{operationError}</div> : null}
        {!store.connected
          ? (
              <div className={styles.notice} role="status">
                {`${store.connectionState === 'reconnecting' ? '重连中' : '连接中'}，已输入的内容会保留`}
              </div>
            )
          : null}
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

        <div ref={boxRef} className={styles.box}>
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
          <div className={styles.composer}>
            <IconButton className={styles.plus} label="添加图片" onClick={() => fileRef.current?.click()}>
              <Plus size={16} strokeWidth={2} />
            </IconButton>
            <textarea
              ref={areaRef}
              value={text}
              rows={1}
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
            {view && (view.model || view.thinkingLevels.length > 0)
              ? (
                  <Dropdown
                    menu={{ items: menuItems }}
                    open={modelOpen}
                    placement="topRight"
                    trigger={['click']}
                    onOpenChange={onModelOpenChange}
                  >
                    <button
                      type="button"
                      className={styles.model}
                      aria-label={view.model ? `模型和思考，当前 ${view.model.id}，${thinkingLabel(view.thinkingLevel)}` : `思考强度，当前${thinkingLabel(view.thinkingLevel)}`}
                    >
                      <span>{view.model?.id ?? thinkingLabel(view.thinkingLevel)}</span>
                      <ChevronDown size={12} />
                    </button>
                  </Dropdown>
                )
              : null}
            <button
              type="button"
              className={`${styles.button} ${stopping ? styles.stop : `${styles.send} ${canSend ? styles.ready : ''}`}`}
              title={sendLabel}
              aria-label={sendAria}
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

        <div className={styles.meta}>
          {view?.cwd ? <BranchNavigator cwd={view.cwd} /> : null}
          {view?.context
            ? (
                <div className={styles.meter}>
                  <button type="button" className={`${styles.ring} ${contextLevel}`} aria-label={`上下文已用 ${contextPercent}%`} aria-describedby="composer-usage">
                    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                      <circle className={styles.track} cx="8" cy="8" r={RING_R} />
                      {contextPercent > 0
                        ? (
                            <circle
                              className={styles.value}
                              cx="8"
                              cy="8"
                              r={RING_R}
                              strokeDasharray={`${(contextPercent / 100) * RING_C} ${RING_C}`}
                              transform="rotate(-90 8 8)"
                            />
                          )
                        : null}
                    </svg>
                  </button>
                  <div className={styles.meterTip} id="composer-usage" role="tooltip">
                    {`已用 ${contextPercent}% · ${formatTokens(view.context.tokens ?? 0)} / ${formatTokens(view.context.contextWindow)}`}
                  </div>
                </div>
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

import type { ThinkingLevel } from '@earendil-works/pi-agent-core'
import type { ComposerCommandHit } from '@piflow/protocol'
import type { ChangeEvent, DragEvent, KeyboardEvent } from 'react'
import type { DraftImage } from '../../session/persistence'
import type { SessionView } from '../../session/state'
import type { DropdownItem } from '../Dropdown'
import type { ComposerToken } from './complete'
import { MAX_PROMPT_IMAGE_BYTES as MAX_IMAGE_BYTES, MAX_PROMPT_IMAGES as MAX_IMAGES } from '@piflow/protocol'
import { ArrowUp, ChevronDown, ListX, Plus, Square, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { abort, abortCompaction, clearQueue, completePaths, loadComposerCommands, sendPrompt, setModel, setThinking } from '../../session/actions'
import { clearDraft, readDraft, saveDraftImages, saveDraftText } from '../../session/persistence'
import { useStore } from '../../session/use-store'
import BranchNavigator from '../BranchNavigator'
import Dropdown from '../Dropdown'
import IconButton from '../IconButton'
import { applyAt, applyCommand, composerToken, filterCommands } from './complete'
import styles from './styles.module.css'

interface Props {
  view: SessionView | null
  text: string
  focusVersion: number
  onTextChange: (text: string) => void
  draftKey: string
  hideMeta?: boolean
  floating?: boolean
}

const RING_R = 6
const RING_C = 2 * Math.PI * RING_R

export default function InputBar({ view, text, focusVersion, onTextChange, draftKey, hideMeta = false, floating = false }: Props) {
  const store = useStore()
  const [modelOpen, setModelOpen] = useState(false)
  const [operationError, setOperationError] = useState<string | null>(null)
  const [aborting, setAborting] = useState(false)
  const [clearingQueue, setClearingQueue] = useState(false)
  const [images, setImages] = useState<DraftImage[]>([])
  const fileRef = useRef<HTMLInputElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const markRef = useRef<HTMLSpanElement>(null)
  const rowListRef = useRef<(HTMLButtonElement | null)[]>([])
  const cursorRef = useRef<number | null>(null)
  const pathRequestRef = useRef(0)
  const commandRequestRef = useRef(0)
  const [cursor, setCursor] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const [paths, setPaths] = useState<string[]>([])
  const [commands, setCommands] = useState<ComposerCommandHit[]>([])
  const [pathLoading, setPathLoading] = useState(false)
  const [commandLoading, setCommandLoading] = useState(false)
  const [active, setActive] = useState(0)
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
  const token = dismissed ? null : composerToken(text, cursor)
  const menuOpen = !!token && (token.kind === 'at' || !!view)
  const loading = token?.kind === 'at' ? pathLoading : commandLoading
  const rows = menuRows(token, paths, commands)
  const rowKey = rows.map(row => row.key).join('\n')
  const rowIndex = rows.length ? Math.min(active, rows.length - 1) : 0

  useEffect(() => {
    if (token?.kind !== 'at')
      return
    const cwd = view?.cwd || store.cwd
    if (!cwd)
      return
    const request = ++pathRequestRef.current
    /* eslint-disable react/set-state-in-effect */
    setPathLoading(true)
    setPaths([])
    /* eslint-enable react/set-state-in-effect */
    void completePaths(cwd, token.query).then((next) => {
      if (pathRequestRef.current !== request)
        return
      setPaths(next)
      setOperationError(null)
    }).catch((error: unknown) => {
      if (pathRequestRef.current !== request)
        return
      setPaths([])
      setOperationError(errorMessage(error))
    }).finally(() => {
      if (pathRequestRef.current === request)
        setPathLoading(false)
    })
  }, [token?.kind, token?.query, view?.cwd, store.cwd])

  const sessionKey = view?.key
  useEffect(() => {
    if (token?.kind !== 'slash' || !sessionKey)
      return
    const request = ++commandRequestRef.current
    /* eslint-disable react/set-state-in-effect */
    setCommandLoading(true)
    setCommands([])
    /* eslint-enable react/set-state-in-effect */
    void loadComposerCommands(sessionKey).then((next) => {
      if (commandRequestRef.current !== request)
        return
      setCommands(next)
      setOperationError(null)
    }).catch((error: unknown) => {
      if (commandRequestRef.current !== request)
        return
      setCommands([])
      setOperationError(errorMessage(error))
    }).finally(() => {
      if (commandRequestRef.current === request)
        setCommandLoading(false)
    })
  }, [token?.kind, sessionKey])

  useEffect(() => {
    // A new query starts the highlight on the first row.
    // eslint-disable-next-line react/set-state-in-effect
    setActive(0)
  }, [token?.kind, token?.query])

  useEffect(() => {
    if (!menuOpen)
      return
    const close = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Element && target.closest('[data-composer]'))
        return
      setDismissed(true)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [menuOpen])

  useLayoutEffect(() => {
    const area = areaRef.current
    const next = cursorRef.current
    if (!area || next == null)
      return
    area.setSelectionRange(next, next)
    cursorRef.current = null
    setCursor(next)
  }, [text])

  useLayoutEffect(() => {
    const box = boxRef.current
    const menu = menuRef.current
    if (!box || !menu || !menuOpen)
      return
    const measure = () => {
      const top = box.getBoundingClientRect().top
      const viewportTop = window.visualViewport?.offsetTop ?? 0
      menu.style.maxHeight = `${Math.max(80, top - viewportTop - 8)}px`
    }
    measure()
    window.addEventListener('resize', measure)
    window.visualViewport?.addEventListener('resize', measure)
    window.visualViewport?.addEventListener('scroll', measure)
    return () => {
      window.removeEventListener('resize', measure)
      window.visualViewport?.removeEventListener('resize', measure)
      window.visualViewport?.removeEventListener('scroll', measure)
    }
  }, [menuOpen])

  useLayoutEffect(() => {
    const mark = markRef.current
    const row = rowListRef.current[rowIndex]
    if (!mark)
      return
    if (!menuOpen || loading || !row) {
      mark.style.opacity = '0'
      return
    }
    mark.style.opacity = '1'
    mark.style.height = `${row.offsetHeight}px`
    mark.style.transform = `translateY(${row.offsetTop}px)`
    const menu = menuRef.current
    if (!menu)
      return
    const bottom = row.offsetTop + row.offsetHeight
    if (row.offsetTop < menu.scrollTop)
      menu.scrollTop = row.offsetTop
    else if (bottom > menu.scrollTop + menu.clientHeight)
      menu.scrollTop = bottom - menu.clientHeight
  }, [rowIndex, loading, menuOpen, rowKey])

  function placeCursor(next: number) {
    cursorRef.current = next
    setCursor(next)
  }

  function pick(row: MenuRow) {
    if (!token)
      return
    const next = token.kind === 'at' ? applyAt(text, token, row.label) : applyCommand(text, row.label)
    placeCursor(next.cursor)
    onTextChange(next.text)
    saveDraftText(draftKey, next.text)
    areaRef.current?.focus()
  }

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
    const bar = barRef.current
    const chat = bar?.parentElement
    if (!bar || !chat)
      return
    const sync = () => chat.style.setProperty('--composer-h', `${bar.offsetHeight}px`)
    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(bar)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    const input = areaRef.current
    const box = boxRef.current
    const wide = styles.wide
    if (!box || !wide)
      return
    if (!input || images.length > 0) {
      box.classList.toggle(wide, images.length > 0)
      return
    }
    // Probe at the single-row width. Measuring the live field would reflow the side buttons.
    const composer = input.parentElement
    if (!composer)
      return
    const controls = [...composer.children].filter((el): el is HTMLElement => el instanceof HTMLElement && el !== input && getComputedStyle(el).display !== 'none')
    const style = getComputedStyle(composer)
    const pad = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight)
    const gap = Number.parseFloat(style.columnGap) || 0
    const taken = controls.reduce((sum, el) => {
      const button = el instanceof HTMLButtonElement ? el : el.querySelector('button')
      return sum + (button?.offsetWidth ?? el.offsetWidth)
    }, 0)
    const narrow = Math.max(40, composer.clientWidth - pad - taken - gap * controls.length)
    const probe = document.createElement('textarea')
    probe.className = input.className
    probe.value = input.value
    probe.setAttribute('aria-hidden', 'true')
    probe.tabIndex = -1
    probe.style.position = 'absolute'
    probe.style.visibility = 'hidden'
    probe.style.pointerEvents = 'none'
    probe.style.width = `${narrow}px`
    probe.style.height = 'auto'
    box.appendChild(probe)
    const overflows = probe.scrollHeight > 32
    probe.remove()
    box.classList.toggle(wide, overflows)
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
        view?.key,
      )
      onTextChange('')
      clearDraft(draftKey)
      if (!view)
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
    if (event.nativeEvent.isComposing || event.key === 'Process')
      return
    if (menuOpen) {
      if (event.key === 'Escape') {
        event.preventDefault()
        setDismissed(true)
        return
      }
      if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && rows.length > 0 && !loading) {
        event.preventDefault()
        setActive((current) => {
          const at = Math.min(current, rows.length - 1)
          return event.key === 'ArrowDown' ? Math.min(rows.length - 1, at + 1) : Math.max(0, at - 1)
        })
        return
      }
      if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
        if (loading || rows.length > 0) {
          event.preventDefault()
          const row = rows[rowIndex]
          if (!loading && row)
            pick(row)
          return
        }
      }
    }
    if (event.key === 'Enter' && !event.shiftKey) {
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
    <div ref={barRef} className={styles.bar} data-floating={floating}>
      <div className={styles.column} data-composer="">
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
          {menuOpen
            ? (
                <div
                  ref={menuRef}
                  className={styles.menu}
                  role="listbox"
                  aria-label={token?.kind === 'at' ? '路径' : '命令'}
                >
                  {loading
                    ? <div className={styles.menuNote} role="status">正在查找</div>
                    : rows.length === 0
                      ? <div className={styles.menuNote}>{token?.kind === 'at' ? '没有匹配的路径' : '没有匹配的命令'}</div>
                      : (
                          <>
                            <span ref={markRef} aria-hidden="true" className={styles.mark} />
                            {rows.map((row, position) => (
                              <button
                                key={row.key}
                                type="button"
                                role="option"
                                aria-selected={position === rowIndex}
                                ref={(element) => {
                                  rowListRef.current[position] = element
                                }}
                                title={row.description ? `${row.label} ${row.description}` : row.label}
                                className={styles.menuRow}
                                onMouseDown={event => event.preventDefault()}
                                onMouseEnter={() => setActive(position)}
                                onClick={() => pick(row)}
                              >
                                <span className={row.description ? styles.menuCommand : styles.menuPath}>{row.label}</span>
                                {row.description ? <span className={styles.menuDesc}>{row.description}</span> : null}
                              </button>
                            ))}
                          </>
                        )}
                </div>
              )
            : null}
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
                setDismissed(false)
                setCursor(event.target.selectionStart ?? event.target.value.length)
              }}
              onSelect={event => setCursor(event.currentTarget.selectionStart ?? 0)}
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
                  <span className={styles.modelSlot}>
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
                  </span>
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

        {hideMeta
          ? null
          : (
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
            )}
      </div>
    </div>
  )
}

interface MenuRow {
  key: string
  label: string
  description: string
}

function menuRows(token: ComposerToken | null, paths: readonly string[], commands: readonly ComposerCommandHit[]): MenuRow[] {
  if (!token)
    return []
  if (token.kind === 'at') {
    return paths.map(path => ({ key: path, label: path, description: '' }))
  }
  return filterCommands(commands, token.query).map(command => ({
    key: `${command.source}:${command.name}`,
    label: command.name,
    description: command.description,
  }))
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

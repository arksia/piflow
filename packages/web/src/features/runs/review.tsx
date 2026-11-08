import type { ReviewDecision, ReviewDetail, ReviewDocumentDetail, ReviewFileDetail, ReviewRouteStep, RunSummary } from '@piflow/protocol'
import { buildReviewsPath } from '@piflow/protocol'
import { ArrowDown, ArrowUp, ArrowUpRight, Check, ChevronRight, FileCode2, GitBranch, GitCompareArrows, Maximize2, MessageSquare, Minimize2, RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import ReactMarkdown from 'react-markdown'
import { markdownRehypePlugins, markdownRemarkPlugins } from '../../markdown/md'
import { api, post } from '../../session/api'
import { decisionLabels, diffRows, reviewGroups } from './review-model'
import { createReviewReader } from './review-reader'
import styles from './review.module.css'

function unique<T>(values: T[]) {
  return [...new Map(values.map(value => [JSON.stringify(value), value]))]
}
interface Props {
  run: RunSummary
  connectionVersion: number
  expanded: boolean
  onExpand: () => void
  onDraft: (text: string) => Promise<void>
  onEvidence: (runId: string, toolCallId: string) => void
}
export default function DeliveryReview({ run, connectionVersion, expanded, onExpand, onDraft, onEvidence }: Props) {
  const [reader] = useState(() => createReviewReader(run.projectPath, run.id))
  const state = useSyncExternalStore(reader.subscribe, reader.getSnapshot)
  const [mode, setMode] = useState<'files' | 'flow'>('files')
  const [selection, setSelection] = useState<{ revision: string, target: string, group: string } | null>(null)
  const [sourceSelection, setSourceSelection] = useState<{ revision: string, id: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const liveRef = useRef(true)
  const detail = state.detail
  const documentId = sourceSelection?.revision === detail?.revision.id ? sourceSelection?.id ?? null : null
  function setDocumentId(id: string | null) {
    setSourceSelection(id && detail ? { revision: detail.revision.id, id } : null)
  }
  useEffect(() => {
    liveRef.current = true
    reader.open()
    return () => {
      liveRef.current = false
      reader.close()
    }
  }, [reader])
  useEffect(() => {
    void reader.refresh()
  }, [reader, run.status, run.deliveryRevision, connectionVersion])
  useEffect(() => {
    if (detail?.generation.state !== 'running')
      return
    const timer = setInterval(() => {
      void reader.refresh()
    }, 2000)
    return () => clearInterval(timer)
  }, [reader, detail?.generation.state])
  const groups = detail ? reviewGroups(detail, mode) : []
  const selectedGroup = selection?.revision === detail?.revision.id ? groups.find(g => g.key === selection?.group) : undefined
  const stepSelected = !!selectedGroup?.step && !selection?.target
  const target = stepSelected ? undefined : detail?.targets.find(t => selection?.revision === detail.revision.id && t.id === selection.target) ?? detail?.targets[0]
  const group = stepSelected ? selectedGroup : groups.find(g => g.key === selectedGroup?.key && g.targetIds.includes(target?.id ?? '')) ?? groups.find(g => g.targetIds.includes(target?.id ?? ''))
  const step = group?.step
  const file = detail?.files.find(f => f.id === target?.fileId)
  const decision = detail?.decisions.find(d => d.targetId === target?.id)
  const reviewed = detail?.targets.filter(t => detail.decisions.some(d => d.targetId === t.id && d.state === 'seen')).length ?? 0
  const requests = detail?.decisions.filter(d => d.state === 'changes-requested').length ?? 0
  async function action(work: () => Promise<unknown>) {
    if (busy)
      return false
    setBusy(true)
    setError(null)
    try {
      await work()
      if (liveRef.current)
        await reader.refresh()
      return true
    }
    catch (reason) {
      if (liveRef.current)
        setError(String(reason))
      return false
    }
    finally {
      if (liveRef.current)
        setBusy(false)
    }
  }
  function endpoint(suffix: string) {
    return `/api/reviews/${encodeURIComponent(detail!.review.id)}${suffix}`
  }
  const body = { projectPath: run.projectPath, revisionId: detail?.revision.id }
  function generate() {
    return action(() => post(endpoint('/generate'), body))
  }
  function changeMode(value: 'files' | 'flow') {
    setMode(value)
    if (value === 'flow' && detail && !detail.route && detail.generation.state !== 'running')
      void generate()
  }
  async function moveStep(index: number, delta: number) {
    if (!detail?.route)
      return
    const route = structuredClone(detail.route.value)
    const item = route.steps.splice(index, 1)[0]!
    route.steps.splice(index + delta, 0, item)
    // Reading order follows the edited list; semantic links retain their meaning.
    route.relations = route.relations.filter(r => r.kind !== 'review-order')
    await action(() => post(endpoint('/route'), { ...body, route }))
  }
  function updateAssociation(kind: 'target' | 'document', id: string, stepKey: string, remove = false) {
    if (!detail?.route)
      return
    const route = structuredClone(detail.route.value)
    const step = route.steps.find(s => s.key === stepKey)!
    if (kind === 'target') {
      step.targets = step.targets.filter(t => t.targetId !== id)
      if (!remove)
        step.targets.push({ targetId: id, reason: '用户关联此变更', reviewFocus: '核对本对象与当前步骤需求的实现关系。' })
    }
    else {
      const doc = detail.documents.find(d => d.id === id)!
      const field = doc.kind === 'requirement' ? 'requirementIds' : doc.kind === 'design' ? 'designSectionIds' : 'adrIds'
      step[field] = step[field].filter(value => value !== id)
      if (!remove)
        step[field].push(id)
    }
    void action(() => post(endpoint('/route'), { ...body, route }))
  }
  function choose(id: string, group: string) {
    if (detail)
      setSelection({ revision: detail.revision.id, target: id, group })
    setDocumentId(null)
  }
  return (
    <section className={styles.review} aria-label="交付代码审查" aria-busy={state.loading}>
      <header className={styles.header}>
        <div>
          <h3>变更审查</h3>
        </div>
        <button type="button" className={styles.iconButton} onClick={onExpand} aria-label={expanded ? '收回审查视图' : '展开审查视图'} title={expanded ? '收回' : '扩大代码阅读空间'}>{expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button>
      </header>
      {state.error || error
        ? (
            <p className={styles.error} role="alert">
              {error ?? state.error}
              <button
                type="button"
                onClick={() => {
                  setError(null)
                  void reader.refresh()
                }}
              >
                重试同步
              </button>
            </p>
          )
        : null}
      {!detail
        ? <p className={styles.notice}>{state.loading ? '正在读取固定版本…' : state.reason ?? '尚无固定源码比较。'}</p>
        : (
            <>
              <div className={styles.toolbar}>
                <div className={styles.switcher} aria-label="组织代码审查">
                  <button type="button" aria-pressed={mode === 'files'} onClick={() => changeMode('files')}>
                    <FileCode2 size={13} />
                    按文件
                  </button>
                  <button type="button" disabled={busy} aria-pressed={mode === 'flow'} onClick={() => changeMode('flow')} title={!detail.route ? '调用当前 Code 模型生成需求审查路线' : '查看需求审查路线'}>
                    <GitBranch size={13} />
                    {!detail.route && detail.generation.state !== 'running' ? '按功能 · 生成路线' : '按功能'}
                  </button>
                </div>
                <span className={styles.count}>
                  {reviewed}
                  {' '}
                  /
                  {' '}
                  {detail.targets.length}
                  {' '}
                  已看
                </span>
              </div>
              <div className={styles.revision}>
                <span className={styles.fixedDot} />
                固定版本
                <select
                  aria-label="审查修订"
                  value={detail.revision.id}
                  onChange={(event) => {
                    setDocumentId(null)
                    void reader.selectRevision(event.target.value)
                  }}
                >
                  {detail.revisions.map((r, i) => (
                    <option key={r.id} value={r.id}>
                      {i === 0 ? '最新' : '历史'}
                      {' '}
                      ·
                      {' '}
                      {new Date(r.createdAt).toLocaleString()}
                      {' '}
                      ·
                      {' '}
                      {r.fileCount}
                      {' '}
                      文件
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className={styles.iconButton}
                  disabled={busy}
                  aria-label="采集当前源码为新修订"
                  title="更新源码比较；有变化时需要重新审查"
                  onClick={() => void action(async () => {
                    await post(endpoint('/refresh-source'), { projectPath: run.projectPath })
                    await reader.selectRevision()
                  })}
                >
                  <GitCompareArrows size={13} />
                </button>
                <button type="button" className={styles.iconButton} aria-label="同步审查状态" disabled={state.loading} onClick={() => void reader.refresh()}><RefreshCw size={12} /></button>
              </div>
              {detail.revision.comparison
                ? (
                    <details className={styles.sources}>
                      <summary>比较范围与版本</summary>
                      <p>
                        起点：
                        {detail.revision.comparison.base.kind === 'commit' ? '固定提交' : '运行前工作区'}
                        {' '}
                        ·
                        {detail.revision.comparison.base.head?.slice(0, 12) ?? '尚无提交'}
                        {' '}
                        ·
                        {new Date(detail.revision.comparison.base.capturedAt).toLocaleString()}
                      </p>
                      <p>
                        终点：
                        {detail.revision.comparison.target.kind === 'commit' ? '固定提交' : '工作区采样'}
                        {' '}
                        ·
                        {detail.revision.comparison.target.head?.slice(0, 12) ?? '尚无提交'}
                        {' '}
                        ·
                        {new Date(detail.revision.comparison.target.capturedAt).toLocaleString()}
                      </p>
                      <p>工作区采集包含当时的脏文件、已暂存和未跟踪文本；采样不是原子事务，不提供作者归因。</p>
                    </details>
                  )
                : null}
              {detail.revision.id !== detail.review.revisionId
                ? (
                    <p className={styles.notice}>
                      正在回看历史修订；意见仅属于此版本。
                      <button type="button" onClick={() => void reader.selectRevision()}>查看最新</button>
                    </p>
                  )
                : null}
              {mode === 'flow' ? <RouteStatus detail={detail} busy={busy} onGenerate={() => void generate()} onCancel={() => void action(() => post(endpoint('/cancel'), body))} /> : null}
              <div className={styles.workspace}>
                <nav className={styles.navigation} aria-label={mode === 'flow' ? '功能审查路线' : '变更文件'}>
                  {groups.map((g, index) => (
                    <div className={styles.group} key={g.key}>
                      <div className={styles.groupHeading}>
                        <span className={styles.ordinal}>{String(index + 1).padStart(2, '0')}</span>
                        {g.step
                          ? <button type="button" className={styles.stepButton} aria-current={stepSelected && group?.key === g.key ? 'location' : undefined} onClick={() => choose('', g.key)}>{g.title}</button>
                          : <strong title={g.title}>{g.title}</strong>}
                        {g.step
                          ? (
                              <span className={styles.reorder}>
                                <button type="button" disabled={busy || index === 0} aria-label={`上移 ${g.title}`} onClick={() => void moveStep(index, -1)}><ArrowUp size={11} /></button>
                                <button type="button" disabled={busy || index >= detail.route!.value.steps.length - 1} aria-label={`下移 ${g.title}`} onClick={() => void moveStep(index, 1)}><ArrowDown size={11} /></button>
                              </span>
                            )
                          : null}
                      </div>
                      {g.targetIds.map((id) => {
                        const t = detail.targets.find(t => t.id === id)!
                        const d = detail.decisions.find(d => d.targetId === id)
                        return (
                          <button type="button" key={id} className={styles.target} aria-current={target?.id === id && group?.key === g.key ? 'location' : undefined} onClick={() => choose(id, g.key)}>
                            <span className={styles.targetMark} data-state={d?.state ?? 'unread'}>{d?.state === 'seen' ? <Check size={11} /> : d?.state === 'changes-requested' ? <MessageSquare size={10} /> : <ChevronRight size={11} />}</span>
                            <span>
                              <code>{t.name}</code>
                              {mode === 'flow' ? <small>{detail.files.find(f => f.id === t.fileId)?.path}</small> : null}
                            </span>
                            <span className={styles.srOnly}>{decisionLabels[d?.state ?? 'unread']}</span>
                          </button>
                        )
                      })}
                      {!g.targetIds.length ? <p className={styles.notice}>此步骤未关联代码变更。</p> : null}
                    </div>
                  ))}
                  {!groups.length ? <p className={styles.notice}>本修订没有可展示的文本变更。</p> : null}
                  <details className={styles.gaps}>
                    <summary>
                      范围与缺口 ·
                      {detail.gaps.length + (detail.route?.value.gaps.length ?? 0)}
                    </summary>
                    <p>工作区采样不提供作者归因。未归类不等于未看，已看不代表可合并。</p>
                    {detail.gaps.map(g => (
                      <p key={g.id}>
                        <strong>宿主记录</strong>
                        {' '}
                        {g.path ? `${g.path}：` : ''}
                        {g.explanation}
                      </p>
                    ))}
                    {unique(detail.route?.value.gaps ?? []).map(([key, g]) => (
                      <p key={key}>
                        <strong>Agent 建议</strong>
                        {' '}
                        {g.explanation}
                      </p>
                    ))}
                    <p>
                      {detail.unassignedHunkIds.length}
                      {' '}
                      个 diff 块仍有未归类对象。
                    </p>
                    <details>
                      <summary>携带或恢复路线意图</summary>
                      <p>可将导出的文件保存到 .piflow/reviews/ 并提交。导入后重新定位引用，人工已看状态与执行证据不会从文件继承。</p>
                      {detail.route ? <a href={buildReviewsPath(run.projectPath, `/${encodeURIComponent(detail.review.id)}/intent`, { revisionId: detail.revision.id })} download="review-route.json">导出路线意图</a> : null}
                      <label>
                        导入路线意图
                        <input
                          type="file"
                          accept="application/json,.json"
                          disabled={busy}
                          onChange={(event) => {
                            const file = event.target.files?.[0]
                            event.target.value = ''
                            if (file) {
                              void action(async () => {
                                if (file.size > 128 * 1024)
                                  throw new Error('路线意图超过 128 KiB。')
                                await post(endpoint('/intent'), { ...body, intent: JSON.parse(await file.text()) })
                              })
                            }
                          }}
                        />
                      </label>
                    </details>
                    <details>
                      <summary>管理本机源码副本</summary>
                      <p>删除会移除这份审查的固定源码、路线及人工意见；原 Run 的执行记录保留。</p>
                      <button type="button" disabled={busy || detail.generation.state === 'running'} onClick={() => void action(() => post(endpoint('/remove'), { projectPath: run.projectPath }))}>删除本次审查与源码副本</button>
                    </details>
                  </details>
                </nav>
                <div className={styles.focus}>
                  {target && file
                    ? (
                        <>
                          <div className={styles.focusHeader}>
                            <code title={file.path}>{file.path}</code>
                            <span>
                              <b>
                                +
                                {file.added}
                              </b>
                              {' '}
                              <i>
                                −
                                {file.removed}
                              </i>
                            </span>
                          </div>
                          <div className={styles.targetHeader}>
                            <h4>{target.name}</h4>
                            <span className={styles.status} data-state={decision?.state ?? 'unread'}>{decisionLabels[decision?.state ?? 'unread']}</span>
                          </div>
                          {step
                            ? <StepContext detail={detail} step={step} targetId={target.id} onDocument={setDocumentId} onEvidence={onEvidence} />
                            : (
                                <p className={styles.hint}>
                                  固定起点与交付版本的真实 diff ·
                                  {target.kind === 'function' ? '函数相关块，保留邻近上下文' : '文件级变更'}
                                </p>
                              )}
                          {mode === 'flow' && detail.route
                            ? (
                                <details className={styles.sources}>
                                  <summary>调整路线关联</summary>
                                  <label>
                                    添加到步骤
                                    <select
                                      aria-label="将当前对象关联到步骤"
                                      value=""
                                      disabled={busy}
                                      onChange={(event) => {
                                        if (event.target.value)
                                          updateAssociation('target', target.id, event.target.value)
                                      }}
                                    >
                                      <option value="">选择功能步骤…</option>
                                      {detail.route.value.steps.map(s => <option key={s.key} value={s.key}>{s.title}</option>)}
                                    </select>
                                  </label>
                                  {step ? <button type="button" disabled={busy} onClick={() => updateAssociation('target', target.id, step.key, true)}>移出当前步骤</button> : null}
                                </details>
                              )
                            : null}
                          <details className={styles.sources}>
                            <summary>
                              需求 / 方案 / ADR ·
                              {detail.documents.length}
                              {' '}
                              份章节
                            </summary>
                            <DocumentLinks detail={detail} ids={detail.documents.map(d => d.id)} onSelect={setDocumentId} />
                          </details>
                          {documentId ? <DocumentPreview key={`document:${detail.revision.id}:${documentId}`} projectPath={run.projectPath} reviewId={detail.review.id} revisionId={detail.revision.id} documentId={documentId} association={step ? { linked: [...step.requirementIds, ...step.designSectionIds, ...step.adrIds].includes(documentId), busy, toggle: () => updateAssociation('document', documentId, step.key, [...step.requirementIds, ...step.designSectionIds, ...step.adrIds].includes(documentId)) } : undefined} onClose={() => setDocumentId(null)} /> : null}
                          <FixedDiff key={`diff:${detail.revision.id}:${target.id}`} projectPath={run.projectPath} reviewId={detail.review.id} revisionId={detail.revision.id} fileId={file.id} hunkIds={target.hunkIds} />
                          <ScopeEditor key={`scope:${detail.revision.id}:${target.id}`} reasons={[...new Set((detail.exclusions ?? []).filter(e => target.hunkIds.includes(e.hunkId)).map(e => e.reason))]} busy={busy} onSave={reason => action(() => post(endpoint('/scope'), { ...body, hunkIds: target.hunkIds, reason }))} />
                          <DecisionEditor key={`decision:${detail.revision.id}:${target.id}`} decision={decision} busy={busy} onSave={(state, note) => action(() => post(endpoint('/decisions'), { ...body, targetId: target.id, state, note }))} />
                        </>
                      )
                    : step
                      ? (
                          <>
                            <div className={styles.targetHeader}><h4>{step.title}</h4></div>
                            <StepContext detail={detail} step={step} onDocument={setDocumentId} onEvidence={onEvidence} />
                            {!step.targets.length ? <p className={styles.notice}>此步骤仅提供文档与审查上下文，没有关联代码变更。</p> : null}
                            <details className={styles.sources}>
                              <summary>全部需求 / 方案 / ADR</summary>
                              <DocumentLinks detail={detail} ids={detail.documents.map(d => d.id)} onSelect={setDocumentId} />
                            </details>
                            {documentId ? <DocumentPreview key={`document:${detail.revision.id}:${documentId}`} projectPath={run.projectPath} reviewId={detail.review.id} revisionId={detail.revision.id} documentId={documentId} association={{ linked: [...step.requirementIds, ...step.designSectionIds, ...step.adrIds].includes(documentId), busy, toggle: () => updateAssociation('document', documentId, step.key, [...step.requirementIds, ...step.designSectionIds, ...step.adrIds].includes(documentId)) }} onClose={() => setDocumentId(null)} /> : null}
                          </>
                        )
                      : (
                          <div className={styles.noSelection}>
                            <FileCode2 size={25} />
                            <p>选择一个变更，开始审查。</p>
                          </div>
                        )}
                </div>
              </div>
              <footer className={styles.footer}>
                <span>
                  {detail.files.length}
                  {' '}
                  个文件 ·
                  {' '}
                  {requests}
                  {' '}
                  项需修改
                </span>
                <button
                  type="button"
                  disabled={busy || !requests}
                  onClick={() => void action(async () => {
                    const draft = await api<{ text: string }>(buildReviewsPath(run.projectPath, `/${encodeURIComponent(detail.review.id)}/draft`, { revisionId: detail.revision.id }))
                    await onDraft(draft.text)
                  })}
                >
                  <ArrowUpRight size={13} />
                  汇总返工意见到输入框
                </button>
              </footer>
            </>
          )}
    </section>
  )
}
function RouteStatus({ detail, busy, onGenerate, onCancel }: { detail: ReviewDetail, busy: boolean, onGenerate: () => void, onCancel: () => void }) {
  return (
    <div className={styles.routeStatus} role="status">
      <span className={styles.eyebrow}>{detail.route?.source === 'user' ? '用户调整' : 'AGENT 建议'}</span>
      {detail.generation.state === 'running'
        ? (
            <>
              <span>正在分析固定代码和文档… 文件审查仍可使用。</span>
              <button type="button" disabled={busy} onClick={onCancel}>取消生成</button>
            </>
          )
        : (
            <>
              <span>{detail.generation.error ?? detail.route?.value.summary ?? '尚无路线。生成需要调用当前 Code 模型。'}</span>
              <button type="button" disabled={busy} onClick={onGenerate}>{detail.route ? '重新生成' : '生成路线'}</button>
            </>
          )}
    </div>
  )
}
function DocumentLinks({ detail, ids, onSelect }: { detail: ReviewDetail, ids: string[], onSelect: (id: string) => void }) {
  return (
    <div className={styles.citations}>
      {[...new Set(ids)].map((id) => {
        const d = detail.documents.find(d => d.id === id)!
        return (
          <button type="button" key={id} title={`${d.path}#${d.anchor}`} onClick={() => onSelect(id)}>
            <span>{{ requirement: 'PRD', design: '方案', adr: 'ADR' }[d.kind]}</span>
            {d.title}
            {!d.stableAnchor ? ' · 临时锚点' : ''}
          </button>
        )
      })}
    </div>
  )
}
function StepContext({ detail, step, targetId, onDocument, onEvidence }: { detail: ReviewDetail, step: ReviewRouteStep, targetId?: string, onDocument: (id: string) => void, onEvidence: Props['onEvidence'] }) {
  const link = step.targets.find(t => t.targetId === targetId)
  return (
    <div className={styles.stepContext}>
      <span className={styles.eyebrow}>{detail.route?.source === 'user' ? '用户调整的阅读建议' : 'AGENT 阅读建议'}</span>
      <p>{step.purpose}</p>
      {link
        ? (
            <p>
              <strong>{link.reason}</strong>
              <br />
              关注：
              {link.reviewFocus}
            </p>
          )
        : null}
      <DocumentLinks detail={detail} ids={[...step.requirementIds, ...step.designSectionIds, ...step.adrIds]} onSelect={onDocument} />
      {step.evidenceIds.map((id) => {
        const e = detail.evidence.find(e => e.id === id)
        if (!e)
          return <p key={id} className={styles.notice}>此命令引用未采集，无法回看原执行事实。</p>
        return (
          <button type="button" className={styles.evidence} key={id} onClick={() => onEvidence(e.runId, e.toolCallId)}>
            <ArrowUpRight size={12} />
            <code>{e.name}</code>
            <span>
              {e.exitCode === null ? '退出未知' : `退出 ${e.exitCode}`}
              {' '}
              · 对应源码版本未知
            </span>
          </button>
        )
      })}
      {unique(detail.route?.value.relations.filter(r => r.from === step.key || r.to === step.key) ?? []).map(([key, r]) => (
        <p className={styles.hint} key={key}>
          {r.kind === 'review-order' ? '阅读顺序' : `建议关系 · ${r.kind}`}
          ：
          {r.explanation}
        </p>
      ))}
    </div>
  )
}
function FixedDiff({ projectPath, reviewId, revisionId, fileId, hunkIds }: { projectPath: string, reviewId: string, revisionId: string, fileId: string, hunkIds: string[] }) {
  const [state, setState] = useState<{ detail?: ReviewFileDetail, error?: string }>({})
  const [retry, setRetry] = useState(0)
  const [limit, setLimit] = useState(500)
  useEffect(() => {
    let current = true
    const controller = new AbortController()
    void api<ReviewFileDetail>(buildReviewsPath(projectPath, `/${encodeURIComponent(reviewId)}/files/${encodeURIComponent(fileId)}`, { revisionId }), { signal: controller.signal }).then((detail) => {
      if (current && detail.revisionId === revisionId && detail.file.id === fileId)
        setState({ detail })
    }).catch((error) => {
      if (current)
        setState({ error: String(error) })
    })
    return () => {
      current = false
      controller.abort()
    }
  }, [projectPath, reviewId, revisionId, fileId, retry])
  const rows = diffRows(state.detail?.hunks.filter(h => hunkIds.includes(h.id)) ?? [])
  return (
    <div className={styles.diff} aria-label="固定版本代码差异">
      {state.error
        ? (
            <p className={styles.error}>
              {state.error}
              <button type="button" onClick={() => setRetry(v => v + 1)}>重试正文</button>
            </p>
          )
        : !state.detail
            ? <p className={styles.notice}>正在读取固定 diff…</p>
            : (
                <>
                  <div className={styles.diffScroll} tabIndex={0}>
                    <table>
                      <thead className={styles.srOnly}>
                        <tr>
                          <th>原行号</th>
                          <th>新行号</th>
                          <th>代码差异</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.slice(0, limit).map(row => (
                          <tr key={row.key} className={styles[row.kind]}>
                            <td>{row.old}</td>
                            <td>{row.next}</td>
                            <td><code>{row.text}</code></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {rows.length > limit
                    ? (
                        <button type="button" className={styles.more} onClick={() => setLimit(n => n + 500)}>
                          继续显示 diff ·
                          {limit}
                          {' '}
                          /
                          {rows.length}
                          {' '}
                          行
                        </button>
                      )
                    : null}
                </>
              )}
    </div>
  )
}
function DocumentPreview({ projectPath, reviewId, revisionId, documentId, onClose, association }: { projectPath: string, reviewId: string, revisionId: string, documentId: string, onClose: () => void, association?: { linked: boolean, busy: boolean, toggle: () => void } }) {
  const [state, setState] = useState<{ detail?: ReviewDocumentDetail, error?: string }>({})
  useEffect(() => {
    let current = true
    const controller = new AbortController()
    void api<ReviewDocumentDetail>(buildReviewsPath(projectPath, `/${encodeURIComponent(reviewId)}/documents/${encodeURIComponent(documentId)}`, { revisionId }), { signal: controller.signal }).then((detail) => {
      if (current && detail.revisionId === revisionId && detail.document.id === documentId)
        setState({ detail })
    }).catch((error) => {
      if (current)
        setState({ error: String(error) })
    })
    return () => {
      current = false
      controller.abort()
    }
  }, [projectPath, reviewId, revisionId, documentId])
  return (
    <aside className={styles.document} aria-label="固定文档依据">
      <div className={styles.documentHeader}>
        <span>
          {state.detail?.document.path ?? '文档依据'}
          {' '}
          · 固定版本
        </span>
        {association ? <button type="button" disabled={association.busy} onClick={association.toggle}>{association.linked ? '移出当前步骤依据' : '关联到当前步骤'}</button> : null}
        <button type="button" onClick={onClose}>收起</button>
      </div>
      {state.error ? <p className={styles.error}>{state.error}</p> : state.detail ? <div className={styles.documentBody}><ReactMarkdown remarkPlugins={markdownRemarkPlugins} rehypePlugins={markdownRehypePlugins}>{state.detail.text}</ReactMarkdown></div> : <p>正在读取…</p>}
    </aside>
  )
}
function DecisionEditor({ decision, busy, onSave }: { decision?: ReviewDecision, busy: boolean, onSave: (state: ReviewDecision['state'], note: string) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false)
  const [note, setNote] = useState(decision?.note ?? '')
  const editRef = useRef<HTMLButtonElement>(null)
  return (
    <div className={styles.decision}>
      <div className={styles.decisionActions}>
        <button type="button" aria-disabled={busy} aria-pressed={decision?.state === 'seen'} onClick={() => !busy && void onSave(decision?.state === 'seen' ? 'unread' : 'seen', decision?.note ?? '')}>
          <Check size={13} />
          已看
        </button>
        <button
          type="button"
          ref={editRef}
          aria-disabled={busy}
          aria-expanded={editing}
          onClick={() => {
            if (busy)
              return
            setNote(decision?.note ?? '')
            setEditing(!editing)
          }}
        >
          <MessageSquare size={13} />
          {decision?.note ? '编辑意见' : '需要修改'}
        </button>
        <button type="button" aria-disabled={busy} aria-pressed={decision?.state === 'skipped'} onClick={() => !busy && void onSave(decision?.state === 'skipped' ? 'unread' : 'skipped', decision?.note ?? '')}>略过</button>
      </div>
      {decision?.note && !editing
        ? (
            <div className={styles.savedNote}>
              <span>你的意见</span>
              <p>{decision.note}</p>
            </div>
          )
        : null}
      {editing
        ? (
            <form onSubmit={(event) => {
              event.preventDefault()
              void onSave('changes-requested', note).then((saved) => {
                if (saved) {
                  setEditing(false)
                  editRef.current?.focus({ preventScroll: true })
                }
              })
            }}
            >
              <label>
                返工意见
                <textarea autoFocus value={note} maxLength={8000} onChange={event => setNote(event.target.value)} placeholder="说明哪里需要修改、预期是什么…" />
              </label>
              <div>
                <button type="button" disabled={busy} onClick={() => setEditing(false)}>取消</button>
                <button type="submit" disabled={busy || !note.trim()}>保存需修改</button>
              </div>
            </form>
          )
        : null}
    </div>
  )
}

function ScopeEditor({ reasons, busy, onSave }: { reasons: string[], busy: boolean, onSave: (reason: string | null) => Promise<boolean> }) {
  const [reason, setReason] = useState('')
  return (
    <details className={styles.sources}>
      <summary>{reasons.length ? '此对象有明确排除的 diff 块' : '调整本次审查范围'}</summary>
      <p>排除按 diff 块记录，共享块会影响其中其他对象。排除后仍可查看，不会标记为已看。</p>
      {reasons.map(r => (
        <p key={r}>
          排除理由：
          {r}
        </p>
      ))}
      {reasons.length
        ? <button type="button" disabled={busy} onClick={() => void onSave(null)}>恢复到审查范围</button>
        : (
            <form onSubmit={(event) => {
              event.preventDefault()
              void onSave(reason)
            }}
            >
              <label>
                排除理由
                <input aria-label="排除理由" value={reason} maxLength={2000} onChange={event => setReason(event.target.value)} placeholder="例如：这份独立样式调整不属于当前需求" />
              </label>
              <button type="submit" disabled={busy || !reason.trim()}>明确排除相关 diff 块</button>
            </form>
          )}
    </details>
  )
}

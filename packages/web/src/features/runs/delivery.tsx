import type { GitWorkspaceSnapshot, RunSummary } from '@piflow/protocol'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { createDeliveryReader } from './delivery-reader'
import deliveryStyles from './delivery.module.css'
import DeliveryReview from './review'
import baseStyles from './styles.module.css'
import ToolStep from './tool-step'

const styles = { ...baseStyles, ...deliveryStyles }

function distinct<T>(items: T[]) {
  return [...new Map(items.map(item => [JSON.stringify(item), item])).entries()]
}
const outcomeLabels = { completed: '声明完成', partial: '部分完成', blocked: '遇到阻塞' }
const claimLabels = { 'passed': '声明通过', 'failed': '声明失败', 'not-run': '声明未执行', 'unknown': '尚不确定' }
export default function RunDeliveryView({ run, connectionVersion, now, expanded, onExpand, onDraft, onEvidence }: { run: RunSummary, connectionVersion: number, now: number, expanded: boolean, onExpand: () => void, onDraft: (text: string) => Promise<void>, onEvidence: (runId: string, toolCallId: string) => void }) {
  const [reader] = useState(() => createDeliveryReader(run.projectPath, run.id))
  const state = useSyncExternalStore(reader.subscribe, reader.getSnapshot)
  const [openTool, setOpenTool] = useState<string | null>(null)
  useEffect(() => {
    reader.open()
    return () => reader.close()
  }, [reader])
  useEffect(() => {
    void reader.refresh(run.deliveryRevision ?? 0)
  }, [reader, run.deliveryRevision, connectionVersion])
  const record = state.detail?.record
  const report = record?.declaration
  const commands = Object.values(state.commands).sort((a, b) => a.sequence - b.sequence)
  const counts = state.detail?.commands
  return (
    <div className={styles.delivery} aria-label="Code 交付事实" aria-busy={state.loading}>
      {state.error
        ? (
            <p className={styles.error} role="alert">
              {state.error}
              <button type="button" onClick={() => void reader.refresh(run.deliveryRevision ?? 0)}>重试读取交付</button>
            </p>
          )
        : null}
      {!state.detail && !state.error ? <p className={styles.muted}>正在读取交付证据…</p> : null}
      {state.detail && state.detail.availability !== 'recorded' ? <p className={styles.muted}>此运行未采集 Code 交付证据。</p> : null}
      <section className={styles.deliverySection}>
        {report
          ? (
              <>
                <p className={styles.deliverySummary}>
                  <small className={styles.muted}>Agent 声明 · </small>
                  {report.value.summary}
                </p>
                <details className={styles.evidenceDisclosure}>
                  <summary>Agent 交付说明与产物</summary>
                  <span className={styles.declarationOutcome}>{outcomeLabels[report.value.outcome]}</span>

                  {report.value.changes.length
                    ? <ul className={styles.deliveryItems}>{distinct(report.value.changes).map(([key, change]) => <li key={key}>{change}</li>)}</ul>
                    : null}
                  {report.value.unresolved.length
                    ? (
                        <div className={styles.unresolved}>
                          <strong>未解决事项</strong>
                          <ul className={styles.deliveryItems}>{distinct(report.value.unresolved).map(([key, issue]) => <li key={key}>{issue}</li>)}</ul>
                        </div>
                      )
                    : <p className={styles.muted}>Agent 未列出未解决事项。</p>}
                  {report.value.artifacts.length
                    ? (
                        <details className={styles.evidenceDisclosure}>
                          <summary>
                            声明的产物 ·
                            {report.value.artifacts.length}
                          </summary>
                          <p className={styles.muted}>路径由 Agent 提供，尚未核验文件。</p>
                          <ul className={styles.deliveryItems}>
                            {distinct(report.value.artifacts).map(([key, artifact]) => (
                              <li key={key}>
                                <code>{artifact.path}</code>
                                <br />
                                {artifact.description}
                              </li>
                            ))}
                          </ul>
                        </details>
                      )
                    : null}
                  {report.subsequentToolActivity ? <p className={styles.warning}>交付声明提交后仍有工具活动，请结合后续记录判断。</p> : null}
                  {report.value.checks.length
                    ? (
                        <details className={styles.evidenceDisclosure}>
                          <summary>检查说明 · Agent 声明</summary>
                          {distinct(report.value.checks).map(([key, check]) => (
                            <div className={styles.checkClaim} key={key}>
                              <strong>{check.name}</strong>
                              <span>{claimLabels[check.claimedStatus]}</span>
                              {check.note ? <p>{check.note}</p> : null}
                              {!check.toolCallIds.length
                                ? <small>未关联执行证据</small>
                                : [...new Set(check.toolCallIds)].map((id) => {
                                    const reference = state.detail?.checkReferences.find(reference => reference.toolCallId === id)
                                    return <small key={id}>{reference?.linked ? `${id} · ${reference.exitCode === null ? '退出码未知' : `退出 ${reference.exitCode}`}` : `${id} · 未关联本次 bash 证据`}</small>
                                  })}
                            </div>
                          ))}
                        </details>
                      )
                    : null}
                </details>
              </>
            )
          : state.detail ? <p className={styles.muted}>{run.status === 'running' ? '尚未提交交付说明。' : '未提交结构化交付说明；执行完成不代表交付已核验。'}</p> : null}
        {record?.lastDeclarationError ? <p className={styles.warning}>{record.lastDeclarationError}</p> : null}
      </section>
      <DeliveryReview run={run} connectionVersion={connectionVersion} expanded={expanded} onExpand={onExpand} onDraft={onDraft} onEvidence={onEvidence} />
      <details className={styles.deliverySection}>
        <summary>执行证据与检查声明</summary>
        <h3>
          实际执行记录
          <small>宿主记录</small>
        </h3>
        <p className={styles.muted}>退出码描述命令的整体结果，退出 0 不等于测试全部通过。</p>
        {counts
          ? (
              <div className={styles.commandCounts}>
                <span>
                  {counts.total}
                  {' '}
                  条命令
                </span>
                {counts.nonzero
                  ? (
                      <span className={styles.failed}>
                        {counts.nonzero}
                        {' '}
                        条非零退出
                      </span>
                    )
                  : null}
                {counts.unknown
                  ? (
                      <span>
                        {counts.unknown}
                        {' '}
                        条退出码未知
                      </span>
                    )
                  : null}
              </div>
            )
          : null}
        {!commands.length && state.detail ? <p className={styles.muted}>没有记录到命令执行。</p> : null}
        {commands.map(command => <ToolStep key={command.toolCallId} tool={command} commandLabel={`${command.commandPreview ?? '命令参数未记录'}${command.commandTruncated ? ' · 已截断' : ''}`} projectPath={run.projectPath} runId={run.id} open={openTool === command.toolCallId} onToggle={() => setOpenTool(openTool === command.toolCallId ? null : command.toolCallId)} connectionVersion={connectionVersion} now={now} />)}
        {counts?.total
          ? (
              <p className={styles.muted}>
                已加载
                {commands.length}
                {' '}
                / 共
                {counts.total}
                {' '}
                条
              </p>
            )
          : null}
        {state.nextCursor ? <button type="button" className={styles.action} disabled={state.loading} onClick={() => void reader.more()}>{state.loading ? '正在加载…' : '加载后续命令'}</button> : null}
        {state.detail?.processExit
          ? (
              <p className={styles.processExit}>
                子 Agent 进程：
                {state.detail.processExit.exitCode === null ? '退出码未知' : `退出 ${state.detail.processExit.exitCode}`}
                {state.detail.processExit.signal ? ` · ${state.detail.processExit.signal}` : ''}
              </p>
            )
          : null}
      </details>
      <details className={styles.deliverySection}>
        <summary>Git 来源与采样范围</summary>
        <h3>
          工作区观察
          <small>宿主 Git 采样</small>
        </h3>
        <p className={styles.muted}>共享工作区快照，不提供改动作者归因。</p>
        {record?.before.state === 'recorded' && record.before.files.length ? <p className={styles.warning}>运行前已有工作区改动，以下文件状态包含这些既有改动。</p> : null}
        {record?.concurrentRunIds.length
          ? (
              <p className={styles.warning}>
                观察到
                {record.concurrentRunIds.length}
                {record.concurrentRunIdsTruncated ? '+' : ''}
                {' '}
                个重叠运行；外部写入也可能影响快照。
              </p>
            )
          : null}
        {record
          ? (
              <>
                <WorkspaceSnapshot label="运行前" snapshot={record.before} />
                <WorkspaceSnapshot label="运行后" snapshot={record.after} />
              </>
            )
          : null}
      </details>
    </div>
  )
}
function WorkspaceSnapshot({ label, snapshot }: { label: string, snapshot: GitWorkspaceSnapshot }) {
  if (snapshot.state !== 'recorded') {
    return (
      <p className={styles.muted}>
        {label}
        ：
        {snapshot.state === 'pending' ? '等待采集' : snapshot.state === 'not-captured' ? '未采集' : '不可用'}
        {snapshot.reason ? ` · ${snapshot.reason}` : ''}
      </p>
    )
  }
  return (
    <details className={styles.evidenceDisclosure}>
      <summary>
        {label}
        <span>{snapshot.files.length ? `${snapshot.files.length}${snapshot.filesTruncated ? '+' : ''} 条文件状态` : '工作区干净'}</span>
      </summary>
      <p className={styles.muted}>
        {new Date(snapshot.startedAt).toLocaleString()}
        {' 至 '}
        {new Date(snapshot.capturedAt).toLocaleTimeString()}
        <br />
        {snapshot.branch ?? 'detached HEAD'}
        {' '}
        ·
        {' '}
        {snapshot.head?.slice(0, 12) ?? '尚无提交'}
      </p>
      <code className={styles.workspaceRoot}>{snapshot.root}</code>
      {snapshot.files.length
        ? (
            <ul className={styles.fileStates}>
              {snapshot.files.map(file => (
                <li key={file.path}>
                  <span className={styles.fileStatus}>
                    {file.index}
                    {file.worktree}
                  </span>
                  <code>
                    {file.originalPath ? `${file.originalPath} → ` : ''}
                    {file.path}
                  </code>
                </li>
              ))}
            </ul>
          )
        : null}
      {snapshot.filesTruncated ? <p className={styles.muted}>文件列表超过上限，仅保留前 200 项。</p> : null}
      <details className={styles.evidenceDisclosure}>
        <summary>Diff 统计</summary>
        <h4>
          已暂存
          {snapshot.stagedStatTruncated ? ' · 已截断' : ''}
        </h4>
        <pre className={styles.output}>{snapshot.stagedStat || '无统计；未跟踪文件不包含在 diff 中。'}</pre>
        <h4>
          未暂存
          {snapshot.unstagedStatTruncated ? ' · 已截断' : ''}
        </h4>
        <pre className={styles.output}>{snapshot.unstagedStat || '无统计；未跟踪文件不包含在 diff 中。'}</pre>
      </details>
    </details>
  )
}

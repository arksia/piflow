import type { RunOutputChunk, RunSummary } from '@piflow/protocol'
import { buildRunsPath } from '@piflow/protocol'
import { useEffect, useRef, useState } from 'react'
import { api } from '../../session/api'
import { mergeOutput } from './cache'
import styles from './styles.module.css'

export default function RunOutput({ run, connectionVersion }: { run: RunSummary, connectionVersion: number }) {
  const [output, setOutput] = useState<RunOutputChunk | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const outputRef = useRef<RunOutputChunk | null>(null)
  const requestRef = useRef({ busy: false, pending: false, generation: 0, active: false })
  useEffect(() => {
    const request = requestRef.current
    request.active = true
    request.generation++
    return () => {
      request.active = false
      request.generation++
    }
  }, [])
  useEffect(() => {
    const request = requestRef.current
    request.pending = true
    if (request.busy)
      return
    request.busy = true
    async function read() {
      try {
        while (request.active && request.pending) {
          request.pending = false
          const generation = request.generation
          const previous = outputRef.current
          let value: RunOutputChunk
          try {
            value = await api<RunOutputChunk>(buildRunsPath(run.projectPath, `/${encodeURIComponent(run.id)}/output`, { version: previous?.version, after: previous?.endOffset }))
          }
          catch (reason) {
            if (!request.active || generation !== request.generation)
              continue
            throw reason
          }
          if (!request.active || generation !== request.generation)
            continue
          const merged = mergeOutput(outputRef.current, value)
          outputRef.current = merged
          setOutput(merged)
          setError(null)
        }
      }
      catch (reason) {
        if (request.active)
          setError(`输出同步失败：${String(reason)}`)
      }
      finally { request.busy = false }
    }
    void read()
  }, [run.projectPath, run.id, run.outputRevision, connectionVersion, retry])
  return (
    <>
      <h3>执行输出</h3>
      {error
        ? (
            <p className={styles.error} role="alert">
              {error}
              <button type="button" onClick={() => setRetry(value => value + 1)}>重试</button>
            </p>
          )
        : null}
      {output?.truncated ? <p className={styles.warning}>输出较长，仅保留最近 160000 字符。</p> : null}
      <pre className={styles.output}>{output?.text || '暂无文本输出。'}</pre>
    </>
  )
}

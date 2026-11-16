import type { EvidenceTarget, RunDetail } from '@piflow/protocol'
import { buildRunsPath } from '@piflow/protocol'
import Dialog from '../../components/Dialog'
import { api } from '../../session/api'
import { draftToSession } from '../runs/draft'
import DeliveryReview from '../runs/review'
import { getRunsConnection } from '../runs/store'
import styles from './styles.module.css'

/** The same fixed-comparison reader used inside Run delivery, in one evidence shell. */
export default function FlowReview({ projectPath, target, onClose, onShowChat, onEvidence }: {
  projectPath: string
  target: Extract<EvidenceTarget, { kind: 'review' }>
  onClose: () => void
  onShowChat: () => void
  onEvidence: (target: EvidenceTarget) => void
}) {
  return (
    <Dialog title="交付代码审查" width={1240} maxHeight={820} responsive compact onClose={onClose}>
      <div className={styles.evidenceReader}>
        <DeliveryReview
          reference={{ ...target, projectPath }}
          expanded
          connectionVersion={getRunsConnection().version}
          onEvidence={runId => onEvidence({ kind: 'run', runId, tab: 'steps' })}
          onDraft={async (text, runId) => {
            if (!runId)
              throw new Error('此修订没有来源运行，无法定位返工会话。')
            const source = await api<RunDetail>(buildRunsPath(projectPath, `/${encodeURIComponent(runId)}`))
            if (source.projectPath !== projectPath || source.id !== runId)
              throw new Error('来源运行身份不匹配。')
            await draftToSession(source.parentSessionPath, text)
            onClose()
            onShowChat()
          }}
        />
      </div>
    </Dialog>
  )
}

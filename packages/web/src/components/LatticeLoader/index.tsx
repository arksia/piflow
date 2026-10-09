import styles from './styles.module.css'

type Status = 'working' | 'done' | 'error' | 'needs_input'

const ORBIT = [0, 1, 2, 7, null, 3, 6, 5, 4]
const MARKS: Record<Exclude<Status, 'working'>, number[]> = {
  done: [2, 3, 5, 7],
  error: [0, 2, 4, 6, 8],
  needs_input: [0, 1, 2, 5, 7],
}
const LABEL: Record<Status, string> = {
  working: '运行中',
  done: '已完成',
  error: '失败',
  needs_input: '待回答',
}

export default function LatticeLoader({ status, phase }: { status: Status, phase: string }) {
  const mark = status === 'working' ? 'done' : status
  return (
    <span
      role="status"
      className={styles.root}
      data-status={status}
      data-phase={phase || undefined}
    >
      <span className={styles.grid} aria-hidden="true">
        {/* eslint-disable react/no-array-index-key -- cell index is the grid slot */}
        <span className={`${styles.layer} ${styles.run}`}>
          {ORBIT.map((unit, i) => (
            <span
              key={i}
              className={styles.cell}
              data-hole={unit === null ? '' : undefined}
              style={unit === null ? undefined : { animationDelay: `${unit * 108}ms` }}
            />
          ))}
        </span>
        <span className={`${styles.layer} ${styles.mark}`}>
          {ORBIT.map((_, i) => (
            <span key={i} className={styles.cell} data-on={MARKS[mark].includes(i) ? '' : undefined} />
          ))}
        </span>
        {/* eslint-enable react/no-array-index-key */}
      </span>
      <span className={styles.sr}>{LABEL[status]}</span>
    </span>
  )
}

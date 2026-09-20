import { useRef } from 'react'
import { useTabsPill } from '../../motion'
import styles from './styles.module.css'

interface ViewSwitchProps {
  active: 'chat' | 'flow'
  onChange: (view: 'chat' | 'flow') => void
}

export default function ViewSwitch({ active, onChange }: ViewSwitchProps) {
  const barRef = useRef<HTMLDivElement>(null)
  const pillRef = useTabsPill(barRef, active)

  return (
    <div ref={barRef} className={`t-tabs ${styles.switcher}`} role="tablist" aria-label="工作区视图">
      <span ref={pillRef} className="t-tabs-pill" aria-hidden="true" />
      <button className="t-tab" role="tab" aria-selected={active === 'chat'} onClick={() => onChange('chat')}>聊天</button>
      <button className={`t-tab ${styles.flow}`} role="tab" aria-selected={active === 'flow'} onClick={() => onChange('flow')}>Flow</button>
    </div>
  )
}

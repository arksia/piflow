import { Panel } from '@xyflow/react'
import { Ellipsis, Maximize, Minus, Plus, Scan } from 'lucide-react'
import { useRef } from 'react'
import styles from './styles.module.css'

interface Props {
  zoom: number
  canLocate: boolean
  canArrange: boolean
  canUndo: boolean
  minimap: boolean
  onZoomOut: () => void
  onZoomIn: () => void
  onOverview: () => void
  onLocate: () => void
  onArrange: () => void
  onUndo: () => void
  onMinimap: () => void
}

export default function FlowCanvasTools(props: Props) {
  const menuRef = useRef<HTMLDetailsElement>(null)
  function action(callback: () => void) {
    if (menuRef.current) {
      menuRef.current.open = false
      menuRef.current.querySelector('summary')?.focus()
    }
    callback()
  }
  return (
    <Panel
      position="bottom-left"
      className={styles.canvasTools}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && menuRef.current?.open) {
          event.stopPropagation()
          action(() => {})
        }
        if (event.key === 'Delete' || event.key === 'Backspace')
          event.stopPropagation()
      }}
    >
      <button type="button" aria-label="缩小" onClick={props.onZoomOut}><Minus size={14} /></button>
      <span>
        {Math.round(props.zoom * 100)}
        %
      </span>
      <button type="button" aria-label="放大" onClick={props.onZoomIn}><Plus size={14} /></button>
      <button type="button" aria-label="查看全图" onClick={props.onOverview}><Maximize size={14} /></button>
      <button type="button" aria-label="定位所选" disabled={!props.canLocate} onClick={props.onLocate}><Scan size={14} /></button>
      <details ref={menuRef} className={styles.toolMenu}>
        <summary aria-label="画布工具"><Ellipsis size={16} /></summary>
        <div>
          <button type="button" disabled={!props.canArrange} onClick={() => action(props.onArrange)}>整理布局</button>
          <button type="button" disabled={!props.canUndo} onClick={() => action(props.onUndo)}>撤回本次整理</button>
          <button type="button" aria-pressed={props.minimap} onClick={() => action(props.onMinimap)}>{props.minimap ? '隐藏缩略图' : '显示缩略图'}</button>
        </div>
      </details>
    </Panel>
  )
}

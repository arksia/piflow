import type { ReactNode } from 'react'
import { ChevronRight, Folder, FolderOpen } from 'lucide-react'
import { useId } from 'react'

export function SidebarTreeToggle({ label, open, onToggle }: { label: string, open: boolean, onToggle: () => void }) {
  return (
    <button type="button" aria-label={`${open ? '折叠' : '展开'} ${label}`} aria-expanded={open} onClick={onToggle} className="pf-grid pf-w-[20px] pf-h-[20px] pf-place-items-center pf-rounded-[4px] pf-text-faint hover:pf-bg-line hover:pf-text-ink">
      <ChevronRight size={12} aria-hidden="true" className={`pf-transition-transform pf-duration-[var(--acc-chevron)] motion-reduce:pf-transition-none ${open ? 'pf-rotate-90' : ''}`} />
    </button>
  )
}

export function SidebarTreeGroup({ label, title, open, onToggle, metadata, actions, children }: { label: string, title?: string, open: boolean, onToggle: () => void, metadata?: ReactNode, actions?: ReactNode, children: ReactNode }) {
  const panelId = useId()
  return (
    <section className="pf-mt-[6px] t-acc t-acc-fold" data-open={String(open)}>
      <div className="pf-group pf-flex pf-items-center pf-gap-[2px]">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={`${open ? '折叠' : '展开'} ${label}`}
          onClick={onToggle}
          onKeyDown={(event) => {
            if ((event.key === 'ArrowLeft' && open) || (event.key === 'ArrowRight' && !open)) {
              event.preventDefault()
              onToggle()
            }
          }}
          title={title}
          className="pf-flex pf-items-center pf-gap-[8px] pf-min-h-[32px] pf-min-w-0 pf-flex-1 pf-px-[10px] pf-rounded-[8px] pf-text-left pf-text-mid hover:pf-bg-press"
        >
          <span className="pf-grid pf-w-[20px] pf-h-[20px] pf-place-items-center pf-flex-none pf-text-muted">{open ? <FolderOpen size={16} aria-hidden="true" /> : <Folder size={16} aria-hidden="true" />}</span>
          <span className="pf-min-w-0 pf-overflow-hidden pf-text-ellipsis pf-whitespace-nowrap pf-text-small">{label}</span>
        </button>
        {metadata}
        {actions ? <span className="pf-flex pf-items-center pf-opacity-0 pf-transition-opacity group-hover:pf-opacity-100 group-focus-within:pf-opacity-100 [@media(pointer:coarse)]:pf-opacity-100 motion-reduce:pf-transition-none">{actions}</span> : null}
      </div>
      <div id={panelId} className="t-acc-panel" inert={!open} aria-hidden={!open}>
        <div className="t-acc-panel-inner">{children}</div>
      </div>
    </section>
  )
}

export function SidebarTreeRow({ id, label, title, active = false, indent = 0, rail, trailing, children, disabled, onSelect, ariaLabel }: {
  id?: string
  label: string
  title?: string
  active?: boolean
  indent?: number
  rail?: ReactNode
  trailing?: ReactNode
  children?: ReactNode
  disabled?: boolean
  onSelect?: () => void
  ariaLabel?: string
}) {
  return (
    <div data-glide={id} data-sidebar-row="" data-active={active || undefined} aria-current={active ? 'page' : undefined} className={`pf-relative pf-z-1 pf-grid pf-grid-cols-[20px_minmax(0,1fr)] pf-items-center pf-gap-x-[8px] pf-min-h-[32px] pf-rounded-[8px] ${active ? 'pf-bg-[color-mix(in_srgb,var(--c-press)_60%,transparent)]' : ''}`} style={{ paddingLeft: `${10 + indent * 12}px` }}>
      <span className="pf-grid pf-w-[20px] pf-h-[20px] pf-place-items-center pf-text-muted">{rail}</span>
      <div data-sidebar-item="" title={title} className="t-session pf-relative pf-grid pf-grid-cols-[minmax(0,1fr)_auto] pf-items-center pf-gap-x-[8px] pf-min-h-[32px] pf-rounded-[6px] pf-leading-[1.3]">
        {children ?? (
          <button type="button" disabled={disabled} aria-label={ariaLabel} onClick={onSelect} className={`pf-col-start-1 pf-row-start-1 pf-flex pf-min-w-0 pf-self-stretch pf-items-center pf-py-[4px] pf-rounded-[4px] pf-text-left ${active ? 'pf-text-ink' : 'pf-text-body'}`}>
            <span className="pf-min-w-0 pf-overflow-hidden pf-text-ellipsis pf-whitespace-nowrap pf-text-ui pf-font-normal">{label}</span>
          </button>
        )}
        {trailing ? <span className="pf-col-start-2 pf-row-start-1 pf-flex pf-items-center">{trailing}</span> : null}
      </div>
    </div>
  )
}

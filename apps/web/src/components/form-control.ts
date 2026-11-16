export type ControlAppearance = 'default' | 'prompt' | 'panel' | 'surface'

const appearances = {
  default: 'pf-rounded-[5px] pf-p-[9px_10px] pf-bg-bg pf-text-body pf-text-[0.76rem]',
  prompt: 'pf-rounded-[4px] pf-p-[8px] pf-bg-bg pf-text-body',
  panel: 'pf-block pf-w-full pf-mt-[5px] pf-rounded-[5px] pf-border-line-strong pf-bg-canvas pf-text-ink pf-text-[0.82rem] pf-leading-[inherit] placeholder:pf-text-faint',
  surface: 'pf-rounded-[6px] pf-p-[8px] pf-bg-surface pf-text-ink pf-[font-size:inherit] pf-leading-[inherit]',
}

export function controlClasses(appearance: ControlAppearance, kind: 'input' | 'select' | 'textarea') {
  return [
    'pf-min-w-0 pf-border pf-border-solid pf-outline-none focus:pf-border-signal aria-[invalid=true]:pf-border-danger disabled:pf-opacity-50 disabled:pf-cursor-default',
    appearance === 'panel' ? '' : 'pf-border-line',
    appearances[appearance],
    appearance === 'default' && kind !== 'select' ? 'pf-font-mono' : 'pf-font-sans',
    appearance === 'panel' ? (kind === 'textarea' ? 'pf-p-[8px_10px]' : 'pf-h-[36px] pf-p-[0_10px]') : '',
    kind === 'textarea' ? 'pf-resize-y' : '',
  ].join(' ')
}

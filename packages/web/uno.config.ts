import { defineConfig, presetWind3 } from 'unocss'

export default defineConfig({
  presets: [presetWind3({ prefix: 'pf-', preflight: false })],
  shortcuts: {
    'pf-dialog-backdrop': 'pf-fixed pf-z-40 pf-inset-0 pf-grid pf-place-items-center pf-bg-[rgb(0_0_0_/_68%)] pf-[backdrop-filter:blur(6px)]',
    'pf-dialog-surface': 'pf-flex pf-flex-col pf-overflow-hidden pf-border pf-border-solid pf-border-line pf-rounded-[8px] pf-bg-raise pf-[box-shadow:0_24px_80px_rgb(0_0_0_/_55%)]',
  },
  theme: {
    colors: {
      'bg': 'var(--c-bg)',
      'canvas': 'var(--c-canvas)',
      'surface': 'var(--c-surface)',
      'ink': 'var(--c-ink)',
      'mid': 'var(--c-mid)',
      'body': 'var(--c-body)',
      'muted': 'var(--c-muted)',
      'faint': 'var(--c-faint)',
      'line': 'var(--c-line)',
      'line-strong': 'var(--c-line-strong)',
      'raise': 'var(--c-raise)',
      'press': 'var(--c-press)',
      'accent': 'var(--c-accent)',
      'signal': 'var(--c-signal)',
      'success': 'var(--c-success)',
      'warning': 'var(--c-warning)',
      'danger': 'var(--c-danger)',
    },
    spacing: {
      1: 'var(--space-1)',
      2: 'var(--space-2)',
      3: 'var(--space-3)',
      4: 'var(--space-4)',
      control: 'var(--control)',
      icon: 'var(--icon)',
      chrome: 'var(--chrome-h)',
    },
    width: { control: 'var(--control)', icon: 'var(--icon)' },
    height: { control: 'var(--control)', icon: 'var(--icon)', chrome: 'var(--chrome-h)' },
    fontFamily: {
      sans: 'var(--font-sans)',
      mono: 'var(--font-mono)',
    },
    fontSize: {
      caption: ['var(--text-caption)', { 'line-height': 'var(--line-caption)' }],
      small: ['var(--text-small)', { 'line-height': 'var(--line-small)' }],
      ui: ['var(--text-ui)', { 'line-height': 'var(--line-ui)' }],
      reading: ['var(--text-body)', { 'line-height': 'var(--line-body)' }],
    },
    borderRadius: {
      control: 'var(--radius-control)',
      panel: 'var(--radius-panel)',
    },
  },
})

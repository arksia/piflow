import type { ComponentProps } from 'react'

const variants = {
  primary: 'pf-bg-ink pf-text-bg [&:hover:not(:disabled)]:pf-opacity-90',
  secondary: 'pf-bg-line pf-text-ink [&:hover:not(:disabled)]:pf-bg-press',
  outline: 'pf-border pf-border-solid pf-border-line pf-text-muted [&:hover:not(:disabled)]:pf-border-signal [&:hover:not(:disabled)]:pf-text-ink',
  danger: 'pf-border pf-border-solid pf-border-danger pf-text-danger [&:hover:not(:disabled)]:pf-bg-[var(--c-danger-tint)]',
  accent: 'pf-bg-accent pf-text-[var(--c-accent-contrast)] pf-font-semibold [&:hover:not(:disabled)]:pf-bg-[var(--c-accent-hover)] disabled:pf-bg-press disabled:pf-text-faint',
  ghost: 'pf-text-muted [&:hover:not(:disabled)]:pf-text-ink',
}

const sizes = {
  default: 'pf-p-[8px_12px] pf-rounded-[5px] pf-text-[0.8rem]',
  compact: 'pf-p-[4px_8px] pf-rounded-[4px] pf-text-[0.7rem]',
  panel: 'pf-min-h-[32px] pf-p-[4px_10px] pf-rounded-[5px] pf-text-[0.78rem]',
}

type Props = ComponentProps<'button'> & {
  variant?: keyof typeof variants
  size?: keyof typeof sizes
}

export default function Button({ variant = 'secondary', size = 'default', type = 'button', className = '', ...props }: Props) {
  return (
    <button
      {...props}
      type={type}
      className={`pf-shrink-0 pf-[transition:color_0.15s_var(--ease),background_0.15s_var(--ease),border-color_0.15s_var(--ease)] focus-visible:pf-outline focus-visible:pf-outline-2 focus-visible:pf-outline-signal focus-visible:pf-outline-offset-2 disabled:pf-opacity-50 disabled:pf-cursor-default ${variants[variant]} ${sizes[size]} ${className}`}
    />
  )
}

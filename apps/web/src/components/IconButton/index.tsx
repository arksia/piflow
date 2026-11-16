import type { ButtonHTMLAttributes, ReactNode } from 'react'

const sizes = {
  default: 'pf-size-control [&>svg]:pf-size-icon',
  compact: 'pf-size-[24px] [&>svg]:pf-size-[14px]',
}

const variants = {
  ghost: '',
  outline: 'pf-border pf-border-solid pf-border-line [&:hover:not(:disabled)]:pf-border-faint',
}

const buttonClass = [
  'pf-grid pf-flex-none pf-place-items-center pf-rounded-control pf-text-muted pf-bg-transparent',
  'pf-[transition:color_0.15s_var(--ease),background_0.15s_var(--ease),border-color_0.15s_var(--ease)]',
  'disabled:pf-text-faint disabled:pf-opacity-45',
  '[&:hover:not(:disabled)]:pf-text-ink [&:hover:not(:disabled)]:pf-bg-press',
  '[&:active:not(:disabled)]:pf-bg-press',
  'aria-[pressed=true]:pf-text-ink aria-[pressed=true]:pf-bg-press',
  '[&[aria-pressed=true]:disabled]:pf-text-ink',
].join(' ')

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  variant?: 'ghost' | 'outline'
  size?: 'default' | 'compact'
  tip?: boolean
  children: ReactNode
}

export default function IconButton({
  label,
  title,
  variant = 'ghost',
  size = 'default',
  tip = false,
  className,
  children,
  type = 'button',
  ...rest
}: Props) {
  return (
    <button
      type={type}
      title={tip ? undefined : title ?? label}
      data-tooltip={tip ? label : undefined}
      aria-label={label}
      className={`${buttonClass} ${sizes[size]} ${variants[variant]} ${tip ? 't-tt-trigger' : ''} ${className ?? ''}`}
      {...rest}
    >
      {children}
    </button>
  )
}

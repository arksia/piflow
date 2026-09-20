import type { ButtonHTMLAttributes, ReactNode } from 'react'
import styles from './styles.module.css'

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
      className={`${styles.button} ${styles[variant]} ${size === 'compact' ? styles.compact : ''} ${tip ? 't-tt-trigger' : ''} ${className ?? ''}`}
      {...rest}
    >
      {children}
    </button>
  )
}

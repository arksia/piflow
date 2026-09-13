import type { ButtonHTMLAttributes, ReactNode } from 'react'
import styles from './styles.module.css'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  variant?: 'ghost' | 'outline'
  size?: 'default' | 'compact'
  children: ReactNode
}

export default function IconButton({
  label,
  title,
  variant = 'ghost',
  size = 'default',
  className,
  children,
  type = 'button',
  ...rest
}: Props) {
  return (
    <button
      type={type}
      title={title ?? label}
      aria-label={label}
      className={`${styles.button} ${styles[variant]} ${size === 'compact' ? styles.compact : ''} ${className ?? ''}`}
      {...rest}
    >
      {children}
    </button>
  )
}

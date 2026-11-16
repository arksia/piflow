import type { ComponentProps } from 'react'
import type { ControlAppearance } from '../form-control'
import { controlClasses } from '../form-control'

type Props = ComponentProps<'select'> & { appearance?: ControlAppearance }

export default function Select({ appearance = 'default', className = '', ...props }: Props) {
  return <select {...props} className={`${controlClasses(appearance, 'select')} ${className}`} />
}

import type { ComponentProps } from 'react'
import type { ControlAppearance } from '../form-control'
import { controlClasses } from '../form-control'

type Props = ComponentProps<'textarea'> & { appearance?: ControlAppearance }

export default function Textarea({ appearance = 'default', className = '', ...props }: Props) {
  return <textarea {...props} className={`${controlClasses(appearance, 'textarea')} ${className}`} />
}

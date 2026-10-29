import type { Edge, EdgeProps } from '@xyflow/react'
import type { FlowEdgeActivity } from '../../flow/edges'
import type { FlowRoutePoint } from '../../flow/routes'
import { BaseEdge, EdgeLabelRenderer } from '@xyflow/react'
import { roundedOrthogonalPath } from '../../flow/routes'
import styles from './styles.module.css'

export interface FlowMessageEdgeData extends Record<string, unknown> {
  activities: FlowEdgeActivity[]
  reducedMotion: boolean
  dimmed: boolean
  route?: FlowRoutePoint[]
  transient?: boolean
}

export type FlowMessageEdgeType = Edge<FlowMessageEdgeData, 'message'>

export default function FlowMessageEdge({ id, source, sourceX, sourceY, targetX, targetY, data, selected }: EdgeProps<FlowMessageEdgeType>) {
  const points = data?.route ?? [
    { x: sourceX, y: sourceY },
    { x: targetX, y: sourceY },
    { x: targetX, y: targetY },
  ]
  const path = roundedOrthogonalPath(points)
  const lengths = points.slice(1).map((point, index) => Math.abs(point.x - points[index]!.x) + Math.abs(point.y - points[index]!.y))
  let remaining = lengths.reduce((sum, length) => sum + length, 0) / 2
  let labelX = sourceX
  let labelY = sourceY
  for (let index = 0; index < lengths.length; index++) {
    const length = lengths[index]!
    if (remaining > length) {
      remaining -= length
      continue
    }
    const from = points[index]!
    const to = points[index + 1]!
    const fraction = length === 0 ? 0 : remaining / length
    labelX = from.x + (to.x - from.x) * fraction
    labelY = from.y + (to.y - from.y) * fraction
    break
  }
  const activities = data?.activities ?? []

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{
          stroke: selected ? 'var(--c-mid)' : 'var(--c-muted)',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          strokeDasharray: data?.transient ? '3 5' : undefined,
          opacity: data?.dimmed ? 0.14 : 1,
          transition: 'stroke 140ms ease-out, opacity 140ms ease-out',
        }}
      />
      {activities.length > 0 && !data?.reducedMotion
        ? (
            <g className={styles.pulses} aria-hidden="true">
              {activities.map((activity, index) => {
                const messageForward = activity.source === source
                const reverse = activity.kind === 'request' ? !messageForward : messageForward
                const color = activity.kind === 'error' ? 'var(--c-danger)' : activity.kind === 'response' ? 'var(--c-success)' : 'var(--c-signal)'
                return (
                  <path key={`${activity.messageId}:${activity.kind}`} className={styles.pulse} d="M -11 0 H 0" stroke={color} strokeWidth="2.5" strokeLinecap="round" opacity="0.95" style={{ filter: `drop-shadow(0 0 4px ${color})` }}>
                    <animateMotion dur="900ms" begin={`${index * 120}ms`} fill="freeze" keyPoints={reverse ? '1;0' : '0;1'} keyTimes="0;1" path={path} rotate="auto" />
                    <animate attributeName="opacity" values="0;1;0" keyTimes="0;0.15;1" dur="900ms" begin={`${index * 120}ms`} fill="freeze" />
                  </path>
                )
              })}
            </g>
          )
        : null}
      {activities.length > 1 || (activities.length > 0 && data?.reducedMotion)
        ? (
            <EdgeLabelRenderer>
              <span className={styles.count} style={{ left: labelX, top: labelY }} aria-label={`${activities.length} 条消息活动`}>
                {activities.length}
              </span>
            </EdgeLabelRenderer>
          )
        : null}
    </>
  )
}

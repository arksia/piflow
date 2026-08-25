import type { FlowDocument, FlowDocumentResponse, FlowTopology, ReplaceFlowRequest } from '@piflow/protocol'
import { buildFlowPath } from '@piflow/protocol'
import { api } from '../session/api'

export async function loadFlow(projectPath: string): Promise<FlowDocument> {
  return (await api<FlowDocumentResponse>(buildFlowPath(projectPath))).document
}

export async function saveFlow(projectPath: string, topology: FlowTopology): Promise<FlowDocument> {
  return (await api<FlowDocumentResponse>(buildFlowPath(projectPath), {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectPath, topology } satisfies ReplaceFlowRequest),
  })).document
}

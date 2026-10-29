import type { AcceptConductorRequest, ConductorDraft, FlowDocument, FlowDocumentResponse, FlowTopology, ReplaceFlowRequest } from '@piflow/protocol'
import { API_FLOW_ACCEPT_PATH, API_FLOW_PATH, buildFlowPath } from '@piflow/protocol'
import { api } from '../session/api'

export async function loadFlow(projectPath: string): Promise<FlowDocumentResponse> {
  return api<FlowDocumentResponse>(buildFlowPath(projectPath))
}

export async function saveFlow(projectPath: string, topology: FlowTopology, commitGraph = false): Promise<FlowDocument> {
  return (await api<FlowDocumentResponse>(buildFlowPath(projectPath), {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectPath, topology, commitGraph: commitGraph || undefined } satisfies ReplaceFlowRequest),
  })).document
}

export async function acceptConductor(projectPath: string, draft: ConductorDraft): Promise<FlowDocument> {
  return (await api<FlowDocumentResponse>(API_FLOW_ACCEPT_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectPath, draft } satisfies AcceptConductorRequest),
  })).document
}

export async function cancelRun(projectPath: string, runId: string): Promise<void> {
  await api(`${API_FLOW_PATH}/runs/${encodeURIComponent(runId)}/cancel`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectPath }) })
}

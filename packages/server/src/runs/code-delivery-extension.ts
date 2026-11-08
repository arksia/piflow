import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { defineTool } from '@earendil-works/pi-coding-agent'
import { CODE_DELIVERY_TOOL, codeDeliverySchema, parseCodeDelivery } from './delivery'

export default function codeDeliveryExtension(pi: ExtensionAPI) {
  pi.registerTool(defineTool({
    name: CODE_DELIVERY_TOOL,
    label: 'Code delivery declaration',
    description: 'Submit your code delivery declaration. This records your claims, not host-verified success. It does not end the run or execute checks.',
    parameters: codeDeliverySchema,
    async execute(_id, params) {
      const declaration = parseCodeDelivery(params)
      return { content: [{ type: 'text', text: 'Delivery declaration recorded. Return your concise final reply; resubmit if you perform further tool work.' }], details: { codeDelivery: declaration } }
    },
  }))
}

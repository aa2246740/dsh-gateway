import type { Delivery } from './gateway/index.ts'

export function textFromDelivery(delivery: Delivery): string | undefined {
  if (delivery.kind !== 'chat') return undefined
  const body = delivery.body
  switch (body.kind) {
    case 'pairingCode':
      return `Pairing code: ${body.code}. Approve it in DSH Messaging settings.`
    case 'rejectCommand':
      return body.reason === 'unknown' ? 'Unknown command.' : 'That command is owner-only.'
    case 'commandResult':
      return body.text
    case 'notice':
      return body.text
    case 'busy':
      return body.on ? 'Working…' : undefined
    case 'stream':
      return body.snapshot?.text
    case 'approval':
      if (body.handled) return undefined
      return `Approval needed: ${body.request.summary}`
    case 'files':
      return body.files.map(file => file.name).join(', ')
    default: {
      const _exhaustive: never = body
      void _exhaustive
      return undefined
    }
  }
}

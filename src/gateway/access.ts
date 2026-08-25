import {
  pairingCode,
  type AccessDecision,
  type Addressing,
  type PlatformAccess,
  type SessionIdentity,
  type SubjectId,
  type Timestamp,
} from './types.ts'

export function accessOf(
  store: { readonly byPlatform: { readonly [platform: string]: PlatformAccess } },
  platform: string,
): PlatformAccess {
  return store.byPlatform[platform] ?? { kind: 'unbound' }
}

export function decideAccess(args: {
  access: PlatformAccess
  actor: SubjectId
  addressing: Addressing
  identity: SessionIdentity
  at: Timestamp
  pairingSeq: number
}): { decision: AccessDecision; access: PlatformAccess; pairingSeq: number } {
  const { access, actor, addressing, identity, at, pairingSeq } = args
  if (access.kind === 'unbound') {
    if (addressing.kind === 'dm') {
      return {
        decision: { kind: 'owner' },
        access: { kind: 'bound', owner: actor, allowlist: [], guests: [], pending: [] },
        pairingSeq,
      }
    }
    return { decision: { kind: 'deny' }, access, pairingSeq }
  }

  if (actor === access.owner) {
    return { decision: { kind: 'owner' }, access, pairingSeq }
  }
  if (access.allowlist.includes(actor)) {
    return { decision: { kind: 'allowlisted' }, access, pairingSeq }
  }
  if (access.guests.some(g => g.subject === actor)) {
    return { decision: { kind: 'guest' }, access, pairingSeq }
  }

  const pending = access.pending.find(p => p.subject === actor)
  if (pending) {
    return { decision: { kind: 'pair', code: pending.code, issued: false }, access, pairingSeq }
  }

  if (addressing.kind !== 'dm') {
    return { decision: { kind: 'deny' }, access, pairingSeq }
  }

  const nextSeq = pairingSeq + 1
  const code = pairingCode(`P${nextSeq.toString(16).padStart(6, '0')}`)
  return {
    decision: { kind: 'pair', code, issued: true },
    access: {
      ...access,
      pending: [...access.pending, { code, subject: actor, identity, issuedAt: at }],
    },
    pairingSeq: nextSeq,
  }
}

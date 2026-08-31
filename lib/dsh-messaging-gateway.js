// src/dsh-messaging-gateway.ts
import { SessionId as SessionId2 } from "@deepseek-ai/dsh-session";
import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
import z from "@deepseek-ai/schemastery";

// src/config.ts
var SETTINGS_NAMESPACE = "dsh-messaging-gateway";

// src/gateway/types.ts
function brandString(label, raw) {
  if (raw.length === 0) throw new Error(`${label} is empty`);
  return raw;
}
function platformId(raw) {
  return brandString("platform", raw);
}
function subjectId(raw) {
  return brandString("subject", raw);
}
function chatId(raw) {
  return brandString("chat", raw);
}
function threadId(raw) {
  return brandString("thread", raw);
}
function inboundId(raw) {
  return brandString("inbound", raw);
}
function hostSessionId(raw) {
  return brandString("host session", raw);
}
function approvalId(raw) {
  return brandString("approval", raw);
}
function pairingCode(raw) {
  return brandString("pairing", raw);
}
function idempotencyKey(raw) {
  return brandString("idempotency", raw);
}
function timestamp(ms) {
  if (!Number.isFinite(ms)) throw new Error("timestamp is not finite");
  return ms;
}

// src/gateway/access.ts
function accessOf(store, platform) {
  return store.byPlatform[platform] ?? { kind: "unbound" };
}
function decideAccess(args) {
  const { access, actor, addressing, identity, at, pairingSeq } = args;
  if (access.kind === "unbound") {
    if (addressing.kind === "dm") {
      return {
        decision: { kind: "owner" },
        access: { kind: "bound", owner: actor, allowlist: [], guests: [], pending: [] },
        pairingSeq
      };
    }
    return { decision: { kind: "deny" }, access, pairingSeq };
  }
  if (actor === access.owner) {
    return { decision: { kind: "owner" }, access, pairingSeq };
  }
  if (access.allowlist.includes(actor)) {
    return { decision: { kind: "allowlisted" }, access, pairingSeq };
  }
  if (access.guests.some((g) => g.subject === actor)) {
    return { decision: { kind: "guest" }, access, pairingSeq };
  }
  const pending = access.pending.find((p) => p.subject === actor);
  if (pending) {
    return { decision: { kind: "pair", code: pending.code, issued: false }, access, pairingSeq };
  }
  if (addressing.kind !== "dm") {
    return { decision: { kind: "deny" }, access, pairingSeq };
  }
  const nextSeq = pairingSeq + 1;
  const code = pairingCode(`P${nextSeq.toString(16).padStart(6, "0")}`);
  return {
    decision: { kind: "pair", code, issued: true },
    access: {
      ...access,
      pending: [...access.pending, { code, subject: actor, identity, issuedAt: at }]
    },
    pairingSeq: nextSeq
  };
}

// src/gateway/catalog.ts
var DEFAULT_COMMANDS = [
  { name: "model", description: "Show or switch this session model", ownerOnly: false, source: "command" },
  { name: "help", description: "List DSH commands", ownerOnly: false, source: "command" },
  { name: "goal", description: "Observe or change the current goal", ownerOnly: false, source: "command" },
  { name: "plan", description: "Enter plan mode", ownerOnly: false, source: "command" },
  { name: "export", description: "Export this session", ownerOnly: true, source: "command" },
  { name: "compact", description: "Compact this session", ownerOnly: false, source: "command" },
  { name: "new", description: "Start a fresh session in this chat", ownerOnly: false, source: "command" },
  { name: "reset", description: "Start a fresh session in this chat", ownerOnly: false, source: "command" },
  { name: "feedback", description: "Send feedback", ownerOnly: false, source: "command" }
];
function isFreshSessionCommand(name2) {
  return name2 === "new" || name2 === "reset";
}
function matchCommand(catalog, line) {
  const trimmed = line.text.trim();
  if (trimmed.length === 0) return { kind: "unknown" };
  const parts = trimmed.split(/\s+/);
  let name2 = parts[0] ?? "";
  let restStart = 1;
  if (name2 === catalog.catchAllPrefix && parts[1]) {
    name2 = parts[1];
    restStart = 2;
  }
  const spec = catalog.commands.find((c) => c.name === name2);
  if (!spec) return { kind: "unknown" };
  const args = parts.slice(restStart).join(" ");
  return { kind: "ok", spec, args };
}

// src/gateway/key.ts
function sessionKey(identity) {
  const thread = identity.threadId ?? "";
  const encoded = `${identity.platform}|${identity.kind}|${identity.chatId}|${thread}`;
  return encoded;
}

// src/gateway/title.ts
function platformLabel(platform) {
  if (platform.length === 0) return "Chat";
  return `${platform.charAt(0).toUpperCase()}${platform.slice(1)}`;
}
function isOpaquePeerLabel(value) {
  return /^(ou_|oc_|on_)[A-Za-z0-9_-]{8,}$/.test(value.trim());
}
function displayTitle(identity, labels = {}) {
  const platform = platformLabel(identity.platform);
  if (identity.kind === "dm") {
    const who = labels.peerName?.trim() || String(identity.chatId);
    if (who.length === 0 || isOpaquePeerLabel(who)) return `${platform} DM`;
    return `${platform} DM \xB7 ${who}`;
  }
  const raw = labels.chatName?.trim() || String(identity.chatId);
  if (isOpaquePeerLabel(raw)) {
    return identity.threadId ? `${platform} \xB7 \u5E16` : platform;
  }
  const channel = raw.startsWith("#") ? raw : `#${raw}`;
  if (identity.threadId) return `${channel} \xB7 \u5E16`;
  return channel;
}
function looksLikePromptTitle(title, identity) {
  const trimmed = title.trim();
  if (trimmed.length === 0 || trimmed === "session") return true;
  if (trimmed.includes("<@")) return true;
  if (identity.kind === "dm") {
    const prefix = `${platformLabel(identity.platform)} DM`;
    if (!trimmed.startsWith(prefix)) return true;
    const rest = trimmed.slice(prefix.length).replace(/^ · /, "").trim();
    return rest.length > 0 && isOpaquePeerLabel(rest);
  }
  return !trimmed.startsWith("#");
}

// src/gateway/list.ts
function isMainConversation(identity) {
  return identity.kind === "dm" && identity.threadId === null;
}
function rowOf(session) {
  const hostSessionId2 = session.host.kind === "bound" ? session.host.hostSessionId : null;
  return {
    sessionKey: session.key,
    hostSessionId: hostSessionId2,
    identity: session.identity,
    title: session.title,
    turn: session.turn.kind,
    lastActivityAt: session.lastActivityAt
  };
}
function list(state) {
  const platforms = /* @__PURE__ */ new Set();
  for (const [id, access2] of Object.entries(state.access.byPlatform)) {
    if (access2.kind === "bound") platforms.add(id);
  }
  for (const session of Object.values(state.sessions)) {
    platforms.add(session.identity.platform);
  }
  const groups = [...platforms].sort().map((id) => {
    const platform = platformId(id);
    const rows = Object.values(state.sessions).filter((s) => s.identity.platform === platform && isMainConversation(s.identity)).map(rowOf).sort((a, b) => b.lastActivityAt - a.lastActivityAt);
    return { platform, label: platformLabel(platform), collapsedByDefault: true, rows };
  }).filter((g) => {
    const access2 = state.access.byPlatform[g.platform];
    if (g.rows.length > 0) return true;
    return access2?.kind === "bound";
  });
  const access = Object.entries(state.access.byPlatform).map(([id, row]) => ({
    platform: platformId(id),
    bound: row.kind === "bound",
    owner: row.kind === "bound" ? String(row.owner) : null
  })).sort((a, b) => a.platform.localeCompare(b.platform));
  return { groups, access };
}
function projectDelta(before, after) {
  const a = JSON.stringify(list(before));
  const b = JSON.stringify(list(after));
  if (a === b) return { kind: "none" };
  return { kind: "rebuild" };
}

// src/gateway/handle.ts
var SEEN_LIMIT = 512;
function emptyState() {
  return {
    version: 1,
    access: { byPlatform: {} },
    sessions: {},
    catalog: { commands: [], catchAllPrefix: "dsh" },
    seen: [],
    pairingSeq: 0
  };
}
function remember(seen, id) {
  const next = seen.includes(id) ? seen : [...seen, id];
  return next.length > SEEN_LIMIT ? next.slice(next.length - SEEN_LIMIT) : next;
}
function silent(state, inboundId2) {
  const next = { ...state, seen: remember(state.seen, inboundId2) };
  return { state: next, hostCalls: [], deliveries: [], listDelta: { kind: "none" } };
}
function putAccess(state, platform, access) {
  return { ...state, access: { byPlatform: { ...state.access.byPlatform, [platform]: access } } };
}
function putSession(state, session) {
  return { ...state, sessions: { ...state.sessions, [session.key]: session } };
}
function dropSession(state, key) {
  const sessions = { ...state.sessions };
  delete sessions[key];
  return { ...state, sessions };
}
function chat(identity, key, body) {
  return { kind: "chat", identity, sessionKey: key, body };
}
function mentionOk(addressing, hasSession) {
  if (addressing.kind === "dm") return true;
  return addressing.mentioned || addressing.botInvited || hasSession;
}
function titleFor(identity, actor) {
  return displayTitle(identity, identity.kind === "dm" && actor ? { peerName: actor } : {});
}
function ensureSession(state, identity, at, title) {
  const key = sessionKey(identity);
  const existing = state.sessions[key];
  if (existing) {
    const session2 = { ...existing, lastActivityAt: at, title: existing.title || title };
    return { state: putSession(state, session2), session: session2 };
  }
  const session = {
    key,
    identity,
    host: { kind: "unbound" },
    workspace: { kind: "host-default" },
    turn: { kind: "idle" },
    queued: [],
    lastActivityAt: at,
    title
  };
  return { state: putSession(state, session), session };
}
function dispatchWork(session, work) {
  if (session.host.kind === "provisioning") {
    return { session: { ...session, queued: [...session.queued, work] }, hostCalls: [] };
  }
  if (session.host.kind === "bound" && session.turn.kind !== "idle") {
    return { session: { ...session, queued: [...session.queued, work] }, hostCalls: [] };
  }
  const host = session.host.kind === "unbound" ? { kind: "provisioning" } : session.host;
  const call = work.kind === "prompt" ? {
    kind: "ensurePrompt",
    idempotencyKey: work.idempotencyKey,
    sessionKey: session.key,
    identity: session.identity,
    host: session.host,
    workspace: session.workspace,
    prompt: work.prompt
  } : {
    kind: "ensureCommand",
    idempotencyKey: work.idempotencyKey,
    sessionKey: session.key,
    identity: session.identity,
    host: session.host,
    workspace: session.workspace,
    line: work.line
  };
  return {
    session: { ...session, host, turn: { kind: "inFlight" } },
    hostCalls: [call]
  };
}
function drainQueue(session) {
  if (session.host.kind !== "bound" || session.queued.length === 0) {
    return { session, hostCalls: [] };
  }
  const [first, ...rest] = session.queued;
  if (!first) return { session, hostCalls: [] };
  const cleared = { ...session, queued: rest, turn: { kind: "idle" } };
  return dispatchWork(cleared, first);
}
function recoverTurns(state) {
  let changed = false;
  const hostCalls = [];
  const sessions = {};
  for (const [key, session] of Object.entries(state.sessions)) {
    let next = session;
    if (next.host.kind === "provisioning") {
      next = { ...next, host: { kind: "unbound" }, turn: { kind: "idle" } };
      changed = true;
    } else if (next.turn.kind !== "idle") {
      next = { ...next, turn: { kind: "idle" } };
      changed = true;
    }
    if (looksLikePromptTitle(next.title, next.identity)) {
      next = { ...next, title: displayTitle(next.identity) };
      changed = true;
    }
    if (next.host.kind === "bound" && next.queued.length > 0) {
      const drained = drainQueue(next);
      next = drained.session;
      hostCalls.push(...drained.hostCalls);
      changed = true;
    }
    sessions[key] = next;
  }
  if (!changed) return { state, hostCalls: [] };
  return { state: { ...state, sessions }, hostCalls };
}
function finish(before, after, hostCalls, deliveries) {
  return {
    state: after,
    hostCalls,
    deliveries,
    listDelta: projectDelta(before, after)
  };
}
function handle(state, inbound) {
  if (state.seen.includes(inbound.id)) {
    return { state, hostCalls: [], deliveries: [], listDelta: { kind: "none" } };
  }
  const stamped = { ...state, seen: remember(state.seen, inbound.id) };
  switch (inbound.kind) {
    case "bind": {
      const access = {
        kind: "bound",
        owner: inbound.owner,
        allowlist: [inbound.owner],
        guests: [],
        pending: []
      };
      const after = putAccess(stamped, inbound.platform, access);
      return finish(state, after, [], []);
    }
    case "unbind": {
      const after = putAccess(stamped, inbound.platform, { kind: "unbound" });
      return finish(state, after, [], []);
    }
    case "allowlist": {
      const current = accessOf(stamped.access, inbound.platform);
      if (current.kind !== "bound") return silent(stamped, inbound.id);
      const allowlist = inbound.op === "add" ? current.allowlist.includes(inbound.subject) ? current.allowlist : [...current.allowlist, inbound.subject] : current.allowlist.filter((s) => s !== inbound.subject || s === current.owner);
      const after = putAccess(stamped, inbound.platform, { ...current, allowlist });
      return finish(state, after, [], []);
    }
    case "pairingDecision": {
      let foundPlatform;
      let current;
      for (const [id, access] of Object.entries(stamped.access.byPlatform)) {
        if (access.kind !== "bound") continue;
        if (access.pending.some((p) => p.code === inbound.code)) {
          foundPlatform = id;
          current = access;
          break;
        }
      }
      if (!current || !foundPlatform) return silent(stamped, inbound.id);
      const pending = current.pending.find((p) => p.code === inbound.code);
      if (!pending) return silent(stamped, inbound.id);
      const rest = current.pending.filter((p) => p.code !== inbound.code);
      if (inbound.op === "deny") {
        const after2 = putAccess(stamped, foundPlatform, { ...current, pending: rest });
        return finish(state, after2, [], []);
      }
      const guests = current.guests.some((g) => g.subject === pending.subject) ? current.guests : [...current.guests, { subject: pending.subject, pairedAt: inbound.at }];
      const after = putAccess(stamped, foundPlatform, { ...current, pending: rest, guests });
      return finish(state, after, [], []);
    }
    case "revoke": {
      const current = accessOf(stamped.access, inbound.platform);
      if (current.kind !== "bound") return silent(stamped, inbound.id);
      if (inbound.subject === current.owner) return silent(stamped, inbound.id);
      const after = putAccess(stamped, inbound.platform, {
        ...current,
        allowlist: current.allowlist.filter((s) => s !== inbound.subject),
        guests: current.guests.filter((g) => g.subject !== inbound.subject),
        pending: current.pending.filter((p) => p.subject !== inbound.subject)
      });
      return finish(state, after, [], []);
    }
    case "catalog": {
      const after = { ...stamped, catalog: inbound.catalog };
      return finish(state, after, [], [{ kind: "catalogUpdated" }]);
    }
    case "setWorkspace": {
      const key = sessionKey(inbound.identity);
      const existing = stamped.sessions[key];
      if (!existing) return silent(stamped, inbound.id);
      const after = putSession(stamped, { ...existing, workspace: inbound.workspace });
      return finish(state, after, [], []);
    }
    case "setTitle": {
      const key = sessionKey(inbound.identity);
      const existing = stamped.sessions[key];
      if (!existing) return silent(stamped, inbound.id);
      const title = inbound.title.trim();
      if (title.length === 0 || title === existing.title) return silent(stamped, inbound.id);
      const after = putSession(stamped, { ...existing, title, lastActivityAt: inbound.at });
      return finish(state, after, [], []);
    }
    case "sessionDisposed": {
      const after = dropSession(stamped, inbound.sessionKey);
      return finish(state, after, [], []);
    }
    case "hostReport": {
      const session = stamped.sessions[inbound.sessionKey];
      if (!session) return silent(stamped, inbound.id);
      return applyHostReport(state, stamped, session, inbound);
    }
    case "message":
    case "command":
    case "cancel":
    case "approvalAnswer":
      return applyActorInbound(state, stamped, inbound);
    default: {
      const _exhaustive = inbound;
      return _exhaustive;
    }
  }
}
function applyHostReport(before, stamped, session, inbound) {
  const report = inbound.report;
  const deliveries = [];
  let next = session;
  let hostCalls = [];
  switch (report.kind) {
    case "bound": {
      next = { ...next, host: { kind: "bound", hostSessionId: report.hostSessionId } };
      const drained = drainQueue(next);
      next = drained.session;
      hostCalls = drained.hostCalls;
      break;
    }
    case "turnStarted": {
      next = { ...next, turn: { kind: "inFlight" } };
      deliveries.push(chat(session.identity, session.key, { kind: "busy", on: true }));
      deliveries.push(chat(session.identity, session.key, { kind: "stream", phase: "start" }));
      break;
    }
    case "turnProgress": {
      deliveries.push(chat(session.identity, session.key, { kind: "stream", phase: "replace", snapshot: report.snapshot }));
      break;
    }
    case "turnEnded": {
      next = { ...next, turn: { kind: "idle" } };
      deliveries.push(chat(session.identity, session.key, { kind: "stream", phase: "end" }));
      deliveries.push(chat(session.identity, session.key, { kind: "busy", on: false }));
      const drained = drainQueue(next);
      next = drained.session;
      hostCalls = drained.hostCalls;
      break;
    }
    case "approvalRequested": {
      next = { ...next, turn: { kind: "awaitingApproval", request: report.request } };
      deliveries.push(chat(session.identity, session.key, { kind: "approval", request: report.request }));
      break;
    }
    case "approvalSettled": {
      const previous = next.turn.kind === "awaitingApproval" ? next.turn.request : void 0;
      next = { ...next, turn: { kind: "idle" } };
      if (previous) {
        deliveries.push(chat(session.identity, session.key, {
          kind: "approval",
          request: previous,
          handled: true,
          ...report.answer ? { answer: report.answer } : {}
        }));
      }
      break;
    }
    case "artifact": {
      deliveries.push(chat(session.identity, session.key, { kind: "files", files: report.files }));
      break;
    }
    case "commandResult": {
      next = { ...next, turn: { kind: "idle" } };
      deliveries.push(chat(session.identity, session.key, { kind: "commandResult", text: report.text }));
      const drained = drainQueue(next);
      next = drained.session;
      hostCalls = drained.hostCalls;
      break;
    }
    case "error": {
      next = { ...next, turn: { kind: "idle" } };
      deliveries.push(chat(session.identity, session.key, { kind: "notice", text: report.message }));
      break;
    }
    default: {
      const _exhaustive = report;
      return _exhaustive;
    }
  }
  const after = putSession(stamped, next);
  return finish(before, after, hostCalls, deliveries);
}
function applyActorInbound(before, stamped, inbound) {
  const key = sessionKey(inbound.identity);
  const hasSession = Boolean(stamped.sessions[key]);
  const existing = stamped.sessions[key];
  const addressing = inbound.kind === "message" || inbound.kind === "command" ? inbound.addressing : existing?.identity.kind === "group" ? { kind: "group", mentioned: true, botInvited: false } : { kind: "dm" };
  if (!mentionOk(addressing, hasSession)) {
    return silent(stamped, inbound.id);
  }
  const platform = inbound.identity.platform;
  const decided = decideAccess({
    access: accessOf(stamped.access, platform),
    actor: inbound.actor.subject,
    addressing,
    identity: inbound.identity,
    at: inbound.at,
    pairingSeq: stamped.pairingSeq
  });
  let working = putAccess(stamped, platform, decided.access);
  working = { ...working, pairingSeq: decided.pairingSeq };
  if (decided.decision.kind === "deny") {
    return finish(before, working, [], []);
  }
  if (decided.decision.kind === "pair") {
    const deliveries = [
      chat(inbound.identity, key, { kind: "pairingCode", code: decided.decision.code })
    ];
    return finish(before, working, [], deliveries);
  }
  const role = decided.decision.kind;
  if (inbound.kind === "cancel") {
    const session = working.sessions[key];
    if (!session || session.host.kind !== "bound") return finish(before, working, [], []);
    const call = {
      kind: "cancel",
      idempotencyKey: idempotencyKey(inbound.id),
      sessionKey: session.key,
      host: session.host
    };
    return finish(before, working, [call], []);
  }
  if (inbound.kind === "approvalAnswer") {
    const session = working.sessions[key];
    if (!session || session.host.kind !== "bound") return finish(before, working, [], []);
    if (role !== "owner") {
      return finish(before, working, [], [
        chat(session.identity, session.key, { kind: "notice", text: "Only the session owner can approve." })
      ]);
    }
    if (session.turn.kind !== "awaitingApproval" || session.turn.request.requestId !== inbound.requestId) {
      return finish(before, working, [], []);
    }
    const request = session.turn.request;
    const call = {
      kind: "answerApproval",
      idempotencyKey: idempotencyKey(inbound.id),
      sessionKey: session.key,
      host: session.host,
      requestId: inbound.requestId,
      answer: inbound.answer
    };
    const after2 = putSession(working, { ...session, turn: { kind: "idle" } });
    return finish(before, after2, [call], [
      chat(session.identity, session.key, {
        kind: "approval",
        request,
        handled: true,
        answer: inbound.answer
      })
    ]);
  }
  if (inbound.kind === "command") {
    const matched = matchCommand(working.catalog, inbound.line);
    if (matched.kind === "unknown") {
      return finish(before, working, [], [
        chat(inbound.identity, key, { kind: "rejectCommand", reason: "unknown" })
      ]);
    }
    if (role === "guest" && matched.spec.ownerOnly) {
      return finish(before, working, [], [
        chat(inbound.identity, key, { kind: "rejectCommand", reason: "guest-forbidden" })
      ]);
    }
    const ensured2 = ensureSession(working, inbound.identity, inbound.at, titleFor(inbound.identity, inbound.actor.subject));
    if (isFreshSessionCommand(matched.spec.name)) {
      const session = { ...ensured2.session, turn: { kind: "idle" }, queued: [] };
      const after3 = putSession(ensured2.state, session);
      const call = {
        kind: "rotateSession",
        idempotencyKey: idempotencyKey(inbound.id),
        sessionKey: session.key,
        identity: session.identity,
        host: session.host,
        workspace: session.workspace
      };
      return finish(before, after3, [call], []);
    }
    const dispatched2 = dispatchWork(ensured2.session, {
      kind: "command",
      line: inbound.line,
      idempotencyKey: idempotencyKey(inbound.id)
    });
    const after2 = putSession(ensured2.state, dispatched2.session);
    return finish(before, after2, dispatched2.hostCalls, []);
  }
  const ensured = ensureSession(working, inbound.identity, inbound.at, titleFor(inbound.identity, inbound.actor.subject));
  const dispatched = dispatchWork(ensured.session, {
    kind: "prompt",
    prompt: inbound.prompt,
    idempotencyKey: idempotencyKey(inbound.id)
  });
  const after = putSession(ensured.state, dispatched.session);
  return finish(before, after, dispatched.hostCalls, []);
}

// src/host-catalog.ts
function buildCatalog(commands, skills) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  const add = (piece, source) => {
    if (piece.name.length === 0 || seen.has(piece.name)) return;
    seen.add(piece.name);
    out.push({
      name: piece.name,
      description: piece.description,
      ownerOnly: piece.ownerOnly === true,
      source
    });
  };
  for (const command of commands) add(command, "command");
  for (const command of DEFAULT_COMMANDS) add(command, "command");
  for (const skill of skills) add(skill, "skill");
  return { catchAllPrefix: "dsh", commands: out };
}
function formatHelp(catalog) {
  const commands = catalog.commands.filter((spec) => spec.source !== "skill");
  const skills = catalog.commands.filter((spec) => spec.source === "skill");
  const commandBlock = commands.map((spec) => `/${spec.name}  ${spec.description}`).join("\n");
  if (skills.length === 0) return commandBlock || "/help";
  return `${commandBlock}

Skills:
${skills.map((spec) => `/${spec.name}  ${spec.description}`).join("\n")}`;
}
var SLACK_NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/i;
var SLACK_SLASH_CAP = 48;
var FEISHU_NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/i;
var FEISHU_SLASH_CAP = 100;
var FEISHU_DESC_CAP = 100;
function feishuSlashesFromCatalog(catalog) {
  const out = [
    { command: "dsh", description: "Run a DSH command or talk to the agent" }
  ];
  for (const spec of catalog.commands) {
    if (out.length >= FEISHU_SLASH_CAP) break;
    if (!FEISHU_NAME.test(spec.name) || spec.name === "dsh") continue;
    out.push({
      command: spec.name.toLowerCase(),
      description: spec.description.slice(0, FEISHU_DESC_CAP)
    });
  }
  return out;
}
function mergeUserSkills(batches) {
  const byName = /* @__PURE__ */ new Map();
  for (const batch of batches) {
    for (const skill of batch) {
      if (skill.invocation?.userInvocable === false) continue;
      if (skill.name.length === 0 || byName.has(skill.name)) continue;
      byName.set(skill.name, { name: skill.name, description: skill.description });
    }
  }
  return [...byName.values()];
}
function skillListViews(hostSessionIds) {
  const views = [{}];
  const seen = /* @__PURE__ */ new Set();
  for (const id of hostSessionIds) {
    if (id.length === 0 || seen.has(id)) continue;
    seen.add(id);
    views.push({ scope: { session: { id } } });
  }
  return views;
}
function slashesFromCatalog(catalog) {
  const url = "https://dsh.local/slack/commands";
  const out = [
    { command: "/dsh", description: "Run a DSH command or talk to the agent", should_escape: false, url, usage_hint: "[command] [args]" }
  ];
  for (const spec of catalog.commands) {
    if (out.length >= SLACK_SLASH_CAP) break;
    if (!SLACK_NAME.test(spec.name) || spec.name === "dsh") continue;
    out.push({
      command: `/${spec.name}`,
      description: spec.description.slice(0, 140),
      should_escape: false,
      url
    });
  }
  return out;
}

// src/model-command.ts
function parseModelLine(raw) {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return void 0;
  const slash = trimmed.indexOf("/");
  if (slash > 0 && !trimmed.includes(" ")) {
    return { provider: trimmed.slice(0, slash), model: trimmed.slice(slash + 1) };
  }
  return { model: trimmed };
}
function formatModelStatus(pick) {
  if (pick === void 0) {
    return "This Slack session uses the DSH default model from Settings \u2192 \u6A21\u578B. Switch with /model provider/model";
  }
  return `This session: ${pick.provider}/${pick.model}
Switch with /model provider/model  (example: /model pi-openrouter/gpt-5.6)`;
}
async function resolveModelPick(llm, line, current) {
  const parsed = parseModelLine(line);
  if (parsed === void 0) {
    return { ok: false, text: formatModelStatus(current) };
  }
  const provider = parsed.provider ?? current?.provider;
  if (provider !== void 0) {
    try {
      const resolved = await llm.resolveCallConfig({ provider, model: parsed.model });
      return { ok: true, pick: compactPick(resolved) };
    } catch (error) {
      if (parsed.provider !== void 0) {
        return { ok: false, text: error instanceof Error ? error.message : String(error) };
      }
    }
  }
  const matched = await findModel(llm, parsed.model);
  if (matched !== void 0) return { ok: true, pick: matched };
  return { ok: false, text: `Unknown model "${parsed.model}". Use /model provider/model` };
}
async function findModel(llm, needle) {
  const want = needle.toLowerCase();
  for (const route of llm.listProviders()) {
    let models;
    try {
      models = await llm.listModels(route.provider);
    } catch {
      continue;
    }
    const hit = models.find((model) => model.id.toLowerCase() === want || model.id.toLowerCase().endsWith(`/${want}`));
    if (hit === void 0) continue;
    try {
      const resolved = await llm.resolveCallConfig({ provider: route.provider, model: hit.id });
      return compactPick(resolved);
    } catch {
      continue;
    }
  }
  return void 0;
}
function compactPick(resolved) {
  return {
    provider: resolved.provider,
    model: resolved.model,
    ...resolved.reasoningEffort === void 0 ? {} : { reasoningEffort: resolved.reasoningEffort }
  };
}

// src/runtime.ts
import { installModelSelection } from "@deepseek-ai/dsh-agent";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { SessionId } from "@deepseek-ai/dsh-session";
import { randomUUID } from "node:crypto";

// src/persist.ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
function gatewayStatePath() {
  const override = process.env.MESSAGING_GATEWAY_STATE;
  if (override && override.length > 0) return override;
  const home = process.env.DSH_HOME?.trim();
  if (home) return join(home, "messaging-gateway", "state.json");
  return join(homedir(), ".dsh", "messaging-gateway", "state.json");
}
function loadState(path) {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    if (!raw || typeof raw !== "object") return emptyState();
    const version = raw.version;
    if (version !== 1) return emptyState();
    return raw;
  } catch {
    return emptyState();
  }
}
function saveState(path, state) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state), "utf8");
}

// src/feishu-voice.ts
var FEISHU_SPEAKING_CONTRACT_SECTION = "dsh-messaging-gateway:feishu-voice";
var FEISHU_SPEAKING_CONTRACT = [
  "Talk in this Feishu chat like a friend, not a helpdesk.",
  "Visible replies are human sentences. Do not put tool names, thinking drafts, or internal state in the chat body. Tool traces may stay in the session log.",
  "Fast questions: answer directly.",
  "Real work: one sentence of what you are doing, then continue.",
  "Results must be spoken. A working status alone is not done.",
  "Keep it short. Banter is a few words. An explanation is two or three sentences. No memo unless asked.",
  "Lead with the answer or the next step. Do not open with a status word.",
  "On long tasks, update on progress, a result, or a blocker. Do not narrate every command."
].join("\n");
function asHook(agentCtx) {
  return agentCtx;
}
function promptOf(agentCtx) {
  const ctx = asHook(agentCtx);
  if (ctx.systemPrompt?.section) return ctx.systemPrompt;
  const got = ctx.get?.("systemPrompt");
  if (got?.section) return got;
  return void 0;
}
function attachContract(prompt) {
  const base = prompt.getSectionOrder?.("DEPLOYMENT_PERSONA");
  const order = typeof base === "number" && Number.isFinite(base) ? base + 50 : 50;
  prompt.section({
    name: FEISHU_SPEAKING_CONTRACT_SECTION,
    order,
    text: FEISHU_SPEAKING_CONTRACT
  });
}
function installFeishuSpeakingContract(agentCtx) {
  const prompt = promptOf(agentCtx);
  if (prompt) {
    attachContract(prompt);
    return;
  }
  asHook(agentCtx).inject?.(["systemPrompt"], (scoped) => {
    const inner = promptOf(scoped);
    if (inner) attachContract(inner);
  });
}
function outcomeFromAnswer(answer) {
  return answer === "allow-once" ? "allowed-once" : "rejected";
}
function installFeishuApprovalHold(agentCtx, hold) {
  const ctx = asHook(agentCtx);
  const listen = () => ctx.on?.(
    "approval/request",
    ((request, next) => hold(request, next))
  );
  if (typeof ctx.effect === "function") {
    ctx.effect(() => listen() ?? (() => {
    }), "dsh-messaging-gateway: feishu approval");
    return;
  }
  listen();
}

// src/runtime.ts
function assistantTextFromEvent(event) {
  if (event.type !== "assistant/message" || event.data === null || typeof event.data !== "object") return "";
  const message = event.data.message;
  const content = message?.content;
  if (!Array.isArray(content)) return "";
  return content.flatMap((block) => {
    if (!block || typeof block !== "object") return [];
    const row = block;
    if (row.type !== "text" || typeof row.text !== "string" || row.text.length === 0) return [];
    return [row.text];
  }).join("");
}
function turnErrorFromEvent(event) {
  if (event.type !== "turn/end" || event.data === null || typeof event.data !== "object") return void 0;
  const reason = event.data.reason;
  if (reason?.kind !== "error") return void 0;
  const message = reason.error?.message;
  if (typeof message === "string" && message.length > 0) return message;
  return "The agent turn failed.";
}
var GatewayRuntime = class {
  state;
  path;
  agents;
  commands;
  getCommands;
  setupAgent;
  modeled = /* @__PURE__ */ new Set();
  configured = /* @__PURE__ */ new Set();
  seq = 0;
  leftoverCalls = [];
  pending = [];
  flushWork = Promise.resolve();
  skills = [];
  turnStarted = /* @__PURE__ */ new Set();
  turnText = /* @__PURE__ */ new Map();
  feishuVisibleSent = /* @__PURE__ */ new Set();
  approvalWaiters = /* @__PURE__ */ new Map();
  modelPicks = /* @__PURE__ */ new Map();
  outbox = [];
  onDeliveries = () => {
  };
  sinks = [];
  watchDeliveries(fn) {
    this.sinks.push(fn);
    return () => {
      this.sinks = this.sinks.filter((sink) => sink !== fn);
    };
  }
  defaultModel;
  cwd;
  onHostSession;
  onArchiveSession;
  constructor(args) {
    this.path = args.path ?? gatewayStatePath();
    const loaded = args.state ?? loadState(this.path);
    const recovered = recoverTurns(loaded);
    this.state = recovered.state;
    this.leftoverCalls = [];
    this.pending.push(...recovered.hostCalls);
    this.agents = args.agents;
    this.commands = args.commands;
    if (args.getCommands !== void 0) this.getCommands = args.getCommands;
    if (args.setupAgent !== void 0) this.setupAgent = args.setupAgent;
    if (args.defaultModel !== void 0) this.defaultModel = args.defaultModel;
    if (args.skills !== void 0) this.skills = [...args.skills];
    if (args.cwd !== void 0) this.cwd = args.cwd;
    if (args.onHostSession !== void 0) this.onHostSession = args.onHostSession;
    if (args.onArchiveSession !== void 0) this.onArchiveSession = args.onArchiveSession;
    if (recovered.state !== loaded) saveState(this.path, this.state);
  }
  setSkills(skills) {
    this.skills = [...skills];
    this.replaceCatalog([]);
  }
  replaceCatalog(commands) {
    const catalog = buildCatalog(commands, this.skills);
    this.apply({
      kind: "catalog",
      catalog,
      id: this.nextId(),
      at: this.now()
    });
  }
  async run(inbound) {
    await this.flush();
    const result = this.apply(inbound);
    this.pending.push(...result.hostCalls);
    await this.flush();
    return result;
  }
  async flush() {
    this.flushWork = this.flushWork.then(async () => {
      while (this.pending.length > 0) {
        const call = this.pending.shift();
        if (!call) break;
        await this.perform(call);
      }
    });
    return this.flushWork;
  }
  takeRecoveryCalls() {
    const calls = this.leftoverCalls;
    this.leftoverCalls = [];
    return calls;
  }
  apply(inbound) {
    const result = handle(this.state, inbound);
    this.state = result.state;
    saveState(this.path, this.state);
    this.outbox.push(...result.deliveries);
    if (this.outbox.length > 64) this.outbox.splice(0, this.outbox.length - 64);
    this.onDeliveries(result.deliveries);
    for (const sink of this.sinks) sink(result.deliveries);
    if (inbound.kind === "setTitle") {
      this.pinHost(this.state.sessions[sessionKey(inbound.identity)], false);
    }
    return result;
  }
  list() {
    return list(this.state);
  }
  nextId() {
    this.seq += 1;
    return inboundId(`rt-${Date.now()}-${this.seq}`);
  }
  now() {
    return timestamp(Date.now());
  }
  noteAgentStatus(hostId, status) {
    const key = this.keyForHost(hostId);
    if (!key) return;
    if (status === "running") {
      this.beginTurn(hostId, key);
      void this.flush();
      return;
    }
    if (status !== "idle") return;
    this.endTurn(hostId, key);
    void this.flush();
  }
  noteSessionEvent(hostId, event) {
    const key = this.keyForHost(hostId);
    if (!key) return;
    const session = this.state.sessions[key];
    if (event.type === "session/title" && session) {
      const data = event.data;
      const title = typeof data?.title === "string" ? data.title : "";
      const source = data?.source !== null && typeof data?.source === "object" ? data.source.kind : void 0;
      if (title.length > 0 && (source !== "user" || looksLikePromptTitle(title, session.identity))) {
        this.pinHost(session, false);
      }
    }
    const failed = turnErrorFromEvent(event);
    if (failed !== void 0) {
      this.beginTurn(hostId, key);
      this.commit({
        kind: "hostReport",
        sessionKey: key,
        report: { kind: "error", message: failed },
        id: this.nextId(),
        at: this.now()
      });
      void this.flush();
      return;
    }
    if (event.type === "approval/asked") {
      const data = event.data;
      const rawId = typeof data?.id === "string" && data.id.length > 0 ? data.id : `ask-${hostId}-${this.seq + 1}`;
      const summary = typeof data?.reason === "string" && data.reason.length > 0 ? data.reason : typeof data?.toolName === "string" && data.toolName.length > 0 ? data.toolName : "Approval needed";
      this.beginTurn(hostId, key);
      this.ensureApprovalWaiter(hostId);
      this.commit({
        kind: "hostReport",
        sessionKey: key,
        report: {
          kind: "approvalRequested",
          request: {
            requestId: approvalId(rawId),
            summary,
            options: ["allow-once", "deny"]
          }
        },
        id: this.nextId(),
        at: this.now()
      });
      void this.flush();
      return;
    }
    if (event.type === "approval/decided") {
      const data = event.data;
      const rawId = typeof data?.id === "string" && data.id.length > 0 ? data.id : `decided-${hostId}`;
      const answer = data?.outcome === "allowed-once" ? "allow-once" : data?.outcome === "rejected" ? "deny" : void 0;
      this.approvalWaiters.delete(hostId);
      this.commit({
        kind: "hostReport",
        sessionKey: key,
        report: {
          kind: "approvalSettled",
          requestId: approvalId(rawId),
          ...answer ? { answer } : {}
        },
        id: this.nextId(),
        at: this.now()
      });
      void this.flush();
      return;
    }
    const piece = assistantTextFromEvent(event);
    if (piece.length === 0) return;
    this.beginTurn(hostId, key);
    const previous = this.turnText.get(hostId) ?? "";
    this.turnText.set(hostId, previous.length === 0 ? piece : `${previous}

${piece}`);
    if (this.state.sessions[key]?.identity.platform === "feishu") {
      this.feishuVisibleSent.add(hostId);
      this.commit({
        kind: "hostReport",
        sessionKey: key,
        report: { kind: "turnProgress", snapshot: { text: piece, tools: [] } },
        id: this.nextId(),
        at: this.now()
      });
      void this.flush();
    }
  }
  async perform(call) {
    try {
      await this.performInner(call);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[dsh-messaging-gateway] host call failed", message);
      if (call.kind === "ensurePrompt" || call.kind === "ensureCommand" || call.kind === "rotateSession") {
        this.commit({
          kind: "hostReport",
          sessionKey: call.sessionKey,
          report: { kind: "error", message },
          id: this.nextId(),
          at: this.now()
        });
      }
    }
  }
  async performInner(call) {
    if (call.kind === "ensurePrompt" || call.kind === "ensureCommand") {
      const agent = await this.ensureAgent(call);
      if (call.kind === "ensurePrompt") {
        agent.followup(createUserMessage({
          content: [{ type: "text", text: call.prompt.text }],
          source: { kind: "user" }
        }));
        return;
      }
      const raw = call.line.text.replace(/^\//, "");
      const name2 = raw.split(/\s+/)[0] ?? "";
      this.syncCatalog(agent);
      if (name2 === "help" || name2 === "dsh" && raw.split(/\s+/)[1] === "help") {
        this.commit({
          kind: "hostReport",
          sessionKey: call.sessionKey,
          report: { kind: "commandResult", text: formatHelp(this.state.catalog) },
          id: this.nextId(),
          at: this.now()
        });
        return;
      }
      const matched = matchCommand(this.state.catalog, call.line);
      if (matched.kind === "ok" && matched.spec.source === "skill") {
        const text2 = `/${matched.spec.name}${matched.args.length > 0 ? ` ${matched.args}` : ""}`;
        agent.followup(createUserMessage({
          content: [{ type: "text", text: text2 }],
          source: { kind: "user" }
        }));
        return;
      }
      const line = call.line.text.startsWith("/") ? call.line.text : `/${call.line.text}`;
      const commands = this.getCommands?.() ?? this.commands;
      const executed = await commands?.execute(agent, line, [], new AbortController().signal);
      const text = executed && "result" in executed ? executed.result?.text ?? "" : "";
      this.commit({
        kind: "hostReport",
        sessionKey: call.sessionKey,
        report: { kind: "commandResult", text: text || "Unknown command." },
        id: this.nextId(),
        at: this.now()
      });
      return;
    }
    if (call.kind === "rotateSession") {
      await this.rotateAgent(call);
      return;
    }
    if (call.kind === "cancel") {
      this.agents.get(SessionId(call.host.hostSessionId))?.cancel({ kind: "user" });
      return;
    }
    if (call.kind === "answerApproval") {
      this.ensureApprovalWaiter(String(call.host.hostSessionId)).resolve(call.answer);
    }
  }
  beginTurn(hostId, key) {
    if (this.turnStarted.has(hostId)) return;
    this.turnStarted.add(hostId);
    this.turnText.set(hostId, "");
    this.feishuVisibleSent.delete(hostId);
    this.commit({
      kind: "hostReport",
      sessionKey: key,
      report: { kind: "turnStarted" },
      id: this.nextId(),
      at: this.now()
    });
  }
  endTurn(hostId, key) {
    if (!this.turnStarted.has(hostId)) return;
    const text = (this.turnText.get(hostId) ?? "").trim();
    const alreadySent = this.feishuVisibleSent.has(hostId);
    this.turnStarted.delete(hostId);
    this.turnText.delete(hostId);
    this.feishuVisibleSent.delete(hostId);
    if (text.length > 0 && !alreadySent) {
      this.commit({
        kind: "hostReport",
        sessionKey: key,
        report: { kind: "turnProgress", snapshot: { text, tools: [] } },
        id: this.nextId(),
        at: this.now()
      });
    }
    this.commit({
      kind: "hostReport",
      sessionKey: key,
      report: { kind: "turnEnded" },
      id: this.nextId(),
      at: this.now()
    });
  }
  commit(inbound) {
    const result = this.apply(inbound);
    this.pending.push(...result.hostCalls);
    return result;
  }
  syncCatalog(agent) {
    const commands = this.getCommands?.() ?? this.commands;
    const listed = commands?.list(agent) ?? [];
    this.replaceCatalog(listed);
  }
  keyForHost(hostId) {
    for (const session of Object.values(this.state.sessions)) {
      if (session.host.kind === "bound" && String(session.host.hostSessionId) === hostId) {
        return session.key;
      }
    }
    return void 0;
  }
  modelFor(hostId) {
    if (hostId !== void 0) {
      const picked = this.modelPicks.get(hostId);
      if (picked) return { provider: picked.provider, model: picked.model };
    }
    return this.defaultModel?.();
  }
  agentSetup(pick, opts) {
    const feishu = opts?.feishu === true;
    if (!pick && this.setupAgent === void 0 && !feishu) return void 0;
    return (agentCtx) => {
      this.setupAgent?.(agentCtx);
      if (feishu) this.installFeishuSessionHooks(agentCtx);
      if (pick) {
        installModelSelection(agentCtx, {
          current: { provider: pick.provider, model: pick.model },
          assembled: void 0
        });
      }
      const id = agentCtx.agent?.id;
      if (id !== void 0) this.configured.add(String(id));
    };
  }
  sessionIsFeishu(key) {
    if (!key) return false;
    return this.state.sessions[key]?.identity.platform === "feishu";
  }
  hostIsFeishu(hostId) {
    return this.sessionIsFeishu(this.keyForHost(hostId));
  }
  installFeishuSessionHooks(agentCtx) {
    installFeishuSpeakingContract(agentCtx);
    installFeishuApprovalHold(agentCtx, (request, next) => {
      const hostId = String(agentCtx.agent?.id ?? request.agent?.id ?? "");
      return this.holdFeishuApproval(hostId, request, next);
    });
  }
  ensureApprovalWaiter(hostId) {
    const existing = this.approvalWaiters.get(hostId);
    if (existing && !existing.settled) return existing;
    let resolve;
    const promise = new Promise((done) => {
      resolve = done;
    });
    const entry = {
      promise,
      resolve: (answer) => {
        if (entry.settled) return;
        entry.settled = true;
        resolve(answer);
      },
      settled: false
    };
    this.approvalWaiters.set(hostId, entry);
    return entry;
  }
  async holdFeishuApproval(hostId, request, next) {
    const id = hostId || String(request.agent?.id ?? "");
    if (!id) return next();
    const waiter = this.ensureApprovalWaiter(id);
    try {
      return await Promise.race([
        waiter.promise.then(outcomeFromAnswer),
        next()
      ]);
    } catch {
      return "unavailable";
    }
  }
  /** Return the complete setup used for a messaging-owned Agent. */
  setupForAgent(hostId) {
    const pick = hostId === void 0 ? this.modelFor() : this.modelFor(hostId);
    const feishu = hostId !== void 0 && this.hostIsFeishu(hostId);
    return this.agentSetup(pick, { feishu });
  }
  /**
   * Mount messaging-owned scoped contributions onto an already-live Agent.
   * This is used when startup discovers that a persisted session was already
   * resumed by another lifecycle pass, so the resume setup callback did not
   * get a chance to run in this pass.
   */
  ensureAgentSetup(hostId) {
    if (this.configured.has(hostId)) return;
    const agent = this.agents.get(SessionId(hostId));
    if (!agent?.ctx) return;
    this.setupAgent?.(agent.ctx);
    if (this.hostIsFeishu(hostId)) this.installFeishuSessionHooks(agent.ctx);
    this.configured.add(hostId);
  }
  attachModel(hostId, agent, pick) {
    if (!pick || this.modeled.has(hostId)) return;
    if (agent.ctx) {
      installModelSelection(agent.ctx, {
        current: { provider: pick.provider, model: pick.model },
        assembled: void 0
      });
    }
    this.modeled.add(hostId);
    this.modelPicks.set(hostId, pick);
  }
  pinHost(session, created) {
    if (!session || session.host.kind !== "bound" || !this.onHostSession) return;
    const cwd = this.cwd?.() ?? process.cwd();
    this.onHostSession({
      id: String(session.host.hostSessionId),
      title: session.title,
      cwd,
      created,
      recents: isMainConversation(session.identity)
    });
  }
  archiveHost(id) {
    this.onArchiveSession?.(id);
  }
  async rotateAgent(call) {
    this.pending = this.pending.filter((item) => item.sessionKey !== call.sessionKey);
    const ids = /* @__PURE__ */ new Set();
    if (call.host.kind === "bound") ids.add(String(call.host.hostSessionId));
    const current = this.state.sessions[call.sessionKey];
    if (current?.host.kind === "bound") ids.add(String(current.host.hostSessionId));
    for (const id of ids) {
      this.agents.get(SessionId(id))?.cancel({ kind: "user" });
      this.archiveHost(id);
    }
    await this.bindNewAgent(call.sessionKey);
    this.commit({
      kind: "hostReport",
      sessionKey: call.sessionKey,
      report: { kind: "commandResult", text: "Started a new session." },
      id: this.nextId(),
      at: this.now()
    });
  }
  async ensureAgent(call) {
    if (call.host.kind === "bound") {
      const live = this.agents.get(SessionId(call.host.hostSessionId));
      if (live) {
        this.ensureAgentSetup(String(call.host.hostSessionId));
        this.attachModel(String(call.host.hostSessionId), live, this.modelFor(String(call.host.hostSessionId)));
        return live;
      }
      const pick = this.modelFor(String(call.host.hostSessionId));
      const setup = this.agentSetup(pick, { feishu: this.sessionIsFeishu(call.sessionKey) });
      const resumed = await this.agents.resume({
        resumeSessionId: SessionId(call.host.hostSessionId),
        ...pick ? { agentOptions: { provider: pick.provider, model: pick.model } } : {},
        ...setup ? { setup } : {}
      });
      this.pinHost(this.state.sessions[call.sessionKey], false);
      return resumed.agent;
    }
    return this.bindNewAgent(call.sessionKey);
  }
  async bindNewAgent(key) {
    const sessionId = SessionId(`session-${randomUUID()}`);
    const pick = this.modelFor(String(sessionId));
    const setup = this.agentSetup(pick, { feishu: this.sessionIsFeishu(key) });
    const cwd = this.cwd?.() ?? process.cwd();
    const created = await this.agents.create({
      sessionId,
      meta: { cwd },
      ...pick ? { agentOptions: { provider: pick.provider, model: pick.model } } : {},
      ...setup ? { setup } : {}
    });
    if (pick) this.modelPicks.set(String(sessionId), pick);
    this.commit({
      kind: "hostReport",
      sessionKey: key,
      report: { kind: "bound", hostSessionId: hostSessionId(String(sessionId)) },
      id: this.nextId(),
      at: this.now()
    });
    this.pinHost(this.state.sessions[key], true);
    return created.agent;
  }
};
function captureAgents(ctx) {
  const agents = ctx.agents;
  return {
    get: (id) => agents.get(id),
    create: async (opts) => {
      const handle2 = await agents.create(opts);
      return { agent: handle2.agent, dispose: () => {
        void handle2.dispose();
      } };
    },
    resume: async (opts) => {
      const handle2 = await agents.resume(opts);
      return { agent: handle2.agent, dispose: () => {
        void handle2.dispose();
      } };
    }
  };
}
function captureCommands(ctx) {
  const commands = ctx.get("commands");
  return commands;
}

// src/feishu-slash.ts
var FEISHU_DESC_CAP2 = 100;
function clampFeishuDescription(text) {
  return text.slice(0, FEISHU_DESC_CAP2);
}
function planFeishuSlashSync(desired, remote) {
  const want = new Map(desired.map((item) => [item.command, item]));
  const have = new Map(remote.map((item) => [item.command, item]));
  const create = [];
  const update = [];
  const remove = [];
  for (const [name2, slash] of want) {
    const existing = have.get(name2);
    if (!existing) {
      create.push(slash);
      continue;
    }
    const current = existing.description?.default_value ?? "";
    if (current !== slash.description) update.push({ id: existing.command_id, description: slash.description });
  }
  for (const [name2, item] of have) {
    if (!want.has(name2)) remove.push(item.command_id);
  }
  return { create, update, remove };
}
async function syncFeishuSlashes(http, desired) {
  const token = await http.getToken();
  const remote = await http.list(token);
  const plan = planFeishuSlashSync(desired, remote);
  for (const slash of plan.create) await http.create(token, slash);
  for (const row of plan.update) await http.update(token, row.id, row.description);
  for (const id of plan.remove) await http.remove(token, id);
  return plan;
}
async function feishuJson(url, init) {
  const response = await fetch(url, init);
  const body = await response.json();
  if (body.code !== 0 && body.code !== void 0) {
    throw new Error(body.msg || `feishu ${url} failed`);
  }
  return body;
}
function feishuSlashHttp(appId, appSecret) {
  const headers = (token) => ({
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json; charset=utf-8"
  });
  return {
    getToken: async () => {
      const body = await feishuJson("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ app_id: appId, app_secret: appSecret })
      });
      if (!body.tenant_access_token) throw new Error("feishu token missing");
      return body.tenant_access_token;
    },
    list: async (token) => {
      const body = await feishuJson("https://open.feishu.cn/open-apis/application/v7/app_slash_commands", {
        method: "GET",
        headers: headers(token)
      });
      return body.data?.items ?? [];
    },
    create: async (token, slash) => {
      try {
        await feishuJson("https://open.feishu.cn/open-apis/application/v7/app_slash_commands", {
          method: "POST",
          headers: headers(token),
          body: JSON.stringify({
            command: slash.command,
            description: {
              default_value: clampFeishuDescription(slash.description),
              i18n: {
                zh_cn: clampFeishuDescription(slash.description),
                en_us: clampFeishuDescription(slash.description)
              }
            },
            icon: { icon_key: "skill_outlined" }
          })
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/already exists/i.test(message)) throw error;
      }
    },
    update: async (token, id, description) => {
      const clipped = clampFeishuDescription(description);
      await feishuJson(`https://open.feishu.cn/open-apis/application/v7/app_slash_commands/${id}`, {
        method: "PATCH",
        headers: headers(token),
        body: JSON.stringify({
          description: {
            default_value: clipped,
            i18n: { zh_cn: clipped, en_us: clipped }
          }
        })
      });
    },
    remove: async (token, id) => {
      await feishuJson(`https://open.feishu.cn/open-apis/application/v7/app_slash_commands/${id}`, {
        method: "DELETE",
        headers: headers(token)
      });
    }
  };
}

// src/present.ts
function textFromDelivery(delivery) {
  if (delivery.kind !== "chat") return void 0;
  const body = delivery.body;
  switch (body.kind) {
    case "pairingCode":
      return `Pairing code: ${body.code}. Approve it in DSH Messaging settings.`;
    case "rejectCommand":
      return body.reason === "unknown" ? "Unknown command." : "That command is owner-only.";
    case "commandResult":
      return body.text;
    case "notice":
      return body.text;
    case "busy":
      return body.on ? "Working\u2026" : void 0;
    case "stream":
      return body.snapshot?.text;
    case "approval":
      if (body.handled) return void 0;
      return `Approval needed: ${body.request.summary}`;
    case "files":
      return body.files.map((file) => file.name).join(", ");
    default: {
      const _exhaustive = body;
      void _exhaustive;
      return void 0;
    }
  }
}

// src/feishu-card.ts
var FEISHU = platformId("feishu");
var FEISHU_CARD_KIND = "dsh-approval";
function button(label, answer, identity, requestId, type) {
  const value = {
    kind: FEISHU_CARD_KIND,
    requestId,
    answer,
    chatKind: identity.kind,
    chatId: String(identity.chatId),
    ...identity.threadId ? { threadId: String(identity.threadId) } : {}
  };
  return {
    tag: "button",
    text: { tag: "plain_text", content: label },
    type,
    value
  };
}
function feishuApprovalCard(request, identity) {
  const requestId = String(request.requestId);
  const actions = [];
  const options = request.options.length > 0 ? request.options : ["allow-once", "deny"];
  if (options.includes("allow-once")) {
    actions.push(button("\u5141\u8BB8\u4E00\u6B21", "allow-once", identity, requestId, "primary"));
  }
  if (options.includes("deny")) {
    actions.push(button("\u62D2\u7EDD", "deny", identity, requestId, "danger"));
  }
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: "plain_text", content: "\u9700\u8981\u6279\u51C6" },
      template: "orange"
    },
    elements: [
      {
        tag: "div",
        text: { tag: "lark_md", content: request.summary }
      },
      {
        tag: "action",
        actions
      }
    ]
  };
}
function handledFeishuCard(request, answer) {
  const note = answer === "allow-once" ? "\u5DF2\u5141\u8BB8\u4E00\u6B21" : answer === "deny" ? "\u5DF2\u62D2\u7EDD" : "\u5DF2\u5904\u7406";
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: "plain_text", content: "\u5DF2\u5904\u7406" },
      template: "grey"
    },
    elements: [
      {
        tag: "div",
        text: { tag: "lark_md", content: request.summary }
      },
      {
        tag: "note",
        elements: [{ tag: "plain_text", content: note }]
      }
    ]
  };
}
function parseValue(raw) {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return void 0;
    }
  }
  if (!value || typeof value !== "object") return void 0;
  const row = value;
  if (row.kind !== FEISHU_CARD_KIND) return void 0;
  if (typeof row.requestId !== "string" || row.requestId.length === 0) return void 0;
  if (row.answer !== "allow-once" && row.answer !== "deny") return void 0;
  if (row.chatKind !== "dm" && row.chatKind !== "group") return void 0;
  if (typeof row.chatId !== "string" || row.chatId.length === 0) return void 0;
  return {
    kind: FEISHU_CARD_KIND,
    requestId: row.requestId,
    answer: row.answer,
    chatKind: row.chatKind,
    chatId: row.chatId,
    ...typeof row.threadId === "string" && row.threadId.length > 0 ? { threadId: row.threadId } : {}
  };
}
function inboundFromFeishuCardAction(event) {
  const value = parseValue(event.action?.value);
  if (!value) return void 0;
  const user = event.operator?.open_id ?? event.open_id;
  const chat2 = event.context?.open_chat_id ?? event.open_chat_id ?? value.chatId;
  if (!user || !chat2) return void 0;
  const identity = {
    platform: FEISHU,
    kind: value.chatKind,
    chatId: chatId(chat2),
    threadId: value.threadId ? threadId(value.threadId) : null
  };
  const clickId = event.context?.open_message_id ?? event.open_message_id ?? `${value.requestId}:${user}:${value.answer}`;
  return {
    kind: "approvalAnswer",
    actor: { platform: identity.platform, subject: subjectId(user) },
    identity,
    requestId: approvalId(value.requestId),
    answer: value.answer,
    id: inboundId(`card:${clickId}:${value.requestId}:${value.answer}:${user}`),
    at: timestamp(Date.now())
  };
}

// src/feishu.ts
var FEISHU2 = platformId("feishu");
function feishuIdentity(args) {
  const kind = args.chatType === "p2p" ? "dm" : "group";
  return {
    platform: FEISHU2,
    kind,
    chatId: chatId(args.chatId),
    threadId: args.threadId ? threadId(args.threadId) : null
  };
}
function textFromFeishuContent(content) {
  if (!content) return "";
  try {
    const parsed = JSON.parse(content);
    if (typeof parsed.text === "string") return parsed.text.replace(/@_user_\d+/g, "").trim();
  } catch {
    return content.trim();
  }
  return content.trim();
}
function inboundFromFeishu(args) {
  const identity = feishuIdentity({
    chatId: args.chatId,
    ...args.chatType ? { chatType: args.chatType } : {},
    ...args.threadId ? { threadId: args.threadId } : {}
  });
  const actor = { platform: FEISHU2, subject: subjectId(args.user) };
  const addressing = identity.kind === "dm" ? { kind: "dm" } : { kind: "group", mentioned: args.mentioned === true, botInvited: false };
  const text = args.text.trim();
  const first = text.split(/\s+/)[0] ?? "";
  const names = new Set((args.commands ?? []).map((name2) => name2.toLowerCase()));
  const isCommand = text.startsWith("/") || text.startsWith("!") || names.has(first.toLowerCase());
  const line = isCommand ? text.replace(/^[/!]/, "") : text;
  const meta = { id: inboundId(args.id), at: timestamp(Date.now()) };
  if (isCommand) {
    return { kind: "command", actor, identity, addressing, line: { text: line }, ...meta };
  }
  return { kind: "message", actor, identity, addressing, prompt: { text, attachments: [] }, ...meta };
}
function inboundFromFeishuEvent(event, commands) {
  const sender = event.sender;
  const message = event.message;
  if (sender?.sender_type === "bot") return void 0;
  const user = sender?.sender_id?.open_id;
  const chat2 = message?.chat_id;
  const id = message?.message_id;
  if (!user || !chat2 || !id) return void 0;
  if (message.message_type && message.message_type !== "text") return void 0;
  const mentioned = (message.mentions ?? []).some((item) => item.mentioned_type === "bot");
  return inboundFromFeishu({
    user,
    chatId: chat2,
    ...message.chat_type ? { chatType: message.chat_type } : {},
    ...message.thread_id ? { threadId: message.thread_id } : {},
    text: textFromFeishuContent(message.content),
    id,
    ...mentioned ? { mentioned: true } : {},
    commands
  });
}
function feishuOutboundFromDelivery(delivery, cards) {
  if (delivery.kind !== "chat" || delivery.identity.platform !== FEISHU2) return void 0;
  const chat2 = String(delivery.identity.chatId);
  const replyId = delivery.identity.threadId ? String(delivery.identity.threadId) : void 0;
  const body = delivery.body;
  if (body.kind === "approval") {
    const requestId = String(body.request.requestId);
    if (body.handled) {
      const messageId = cards.get(requestId);
      if (!messageId) return void 0;
      return {
        chatId: chat2,
        msgType: "interactive",
        content: JSON.stringify(handledFeishuCard(body.request, body.answer)),
        mode: "patch",
        messageId,
        requestId
      };
    }
    return {
      chatId: chat2,
      ...replyId ? { replyId } : {},
      msgType: "interactive",
      content: JSON.stringify(feishuApprovalCard(body.request, delivery.identity)),
      mode: "create",
      requestId
    };
  }
  const text = textFromDelivery(delivery);
  if (!text) return void 0;
  return {
    chatId: chat2,
    ...replyId ? { replyId } : {},
    msgType: "text",
    content: JSON.stringify({ text }),
    mode: "create"
  };
}
async function presentFeishuDelivery(delivery, say, cards = /* @__PURE__ */ new Map()) {
  const outbound = feishuOutboundFromDelivery(delivery, cards);
  if (!outbound) return;
  const posted = await say(outbound);
  if (outbound.mode === "create" && outbound.msgType === "interactive" && outbound.requestId) {
    const messageId = posted && typeof posted === "object" ? posted.messageId : void 0;
    if (typeof messageId === "string" && messageId.length > 0) cards.set(outbound.requestId, messageId);
  }
}
async function syncFeishuCatalog(runtime, tokens) {
  const desired = feishuSlashesFromCatalog(runtime.state.catalog);
  await syncFeishuSlashes(feishuSlashHttp(tokens.appId, tokens.appSecret), desired);
}
async function runFeishu(runtime, tokens) {
  const Lark = await import("@larksuiteoapi/node-sdk");
  const client = new Lark.Client({ appId: tokens.appId, appSecret: tokens.appSecret });
  const cards = /* @__PURE__ */ new Map();
  const unwatch = runtime.watchDeliveries((deliveries) => {
    for (const delivery of deliveries) {
      if (delivery.kind !== "chat" || delivery.identity.platform !== FEISHU2) continue;
      void presentFeishuDelivery(delivery, async (out) => {
        if (out.mode === "patch" && out.messageId) {
          await client.im.v1.message.patch({
            path: { message_id: out.messageId },
            data: { content: out.content }
          });
          return;
        }
        if (out.replyId && out.replyId.startsWith("om_")) {
          const replied = await client.im.v1.message.reply({
            path: { message_id: out.replyId },
            data: { content: out.content, msg_type: out.msgType }
          });
          return { messageId: replied.data?.message_id };
        }
        const created = await client.im.v1.message.create({
          params: { receive_id_type: "chat_id" },
          data: {
            receive_id: out.chatId,
            msg_type: out.msgType,
            content: out.content
          }
        });
        return { messageId: created.data?.message_id };
      }, cards).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[dsh-messaging-gateway] feishu delivery failed", message);
      });
    }
  });
  const commandsOf = () => runtime.state.catalog.commands.map((spec) => spec.name);
  const pinTitle = (identity, peerName) => {
    runtime.apply({
      kind: "setTitle",
      identity,
      title: displayTitle(identity, peerName ? { peerName } : {}),
      id: runtime.nextId(),
      at: runtime.now()
    });
  };
  const wsClient = new Lark.WSClient({ appId: tokens.appId, appSecret: tokens.appSecret });
  const started = wsClient.start({
    eventDispatcher: new Lark.EventDispatcher({}).register({
      "im.message.receive_v1": async (data) => {
        const inbound = inboundFromFeishuEvent(data, commandsOf());
        if (!inbound) return;
        await runtime.run(inbound);
        if (inbound.kind === "message" || inbound.kind === "command") pinTitle(inbound.identity);
      },
      "card.action.trigger": async (data) => {
        const inbound = inboundFromFeishuCardAction(data);
        if (!inbound) return;
        await runtime.run(inbound);
      }
    })
  });
  await Promise.resolve(started).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[dsh-messaging-gateway] feishu ws start failed", message);
  });
  try {
    await syncFeishuCatalog(runtime, tokens);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[dsh-messaging-gateway] feishu slash sync failed", message);
  }
  for (const session of Object.values(runtime.state.sessions)) {
    if (session.identity.platform !== FEISHU2) continue;
    pinTitle(session.identity);
  }
  return async () => {
    unwatch();
    wsClient.close();
  };
}

// src/host-cwd.ts
function isUnder(child, parent) {
  if (child === parent) return true;
  const prefix = parent.endsWith("/") ? parent : `${parent}/`;
  return child.startsWith(prefix);
}
function pickMessagingCwd(input) {
  const paths = (input.workspaces ?? []).map((item) => item.path).filter((path) => path.length > 0);
  if (paths.length > 0) {
    const roots = paths.filter((path) => !paths.some((other) => other !== path && isUnder(path, other)));
    roots.sort((a, b) => a.length - b.length);
    return roots[0] ?? paths[0] ?? input.fallback;
  }
  for (const session of input.live ?? []) {
    if (input.skipIds.has(String(session.id))) continue;
    const cwd = session.header?.cwd;
    if (typeof cwd === "string" && cwd.length > 0) return cwd;
  }
  return input.fallback;
}

// src/slack.ts
var SLACK = platformId("slack");
function peerNameFromSlackUser(user) {
  const pieces = [user?.profile?.display_name, user?.profile?.real_name, user?.real_name, user?.name];
  for (const piece of pieces) {
    if (typeof piece === "string" && piece.trim().length > 0) return piece.trim();
  }
  return void 0;
}
function labelsFromConversation(channel) {
  if (!channel) return {};
  if (channel.is_im === true && channel.user) return { imUser: channel.user };
  if (typeof channel.name === "string" && channel.name.length > 0) return { chatName: channel.name };
  return {};
}
function slackIdentity(args) {
  const kind = args.channel.startsWith("D") ? "dm" : "group";
  return {
    platform: SLACK,
    kind,
    chatId: chatId(args.channel),
    threadId: args.threadTs ? threadId(args.threadTs) : null
  };
}
function inboundFromSlack(args) {
  const identity = args.threadTs ? slackIdentity({ channel: args.channel, threadTs: args.threadTs }) : slackIdentity({ channel: args.channel });
  const actor = { platform: SLACK, subject: subjectId(args.user) };
  const addressing = identity.kind === "dm" ? { kind: "dm" } : { kind: "group", mentioned: args.mentioned === true || args.text.includes("<@"), botInvited: false };
  const text = args.text.trim();
  const isCommand = text.startsWith("/") || text.startsWith("!");
  const line = isCommand ? text.replace(/^[/!]/, "") : text;
  const meta = { id: inboundId(args.id), at: timestamp(Date.now()) };
  if (isCommand) {
    return { kind: "command", actor, identity, addressing, line: { text: line }, ...meta };
  }
  return { kind: "message", actor, identity, addressing, prompt: { text, attachments: [] }, ...meta };
}
async function presentSlackDelivery(delivery, say) {
  if (delivery.kind !== "chat") return;
  const thread_ts = delivery.identity.threadId ?? void 0;
  const body = delivery.body;
  let text;
  switch (body.kind) {
    case "pairingCode":
      text = `Pairing code: ${body.code}. Approve it in DSH Messaging settings.`;
      break;
    case "rejectCommand":
      text = body.reason === "unknown" ? "Unknown command." : "That command is owner-only.";
      break;
    case "commandResult":
      text = body.text;
      break;
    case "notice":
      text = body.text;
      break;
    case "busy":
      text = body.on ? "Working\u2026" : void 0;
      break;
    case "stream":
      text = body.snapshot?.text;
      break;
    case "approval":
      text = body.handled ? void 0 : `Approval needed: ${body.request.summary}`;
      break;
    case "files":
      text = body.files.map((f) => f.name).join(", ");
      break;
    default: {
      const _exhaustive = body;
      void _exhaustive;
    }
  }
  if (!text) return;
  if (thread_ts) await say({ text, thread_ts });
  else await say({ text });
}
async function runSlack(runtime, tokens) {
  const { App } = await import("@slack/bolt");
  const app = new App({ token: tokens.bot, appToken: tokens.app, socketMode: true });
  const unwatch = runtime.watchDeliveries((deliveries) => {
    for (const d of deliveries) {
      if (d.kind !== "chat" || d.identity.platform !== SLACK) continue;
      void presentSlackDelivery(d, async (args) => {
        if (args.thread_ts) {
          return app.client.chat.postMessage({ channel: d.identity.chatId, text: args.text, thread_ts: args.thread_ts });
        }
        return app.client.chat.postMessage({ channel: d.identity.chatId, text: args.text });
      }).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[dsh-messaging-gateway] slack delivery failed", message);
      });
    }
  });
  const seen = /* @__PURE__ */ new Set();
  const take = (id) => {
    if (seen.has(id)) return false;
    seen.add(id);
    if (seen.size > 512) seen.clear();
    return true;
  };
  const names = /* @__PURE__ */ new Map();
  const resolveLabels = async (channel, fallbackUser) => {
    const cached = names.get(channel);
    if (cached) return cached;
    try {
      const info = await app.client.conversations.info({ channel });
      const fromChannel = labelsFromConversation(info.channel);
      if (fromChannel.imUser) {
        const userInfo = await app.client.users.info({ user: fromChannel.imUser });
        const peerName = peerNameFromSlackUser(userInfo.user) ?? fromChannel.imUser;
        const labels2 = { peerName };
        names.set(channel, labels2);
        return labels2;
      }
      const labels = fromChannel.chatName ? { chatName: fromChannel.chatName } : {};
      if (labels.chatName || labels.peerName) names.set(channel, labels);
      return labels;
    } catch {
      return fallbackUser ? { peerName: fallbackUser } : {};
    }
  };
  const pinTitle = async (identity, channel, user) => {
    const labels = await resolveLabels(channel, identity.kind === "dm" ? user : void 0);
    const title = displayTitle(identity, labels);
    runtime.apply({
      kind: "setTitle",
      identity,
      title,
      id: runtime.nextId(),
      at: runtime.now()
    });
  };
  const ingest = async (args) => {
    if (!take(args.id)) return;
    const inbound = inboundFromSlack(args);
    await runtime.run(inbound);
    if (inbound.kind === "message" || inbound.kind === "command") {
      void pinTitle(inbound.identity, args.channel, args.user).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[dsh-messaging-gateway] slack title failed", message);
      });
    }
  };
  app.message(async ({ message }) => {
    if (!("user" in message) || !message.user || !("text" in message) || !message.text) return;
    const threadTs = "thread_ts" in message && typeof message.thread_ts === "string" ? message.thread_ts : "";
    await ingest({
      user: message.user,
      channel: message.channel,
      ...threadTs ? { threadTs } : {},
      text: message.text,
      id: message.ts
    });
  });
  app.event("app_mention", async ({ event }) => {
    if (!("user" in event) || !event.user || !event.text) return;
    await ingest({
      user: event.user,
      channel: event.channel,
      ...event.thread_ts ? { threadTs: event.thread_ts } : {},
      text: event.text,
      id: event.ts,
      mentioned: true
    });
  });
  app.command(/.*/, async ({ command, ack }) => {
    await ack();
    await ingest({
      user: command.user_id,
      channel: command.channel_id,
      ...command.thread_ts ? { threadTs: command.thread_ts } : {},
      text: `${command.command} ${command.text}`,
      id: `slash-${command.trigger_id}`
    });
  });
  await app.start();
  for (const session of Object.values(runtime.state.sessions)) {
    if (session.identity.platform !== SLACK) continue;
    void pinTitle(session.identity, String(session.identity.chatId)).catch(() => {
    });
  }
  return async () => {
    unwatch();
    await app.stop();
  };
}

// src/slack-manifest.ts
function slackManifest(slashes) {
  const commands = slashes && slashes.length > 0 ? slashes : slashesFromCatalog(buildCatalog([], []));
  return {
    display_information: {
      name: "DSH",
      description: "DeepSeek Harness on Slack. Socket Mode. Your tokens stay on your machine.",
      background_color: "#111111"
    },
    features: {
      app_home: {
        home_tab_enabled: false,
        messages_tab_enabled: true,
        messages_tab_read_only_enabled: false
      },
      bot_user: {
        display_name: "DSH",
        always_online: true
      },
      slash_commands: commands
    },
    oauth_config: {
      scopes: {
        bot: [
          "app_mentions:read",
          "channels:history",
          "channels:read",
          "chat:write",
          "commands",
          "files:read",
          "files:write",
          "groups:history",
          "groups:read",
          "im:history",
          "im:read",
          "im:write",
          "mpim:history",
          "mpim:read",
          "reactions:read",
          "users:read"
        ]
      }
    },
    settings: {
      event_subscriptions: {
        bot_events: [
          "app_mention",
          "message.channels",
          "message.groups",
          "message.im",
          "message.mpim"
        ]
      },
      interactivity: { is_enabled: true },
      org_deploy_enabled: false,
      socket_mode_enabled: true,
      token_rotation_enabled: false
    }
  };
}

// src/dsh-messaging-gateway.ts
function gatewayHostIds(runtime) {
  const ids = /* @__PURE__ */ new Set();
  for (const session of Object.values(runtime.state.sessions)) {
    if (session.host.kind === "bound") ids.add(String(session.host.hostSessionId));
  }
  return ids;
}
function liveCwd(ctx, skip) {
  const sessions = ctx.get("sessions");
  const registry = ctx.get("workspaceRegistry");
  return pickMessagingCwd({
    skipIds: skip,
    live: sessions?.list?.() ?? [],
    workspaces: registry?.list?.() ?? [],
    fallback: process.cwd()
  });
}
function pinSessionTitle(ctx, id, title) {
  if (title.trim().length === 0) return;
  try {
    const sessions = ctx.get("sessions");
    const titles = ctx.get("sessionTitle");
    const session = sessions?.get?.(SessionId2(id));
    if (!session || !titles?.rename) {
      if (!session) console.error("[dsh-messaging-gateway] session title skipped, not live", id);
      return;
    }
    titles.rename(session, title);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[dsh-messaging-gateway] session title failed", message);
  }
}
function archiveHostSession(ctx, id) {
  const registry = ctx.get("workspaceRegistry");
  if (!registry?.archiveSession) return;
  void registry.archiveSession(SessionId2(id)).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[dsh-messaging-gateway] session archive failed", message);
  });
}
function attachWorkspace(ctx, id, cwd) {
  const registry = ctx.get("workspaceRegistry");
  if (!registry) return;
  void (async () => {
    try {
      let workspace = registry.resolveByPath ? await registry.resolveByPath(cwd) : registry.list?.().find((item) => item.path === cwd);
      if (!workspace && registry.create) workspace = await registry.create(cwd, "Messaging");
      await workspace?.attachSession?.(SessionId2(id));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[dsh-messaging-gateway] workspace attach failed", message);
    }
  })();
}
function boundHostIds(runtime) {
  const ids = [];
  for (const session of Object.values(runtime.state.sessions)) {
    if (session.host.kind === "bound") ids.push(String(session.host.hostSessionId));
  }
  return ids;
}
function placeBoundSessions(ctx, runtime, after) {
  const sessions = ctx.get("sessions");
  void (async () => {
    for (const row of Object.values(runtime.state.sessions)) {
      if (row.host.kind !== "bound") continue;
      const id = String(row.host.hostSessionId);
      let resumed = false;
      try {
        const setup = runtime.setupForAgent(id);
        await ctx.agents.resume({
          resumeSessionId: SessionId2(id),
          ...setup ? { setup } : {}
        });
        resumed = true;
      } catch {
      }
      if (!resumed) runtime.ensureAgentSetup(id);
      pinSessionTitle(ctx, id, row.title);
      if (!isMainConversation(row.identity)) {
        archiveHostSession(ctx, id);
        continue;
      }
      const live = sessions?.get?.(SessionId2(id));
      const listed = sessions?.list?.().find((item) => String(item.id) === id);
      const path = listed?.header?.cwd ?? live?.header?.cwd;
      if (path) attachWorkspace(ctx, id, path);
    }
    if (after) await after();
  })();
}
var name = "dsh-messaging-gateway";
var inject = ["agents", "commands"];
var Config = z.object({
  enabled: z.boolean().default(true),
  slackBotToken: z.string().role("secret").default(""),
  slackAppToken: z.string().role("secret").default(""),
  slackOwner: z.string().default(""),
  feishuAppId: z.string().default(""),
  feishuAppSecret: z.string().role("secret").default(""),
  feishuOwner: z.string().default("")
});
function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body, null, 2));
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => {
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (raw.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}
function html(res, body) {
  res.statusCode = 200;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(body);
}
function setupPage(catalogSlashes) {
  const manifest = JSON.stringify(slackManifest(catalogSlashes), null, 2);
  return `<!doctype html>
<meta charset="utf-8">
<title>\u7ED1\u5B9A DSH \u5230\u4F60\u7684 Slack</title>
<body style="font:16px/1.5 system-ui;max-width:720px;margin:40px auto;padding:0 16px">
<h1>\u7ED1\u5B9A\u4F60\u7684 Slack</h1>
<p>\u6CA1\u6709\u5B98\u65B9\u5171\u7528 bot\u3002Slack \u548C\u98DE\u4E66\u90FD\u5728\u4F60\u7684\u6D4F\u89C8\u5668\u91CC\u7ED1\u5B9A\uFF0Ctoken \u53EA\u5B58\u4F60\u8FD9\u53F0 DSH\u3002\u98DE\u4E66\u8F93\u5165 <code>/</code> \u5F39\u51FA\u7684\u6307\u4EE4\u6765\u81EA\u540C\u4E00\u4EFD DSH \u547D\u4EE4\u76EE\u5F55\u3002</p>
<ol>
<li><a href="https://api.slack.com/apps?new_app=1" target="_blank" rel="noreferrer">\u6253\u5F00 Slack \u521B\u5EFA\u5E94\u7528\uFF08From an app manifest\uFF09</a>\uFF0C\u767B\u5F55\u4F60\u81EA\u5DF1\u7684 workspace\uFF0C\u628A\u4E0B\u9762\u6E05\u5355\u6574\u6BB5\u8D34\u8FDB\u53BB\uFF0CCreate\uFF0C\u7136\u540E Install to workspace\u3002</li>
<li>\u56DE\u5230 <strong>DSH Web \u2192 \u8BBE\u7F6E \u2192 \u6D88\u606F</strong>\uFF0C\u586B Bot Token\uFF08xoxb-\uFF09\u3001App Token\uFF08xapp-\uFF0CSocket Mode / connections:write\uFF09\u3001\u4F60\u7684 member id\uFF08\u5934\u50CF \u2192 Copy member ID\uFF09\u3002\u70B9\u4FDD\u5B58\u5E76\u8FDE\u63A5\u3002</li>
</ol>
<p><button type="button" id="copy">\u590D\u5236 Manifest</button> <a href="/plugins/dsh-messaging-gateway/slack-manifest">JSON</a></p>
<pre id="manifest" style="white-space:pre-wrap;background:#111;color:#eee;padding:12px;border-radius:8px">${manifest.replace(/</g, "&lt;")}</pre>
<script>
document.getElementById('copy').onclick = () => {
  navigator.clipboard.writeText(document.getElementById('manifest').innerText)
  document.getElementById('copy').textContent = '\u5DF2\u590D\u5236'
}
</script>
</body>`;
}
function apply(ctx, config) {
  console.log("[my-plugins/dsh-messaging-gateway] loaded");
  const getLlm = () => ctx.get("llm");
  let runtime;
  const registerModel = (commandHost) => commandHost.register({
    name: "model",
    description: "Show or switch this session model",
    input: { hint: "[provider/model]", images: false },
    handler: async (invocation) => {
      const key = String(invocation.agent.id);
      const llm = getLlm();
      if (llm === void 0) {
        return { kind: "error", text: "Model switching is unavailable on this Host." };
      }
      const current = runtime.modelPicks.get(key);
      if (invocation.rawInput.trim().length === 0) {
        return { kind: "success", text: formatModelStatus(current) };
      }
      const resolved = await resolveModelPick(llm, invocation.rawInput, current);
      if (!resolved.ok) return { kind: "error", text: resolved.text };
      runtime.modelPicks.set(key, resolved.pick);
      return { kind: "success", text: `This Slack session now uses ${resolved.pick.provider}/${resolved.pick.model}. Later turns follow this pick.` };
    }
  });
  const setupAgent = (agentCtx) => {
    const commandHost = agentCtx.get("commands");
    if (!commandHost) return;
    agentCtx.effect(() => registerModel(commandHost), "dsh-messaging-gateway: /model");
  };
  const agents = captureAgents(ctx);
  runtime = new GatewayRuntime({
    agents,
    getCommands: () => captureCommands(ctx),
    setupAgent,
    defaultModel: () => {
      const svc = ctx.get("agentDefaultModel");
      return svc?.currentSelection?.();
    },
    cwd: () => liveCwd(ctx, gatewayHostIds(runtime)),
    onHostSession: ({ id, title, cwd, created, recents }) => {
      pinSessionTitle(ctx, id, title);
      if (!created) return;
      if (recents) attachWorkspace(ctx, id, cwd);
      else archiveHostSession(ctx, id);
    },
    onArchiveSession: (id) => {
      archiveHostSession(ctx, id);
    }
  });
  runtime.replaceCatalog([]);
  const pullSkills = async () => {
    const skills = ctx.get("skills");
    if (!skills?.list) return;
    const batches = [];
    for (const view of skillListViews(boundHostIds(runtime))) {
      try {
        batches.push(await skills.list(view));
      } catch {
      }
    }
    runtime.setSkills(mergeUserSkills(batches));
  };
  placeBoundSessions(ctx, runtime, pullSkills);
  ctx.inject(["sessions", "sessionTitle", "workspaceRegistry"], () => {
    placeBoundSessions(ctx, runtime, pullSkills);
  });
  void pullSkills();
  ctx.inject(["skills"], (skillCtx) => {
    void pullSkills();
    const events = skillCtx;
    skillCtx.effect(() => events.on("skills/change", () => {
      void pullSkills();
    }), "dsh-messaging-gateway: skills");
  });
  ctx.effect(() => ctx.on("agent/request", async (payload, next) => {
    const resolved = await next();
    const pick = runtime.modelPicks.get(String(payload.agent.id));
    if (pick === void 0) return resolved;
    return {
      ...resolved,
      provider: pick.provider,
      model: pick.model
    };
  }), "dsh-messaging-gateway: session model");
  let source = () => config;
  let stopSlack;
  let stopFeishu;
  const bindOwner = (platform, owner) => {
    if (!owner) return;
    const id = platformId(platform);
    const bound = runtime.state.access.byPlatform[id];
    if (!bound || bound.kind !== "bound" || bound.owner !== subjectId(owner)) {
      runtime.apply({
        kind: "bind",
        platform: id,
        owner: subjectId(owner),
        id: runtime.nextId(),
        at: runtime.now()
      });
    }
  };
  const syncSlack = () => {
    const current = source();
    bindOwner("slack", current.slackOwner ?? "");
    const bot = current.slackBotToken ?? "";
    const app = current.slackAppToken ?? "";
    void (async () => {
      if (stopSlack) {
        await stopSlack();
        stopSlack = void 0;
      }
      if (current.enabled !== false && bot && app && process.env.MESSAGING_GATEWAY_DISABLE_SLACK !== "1") {
        stopSlack = await runSlack(runtime, { bot, app });
      }
    })().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[dsh-messaging-gateway] slack sync failed", message);
    });
  };
  const syncFeishu = () => {
    const current = source();
    bindOwner("feishu", current.feishuOwner ?? "");
    const appId = current.feishuAppId ?? "";
    const appSecret = current.feishuAppSecret ?? "";
    void (async () => {
      if (stopFeishu) {
        await stopFeishu();
        stopFeishu = void 0;
      }
      if (current.enabled !== false && appId && appSecret && process.env.MESSAGING_GATEWAY_DISABLE_FEISHU !== "1") {
        stopFeishu = await runFeishu(runtime, { appId, appSecret });
      }
    })().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[dsh-messaging-gateway] feishu sync failed", message);
    });
  };
  let feishuSlashTail = Promise.resolve();
  runtime.watchDeliveries((deliveries) => {
    if (!deliveries.some((item) => item.kind === "catalogUpdated")) return;
    const current = source();
    const appId = current.feishuAppId ?? "";
    const appSecret = current.feishuAppSecret ?? "";
    if (!appId || !appSecret || process.env.MESSAGING_GATEWAY_DISABLE_FEISHU === "1") return;
    feishuSlashTail = feishuSlashTail.then(
      () => syncFeishuCatalog(runtime, { appId, appSecret }),
      () => syncFeishuCatalog(runtime, { appId, appSecret })
    ).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[dsh-messaging-gateway] feishu slash resync failed", message);
    });
  });
  bindOwner("slack", config.slackOwner ?? "");
  bindOwner("feishu", config.feishuOwner ?? "");
  installSettingsSection(ctx, settingsNamespace(SETTINGS_NAMESPACE), Config, config, {
    setSource: (current) => {
      source = current;
    },
    onChange: () => {
      syncSlack();
      syncFeishu();
    }
  });
  ctx.inject(["webServer"], (httpCtx) => {
    const webServer = httpCtx.get("webServer");
    if (!webServer) return;
    httpCtx.effect(() => webServer.register({
      kind: "exact",
      path: "/plugins/dsh-messaging-gateway/list",
      handler: (_req, res) => json(res, 200, runtime.list())
    }), "dsh-messaging-gateway: list");
    httpCtx.effect(() => webServer.register({
      kind: "exact",
      path: "/plugins/dsh-messaging-gateway/slack-manifest",
      handler: (_req, res) => json(res, 200, slackManifest(slashesFromCatalog(runtime.state.catalog)))
    }), "dsh-messaging-gateway: slack-manifest");
    httpCtx.effect(() => webServer.register({
      kind: "exact",
      path: "/plugins/dsh-messaging-gateway/setup",
      handler: (_req, res) => html(res, setupPage(slashesFromCatalog(runtime.state.catalog)))
    }), "dsh-messaging-gateway: setup");
    httpCtx.effect(() => webServer.register({
      kind: "exact",
      path: "/plugins/dsh-messaging-gateway/outbox",
      handler: (_req, res) => json(res, 200, runtime.outbox)
    }), "dsh-messaging-gateway: outbox");
    httpCtx.effect(() => webServer.register({
      kind: "exact",
      path: "/plugins/dsh-messaging-gateway/ingest",
      handler: (req, res) => {
        if (req.method !== "POST") {
          json(res, 405, { error: "POST only" });
          return;
        }
        void readJson(req).then(async (raw) => {
          const body = raw && typeof raw === "object" ? raw : {};
          if (!body.user || !body.channel || !body.text) {
            json(res, 400, { error: "user, channel, and text are required" });
            return;
          }
          const inbound = body.platform === "feishu" ? inboundFromFeishu({
            user: body.user,
            chatId: body.channel,
            ...body.chatType ? { chatType: body.chatType } : {},
            text: body.text,
            id: `ingest-${Date.now()}`,
            ...body.mentioned === true ? { mentioned: true } : {},
            commands: runtime.state.catalog.commands.map((spec) => spec.name)
          }) : inboundFromSlack({
            user: body.user,
            channel: body.channel,
            text: body.text,
            id: `ingest-${Date.now()}`,
            ...body.mentioned === true ? { mentioned: true } : {}
          });
          const result = await runtime.run(inbound);
          json(res, 200, { hostCalls: result.hostCalls.length, deliveries: result.deliveries, list: runtime.list() });
        }).catch((error) => {
          json(res, 400, { error: error instanceof Error ? error.message : String(error) });
        });
      }
    }), "dsh-messaging-gateway: ingest");
    console.log("[my-plugins/dsh-messaging-gateway] http /plugins/dsh-messaging-gateway/list");
  });
  ctx.effect(() => {
    const offStatus = ctx.on("agent/status", ({ agent, status }) => {
      runtime.noteAgentStatus(String(agent.id), status);
    });
    const offEvent = ctx.on("session/event", (session, event) => {
      runtime.noteSessionEvent(String(session.id), event);
    });
    return () => {
      offStatus();
      offEvent();
    };
  }, "dsh-messaging-gateway: host bridge");
  ctx.effect(() => {
    syncSlack();
    syncFeishu();
    return () => {
      void stopSlack?.();
      void stopFeishu?.();
    };
  }, "dsh-messaging-gateway: platforms");
}
export {
  Config,
  apply,
  inject,
  name
};

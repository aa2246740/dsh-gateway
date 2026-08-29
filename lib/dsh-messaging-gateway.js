import { SessionId } from "@deepseek-ai/dsh-session";
import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
import z from "@deepseek-ai/schemastery";
import { installModelSelection } from "@deepseek-ai/dsh-agent";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
//#region lib/types/config.js
const SETTINGS_NAMESPACE = "dsh-messaging-gateway";
//#endregion
//#region lib/types/gateway/types.js
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
//#endregion
//#region lib/types/gateway/access.js
function accessOf(store, platform) {
	return store.byPlatform[platform] ?? { kind: "unbound" };
}
function decideAccess(args) {
	const { access, actor, addressing, identity, at, pairingSeq } = args;
	if (access.kind === "unbound") {
		if (addressing.kind === "dm") return {
			decision: { kind: "owner" },
			access: {
				kind: "bound",
				owner: actor,
				allowlist: [],
				guests: [],
				pending: []
			},
			pairingSeq
		};
		return {
			decision: { kind: "deny" },
			access,
			pairingSeq
		};
	}
	if (actor === access.owner) return {
		decision: { kind: "owner" },
		access,
		pairingSeq
	};
	if (access.allowlist.includes(actor)) return {
		decision: { kind: "allowlisted" },
		access,
		pairingSeq
	};
	if (access.guests.some((g) => g.subject === actor)) return {
		decision: { kind: "guest" },
		access,
		pairingSeq
	};
	const pending = access.pending.find((p) => p.subject === actor);
	if (pending) return {
		decision: {
			kind: "pair",
			code: pending.code,
			issued: false
		},
		access,
		pairingSeq
	};
	if (addressing.kind !== "dm") return {
		decision: { kind: "deny" },
		access,
		pairingSeq
	};
	const nextSeq = pairingSeq + 1;
	const code = pairingCode(`P${nextSeq.toString(16).padStart(6, "0")}`);
	return {
		decision: {
			kind: "pair",
			code,
			issued: true
		},
		access: {
			...access,
			pending: [...access.pending, {
				code,
				subject: actor,
				identity,
				issuedAt: at
			}]
		},
		pairingSeq: nextSeq
	};
}
//#endregion
//#region lib/types/gateway/catalog.js
const DEFAULT_COMMANDS = [
	{
		name: "model",
		description: "Show or switch this session model",
		ownerOnly: false,
		source: "command"
	},
	{
		name: "help",
		description: "List DSH commands",
		ownerOnly: false,
		source: "command"
	},
	{
		name: "goal",
		description: "Observe or change the current goal",
		ownerOnly: false,
		source: "command"
	},
	{
		name: "plan",
		description: "Enter plan mode",
		ownerOnly: false,
		source: "command"
	},
	{
		name: "export",
		description: "Export this session",
		ownerOnly: true,
		source: "command"
	},
	{
		name: "compact",
		description: "Compact this session",
		ownerOnly: false,
		source: "command"
	},
	{
		name: "new",
		description: "Start a fresh session in this chat",
		ownerOnly: false,
		source: "command"
	},
	{
		name: "reset",
		description: "Start a fresh session in this chat",
		ownerOnly: false,
		source: "command"
	},
	{
		name: "feedback",
		description: "Send feedback",
		ownerOnly: false,
		source: "command"
	}
];
function isFreshSessionCommand(name) {
	return name === "new" || name === "reset";
}
function matchCommand(catalog, line) {
	const trimmed = line.text.trim();
	if (trimmed.length === 0) return { kind: "unknown" };
	const parts = trimmed.split(/\s+/);
	let name = parts[0] ?? "";
	let restStart = 1;
	if (name === catalog.catchAllPrefix && parts[1]) {
		name = parts[1];
		restStart = 2;
	}
	const spec = catalog.commands.find((c) => c.name === name);
	if (!spec) return { kind: "unknown" };
	return {
		kind: "ok",
		spec,
		args: parts.slice(restStart).join(" ")
	};
}
//#endregion
//#region lib/types/gateway/key.js
function sessionKey(identity) {
	const thread = identity.threadId ?? "";
	return `${identity.platform}|${identity.kind}|${identity.chatId}|${thread}`;
}
//#endregion
//#region lib/types/gateway/title.js
function platformLabel(platform) {
	if (platform.length === 0) return "Chat";
	return `${platform.charAt(0).toUpperCase()}${platform.slice(1)}`;
}
/** Feishu open_id / chat_id are not a name. Do not put them in the Computer list. */
function isOpaquePeerLabel(value) {
	return /^(ou_|oc_|on_)[A-Za-z0-9_-]{8,}$/.test(value.trim());
}
function displayTitle(identity, labels = {}) {
	const platform = platformLabel(identity.platform);
	if (identity.kind === "dm") {
		const who = labels.peerName?.trim() || String(identity.chatId);
		if (who.length === 0 || isOpaquePeerLabel(who)) return `${platform} DM`;
		return `${platform} DM · ${who}`;
	}
	const raw = labels.chatName?.trim() || String(identity.chatId);
	if (isOpaquePeerLabel(raw)) return identity.threadId ? `${platform} · 帖` : platform;
	const channel = raw.startsWith("#") ? raw : `#${raw}`;
	if (identity.threadId) return `${channel} · 帖`;
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
//#endregion
//#region lib/types/gateway/list.js
/** Computer Recents and the overlay list the DM, not channel or thread rows. */
function isMainConversation(identity) {
	return identity.kind === "dm" && identity.threadId === null;
}
function rowOf(session) {
	const hostSessionId = session.host.kind === "bound" ? session.host.hostSessionId : null;
	return {
		sessionKey: session.key,
		hostSessionId,
		identity: session.identity,
		title: session.title,
		turn: session.turn.kind,
		lastActivityAt: session.lastActivityAt
	};
}
function list(state) {
	const platforms = /* @__PURE__ */ new Set();
	for (const [id, access] of Object.entries(state.access.byPlatform)) if (access.kind === "bound") platforms.add(id);
	for (const session of Object.values(state.sessions)) platforms.add(session.identity.platform);
	return {
		groups: [...platforms].sort().map((id) => {
			const platform = platformId(id);
			const rows = Object.values(state.sessions).filter((s) => s.identity.platform === platform && isMainConversation(s.identity)).map(rowOf).sort((a, b) => b.lastActivityAt - a.lastActivityAt);
			return {
				platform,
				label: platformLabel(platform),
				collapsedByDefault: true,
				rows
			};
		}).filter((g) => {
			const access = state.access.byPlatform[g.platform];
			if (g.rows.length > 0) return true;
			return access?.kind === "bound";
		}),
		access: Object.entries(state.access.byPlatform).map(([id, row]) => ({
			platform: platformId(id),
			bound: row.kind === "bound",
			owner: row.kind === "bound" ? String(row.owner) : null
		})).sort((a, b) => a.platform.localeCompare(b.platform))
	};
}
function projectDelta(before, after) {
	if (JSON.stringify(list(before)) === JSON.stringify(list(after))) return { kind: "none" };
	return { kind: "rebuild" };
}
//#endregion
//#region lib/types/gateway/handle.js
const SEEN_LIMIT = 512;
function emptyState() {
	return {
		version: 1,
		access: { byPlatform: {} },
		sessions: {},
		catalog: {
			commands: [],
			catchAllPrefix: "dsh"
		},
		seen: [],
		pairingSeq: 0
	};
}
function remember(seen, id) {
	const next = seen.includes(id) ? seen : [...seen, id];
	return next.length > SEEN_LIMIT ? next.slice(next.length - SEEN_LIMIT) : next;
}
function silent(state, inboundId) {
	return {
		state: {
			...state,
			seen: remember(state.seen, inboundId)
		},
		hostCalls: [],
		deliveries: [],
		listDelta: { kind: "none" }
	};
}
function putAccess(state, platform, access) {
	return {
		...state,
		access: { byPlatform: {
			...state.access.byPlatform,
			[platform]: access
		} }
	};
}
function putSession(state, session) {
	return {
		...state,
		sessions: {
			...state.sessions,
			[session.key]: session
		}
	};
}
function dropSession(state, key) {
	const sessions = { ...state.sessions };
	delete sessions[key];
	return {
		...state,
		sessions
	};
}
function chat(identity, key, body) {
	return {
		kind: "chat",
		identity,
		sessionKey: key,
		body
	};
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
		const session = {
			...existing,
			lastActivityAt: at,
			title: existing.title || title
		};
		return {
			state: putSession(state, session),
			session
		};
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
	return {
		state: putSession(state, session),
		session
	};
}
function dispatchWork(session, work) {
	if (session.host.kind === "provisioning") return {
		session: {
			...session,
			queued: [...session.queued, work]
		},
		hostCalls: []
	};
	if (session.host.kind === "bound" && session.turn.kind !== "idle") return {
		session: {
			...session,
			queued: [...session.queued, work]
		},
		hostCalls: []
	};
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
		session: {
			...session,
			host,
			turn: { kind: "inFlight" }
		},
		hostCalls: [call]
	};
}
function drainQueue(session) {
	if (session.host.kind !== "bound" || session.queued.length === 0) return {
		session,
		hostCalls: []
	};
	const [first, ...rest] = session.queued;
	if (!first) return {
		session,
		hostCalls: []
	};
	return dispatchWork({
		...session,
		queued: rest,
		turn: { kind: "idle" }
	}, first);
}
/** Host restart cannot resume an in-flight turn. Idle the session and drain work queued behind it. */
function recoverTurns(state) {
	let changed = false;
	const hostCalls = [];
	const sessions = {};
	for (const [key, session] of Object.entries(state.sessions)) {
		let next = session;
		if (next.host.kind === "provisioning") {
			next = {
				...next,
				host: { kind: "unbound" },
				turn: { kind: "idle" }
			};
			changed = true;
		} else if (next.turn.kind !== "idle") {
			next = {
				...next,
				turn: { kind: "idle" }
			};
			changed = true;
		}
		if (looksLikePromptTitle(next.title, next.identity)) {
			next = {
				...next,
				title: displayTitle(next.identity)
			};
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
	if (!changed) return {
		state,
		hostCalls: []
	};
	return {
		state: {
			...state,
			sessions
		},
		hostCalls
	};
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
	if (state.seen.includes(inbound.id)) return {
		state,
		hostCalls: [],
		deliveries: [],
		listDelta: { kind: "none" }
	};
	const stamped = {
		...state,
		seen: remember(state.seen, inbound.id)
	};
	switch (inbound.kind) {
		case "bind": {
			const access = {
				kind: "bound",
				owner: inbound.owner,
				allowlist: [inbound.owner],
				guests: [],
				pending: []
			};
			return finish(state, putAccess(stamped, inbound.platform, access), [], []);
		}
		case "unbind": return finish(state, putAccess(stamped, inbound.platform, { kind: "unbound" }), [], []);
		case "allowlist": {
			const current = accessOf(stamped.access, inbound.platform);
			if (current.kind !== "bound") return silent(stamped, inbound.id);
			const allowlist = inbound.op === "add" ? current.allowlist.includes(inbound.subject) ? current.allowlist : [...current.allowlist, inbound.subject] : current.allowlist.filter((s) => s !== inbound.subject || s === current.owner);
			return finish(state, putAccess(stamped, inbound.platform, {
				...current,
				allowlist
			}), [], []);
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
			if (inbound.op === "deny") return finish(state, putAccess(stamped, foundPlatform, {
				...current,
				pending: rest
			}), [], []);
			const guests = current.guests.some((g) => g.subject === pending.subject) ? current.guests : [...current.guests, {
				subject: pending.subject,
				pairedAt: inbound.at
			}];
			return finish(state, putAccess(stamped, foundPlatform, {
				...current,
				pending: rest,
				guests
			}), [], []);
		}
		case "revoke": {
			const current = accessOf(stamped.access, inbound.platform);
			if (current.kind !== "bound") return silent(stamped, inbound.id);
			if (inbound.subject === current.owner) return silent(stamped, inbound.id);
			return finish(state, putAccess(stamped, inbound.platform, {
				...current,
				allowlist: current.allowlist.filter((s) => s !== inbound.subject),
				guests: current.guests.filter((g) => g.subject !== inbound.subject),
				pending: current.pending.filter((p) => p.subject !== inbound.subject)
			}), [], []);
		}
		case "catalog": return finish(state, {
			...stamped,
			catalog: inbound.catalog
		}, [], [{ kind: "catalogUpdated" }]);
		case "setWorkspace": {
			const key = sessionKey(inbound.identity);
			const existing = stamped.sessions[key];
			if (!existing) return silent(stamped, inbound.id);
			return finish(state, putSession(stamped, {
				...existing,
				workspace: inbound.workspace
			}), [], []);
		}
		case "setTitle": {
			const key = sessionKey(inbound.identity);
			const existing = stamped.sessions[key];
			if (!existing) return silent(stamped, inbound.id);
			const title = inbound.title.trim();
			if (title.length === 0 || title === existing.title) return silent(stamped, inbound.id);
			return finish(state, putSession(stamped, {
				...existing,
				title,
				lastActivityAt: inbound.at
			}), [], []);
		}
		case "sessionDisposed": return finish(state, dropSession(stamped, inbound.sessionKey), [], []);
		case "hostReport": {
			const session = stamped.sessions[inbound.sessionKey];
			if (!session) return silent(stamped, inbound.id);
			return applyHostReport(state, stamped, session, inbound);
		}
		case "message":
		case "command":
		case "cancel":
		case "approvalAnswer": return applyActorInbound(state, stamped, inbound);
		default: return inbound;
	}
}
function applyHostReport(before, stamped, session, inbound) {
	const report = inbound.report;
	const deliveries = [];
	let next = session;
	let hostCalls = [];
	switch (report.kind) {
		case "bound": {
			next = {
				...next,
				host: {
					kind: "bound",
					hostSessionId: report.hostSessionId
				}
			};
			const drained = drainQueue(next);
			next = drained.session;
			hostCalls = drained.hostCalls;
			break;
		}
		case "turnStarted":
			next = {
				...next,
				turn: { kind: "inFlight" }
			};
			deliveries.push(chat(session.identity, session.key, {
				kind: "busy",
				on: true
			}));
			deliveries.push(chat(session.identity, session.key, {
				kind: "stream",
				phase: "start"
			}));
			break;
		case "turnProgress":
			deliveries.push(chat(session.identity, session.key, {
				kind: "stream",
				phase: "replace",
				snapshot: report.snapshot
			}));
			break;
		case "turnEnded": {
			next = {
				...next,
				turn: { kind: "idle" }
			};
			deliveries.push(chat(session.identity, session.key, {
				kind: "stream",
				phase: "end"
			}));
			deliveries.push(chat(session.identity, session.key, {
				kind: "busy",
				on: false
			}));
			const drained = drainQueue(next);
			next = drained.session;
			hostCalls = drained.hostCalls;
			break;
		}
		case "approvalRequested":
			next = {
				...next,
				turn: {
					kind: "awaitingApproval",
					request: report.request
				}
			};
			deliveries.push(chat(session.identity, session.key, {
				kind: "approval",
				request: report.request
			}));
			break;
		case "approvalSettled":
			next = {
				...next,
				turn: { kind: "idle" }
			};
			break;
		case "artifact":
			deliveries.push(chat(session.identity, session.key, {
				kind: "files",
				files: report.files
			}));
			break;
		case "commandResult": {
			next = {
				...next,
				turn: { kind: "idle" }
			};
			deliveries.push(chat(session.identity, session.key, {
				kind: "commandResult",
				text: report.text
			}));
			const drained = drainQueue(next);
			next = drained.session;
			hostCalls = drained.hostCalls;
			break;
		}
		case "error":
			next = {
				...next,
				turn: { kind: "idle" }
			};
			deliveries.push(chat(session.identity, session.key, {
				kind: "notice",
				text: report.message
			}));
			break;
		default: return report;
	}
	return finish(before, putSession(stamped, next), hostCalls, deliveries);
}
function applyActorInbound(before, stamped, inbound) {
	const key = sessionKey(inbound.identity);
	const hasSession = Boolean(stamped.sessions[key]);
	const addressing = inbound.kind === "message" || inbound.kind === "command" ? inbound.addressing : { kind: "dm" };
	if (!mentionOk(addressing, hasSession)) return silent(stamped, inbound.id);
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
	working = {
		...working,
		pairingSeq: decided.pairingSeq
	};
	if (decided.decision.kind === "deny") return finish(before, working, [], []);
	if (decided.decision.kind === "pair") {
		const deliveries = [chat(inbound.identity, key, {
			kind: "pairingCode",
			code: decided.decision.code
		})];
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
		if (session.turn.kind !== "awaitingApproval" || session.turn.request.requestId !== inbound.requestId) return finish(before, working, [], []);
		const call = {
			kind: "answerApproval",
			idempotencyKey: idempotencyKey(inbound.id),
			sessionKey: session.key,
			host: session.host,
			requestId: inbound.requestId,
			answer: inbound.answer
		};
		return finish(before, putSession(working, {
			...session,
			turn: { kind: "idle" }
		}), [call], []);
	}
	if (inbound.kind === "command") {
		const matched = matchCommand(working.catalog, inbound.line);
		if (matched.kind === "unknown") return finish(before, working, [], [chat(inbound.identity, key, {
			kind: "rejectCommand",
			reason: "unknown"
		})]);
		if (role === "guest" && matched.spec.ownerOnly) return finish(before, working, [], [chat(inbound.identity, key, {
			kind: "rejectCommand",
			reason: "guest-forbidden"
		})]);
		const ensured = ensureSession(working, inbound.identity, inbound.at, titleFor(inbound.identity, inbound.actor.subject));
		if (isFreshSessionCommand(matched.spec.name)) {
			const session = {
				...ensured.session,
				turn: { kind: "idle" },
				queued: []
			};
			return finish(before, putSession(ensured.state, session), [{
				kind: "rotateSession",
				idempotencyKey: idempotencyKey(inbound.id),
				sessionKey: session.key,
				identity: session.identity,
				host: session.host,
				workspace: session.workspace
			}], []);
		}
		const dispatched = dispatchWork(ensured.session, {
			kind: "command",
			line: inbound.line,
			idempotencyKey: idempotencyKey(inbound.id)
		});
		return finish(before, putSession(ensured.state, dispatched.session), dispatched.hostCalls, []);
	}
	const ensured = ensureSession(working, inbound.identity, inbound.at, titleFor(inbound.identity, inbound.actor.subject));
	const dispatched = dispatchWork(ensured.session, {
		kind: "prompt",
		prompt: inbound.prompt,
		idempotencyKey: idempotencyKey(inbound.id)
	});
	return finish(before, putSession(ensured.state, dispatched.session), dispatched.hostCalls, []);
}
//#endregion
//#region lib/types/host-catalog.js
/** Host commands first, then built-in fallbacks, then user-invocable skills. Command names win. */
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
	return {
		catchAllPrefix: "dsh",
		commands: out
	};
}
function formatHelp(catalog) {
	const commands = catalog.commands.filter((spec) => spec.source !== "skill");
	const skills = catalog.commands.filter((spec) => spec.source === "skill");
	const commandBlock = commands.map((spec) => `/${spec.name}  ${spec.description}`).join("\n");
	if (skills.length === 0) return commandBlock || "/help";
	return `${commandBlock}\n\nSkills:\n${skills.map((spec) => `/${spec.name}  ${spec.description}`).join("\n")}`;
}
const SLACK_NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/i;
const SLACK_SLASH_CAP = 48;
const FEISHU_NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/i;
const FEISHU_SLASH_CAP = 100;
const FEISHU_DESC_CAP$1 = 100;
function feishuSlashesFromCatalog(catalog) {
	const out = [{
		command: "dsh",
		description: "Run a DSH command or talk to the agent"
	}];
	for (const spec of catalog.commands) {
		if (out.length >= FEISHU_SLASH_CAP) break;
		if (!FEISHU_NAME.test(spec.name) || spec.name === "dsh") continue;
		out.push({
			command: spec.name.toLowerCase(),
			description: spec.description.slice(0, FEISHU_DESC_CAP$1)
		});
	}
	return out;
}
/** Keep user-invocable skills; first listing of a name wins. */
function mergeUserSkills(batches) {
	const byName = /* @__PURE__ */ new Map();
	for (const batch of batches) for (const skill of batch) {
		if (skill.invocation?.userInvocable === false) continue;
		if (skill.name.length === 0 || byName.has(skill.name)) continue;
		byName.set(skill.name, {
			name: skill.name,
			description: skill.description
		});
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
	const out = [{
		command: "/dsh",
		description: "Run a DSH command or talk to the agent",
		should_escape: false,
		url,
		usage_hint: "[command] [args]"
	}];
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
//#endregion
//#region lib/types/model-command.js
function parseModelLine(raw) {
	const trimmed = raw.trim();
	if (trimmed.length === 0) return void 0;
	const slash = trimmed.indexOf("/");
	if (slash > 0 && !trimmed.includes(" ")) return {
		provider: trimmed.slice(0, slash),
		model: trimmed.slice(slash + 1)
	};
	return { model: trimmed };
}
function formatModelStatus(pick) {
	if (pick === void 0) return "This Slack session uses the DSH default model from Settings → 模型. Switch with /model provider/model";
	return `This session: ${pick.provider}/${pick.model}\nSwitch with /model provider/model  (example: /model pi-openrouter/gpt-5.6)`;
}
async function resolveModelPick(llm, line, current) {
	const parsed = parseModelLine(line);
	if (parsed === void 0) return {
		ok: false,
		text: formatModelStatus(current)
	};
	const provider = parsed.provider ?? current?.provider;
	if (provider !== void 0) try {
		return {
			ok: true,
			pick: compactPick(await llm.resolveCallConfig({
				provider,
				model: parsed.model
			}))
		};
	} catch (error) {
		if (parsed.provider !== void 0) return {
			ok: false,
			text: error instanceof Error ? error.message : String(error)
		};
	}
	const matched = await findModel(llm, parsed.model);
	if (matched !== void 0) return {
		ok: true,
		pick: matched
	};
	return {
		ok: false,
		text: `Unknown model "${parsed.model}". Use /model provider/model`
	};
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
			return compactPick(await llm.resolveCallConfig({
				provider: route.provider,
				model: hit.id
			}));
		} catch {
			continue;
		}
	}
}
function compactPick(resolved) {
	return {
		provider: resolved.provider,
		model: resolved.model,
		...resolved.reasoningEffort === void 0 ? {} : { reasoningEffort: resolved.reasoningEffort }
	};
}
//#endregion
//#region lib/types/persist.js
/** `$DSH_HOME` is already the `.dsh` root. Do not join `.dsh` again. */
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
		if (raw.version !== 1) return emptyState();
		return raw;
	} catch {
		return emptyState();
	}
}
function saveState(path, state) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(state), "utf8");
}
//#endregion
//#region lib/types/runtime.js
function assistantTextFromEvent(event) {
	if (event.type !== "assistant/message" || event.data === null || typeof event.data !== "object") return "";
	const content = event.data.message?.content;
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
	modelPicks = /* @__PURE__ */ new Map();
	outbox = [];
	onDeliveries = () => {};
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
		if (inbound.kind === "setTitle") this.pinHost(this.state.sessions[sessionKey(inbound.identity)], false);
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
			this.flush();
			return;
		}
		if (status !== "idle") return;
		this.endTurn(hostId, key);
		this.flush();
	}
	noteSessionEvent(hostId, event) {
		const key = this.keyForHost(hostId);
		if (!key) return;
		const session = this.state.sessions[key];
		if (event.type === "session/title" && session) {
			const data = event.data;
			const title = typeof data?.title === "string" ? data.title : "";
			const source = data?.source !== null && typeof data?.source === "object" ? data.source.kind : void 0;
			if (title.length > 0 && (source !== "user" || looksLikePromptTitle(title, session.identity))) this.pinHost(session, false);
		}
		const failed = turnErrorFromEvent(event);
		if (failed !== void 0) {
			this.beginTurn(hostId, key);
			this.commit({
				kind: "hostReport",
				sessionKey: key,
				report: {
					kind: "error",
					message: failed
				},
				id: this.nextId(),
				at: this.now()
			});
			this.flush();
			return;
		}
		const piece = assistantTextFromEvent(event);
		if (piece.length === 0) return;
		this.beginTurn(hostId, key);
		const previous = this.turnText.get(hostId) ?? "";
		this.turnText.set(hostId, previous.length === 0 ? piece : `${previous}\n\n${piece}`);
	}
	async perform(call) {
		try {
			await this.performInner(call);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error("[dsh-messaging-gateway] host call failed", message);
			if (call.kind === "ensurePrompt" || call.kind === "ensureCommand" || call.kind === "rotateSession") this.commit({
				kind: "hostReport",
				sessionKey: call.sessionKey,
				report: {
					kind: "error",
					message
				},
				id: this.nextId(),
				at: this.now()
			});
		}
	}
	async performInner(call) {
		if (call.kind === "ensurePrompt" || call.kind === "ensureCommand") {
			const agent = await this.ensureAgent(call);
			if (call.kind === "ensurePrompt") {
				agent.followup(createUserMessage({
					content: [{
						type: "text",
						text: call.prompt.text
					}],
					source: { kind: "user" }
				}));
				return;
			}
			const raw = call.line.text.replace(/^\//, "");
			const name = raw.split(/\s+/)[0] ?? "";
			this.syncCatalog(agent);
			if (name === "help" || name === "dsh" && raw.split(/\s+/)[1] === "help") {
				this.commit({
					kind: "hostReport",
					sessionKey: call.sessionKey,
					report: {
						kind: "commandResult",
						text: formatHelp(this.state.catalog)
					},
					id: this.nextId(),
					at: this.now()
				});
				return;
			}
			const matched = matchCommand(this.state.catalog, call.line);
			if (matched.kind === "ok" && matched.spec.source === "skill") {
				const text = `/${matched.spec.name}${matched.args.length > 0 ? ` ${matched.args}` : ""}`;
				agent.followup(createUserMessage({
					content: [{
						type: "text",
						text
					}],
					source: { kind: "user" }
				}));
				return;
			}
			const line = call.line.text.startsWith("/") ? call.line.text : `/${call.line.text}`;
			const executed = await (this.getCommands?.() ?? this.commands)?.execute(agent, line, [], new AbortController().signal);
			const text = executed && "result" in executed ? executed.result?.text ?? "" : "";
			this.commit({
				kind: "hostReport",
				sessionKey: call.sessionKey,
				report: {
					kind: "commandResult",
					text: text || "Unknown command."
				},
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
	}
	beginTurn(hostId, key) {
		if (this.turnStarted.has(hostId)) return;
		this.turnStarted.add(hostId);
		this.turnText.set(hostId, "");
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
		this.turnStarted.delete(hostId);
		this.turnText.delete(hostId);
		if (text.length > 0) this.commit({
			kind: "hostReport",
			sessionKey: key,
			report: {
				kind: "turnProgress",
				snapshot: {
					text,
					tools: []
				}
			},
			id: this.nextId(),
			at: this.now()
		});
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
		const listed = (this.getCommands?.() ?? this.commands)?.list(agent) ?? [];
		this.replaceCatalog(listed);
	}
	keyForHost(hostId) {
		for (const session of Object.values(this.state.sessions)) if (session.host.kind === "bound" && String(session.host.hostSessionId) === hostId) return session.key;
	}
	modelFor(hostId) {
		if (hostId !== void 0) {
			const picked = this.modelPicks.get(hostId);
			if (picked) return {
				provider: picked.provider,
				model: picked.model
			};
		}
		return this.defaultModel?.();
	}
	agentSetup(pick) {
		if (!pick && this.setupAgent === void 0) return void 0;
		return (agentCtx) => {
			this.setupAgent?.(agentCtx);
			if (pick) installModelSelection(agentCtx, {
				current: {
					provider: pick.provider,
					model: pick.model
				},
				assembled: void 0
			});
			const id = agentCtx.agent?.id;
			if (id !== void 0) this.configured.add(String(id));
		};
	}
	/** Return the complete setup used for a messaging-owned Agent. */
	setupForAgent(hostId) {
		return this.agentSetup(hostId === void 0 ? this.modelFor() : this.modelFor(hostId));
	}
	/**
	* Mount messaging-owned scoped contributions onto an already-live Agent.
	* This is used when startup discovers that a persisted session was already
	* resumed by another lifecycle pass, so the resume setup callback did not
	* get a chance to run in this pass.
	*/
	ensureAgentSetup(hostId) {
		if (this.configured.has(hostId) || this.setupAgent === void 0) return;
		const agent = this.agents.get(SessionId(hostId));
		if (!agent?.ctx) return;
		this.setupAgent(agent.ctx);
		this.configured.add(hostId);
	}
	attachModel(hostId, agent, pick) {
		if (!pick || this.modeled.has(hostId)) return;
		if (agent.ctx) installModelSelection(agent.ctx, {
			current: {
				provider: pick.provider,
				model: pick.model
			},
			assembled: void 0
		});
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
			report: {
				kind: "commandResult",
				text: "Started a new session."
			},
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
			const setup = this.agentSetup(pick);
			const resumed = await this.agents.resume({
				resumeSessionId: SessionId(call.host.hostSessionId),
				...pick ? { agentOptions: {
					provider: pick.provider,
					model: pick.model
				} } : {},
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
		const setup = this.agentSetup(pick);
		const cwd = this.cwd?.() ?? process.cwd();
		const created = await this.agents.create({
			sessionId,
			meta: { cwd },
			...pick ? { agentOptions: {
				provider: pick.provider,
				model: pick.model
			} } : {},
			...setup ? { setup } : {}
		});
		if (pick) this.modelPicks.set(String(sessionId), pick);
		this.commit({
			kind: "hostReport",
			sessionKey: key,
			report: {
				kind: "bound",
				hostSessionId: hostSessionId(String(sessionId))
			},
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
			const handle = await agents.create(opts);
			return {
				agent: handle.agent,
				dispose: () => {
					handle.dispose();
				}
			};
		},
		resume: async (opts) => {
			const handle = await agents.resume(opts);
			return {
				agent: handle.agent,
				dispose: () => {
					handle.dispose();
				}
			};
		}
	};
}
function captureCommands(ctx) {
	return ctx.get("commands");
}
//#endregion
//#region lib/types/feishu-slash.js
const FEISHU_DESC_CAP = 100;
function clampFeishuDescription(text) {
	return text.slice(0, FEISHU_DESC_CAP);
}
function planFeishuSlashSync(desired, remote) {
	const want = new Map(desired.map((item) => [item.command, item]));
	const have = new Map(remote.map((item) => [item.command, item]));
	const create = [];
	const update = [];
	const remove = [];
	for (const [name, slash] of want) {
		const existing = have.get(name);
		if (!existing) {
			create.push(slash);
			continue;
		}
		if ((existing.description?.default_value ?? "") !== slash.description) update.push({
			id: existing.command_id,
			description: slash.description
		});
	}
	for (const [name, item] of have) if (!want.has(name)) remove.push(item.command_id);
	return {
		create,
		update,
		remove
	};
}
async function syncFeishuSlashes(http, desired) {
	const token = await http.getToken();
	const plan = planFeishuSlashSync(desired, await http.list(token));
	for (const slash of plan.create) await http.create(token, slash);
	for (const row of plan.update) await http.update(token, row.id, row.description);
	for (const id of plan.remove) await http.remove(token, id);
	return plan;
}
async function feishuJson(url, init) {
	const body = await (await fetch(url, init)).json();
	if (body.code !== 0 && body.code !== void 0) throw new Error(body.msg || `feishu ${url} failed`);
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
				body: JSON.stringify({
					app_id: appId,
					app_secret: appSecret
				})
			});
			if (!body.tenant_access_token) throw new Error("feishu token missing");
			return body.tenant_access_token;
		},
		list: async (token) => {
			return (await feishuJson("https://open.feishu.cn/open-apis/application/v7/app_slash_commands", {
				method: "GET",
				headers: headers(token)
			})).data?.items ?? [];
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
				body: JSON.stringify({ description: {
					default_value: clipped,
					i18n: {
						zh_cn: clipped,
						en_us: clipped
					}
				} })
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
//#endregion
//#region lib/types/present.js
function textFromDelivery(delivery) {
	if (delivery.kind !== "chat") return void 0;
	const body = delivery.body;
	switch (body.kind) {
		case "pairingCode": return `Pairing code: ${body.code}. Approve it in DSH Messaging settings.`;
		case "rejectCommand": return body.reason === "unknown" ? "Unknown command." : "That command is owner-only.";
		case "commandResult": return body.text;
		case "notice": return body.text;
		case "busy": return body.on ? "Working…" : void 0;
		case "stream": return body.snapshot?.text;
		case "approval": return `Approval needed: ${body.request.summary}`;
		case "files": return body.files.map((file) => file.name).join(", ");
		default: return;
	}
}
//#endregion
//#region lib/types/feishu.js
const FEISHU = platformId("feishu");
function feishuIdentity(args) {
	const kind = args.chatType === "p2p" ? "dm" : "group";
	return {
		platform: FEISHU,
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
	const actor = {
		platform: FEISHU,
		subject: subjectId(args.user)
	};
	const addressing = identity.kind === "dm" ? { kind: "dm" } : {
		kind: "group",
		mentioned: args.mentioned === true,
		botInvited: false
	};
	const text = args.text.trim();
	const first = text.split(/\s+/)[0] ?? "";
	const names = new Set((args.commands ?? []).map((name) => name.toLowerCase()));
	const isCommand = text.startsWith("/") || text.startsWith("!") || names.has(first.toLowerCase());
	const line = isCommand ? text.replace(/^[/!]/, "") : text;
	const meta = {
		id: inboundId(args.id),
		at: timestamp(Date.now())
	};
	if (isCommand) return {
		kind: "command",
		actor,
		identity,
		addressing,
		line: { text: line },
		...meta
	};
	return {
		kind: "message",
		actor,
		identity,
		addressing,
		prompt: {
			text,
			attachments: []
		},
		...meta
	};
}
function inboundFromFeishuEvent(event, commands) {
	const sender = event.sender;
	const message = event.message;
	if (sender?.sender_type === "bot") return void 0;
	const user = sender?.sender_id?.open_id;
	const chat = message?.chat_id;
	const id = message?.message_id;
	if (!user || !chat || !id) return void 0;
	if (message.message_type && message.message_type !== "text") return void 0;
	const mentioned = (message.mentions ?? []).some((item) => item.mentioned_type === "bot");
	return inboundFromFeishu({
		user,
		chatId: chat,
		...message.chat_type ? { chatType: message.chat_type } : {},
		...message.thread_id ? { threadId: message.thread_id } : {},
		text: textFromFeishuContent(message.content),
		id,
		...mentioned ? { mentioned: true } : {},
		commands
	});
}
async function presentFeishuDelivery(delivery, say) {
	const text = textFromDelivery(delivery);
	if (!text || delivery.kind !== "chat") return;
	const replyId = delivery.identity.threadId ?? void 0;
	await say({
		chatId: String(delivery.identity.chatId),
		text,
		...replyId ? { replyId: String(replyId) } : {}
	});
}
async function syncFeishuCatalog(runtime, tokens) {
	const desired = feishuSlashesFromCatalog(runtime.state.catalog);
	await syncFeishuSlashes(feishuSlashHttp(tokens.appId, tokens.appSecret), desired);
}
async function runFeishu(runtime, tokens) {
	const Lark = await import("@larksuiteoapi/node-sdk");
	const client = new Lark.Client({
		appId: tokens.appId,
		appSecret: tokens.appSecret
	});
	const unwatch = runtime.watchDeliveries((deliveries) => {
		for (const delivery of deliveries) {
			if (delivery.kind !== "chat" || delivery.identity.platform !== FEISHU) continue;
			presentFeishuDelivery(delivery, async (args) => {
				if (args.replyId && args.replyId.startsWith("om_")) {
					await client.im.v1.message.reply({
						path: { message_id: args.replyId },
						data: {
							content: JSON.stringify({ text: args.text }),
							msg_type: "text"
						}
					});
					return;
				}
				await client.im.v1.message.create({
					params: { receive_id_type: "chat_id" },
					data: {
						receive_id: args.chatId,
						msg_type: "text",
						content: JSON.stringify({ text: args.text })
					}
				});
			}).catch((error) => {
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
	const wsClient = new Lark.WSClient({
		appId: tokens.appId,
		appSecret: tokens.appSecret
	});
	const started = wsClient.start({ eventDispatcher: new Lark.EventDispatcher({}).register({ "im.message.receive_v1": async (data) => {
		const inbound = inboundFromFeishuEvent(data, commandsOf());
		if (!inbound) return;
		await runtime.run(inbound);
		if (inbound.kind === "message" || inbound.kind === "command") pinTitle(inbound.identity);
	} }) });
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
		if (session.identity.platform !== FEISHU) continue;
		pinTitle(session.identity);
	}
	return async () => {
		unwatch();
		wsClient.close();
	};
}
//#endregion
//#region lib/types/host-cwd.js
function isUnder(child, parent) {
	if (child === parent) return true;
	const prefix = parent.endsWith("/") ? parent : `${parent}/`;
	return child.startsWith(prefix);
}
/** Pick a Host workspace the Computer already lists, never the Host process cwd. */
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
//#endregion
//#region lib/types/slack.js
const SLACK = platformId("slack");
function peerNameFromSlackUser(user) {
	const pieces = [
		user?.profile?.display_name,
		user?.profile?.real_name,
		user?.real_name,
		user?.name
	];
	for (const piece of pieces) if (typeof piece === "string" && piece.trim().length > 0) return piece.trim();
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
	const identity = args.threadTs ? slackIdentity({
		channel: args.channel,
		threadTs: args.threadTs
	}) : slackIdentity({ channel: args.channel });
	const actor = {
		platform: SLACK,
		subject: subjectId(args.user)
	};
	const addressing = identity.kind === "dm" ? { kind: "dm" } : {
		kind: "group",
		mentioned: args.mentioned === true || args.text.includes("<@"),
		botInvited: false
	};
	const text = args.text.trim();
	const isCommand = text.startsWith("/") || text.startsWith("!");
	const line = isCommand ? text.replace(/^[/!]/, "") : text;
	const meta = {
		id: inboundId(args.id),
		at: timestamp(Date.now())
	};
	if (isCommand) return {
		kind: "command",
		actor,
		identity,
		addressing,
		line: { text: line },
		...meta
	};
	return {
		kind: "message",
		actor,
		identity,
		addressing,
		prompt: {
			text,
			attachments: []
		},
		...meta
	};
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
			text = body.on ? "Working…" : void 0;
			break;
		case "stream":
			text = body.snapshot?.text;
			break;
		case "approval":
			text = `Approval needed: ${body.request.summary}`;
			break;
		case "files": text = body.files.map((f) => f.name).join(", ");
	}
	if (!text) return;
	if (thread_ts) await say({
		text,
		thread_ts
	});
	else await say({ text });
}
async function runSlack(runtime, tokens) {
	const { App } = await import("@slack/bolt");
	const app = new App({
		token: tokens.bot,
		appToken: tokens.app,
		socketMode: true
	});
	const unwatch = runtime.watchDeliveries((deliveries) => {
		for (const d of deliveries) {
			if (d.kind !== "chat" || d.identity.platform !== SLACK) continue;
			presentSlackDelivery(d, async (args) => {
				if (args.thread_ts) return app.client.chat.postMessage({
					channel: d.identity.chatId,
					text: args.text,
					thread_ts: args.thread_ts
				});
				return app.client.chat.postMessage({
					channel: d.identity.chatId,
					text: args.text
				});
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
			const fromChannel = labelsFromConversation((await app.client.conversations.info({ channel })).channel);
			if (fromChannel.imUser) {
				const labels = { peerName: peerNameFromSlackUser((await app.client.users.info({ user: fromChannel.imUser })).user) ?? fromChannel.imUser };
				names.set(channel, labels);
				return labels;
			}
			const labels = fromChannel.chatName ? { chatName: fromChannel.chatName } : {};
			if (labels.chatName || labels.peerName) names.set(channel, labels);
			return labels;
		} catch {
			return fallbackUser ? { peerName: fallbackUser } : {};
		}
	};
	const pinTitle = async (identity, channel, user) => {
		const title = displayTitle(identity, await resolveLabels(channel, identity.kind === "dm" ? user : void 0));
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
		if (inbound.kind === "message" || inbound.kind === "command") pinTitle(inbound.identity, args.channel, args.user).catch((error) => {
			const message = error instanceof Error ? error.message : String(error);
			console.error("[dsh-messaging-gateway] slack title failed", message);
		});
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
		pinTitle(session.identity, String(session.identity.chatId)).catch(() => {});
	}
	return async () => {
		unwatch();
		await app.stop();
	};
}
//#endregion
//#region lib/types/slack-manifest.js
function slackManifest(slashes) {
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
			slash_commands: slashes && slashes.length > 0 ? slashes : slashesFromCatalog(buildCatalog([], []))
		},
		oauth_config: { scopes: { bot: [
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
		] } },
		settings: {
			event_subscriptions: { bot_events: [
				"app_mention",
				"message.channels",
				"message.groups",
				"message.im",
				"message.mpim"
			] },
			interactivity: { is_enabled: true },
			org_deploy_enabled: false,
			socket_mode_enabled: true,
			token_rotation_enabled: false
		}
	};
}
//#endregion
//#region lib/types/dsh-messaging-gateway.js
function gatewayHostIds(runtime) {
	const ids = /* @__PURE__ */ new Set();
	for (const session of Object.values(runtime.state.sessions)) if (session.host.kind === "bound") ids.add(String(session.host.hostSessionId));
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
		const session = sessions?.get?.(SessionId(id));
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
	registry.archiveSession(SessionId(id)).catch((error) => {
		const message = error instanceof Error ? error.message : String(error);
		console.error("[dsh-messaging-gateway] session archive failed", message);
	});
}
function attachWorkspace(ctx, id, cwd) {
	const registry = ctx.get("workspaceRegistry");
	if (!registry) return;
	(async () => {
		try {
			let workspace = registry.resolveByPath ? await registry.resolveByPath(cwd) : registry.list?.().find((item) => item.path === cwd);
			if (!workspace && registry.create) workspace = await registry.create(cwd, "Messaging");
			await workspace?.attachSession?.(SessionId(id));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error("[dsh-messaging-gateway] workspace attach failed", message);
		}
	})();
}
function boundHostIds(runtime) {
	const ids = [];
	for (const session of Object.values(runtime.state.sessions)) if (session.host.kind === "bound") ids.push(String(session.host.hostSessionId));
	return ids;
}
function placeBoundSessions(ctx, runtime, after) {
	const sessions = ctx.get("sessions");
	(async () => {
		for (const row of Object.values(runtime.state.sessions)) {
			if (row.host.kind !== "bound") continue;
			const id = String(row.host.hostSessionId);
			let resumed = false;
			try {
				const setup = runtime.setupForAgent(id);
				await ctx.agents.resume({
					resumeSessionId: SessionId(id),
					...setup ? { setup } : {}
				});
				resumed = true;
			} catch {}
			if (!resumed) runtime.ensureAgentSetup(id);
			pinSessionTitle(ctx, id, row.title);
			if (!isMainConversation(row.identity)) {
				archiveHostSession(ctx, id);
				continue;
			}
			const live = sessions?.get?.(SessionId(id));
			const path = (sessions?.list?.().find((item) => String(item.id) === id))?.header?.cwd ?? live?.header?.cwd;
			if (path) attachWorkspace(ctx, id, path);
		}
		if (after) await after();
	})();
}
const name = "dsh-messaging-gateway";
const inject = ["agents", "commands"];
const Config = z.object({
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
	return `<!doctype html>
<meta charset="utf-8">
<title>绑定 DSH 到你的 Slack</title>
<body style="font:16px/1.5 system-ui;max-width:720px;margin:40px auto;padding:0 16px">
<h1>绑定你的 Slack</h1>
<p>没有官方共用 bot。Slack 和飞书都在你的浏览器里绑定，token 只存你这台 DSH。飞书输入 <code>/</code> 弹出的指令来自同一份 DSH 命令目录。</p>
<ol>
<li><a href="https://api.slack.com/apps?new_app=1" target="_blank" rel="noreferrer">打开 Slack 创建应用（From an app manifest）</a>，登录你自己的 workspace，把下面清单整段贴进去，Create，然后 Install to workspace。</li>
<li>回到 <strong>DSH Web → 设置 → 消息</strong>，填 Bot Token（xoxb-）、App Token（xapp-，Socket Mode / connections:write）、你的 member id（头像 → Copy member ID）。点保存并连接。</li>
</ol>
<p><button type="button" id="copy">复制 Manifest</button> <a href="/plugins/dsh-messaging-gateway/slack-manifest">JSON</a></p>
<pre id="manifest" style="white-space:pre-wrap;background:#111;color:#eee;padding:12px;border-radius:8px">${JSON.stringify(slackManifest(catalogSlashes), null, 2).replace(/</g, "&lt;")}</pre>
<script>
document.getElementById('copy').onclick = () => {
  navigator.clipboard.writeText(document.getElementById('manifest').innerText)
  document.getElementById('copy').textContent = '已复制'
}
<\/script>
</body>`;
}
function apply(ctx, config) {
	console.log("[my-plugins/dsh-messaging-gateway] loaded");
	const getLlm = () => ctx.get("llm");
	let runtime;
	const registerModel = (commandHost) => commandHost.register({
		name: "model",
		description: "Show or switch this session model",
		input: {
			hint: "[provider/model]",
			images: false
		},
		handler: async (invocation) => {
			const key = String(invocation.agent.id);
			const llm = getLlm();
			if (llm === void 0) return {
				kind: "error",
				text: "Model switching is unavailable on this Host."
			};
			const current = runtime.modelPicks.get(key);
			if (invocation.rawInput.trim().length === 0) return {
				kind: "success",
				text: formatModelStatus(current)
			};
			const resolved = await resolveModelPick(llm, invocation.rawInput, current);
			if (!resolved.ok) return {
				kind: "error",
				text: resolved.text
			};
			runtime.modelPicks.set(key, resolved.pick);
			return {
				kind: "success",
				text: `This Slack session now uses ${resolved.pick.provider}/${resolved.pick.model}. Later turns follow this pick.`
			};
		}
	});
	const setupAgent = (agentCtx) => {
		const commandHost = agentCtx.get("commands");
		if (!commandHost) return;
		agentCtx.effect(() => registerModel(commandHost), "dsh-messaging-gateway: /model");
	};
	runtime = new GatewayRuntime({
		agents: captureAgents(ctx),
		getCommands: () => captureCommands(ctx),
		setupAgent,
		defaultModel: () => {
			return ctx.get("agentDefaultModel")?.currentSelection?.();
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
		for (const view of skillListViews(boundHostIds(runtime))) try {
			batches.push(await skills.list(view));
		} catch {}
		runtime.setSkills(mergeUserSkills(batches));
	};
	placeBoundSessions(ctx, runtime, pullSkills);
	ctx.inject([
		"sessions",
		"sessionTitle",
		"workspaceRegistry"
	], () => {
		placeBoundSessions(ctx, runtime, pullSkills);
	});
	pullSkills();
	ctx.inject(["skills"], (skillCtx) => {
		pullSkills();
		const events = skillCtx;
		skillCtx.effect(() => events.on("skills/change", () => {
			pullSkills();
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
		if (!bound || bound.kind !== "bound" || bound.owner !== subjectId(owner)) runtime.apply({
			kind: "bind",
			platform: id,
			owner: subjectId(owner),
			id: runtime.nextId(),
			at: runtime.now()
		});
	};
	const syncSlack = () => {
		const current = source();
		bindOwner("slack", current.slackOwner ?? "");
		const bot = current.slackBotToken ?? "";
		const app = current.slackAppToken ?? "";
		(async () => {
			if (stopSlack) {
				await stopSlack();
				stopSlack = void 0;
			}
			if (current.enabled !== false && bot && app && process.env.MESSAGING_GATEWAY_DISABLE_SLACK !== "1") stopSlack = await runSlack(runtime, {
				bot,
				app
			});
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
		(async () => {
			if (stopFeishu) {
				await stopFeishu();
				stopFeishu = void 0;
			}
			if (current.enabled !== false && appId && appSecret && process.env.MESSAGING_GATEWAY_DISABLE_FEISHU !== "1") stopFeishu = await runFeishu(runtime, {
				appId,
				appSecret
			});
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
		feishuSlashTail = feishuSlashTail.then(() => syncFeishuCatalog(runtime, {
			appId,
			appSecret
		}), () => syncFeishuCatalog(runtime, {
			appId,
			appSecret
		})).catch((error) => {
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
				readJson(req).then(async (raw) => {
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
					json(res, 200, {
						hostCalls: result.hostCalls.length,
						deliveries: result.deliveries,
						list: runtime.list()
					});
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
			stopSlack?.();
			stopFeishu?.();
		};
	}, "dsh-messaging-gateway: platforms");
}
//#endregion
export { Config, apply, inject, name };

# Agent notes for dsh-gateway

Read [README.md](README.md) before installing or pairing. This file is the machine path.

## Product

- Public name: **dsh-gateway**. Loader / settings id: `dsh-messaging-gateway`.
- One DSH Host, one Gateway. Slack and Feishu are Platforms on that Gateway, not two products.
- This is enforced before state load/resume by the cross-process lease beside
  `state.json`. A second or process-inaccessible Host must leave its Gateway
  inactive; never delete `instance.lock` to make it win.
- No shared bot. The human creates their own Slack app and Feishu app. Tokens stay on that Host.

## Install

Default: official `dsh`.

```sh
dsh plugin --profile web add github:aa2246740/dsh-gateway
```

From a local clone: `dsh plugin --profile web add ./dsh-gateway`.

Then the human restarts that Host and reloads the page.

If dshx is already on the machine, feed the agent https://github.com/aa2246740/dsh-external-plugin-devkit and this repo.

## Pair

1. Open **DSH → Settings → 消息**.
2. Copy the Slack manifest from that page (`复制 Manifest`), not from memory.
3. Bind the human’s own member id / open_id, never the bot’s.
4. Verify with `GET /plugins/dsh-messaging-gateway/list` and the 消息 badges (`已绑定` / `已连接`).
5. Prove a DM: send a short message to the bot, then open the matching row under the sidebar Messaging dock.

## Done when

- Settings → 消息 shows the platform as 已绑定 / 已连接.
- `GET /plugins/dsh-messaging-gateway/list` includes that platform.
- A DM to the bot gets a DSH reply. Channel messages without @mention stay silent.

## Guardrails

- Never print, commit, or paste `xoxb-`, `xapp-`, Feishu App Secret, or `state.json` into chat, git, or evidence.
- Do not approve pairing by editing `$DSH_HOME/messaging-gateway/state.json` unless the human asked for that recovery path.
- Do not restart an adopted official DSH.app from a managed shell. The human restarts it.
- Do not run a second Web Host against the same `DSH_HOME`. Use the existing
  DSH.app or direct `dsh web` Host; isolated cold-boot tests need another Home.
- Guest pairing codes exist in the Gateway reducer. The 消息 page does not yet approve guests. The first unbound DM becomes the Owner.
## Commands the human can send from Slack / Feishu

`/help` `/model` `/new` `/reset` `/compact` `/dsh <command>`

Threads on Slack that block `/` use `!` instead (`!help`, `!new`).

## Chat feel

Gateway-created Feishu and Slack sessions (DM and @-mentioned groups) get a short speaking contract at **session setup** and stream each committed assistant sentence to chat. Feishu approvals are interactive cards. Slack approvals stay plaintext. Spec decisions live in this repo (`src/feishu-voice.ts`, delivery in `src/runtime.ts`, cards in `src/feishu-card.ts`). Do not paste Grok Bot handbook / system-prompt text here.

Desktop-created sessions stay stock DSH. Same gateway session opened in the Computer sidebar keeps that feel; that is not a leak.

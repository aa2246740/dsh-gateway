# Agent notes for dsh-gateway

Read [README.md](README.md) before installing or pairing. This file is the machine path.

## Product

- Public name: **dsh-gateway**. Loader / settings id in this checkout: `dsh-messaging-gateway`.
- One DSH Host, one Gateway. Slack and Feishu are Platforms on that Gateway, not two products.
- No shared bot. The human creates their own Slack app and Feishu app. Tokens stay in that Host’s settings.

## Do

1. Install the plugin, then pair in **DSH → Settings → 消息**.
2. Copy the Slack manifest from that page (`复制 Manifest`), not from memory.
3. Bind the human’s own member id / open_id, never the bot’s.
4. Verify with `GET /plugins/dsh-messaging-gateway/list` and the 消息 badges (`Slack 已绑定` / `飞书 已绑定`).
5. Prove a DM: send a short message to the bot, then open the matching row under the sidebar Messaging dock.

## Done when

- Settings → 消息 shows the platform as 已绑定 / 已连接.
- `GET /plugins/dsh-messaging-gateway/list` includes that platform.
- A DM to the bot gets a DSH reply. Channel messages without @mention stay silent.

## Guardrails

- Never print, commit, or paste `xoxb-`, `xapp-`, Feishu App Secret, or `state.json` into chat, git, or evidence.
- Do not approve pairing by editing `$DSH_HOME/messaging-gateway/state.json` unless the human asked for that recovery path.
- Do not restart an adopted official DSH.app from a managed shell. Server-plugin changes need a Host restart the human performs.
- Guest pairing codes exist in the Gateway reducer. The 消息 page does not yet approve guests. The first unbound DM becomes the Owner.

## Commands the human can send from Slack / Feishu

`/help` `/model` `/new` `/reset` `/compact` `/dsh <command>`

Threads on Slack that block `/` use `!` instead (`!help`, `!new`).

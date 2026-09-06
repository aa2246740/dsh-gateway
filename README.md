# dsh-gateway

One [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Host, one Gateway. You create **your** Slack app and **your** Feishu app, paste the tokens into this DSH, and talk to the same agent from your phone.

There is no official shared bot. Tokens never leave your machine.

Gateway 0.1.0 also enforces that rule across processes: before it reads state or
resumes a chat, it atomically leases `$DSH_HOME/messaging-gateway/instance.lock`.
If another live or inaccessible Host already owns that Home, this Gateway stays
inactive instead of becoming a second writer. The DSH UI itself can still start;
fix the duplicate Host and keep the owner process.

New Gateway conversations use platform-isolated workspace directories by
default: `$DSH_HOME/messaging-gateway/workspaces/slack` and
`$DSH_HOME/messaging-gateway/workspaces/feishu`. Settings shows the actual cwd
and accepts an absolute directory plus a `provider/model` default for each
platform. Entering the same absolute directory for both platforms explicitly
shares it. Existing sessions keep their recorded cwd; the legacy `workspaceDir`
setting is still honored so upgrades do not move them.

You do **not** need dshx. The default path is official `dsh`.

Loader id: `dsh-messaging-gateway`. After install, open DSH **设置 → 消息**.

[Install](#install-official-dsh) · [中文配对](#中文自己配对) · [English pairing](#pair-it-yourself) · [For agents](#for-agents)

## What you get

- Slack DM and Feishu DM become real DSH sessions (tools, history, `/` commands).
- Feishu DMs (and @-mentioned group chats) use a short **speaking contract** and send the first spoken sentence as soon as it is written; the rest of that reply stays one bubble (a news digest is not split on every period). Desktop-created sessions stay stock DSH. Slack keeps its existing delivery and tone. Feishu approvals are interactive cards; Slack approvals stay plaintext.
- Computer sidebar lists them under Slack / Feishu, collapsed until you open a group.
- Computer Recents keeps the **main DM** only. Channel `@` still replies on Slack/Feishu, in a separate session, not mixed into the DM.
- `/new` or `/reset` starts a fresh session in that chat. `/compact` shrinks context without resetting.

## Requirements

- Official DSH with a **web** profile (DSH.app or `dsh --profile web`). Built against **dsh-v0.1.2-rc.1**.
- The `dsh` CLI that came with that install.
- A Slack workspace you can install apps into, and/or a Feishu tenant where you can create a 企业自建应用.

---

## Install (official `dsh`)

This is the path for people who only want official DSH.

From GitHub:

```sh
dsh plugin --profile web add github:aa2246740/dsh-gateway
```

Or from a clone:

```sh
git clone https://github.com/aa2246740/dsh-gateway.git
dsh plugin --profile web add ./dsh-gateway
```

Then **restart that DSH Host** and **reload the page**. `dsh plugin add` writes the profile; it does not hot-load a running Host.

Remove:

```sh
dsh plugin --profile web remove dsh-messaging-gateway
```

Prefer this official path. If you already use dshx, see below.

---

## 中文：自己配对

装好插件并重启 Host 之后做这些。

### 1. 打开配对页

DSH → 左下角 **设置** → 左侧 **消息**。

徽章显示 `已绑定` / `已连接` 才算接通。密钥输入框永远是空的：已保存的 token 不会回显。

也可以打开 `/plugins/dsh-messaging-gateway/setup` 看 Slack Manifest。

### 2. 接 Slack

1. 在 **消息** 页点 **复制 Manifest**。
2. 打开 [创建 Slack 应用（From a manifest）](https://api.slack.com/apps?new_app=1)，登录你的 workspace，整段贴上，Create，再 **Install to workspace**。
3. **Basic Information**
   - Bot User OAuth Token → `xoxb-…`
   - App-Level Token → 建一个 `xapp-…`，scope 必须含 **`connections:write`**（Socket Mode）。
4. 点你自己的头像 → **Copy member ID** → `U…`（不要复制 bot 的成员号）。
5. 填回 **消息** 页：Member ID、Bot token、App token → **保存并连接**。
6. 在 Slack 里给这个 bot 发一条私信。

完成：徽章 `Slack 已绑定 U…`，按钮变成灰色 **已连接**，Computer 侧栏出现 Slack 主 DM。

频道里要 **@bot** 才会回。没 @ 的闲聊会静音。

### 3. 接飞书

1. 打开 [飞书开放平台](https://open.feishu.cn/app)，创建 **企业自建应用**，启用机器人。
2. 权限（发布一个新版本之后才生效）：
   - `application:app_slash_command:write`
   - `application:app_slash_command:read`
   - `im:message.p2p_msg:readonly`
   - `im:message.group_at_msg:readonly`
   - `im:message:send_as_bot`
3. 事件订阅选 **使用长连接接收事件**，订阅 **接收消息 v2.0**。长连接要等本插件先连上，飞书后台才能保存这项。审批卡片走同一条长连接的 `card.action.trigger`（卡片回传交互），不另开应用、不加 scope。
4. 凭证与基础信息：App ID（`cli_…`）、App Secret。头像旁复制自己的 **open_id**（`ou_…`，不是机器人的）。
5. 填回 **消息** 页 → **保存并连接**。
6. 在飞书里给这个机器人发一条私信。

完成：徽章 `飞书 已绑定`。斜杠面板大约 **5 分钟** 后出现；可重启飞书客户端加速。飞书网页版往往没有 `/` 面板，用官方桌面端（PC ≥ 7.70）或手机（≥ 7.71）。

群里同样要 @ 机器人才会回。

未绑定的平台会保持关闭。必须在本机已认证的 **设置 → 消息** 中明确保存自己的 member id / open_id，私信本身不会取得 Owner。升级时已有 Owner、token 与会话历史保持不变，无需重新连接。

### 模型与推理强度

在 **设置 → 消息 → Slack / 飞书** 中一起保存新会话工作目录、模型和推理强度，然后再开始聊天。推理档位来自模型自身的目录；换模型会重置档位。选择「跟随 Host 默认」时，同时跟随默认模型和默认强度。

这些默认值用于首次私信及 `/new` / `/reset` 创建的会话，不覆盖已有会话。已有会话在电脑模型选择器里切换即可立即保存，下一条手机消息直接使用新选择，不需要先在电脑上发一句话。正在生成的请求不被中途更换；新选择从下一次请求组装开始生效。

手机也可发送 `/model provider/model high`，或用 `/model effort high` 只改当前模型的推理强度；`/model effort default` 恢复模型默认，`/model` 查看当前选择。无效档位会报错并保留原选择。这些操作与桌面使用同一个持久化 `model/selection` 状态，重开 Host 后仍保留。

### 4. 别人找你的 bot 聊天

未在 allowlist 里的人私信 bot，会收到 pairing code。当前 **消息** 页还没有「批准访客」按钮；Gateway 会把 code 记在 `$DSH_HOME/messaging-gateway/state.json`。自己用就填自己的 member id / open_id，不要把 bot 公开到陌生频道。

### 5. 怎么确认成了

- 设置 → 消息：对应平台 **已绑定**，按钮 **已连接**。
- `GET /plugins/dsh-messaging-gateway/list` 里有该 platform。
- 私信 bot，DSH 会回；Computer 侧栏能点开同一条对话。
- 频道不 @ 则不回。

---

## Pair it yourself

After official install and a Host restart.

### Open pairing

**Settings → 消息** (left nav). Badges `已绑定` / `已连接` mean the platform is live. Secret fields stay blank on purpose.

Manifest: **复制 Manifest** or `/plugins/dsh-messaging-gateway/slack-manifest`.

### Slack

1. Copy the manifest from Settings → 消息.
2. [Create an app from manifest](https://api.slack.com/apps?new_app=1), paste, Create, Install to workspace.
3. Bot token `xoxb-`. App-level token `xapp-` with **`connections:write`** (Socket Mode).
4. Your member id `U…` (avatar → Copy member ID), not the bot’s.
5. Save. DM the bot.

Channels only respond when **@mentioned**.

### Feishu

1. [Open platform](https://open.feishu.cn/app): enterprise self-built app, enable the bot.
2. Scopes (publish a version): `application:app_slash_command:write`, `application:app_slash_command:read`, `im:message.p2p_msg:readonly`, `im:message.group_at_msg:readonly`, `im:message:send_as_bot`.
3. Event subscription: **long connection**, event **receive message v2.0**. Save that after this plugin is connected. Approval cards use `card.action.trigger` on that same connection.
4. App ID `cli_…`, App Secret, your `ou_…` open_id.
5. Save. DM the bot.

Slash picker: ~5 minutes, official Feishu client (PC ≥ 7.70, mobile ≥ 7.71). Feishu web often has no `/` panel.

### Guests

Unknown DMs get a pairing code. There is no approve button on 消息 yet. For a personal Gateway, bind your own ids and do not invite the bot into public rooms.

---

## For agents

Follow [AGENTS.md](AGENTS.md). Default to official `dsh`. If the machine already has dshx, give the agent this repo and the dshx repo and let it install.

1. `dsh plugin --profile web add github:aa2246740/dsh-gateway`
2. Human restarts that Host and reloads the page.
3. Open **Settings → 消息**. Never invent tokens.
4. Slack: copy manifest from the page; human creates the app; paste `xoxb-`, `xapp-` with `connections:write`, and the human’s `U…`.
5. Feishu: human creates the app; paste App ID, App Secret, human `ou_…`; long-connection events after the plugin is up.
6. Done when badges say 已绑定 / 已连接, `GET /plugins/dsh-messaging-gateway/list` lists the platform, and a DM gets a reply.
7. Never print secrets. Never dump `$DSH_HOME/messaging-gateway/state.json` into the transcript.

## Commands

From Slack or Feishu:

| Command | What |
|---|---|
| `/help` | Catalog |
| `/model` | Show or switch this session’s model |
| `/new` `/reset` | Fresh session in this chat |
| `/compact` | Shrink context, keep the session |
| `/dsh <cmd>` | Catch-all when Slack reserves the name |
| `!help` etc. | Same commands inside a Slack thread |

## Layout

```
src/gateway/     reducer: handle, list, access, pairing
src/slack.ts     Slack Socket Mode adapter
src/feishu.ts    Feishu WS + slash sync + approval cards
src/feishu-voice.ts   speaking contract (Feishu gateway sessions)
src/feishu-card.ts    Feishu approval card + callback
src/client/      Settings → 消息, sidebar dock
```

State: `$DSH_HOME/messaging-gateway/state.json` (override with `MESSAGING_GATEWAY_STATE`). Settings tokens: DSH settings namespace `dsh-messaging-gateway`.

The adjacent `instance.lock` is runtime ownership, not user configuration. Do
not delete it while its owner PID is alive. A later Gateway automatically
reclaims it only after the recorded process is proved dead; denied PID access
fails closed.

## Chat feel (not a model swap)

Three seams, all in this plugin:

1. **Session setup.** When the gateway creates a Feishu host session (`bindNewAgent` / resume of that session), it attaches a short speaking contract on that agent only: first visible reply is a short human sentence, short, lead with the answer, speak the result. Desktop `agents.create` and Slack sessions do not get it. Opening the same Feishu session in the Computer sidebar keeps the contract because it is the same host session.
2. **First sentence, then the rest.** Feishu does not leave a sticky `Working…` text. Turn start puts a **Typing** reaction on the user’s message; the reaction comes off when the first spoken sentence lands or the turn ends. The first finished spoken sentence can go out from chunks. The remainder of that same reply is one chat bubble — do not period-split a digest. Later committed messages in the turn stay whole. Markdown (lists, fences, bold, tables) is sent as Feishu `post` + `md` (CommonMark / GFM). Plain sentences stay `text`. Slack still flushes at idle and may still show Working….
3. **Approval card + callback.** Feishu approval deliveries are interactive cards (`允许一次` / `拒绝`) mapped onto the existing allow-once / deny protocol. `card.action.trigger` becomes `approvalAnswer`. Only the session owner can settle; a second click is ignored. Desktop approval on the same session may coexist — first click wins, the card then shows 已处理.

Slack outbound stays plain text, including `Approval needed: …`. No Feishu card JSON on Slack.

## Optional: dshx

Already using an Agent against a Harness checkout? Install [dshx](https://github.com/aa2246740/dsh-external-plugin-devkit), then give the Agent both that repo and this one (`https://github.com/aa2246740/dsh-gateway`). It can take it from there.

## License

MIT. See [LICENSE](LICENSE).

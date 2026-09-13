# dsh-gateway

```sh
dsh plugin --profile web add github:aa2246740/dsh-gateway
```

需要官方 DeepSeek Harness **0.1.5-rc.2**（`dsh` 或 `npx @deepseek-ai/dsh`），以及 PATH 上的 **pnpm**。这条命令在 `$DSH_HOME/profiles/web` 里跑 pnpm，把声明了 `dsh.bundle.patch` 的包装进 web profile。仓库已提交 `lib/`，git 安装不跑 `prepare`。然后**重启这个 Host，刷新页面**。`dsh plugin add` 只写 profile，不会热挂正在跑的进程。

`dsh` 不在 PATH 时：

```sh
npx @deepseek-ai/dsh plugin --profile web add github:aa2246740/dsh-gateway
```

DSH.app 的 Plugin Manager 只接受 npm 包名，吃不下 `github:`。用上面这条命令请走 `dsh web` 的 web profile。

本地 clone（可选）：

```sh
git clone https://github.com/aa2246740/dsh-gateway.git
dsh plugin --profile web add file:./dsh-gateway
```

卸掉：

```sh
dsh plugin --profile web remove dsh-messaging-gateway
```

一台 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Host，一个 Gateway。你自己建 Slack 应用和飞书应用，把 token 贴进这台 DSH，就能从手机跟同一个 agent 说话。

没有官方共享 bot。token 不离开这台机器。

Loader id：`dsh-messaging-gateway`。装完并重启后打开 DSH **设置 → 消息**。

Gateway 读状态或恢复聊天前，会原子租用 `$DSH_HOME/messaging-gateway/instance.lock`。同一 Home 上已有别的 Host 占着，这个 Gateway 就保持不活动。修好重复 Host，留下那个主人进程。

新会话默认工作目录：

- `$DSH_HOME/messaging-gateway/workspaces/slack`
- `$DSH_HOME/messaging-gateway/workspaces/feishu`

设置页可以改成绝对路径，并给每个平台设 `provider/model`。两个平台填同一个目录就是故意共享。已有会话保留当时记录的 cwd。

## 中文：自己配对

装好并重启 Host 之后：

1. DSH → 左下角 **设置** → 左侧 **消息**。徽章 `已绑定` / `已连接` 才算接通。密钥输入框永远是空的。
2. **Slack**：在消息页点 **复制 Manifest**，到 [From a manifest](https://api.slack.com/apps?new_app=1) 创建并 Install。填 Bot token `xoxb-`、带 `connections:write` 的 App-level token `xapp-`、你自己的 member id `U…`。保存后给 bot 发一条私信。频道里要 @bot 才会回。
3. **飞书**：在 [开放平台](https://open.feishu.cn/app) 建企业自建应用，启用机器人。权限发布一个新版本后才生效：`application:app_slash_command:write`、`application:app_slash_command:read`、`im:message.p2p_msg:readonly`、`im:message.group_at_msg:readonly`、`im:message:send_as_bot`。事件订阅选长连接，订阅接收消息 v2.0。填 App ID `cli_…`、App Secret、你自己的 `ou_…`。保存后给机器人发一条私信。斜杠面板大约 5 分钟后出现，官方桌面端 PC ≥ 7.70、手机 ≥ 7.71。
4. 模型和推理强度在 **设置 → 消息 → Slack / 飞书** 里和目录一起保存，用于首次私信以及 `/new` / `/reset`。手机也可以 `/model provider/model high`。
5. 未在 allowlist 里的人私信 bot 会收到 pairing code。当前消息页还没有批准访客按钮。自己用就填自己的 id，不要把 bot 公开到陌生频道。

Slack DM 和飞书 DM 都是真正的 DSH 会话。`/new` 或 `/reset` 在这个聊天里开新会话。`/compact` 压缩上下文。`/help` 看目录。

状态在 `$DSH_HOME/messaging-gateway/state.json`。不要在 transcript 里打印 token 或 dump 这份文件。

## 许可

MIT。见 [LICENSE](LICENSE)。

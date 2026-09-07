# dsh-gateway

一台 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Host，一个 Gateway。你自己建 Slack 应用和飞书应用，把 token 贴进这台 DSH，就能从手机跟同一个 agent 说话。

没有官方共享 bot。token 不离开这台机器。

Loader id：`dsh-messaging-gateway`。装完打开 DSH **设置 → 消息**。

Gateway 读状态或恢复聊天前，会原子租用 `$DSH_HOME/messaging-gateway/instance.lock`。同一 Home 上已有别的 Host 占着，这个 Gateway 就保持不活动。修好重复 Host，留下那个主人进程。

新会话默认工作目录：

- `$DSH_HOME/messaging-gateway/workspaces/slack`
- `$DSH_HOME/messaging-gateway/workspaces/feishu`

设置页可以改成绝对路径，并给每个平台设 `provider/model`。两个平台填同一个目录就是故意共享。已有会话保留当时记录的 cwd。

## 安装

需要带 web profile 的官方 DSH（DSH.app 或 `dsh --profile web`），构建对象是 **dsh-v0.1.2-rc.1**。

```sh
dsh plugin --profile web add github:aa2246740/dsh-gateway
```

或本地 clone：

```sh
git clone https://github.com/aa2246740/dsh-gateway.git
dsh plugin --profile web add ./dsh-gateway
```

然后重启这个 DSH Host，刷新页面。

```sh
dsh plugin --profile web remove dsh-messaging-gateway
```

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

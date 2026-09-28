# dsh-gateway

## 安装

### DSH Studio 桌面 App（推荐）

打开 **设置 → 插件 → 添加插件**，在“包名或地址”中输入：

```text
github:aa2246740/dsh-gateway#v0.2.2
```

桌面端插件管理器负责 Desktop profile 和内置包管理器。本发布已包含 `lib/`；普通使用不需要 clone 或本地构建。若应用提示刷新或重新打开，请按提示完成。

### Web CLI

```sh
dsh plugin --profile web add github:aa2246740/dsh-gateway#v0.2.2
```

这条官方 CLI 命令只写入 `web` profile，不能修改 Desktop App 的 profile。对于已经运行的 Web Host，请重新打开该 Host 一次，再刷新网页。

需要官方 DeepSeek Harness **0.1.7-rc.2**（tag `dsh-v0.1.7-rc.2`，npm `@deepseek-ai/dsh@0.1.7-rc.2`）。Harness peers 是 `>=0.1.7-rc.1 <0.1.8`。

`dsh` 不在 PATH 时：

```sh
npx @deepseek-ai/dsh plugin --profile web add github:aa2246740/dsh-gateway#v0.2.2
```

官方 CLI 只管理 `web` profile；Desktop App 请使用上面的应用内“添加插件”入口。

本地 clone（开发/本地测试）：

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

磁盘满或文件系统暂时不可写时，Gateway 的锁心跳会保留原所有权，记录一次错误并继续重试；写入恢复后记录恢复消息。心跳异常不会再作为未捕获异常退出整个 Host。这项保护不代表磁盘已恢复可用，会话和消息仍需要足够空间才能保存。

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

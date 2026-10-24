# 本机后端与临时公网入口

将本目录 `scripts/` 中四个文件原样复制到网页仓库 `scripts/`。脚本要求 Node 26，macOS 包装文件默认使用 `/opt/homebrew/bin/node`。后端路径为 `backend/server.mjs`，前端配置为 `public/data/runtime.json`。

## 启动

在网页仓库根目录执行：

```zsh
export TTS_MOS_DATA_DIR="$(cd .. && pwd)/private-data"
export CLOUDFLARED_BIN="/Users/wkz/Documents/Codex/2026-10-24/itu-t-p-808/work/ops/bin/cloudflared"
/opt/homebrew/bin/node scripts/launch-local.mjs
```

上述命令只启动本机后端和 Cloudflare Quick Tunnel，并更新本地公开配置。需要把新入口写入 GitHub 时，使用：

```zsh
/opt/homebrew/bin/node scripts/launch-local.mjs --publish-config
```

`--publish-config` 会调用当前已登录的 `gh`，仅更新 `wkzCode/tts-mos-evaluation` 默认分支的 `public/data/runtime.json`。它从 GitHub 获取文件更新必需的版本字段，通过结构化 JSON 标准输入提交，不运行 shell 插值、不读取或打印 token，也不推送个人评分数据。首次使用可先运行 `gh auth status` 自行确认账号。没有此参数不会发布 GitHub 配置。

macOS 可双击 `scripts/launch-local.command`；默认不带发布参数。也可在终端运行 `scripts/launch-local.command --publish-config`。通过 `TTS_MOS_NODE_BIN` 可覆盖包装脚本的 Node 路径。Finder 双击不会继承普通终端刚导出的环境变量，因此默认数据目录为**网页仓库父目录下的 `private-data`**。自定义环境请使用终端启动。`cloudflared` 优先使用 `CLOUDFLARED_BIN`，其次寻找仓库 `bin/`、当前任务 `work/ops/bin/`、Homebrew 路径或 PATH。

脚本也支持 `--repo /绝对路径/网页仓库`，可从任意当前目录启动。默认端口8787，可用环境变量 `PORT` 调整。后端环境固定 `HOST=127.0.0.1`。数据目录被强制放在仓库之外；相对环境路径以调用时当前目录解析，建议总是使用绝对路径。

## 运行状态与停止

脚本先请求 `http://127.0.0.1:8787/api/health`，只有返回 `ok:true` 且 `app:"tts-mos-evaluation"` 才视为正确后端。如果已有正确后端，则复用并提示其数据目录无法在此确认，不将该进程纳入退出清理。如果端口被其他程序占用，启动会报错并保留对方进程。

私有目录下的 `ops/` 包含：

- `supervisor.lock`：主管进程PID、脚本位置、仓库位置及启动时间。
- `status.json`：主管/后端/隧道PID、进程归属、健康状态、当前入口及配置发布时间。
- `backend.log`、`tunnel.log`：仅在本机保存的追加日志。

`ops/` 权限为700，日志和状态权限为600。记录下的已有后端若被复用，其PID保持 `null`，`backendOwned` 为 `false`。健康状态每15秒更新一次。首次域名传播较慢或GitHub配置发布暂时失败时，状态记为 `config-retry-wait`；主管进程以15、30、60、120、240秒递增、最长300秒的间隔，在隧道健康后自动重试。`configInFlight`、`configRetryAttempts`、`configNextRetryAt` 可供排查；成功后清除错误并恢复 `running`。一次仅运行一个配置任务，本地配置与远端发布分别记录已完成地址；已完成的地址不重复写入，远端内容相同时不再创建commit。

保持启动终端打开。按 **Ctrl+C** 会停止本脚本创建的后端和隧道；收到 SIGTERM/SIGHUP 也会清理。另一个终端可运行：

```zsh
/opt/homebrew/bin/node scripts/stop-local.mjs
```

停止命令需沿用启动时的 `TTS_MOS_DATA_DIR` 和 `--repo`。它会核对锁内PID与实际进程命令，再发SIGINT给主管进程。也可双击 `scripts/stop-local.command` 停止使用默认目录启动的实例。脚本不会按端口、进程名称或全局模式杀进程。只有记录中的旧PID已不存在时，下一次启动才自动回收旧锁。

## 临时入口更换

Cloudflare Quick Tunnel 不需要账号，进程重启会得到新的 `https://随机.trycloudflare.com` 地址。主管进程会在隧道意外退出后重试，并在新地址通过 `/api/health` 后更新本地配置；带 `--publish-config` 的本次运行也会再次提交公开入口。连续8次隧道失败后停止，检查私有日志再重新运行。

参与者始终打开 [同一个评测网页](https://wkzcode.github.io/tts-mos-evaluation/)。网页入口保持不变，提交API从配置获取。更新 GitHub 配置后，Pages 重新部署可能需要片刻。前端可在提交失败后重取配置，并以公开 [GitHub Contents API](https://api.github.com/repos/wkzCode/tts-mos-evaluation/contents/public/data/runtime.json) 为备用入口发现来源；请求 `Accept: application/vnd.github.raw+json` 可直接读取 JSON，默认返回则需解码其 base64 `content`。此操作不需要客户端token。脚本不会修改前端的重试逻辑。

关闭本机、断网或停止脚本会使临时API不可达；再次启动并发布新配置后可沿用网页链接。本脚本不安装登录启动项、不创建Cloudflare账号、不配置固定域名。

## 本次校验范围

已完成两个 Node 文件的语法检查、两个 `.command` 的 zsh 语法检查和帮助命令校验。补充的 `config-recovery.test.mjs` 使用纯内存桩验证延迟健康恢复、发布失败重试、关闭发布、单任务去重、隧道替换、退避上限和远端内容幂等；可用 `/opt/homebrew/bin/node config-recovery.test.mjs` 在本说明所在目录重跑，不启动服务、不联网。按照任务要求未实际启动后端或隧道，未替用户执行配置发布；主agent需在复制后执行真实联调。

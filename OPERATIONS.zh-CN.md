# 公网服务器部署运维

服务器：`wangkz@183.36.243.124`，Ubuntu 22.04。网站、API和SQLite均运行在服务器上，不依赖Mac持续在线。未下载任何语音生成模型、未生成合成音频。

## 已安装的专用服务

部署根目录为 `/home/wangkz/tts-mos-evaluation`：

- `site/`：静态页面和 `backend/server.mjs`。
- `private-data/`：SQLite、管理凭证及状态日志，位于site之外，目录权限700。
- `runtime/node-v24.22.1-linux-x64/bin/node`：Node 24 LTS。
- `runtime/cloudflared`：Cloudflare官方Linux amd64二进制，版本2026.10.3。
- `runtime/tunnel-supervisor.py`：仅用系统Python标准库的隧道守护程序。

`~/.config/systemd/user/tts-mos-web.service` 和 `tts-mos-tunnel.service` 已启用。用户会话本身已有 `Linger=yes`，因此SSH断开后继续运行，系统启动时由用户systemd启动。没有安装或改动系统级服务，没有更改nginx、防火墙或其他用户进程。

网页服务监听 `0.0.0.0:18787`，公网直连已独立验证200；单元内设置 `TTS_MOS_DATA_DIR=/home/wangkz/tts-mos-evaluation/private-data`、`TRUST_PROXY_LOOPBACK=1`。后者仅让明确来自loopback的受控反向代理传递HTTP/HTTPS协议，管理员路由仍拒绝公网和代理请求。数据库为 `private-data/responses.sqlite`。不要把private-data复制进site或Git仓库。

## 固定入口与HTTPS访问

固定IP入口为 `http://183.36.243.124:18787/`，已配置为自动跳转到当前HTTPS地址。web单元通过 `PUBLIC_HTTPS_URL_FILE=/home/wangkz/tts-mos-evaluation/private-data/ops/current-url.txt` 动态读取健康入口，隧道地址改变后无需修改分享链接。本机管理员SSH转发不跳转。公网302、HTTPS首页200和正式测评未开放状态均已验证。

本次启动得到的HTTPS入口：

https://categories-exposure-competent-supreme.trycloudflare.com/

通过实际公网检查：首页200、`/api/health`200、`/admin`403。因为网页与API部署同源，`public/data/runtime.json` 的 `apiBase` 保持空字符串，无需发布GitHub配置。

这是无需Cloudflare账号的Quick Tunnel。隧道进程或服务器重启后地址可能变化。当前地址始终写在：

```text
/home/wangkz/tts-mos-evaluation/private-data/ops/current-url.txt
```

隧道状态写在同目录 `tunnel-status.json`，包括URL、主管/子进程PID、后端健康和公网健康。DNS传播延迟时状态为 `waiting_public_health`，每15秒继续探测，成功后自动恢复 `running`，不会因首轮超时永久停止。隧道异常退出由systemd自动重启；超过120秒仍未返回URL也会重启。普通web服务重启不会主动重启隧道，通常保持现有HTTPS地址。

## 日常命令

通过SSH以wangkz执行：

```sh
systemctl --user status tts-mos-web.service tts-mos-tunnel.service
cat /home/wangkz/tts-mos-evaluation/private-data/ops/tunnel-status.json
curl --fail http://127.0.0.1:18787/api/health
```

更新网页代码后只重启web：

```sh
systemctl --user restart tts-mos-web.service
```

需要重启隧道时：

```sh
systemctl --user restart tts-mos-tunnel.service
cat /home/wangkz/tts-mos-evaluation/private-data/ops/current-url.txt
```

新URL可能需要短暂传播，检查状态后再向测试者提供。日志只写服务器私有目录：`ops/web.log`、`ops/cloudflared.log`、`ops/tunnel-supervisor.log`，文件权限600。日志为追加模式，长期使用可定期人工归档。

停止本项目两个服务：

```sh
systemctl --user stop tts-mos-tunnel.service tts-mos-web.service
```

## 管理入口

管理员页面及导出API默认仅限loopback并需要管理token。先在自己的电脑建立SSH转发：

```sh
ssh -N -L 18787:127.0.0.1:18787 wangkz@183.36.243.124
```

随后在电脑浏览器打开 `http://127.0.0.1:18787/admin`。管理token位于服务器 `private-data/admin-token.txt`，不要放入网页、URL、公开仓库或终端共享日志。macOS可以在另一个本机终端把token直接复制到剪贴板而不打印：

```sh
ssh wangkz@183.36.243.124 'cat /home/wangkz/tts-mos-evaluation/private-data/admin-token.txt' | pbcopy
```

把剪贴板内容粘贴到管理页的密码输入框。该token从未被本次部署工具打印。

## 数据备份

使用SQLite在线备份方式生成一致性副本，或先停止web再复制整个private-data。不要在web正在写入时只拷贝主SQLite文件而忽略WAL。未来补齐合成音频后，先完成隔离测试与资源核验，再解除正式session锁定；当前部署阶段不执行音频生成。

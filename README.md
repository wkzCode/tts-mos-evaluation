# 听见自然 · 中文语音自然度测评

无依赖的中文测评网页与 Node / SQLite 后端，整站部署在公网 Linux 服务器。页面、匿名音频与API默认同源，评分直接写入服务器私有数据库。正式测评现已开放：20条文本、80条匿名正式音频及2条独立练习；四个来源为Qwen3-TTS、F5-TTS、VoxCPM1.5和真人录音。

正式入口为 http://183.36.243.124:18787/ ，自动跳转到当前HTTPS地址。当前已验收音频和研究配置以服务器部署为准；仓库内的public材料仍保留部署前的准备快照，未将研究私有映射或评分上传到GitHub。

## Linux 服务器运行

需要 Node.js 22.13+（支持 `node:sqlite`），无需安装 npm 依赖。

```sh
cd /完整路径/tts-mos-site
TTS_MOS_DATA_DIR="$HOME/.local/share/tts-mos" HOST=0.0.0.0 PORT=18787 node backend/server.mjs
```

通过服务器公开地址及端口访问整站，例如 `http://183.36.243.124:18787/`。生产运行应由服务器服务管理器保持进程运行，命令使用实际部署目录、运行账号和端口。默认HOST仍为127.0.0.1，仅本机可访问；直接提供公网服务时显式设置HOST=0.0.0.0，或让反向代理转发到回环地址。

`GET /api/health` 返回 `{ "ok": true, "app": "tts-mos-evaluation", "version": 1 }`。`GET /api/study-status` 返回材料实际可用数量与正式开放状态。

私有数据目录必须放在源码仓库和public之外。Linux默认目录为 `$XDG_DATA_HOME/tts-mos` 或 `~/.local/share/tts-mos`；也可用 `TTS_MOS_DATA_DIR` 指定固定服务器目录。目录包含：

- `responses.sqlite`、`responses.sqlite-wal`、`responses.sqlite-shm`：参与者姓名、性别、身份、随机会话凭证与评分。
- `admin-token.txt`：首次启动自动生成，文件权限0600。凭证不写日志，不发往前端。
- `study-key.json`：研究者独立放入的匿名音频到系统映射。

仓库或公开目录不得保存评分、身份、管理凭证、SSH密钥或模型映射。服务器登录凭证由部署者使用系统SSH管理，本应用不读取或记录这些凭证。

## 材料约定

`public/data/study.json` 的完整结构：

```json
{
  "study_id": "chinese-tts-naturalness-v1",
  "materials_status": "pending",
  "title": "中文语音自然度测评",
  "description": "根据听到的语音评价自然度",
  "samples": [
    { "id": "匿名唯一ID", "text_id": "t01", "text": "待朗读的文本。", "audio": "audio/匿名唯一ID.wav", "duration_seconds": 3.42 }
  ],
  "practice": [
    { "id": "p01", "text": "独立练习文本。", "audio": "audio/p01.wav" },
    { "id": "p02", "text": "另一条独立练习文本。", "audio": "audio/p02.wav" }
  ]
}
```

正式材料必须恰好80条，20个text_id各4条，每段音频使用匿名ID。提供精确 `duration_seconds`，后端据此验证报告时长。2条练习应为独立材料，练习评分不上传。材料未全部生成时保留80条计划记录并设置 `materials_status: "pending"`；仅真实存在的文件放进audio目录。网站明确显示“正式音频准备中，暂未开放评分”，禁止建立正式会话。现有两段独立真人练习可以通过“试听与评分练习”预览完整播放与打分交互，无需身份、不建会话、不保存评分，结束后返回首页。后端离线时仍可使用静态练习，并独立提示连接状态，不会将离线或未备齐材料误报为开放。

部署新材料时，填写所有音频实际正数duration_seconds，并在生成、上传及验收后将materials_status改为ready。后端确认80条均存在、非空、时长有限且大于0、20×4结构正确、至少2个独立练习文件存在，并且不处于pending后，才开放正式建档及评分。本次已完成该流程；正式音频均为24kHz、单声道、PCM16，处理记录保留在服务器私有目录。

不要把系统或模型名称写入公开manifest、音频文件名或界面。私有 `study-key.json` 格式为：

```json
{ "systems": { "匿名唯一ID": "实际系统ID" }, "labels": { "实际系统ID": "研究者显示名称" } }
```

后端统计按systems映射分组，无映射时显示unmapped。labels为可选说明。正式收集开始后，材料变化应更新study_id；已有会话遇到study_id变化会拒绝混入评分。收集期间保持材料和版本稳定。

## 同源配置与访问来源

`public/data/runtime.json` 默认使用同源API：

```json
{ "apiBase": "" }
```

页面直接请求当前服务器的 `/api/*`，不依赖Mac或GitHub Pages。HTTPS入口由服务器侧隧道提供。客户端默认只读取站内runtime，不访问GitHub或任何外部配置服务。若需独立API，可明确填写完整公开API地址，不带末尾斜杠；配置中不得放密钥。

客户端启动或明确重连会读取runtime（4秒超时）；正常评分不反复查配置。网络失败会等待刷新配置，对GET、PUT及幂等最终提交最多重试一次，创建参与者不自动重试。第二次失败仍明确显示错误。代码层可通过 `createApiClient({fallbackConfigUrl: 'https://明确指定的配置地址'})` 显式启用备用配置源，默认关闭。

同源Origin必须与请求Host的协议、主机和端口一致，例如 `http://183.36.243.124:18787`；其他来源拒绝。默认也允许配置端口对应的本机localhost与127.0.0.1开发来源。跨源部署或反向代理TLS终止时，使用逗号分隔的 `ALLOWED_ORIGINS` 明确列出浏览器公开Origin，例如：

```sh
ALLOWED_ORIGINS="https://study.example.org" TTS_MOS_DATA_DIR="/私有数据目录" HOST=127.0.0.1 PORT=18787 node backend/server.mjs
```

后端不信任客户端传来的forwarded协议去扩大来源范围。`TTS_MOS_PUBLIC_DIR`可指定静态材料目录或隔离测试目录。

## 测评与保存

参与者先填写姓名、性别与身份，可选单位；性别须明确选择男或女。确认设备并完成两条练习后进入正式测评。80条匿名随机混排，每批20条，每次只呈现一条。自定义播放器不提供拖动和倍速；完整播放后才能选择1–5整数自然度评分。可重听或返回修改，主键(session_id,sample_id)确保修改覆盖且不重复计票。

后端验证会话、材料版本、音频ID、评分、ended事件、有效时长及听取时长。浏览器报告无法作为反作弊的绝对证明；本工具用于合作式主观测评。设备提示音仅检查播放设备，不是听力诊断。

点击保存后先保存到当前浏览器，再上传。失败时停留当前条并显示待同步，用户重试后继续；同浏览器刷新可恢复进度与待传评分。本地存储键包含站点目录和study_id，避免同一域名下的其他研究冲突。仅后端确认80条均已保存后允许最终提交；最终提交锁定评分。JSON备份含会话恢复凭证、身份、评分与同步状态，应私下保管；CSV提供本人评分备份。当前无跨设备导入流程，恢复请使用原浏览器。

## 通过 SSH 转发管理与导出

管理功能保持仅本机回环连接与管理token可用，不向公网开放。管理员可将服务器端口转发到自己电脑，例如：

```sh
ssh -N -L 18788:127.0.0.1:18787 服务器登录账号@服务器地址
```

然后打开 `http://127.0.0.1:18788/admin`，从服务器私有 `admin-token.txt` 读取管理凭证并输入。管理页和私有API同时限制本机Host、回环连接与无代理转发标识；私有API还始终验证管理凭证。公开服务器Host访问管理页会被拒绝，公网接口也不能读取凭证文件。

管理页支持导出原始CSV（含未完成会话及completed_at）和查看汇总。CSV正确转义逗号/引号/换行，对可能被表格软件解释为公式的文本加前缀。无公开查看参与者姓名或评分的接口。

汇总仅包含与当前study_id一致的完整会话：先计算每系统每文本均值，再对文本等权求系统均值；同时报告实际人数、文本数、评分数。空数据不会生成分数或置信区间。如需推断，请按参与者进行聚类bootstrap，保留同一听者的全部文本评分；多次参与的同一人应由研究者按事先规则合并或排除，不能将80段当作80位独立听者。

数据备份应使用SQLite在线备份或先停止服务再复制数据库；运行中不要只复制主文件而忽略WAL。请依据研究安排限定身份数据访问及保存期限。

## API

- GET `/api/study-status`：仅返回 `{ready,expected:80,available}`，不包含身份、模型映射或结果；available是存在且有有效正数时长的正式音频数。
- POST `/api/sessions`：`{name,gender?,role,organization?,device_confirmed:true}`，返回会话id、随机token及order。
- GET `/api/session`：带 `Authorization: Bearer <session token>`，只返回此会话身份（含gender）、评分及状态。
- PUT `/api/ratings`：带会话token，`{sample_id,score,listened_seconds,duration_seconds,ended:true}`。
- POST `/api/complete`：带会话token；未满80条拒绝完成。
- GET `/api/admin/summary`、`/api/admin/export`：仅本机及管理token可访问。

请求体限制16 KiB；SQL使用参数化语句；静态路径限制public内真实文件，不能读取私有目录。

## 验证

```sh
npm test
node --check public/app.js
node --check backend/server.mjs
```

集成测试在临时隔离目录运行，覆盖身份校验、随机顺序、播放门控、整数范围、覆盖计分、不完整提交拒绝、完成锁定、CORS、代理管理访问拒绝、私有导出、CSV公式处理、路径保护和请求大小限制。测试还覆盖pending状态、20/80文件计数、完整文件但显式pending仍锁定、缺失练习、无效时长及无数据库写入的两条练习预览。隔离临时目录中的非音频marker文件仅测试存在规则，不产生可播放音频或研究评分。同时验证公网Host与端口严格同源、显式ALLOWED_ORIGINS、默认客户端不访问外部配置、公开Host无法访问管理页。浏览器视觉可使用已有练习验收；完整80段正式音频播放须等待真实材料备齐后验收。

## 性别字段与旧会话兼容

姓名、性别与身份信息仅用于本次测评。新报名表要求明确选择男或女；个人JSON、个人CSV和管理员CSV均包含gender，旧会话未填写时导出空字符串。后端兼容旧客户端缺失或空gender，非空仅接受男或女，不从姓名或身份推断性别。

启动时在事务中检查sessions结构，旧库只新增 `gender TEXT NOT NULL DEFAULT ''`，重复启动不会重复迁移。原会话id、token、评分、完成状态保持不变，既有参与者继续恢复和评分，无需重测或更换study_id/音频UUID。正式发布前由部署者按既有流程备份数据库；本次本地回归仅使用隔离测试库。

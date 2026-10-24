# 听见自然 · 中文语音自然度测评

无依赖的中文测评网页及本机 Node / SQLite 接收端。公开页面与个人数据严格分开：GitHub Pages 只提供静态页面和匿名音频；评分通过 HTTPS API 写入研究者 Mac 的 SQLite。

## 本机运行

需要 Node.js 22.13+（支持 `node:sqlite`），无需安装 npm 依赖。

```sh
cd /完整路径/tts-mos-site
TTS_MOS_DATA_DIR="$HOME/Library/Application Support/TTS-MOS" PORT=8787 node backend/server.mjs
```

访问 `http://127.0.0.1:8787/`。默认仅绑定回环地址。`GET /api/health` 返回 `{ "ok": true, "app": "tts-mos-evaluation", "version": 1 }`。

私有目录必须放在 Git 仓库和 public 目录之外。默认目录为 `~/Library/Application Support/TTS-MOS`，包含：

- `responses.sqlite`、`responses.sqlite-wal`、`responses.sqlite-shm`：参与者身份、匿名会话凭证与评分。
- `admin-token.txt`：首次启动自动生成，文件权限 0600。凭证不写日志，不发往前端。
- `study-key.json`：研究者独立放入的匿名音频到系统映射。

GitHub 账号为 `wkzCode`；本项目不收集或保存 GitHub 登录凭证。部署认证交给已登录的 GitHub CLI / 系统凭证服务；不要在网页或配置中放访问令牌。

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

合成音频后续在服务器生成；本站不在本机生成音频，也不以空文件或替代音频冒充正式材料。服务器文件回传后，填写所有音频实际正数duration_seconds，并将materials_status改为ready。后端必须确认80条均存在、非空、时长有限且大于0、20×4结构正确、至少2个独立练习文件存在，并且不处于pending，才开放正式建档及评分。

不要把系统或模型名称写入公开manifest、音频文件名或界面。私有 `study-key.json` 格式为：

```json
{ "systems": { "匿名唯一ID": "实际系统ID" }, "labels": { "实际系统ID": "研究者显示名称" } }
```

后端统计按systems映射分组，无映射时显示unmapped。labels为可选说明。任何材料变化应更新study_id；已有会话遇到study_id变化会拒绝混入评分。收集期间保持材料和版本稳定。

## GitHub Pages 与 HTTPS 接收

将public作为Pages静态站点发布目录。公开地址预计为 `https://wkzcode.github.io/tts-mos-evaluation/`。仓库可以保存本项目代码，但不得提交真实评分、数据目录、管理密钥或系统映射。

通过HTTPS隧道将公网API转发至本机 `http://127.0.0.1:8787`，并将 `public/data/runtime.json` 配置为：

```json
{ "apiBase": "https://实际的HTTPS接收地址" }
```

本机同源调试时设为空字符串。apiBase不带末尾斜杠。配置中只有公开API地址，不放任何密钥。临时隧道重启可能变更地址，需更新并重新发布runtime。网页启动或明确重连时并行读取runtime和本仓库GitHub Contents公开runtime（每路4秒超时），GitHub最新地址优先，已知最新地址不会被滞后的Pages覆盖。正常评分不会反复读取配置；网络失败会等待刷新配置，对GET、PUT及幂等最终提交最多重试一次，创建参与者不自动重试。第二次失败仍明确显示错误，不会把未保存评分标记成功。请保持接收Mac和隧道运行。

默认CORS允许 `https://wkzcode.github.io`、本机localhost和127.0.0.1（使用PORT指定的端口）。URL会标准化主机大小写。其他开发源用逗号分隔的 `ALLOWED_ORIGINS` 追加。`HOST`可调整绑定地址；不建议直接把HTTP服务暴露公网。`TTS_MOS_PUBLIC_DIR`仅用于指定静态材料目录或隔离测试。

## 测评与保存

参与者先填写姓名与身份，可选单位；确认设备并完成两条练习后进入正式测评。80条匿名随机混排，每批20条，每次只呈现一条。自定义播放器不提供拖动和倍速；完整播放后才能选择1–5整数自然度评分。可重听或返回修改，主键(session_id,sample_id)确保修改覆盖且不重复计票。

后端验证会话、材料版本、音频ID、评分、ended事件、有效时长及听取时长。浏览器报告无法作为反作弊的绝对证明；本工具用于合作式主观测评。设备提示音仅检查播放设备，不是听力诊断。

点击保存后先保存到当前浏览器，再上传。失败时停留当前条并显示待同步，用户重试后继续；同浏览器刷新可恢复进度与待传评分。本地存储键包含站点目录和study_id，避免同一GitHub Pages域名下的其他研究冲突。仅后端确认80条均已保存后允许最终提交；最终提交锁定评分。JSON备份含会话恢复凭证、身份、评分与同步状态，应私下保管；CSV提供本人评分备份。当前无跨设备导入流程，恢复请使用原浏览器。

## 本机管理与导出

在接收Mac打开 `http://127.0.0.1:8787/admin`，从私有 `admin-token.txt`复制管理凭证输入管理页。管理页和私有API均同时限制本机Host、回环连接与无代理转发标识；私有API还始终验证管理凭证，因此经公网隧道不可访问管理功能。

管理页支持导出原始CSV（含未完成会话及completed_at）和查看汇总。CSV正确转义逗号/引号/换行，对可能被表格软件解释为公式的文本加前缀。无公开查看参与者姓名或评分的接口。

汇总仅包含与当前study_id一致的完整会话：先计算每系统每文本均值，再对文本等权求系统均值；同时报告实际人数、文本数、评分数。空数据不会生成分数或置信区间。如需推断，请按参与者进行聚类bootstrap，保留同一听者的全部文本评分；多次参与的同一人应由研究者按事先规则合并或排除，不能将80段当作80位独立听者。

数据备份应使用SQLite在线备份或先停止服务再复制数据库；运行中不要只复制主文件而忽略WAL。请依据研究安排限定身份数据访问及保存期限。

## API

- GET `/api/study-status`：仅返回 `{ready,expected:80,available}`，不包含身份、模型映射或结果；available是存在且有有效正数时长的正式音频数。
- POST `/api/sessions`：`{name,role,organization?,device_confirmed:true}`，返回会话id、随机token及order。
- GET `/api/session`：带 `Authorization: Bearer <session token>`，只返回此会话评分及状态。
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

集成测试在临时隔离目录运行，覆盖身份校验、随机顺序、播放门控、整数范围、覆盖计分、不完整提交拒绝、完成锁定、CORS、代理管理访问拒绝、私有导出、CSV公式处理、路径保护和请求大小限制。测试还覆盖pending状态、20/80文件计数、完整文件但显式pending仍锁定、缺失练习、无效时长及无数据库写入的两条练习预览。隔离临时目录中的非音频marker文件仅测试存在规则，不产生可播放音频或研究评分。浏览器视觉与完整80段音频播放另行使用真实材料验收。

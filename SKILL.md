---
name: podcast-to-wechat
description: 「粽子AI世界」公众号内容全流程。从 YouTube 播客视频做选题、抓逐字稿、编译成全文实录体对谈稿、去 AI 味机检，再排版成公众号可直接粘贴的 HTML、出插画与贴图封面和金句卡、写口播稿与视频切片，最后推进公众号草稿箱；并支持存量批量重做与每 2 小时无人值守跑批。当用户说「做一期内容」「跑一轮产线」「选题 / 抓字幕 / 出封面 / 排版 / 推草稿」「重做存量」时使用。
---

# 粽子AI世界 · 公众号内容产线

一条「选题 → 成稿 → 出图 → 排版 → 切片 → 推草稿」的流水线。文字、图片、排版、推送、调度都在本 skill 里。

| | |
| --- | --- |
| 产线根目录（数据 + 凭证 + SOP） | `D:\项目\AI内容生产` |
| 每期产出目录 | `D:\项目\AI内容生产\公众号产出\<slug>\` |
| 人读规范一页版 | `D:\项目\AI内容生产\粽子AI世界-内容生产SOP.md` |
| 流程细节 | `references/pipeline.md` |
| 反 AI 腔规则 | `references/anti-ai-rules.md` |
| 人味化写法 | `references/humanize-guide.md` |
| 品牌声纹 | `assets/voice-dna.md` |
| 插画提示词模板 | `assets/social-art-prompt.md` |
| 排版模板 | `templates/podcast-interview/template.json` |

品牌色：纸面 `#F5F1E9`、朱红橙 `#E8552D`、炭黑 `#2B2B2B`。

## 九环节

| # | 环节 | 动作 | 产出 / 门槛 |
| --- | --- | --- | --- |
| 0 | 选题 | `search_videos.mjs` 搜最近 7 天 AI 赚钱 / 产品 / 创业 / 投资 / 认知 / 营销方向访谈播客，排序筛 1 篇 | `video_id` + 选题理由；能取到完整逐字稿；20–90 分钟；英文一手优先 |
| 0.5 | 去重 | 读 `已发布-视频清单.json` 排除做过的 `video_id` | 无新片只写日志、跳过 |
| ① | 抓字幕 | `fetch_transcript.mjs` 取完整逐字稿 + 视频元信息 | `full-transcript-<lang>.txt` + `video-meta.json` |
| ② | 写文章 | 全文实录体：叙事钩子 →「主要观点」≤5 条 → 分节编译 → 结尾判断 | `文章-<slug>.md` |
| ②.5 | 去 AI 味 + 终检 | 按 `anti-ai-rules.md` 改写，跑 `check_ai_flavor.mjs` | FAIL = 0 才进排版 |
| ③ | 排版 | `render_article.mjs`，模板 `podcast-interview` | `文章-<slug>.html`，0 图 0 外链无 H1 |
| ④ | 标题 / 摘要 | `深度｜对话{机构/人物}：{观点}？`，≥3 候选 | 标题 ≤64（推送 ≤32），摘要 ≤120 |
| ⑤ | 出图 | `generate_art.mjs` 出插画 + `make_social_cover.mjs` 叠字 | 横版 2048×1152、贴图 3x4、贴图 1x1、金句卡 1080×1350 |
| ⑥ | 口播稿 | 钩子 15–30s → 2–4 个观点带例子 → 收尾 | `口播稿-<slug>.md`，800–1000 字 |
| ⑦ | 切片 | 3–5 个高亮观点，9:16 竖版 30–60s | `切片-<n>-<slug>.md` |
| ⑧ | 推草稿箱 | `push_to_wechat_draft.mjs`，先 `--check` / `--dry-run` | 只进草稿箱，不群发 |

## 脚本

全部在 `scripts\`，用全路径调用，例如 `node C:\Users\Administrator\.codex\skills\podcast-to-wechat\scripts\xxx.mjs`。

| 脚本 | 环节 | 说明 |
| --- | --- | --- |
| `search_videos.mjs` | 0 | 支持逗号分隔多查询词；自动去重、补精确时长与发布日期、按窗口筛，输出「可做 / 跳过 + 原因」 |
| `fetch_transcript.mjs` | ① | TikHub 一次同步调用取全文；落盘逐字稿与 `video-meta.json`（来源四项从这里抄） |
| `check_ai_flavor.mjs` | ②.5 | 破折号 / 碎片回合 / 正文图 / 文末编译说明 / 来源四项 / 字数 ≥逐字稿 1/3 / AI 腔词表；退出码非 0 即 FAIL |
| `render_article.mjs` | ③ | Markdown → 内联样式 HTML；丢弃 H1、剥离外链、丢弃正文图、小节自动编号、说话人标签、来源块 |
| `generate_art.mjs` | ⑤ | 调 AI98 出竖版与方版插画，内置模型降级链（`gpt-image-2` → `2.5-sunburst` → `2.5-flare`）；`CRITICAL FACE REQUIREMENT` 内嵌，不允许手搓绕开 |
| `make_social_cover.mjs` | ⑤ | 横版 / 贴图 3x4 / 贴图 1x1 / 金句卡，HTML + Chrome 无头截图，中文由 HTML 渲染 |
| `check_art_faces.py` | ⑤ | 人脸纯黑 / 空白废图机检；退出码非 0 即有废图 |
| `push_to_wechat_draft.mjs` | ⑧ | 上传封面 + `draft/add`；`--check` / `--dry-run` / `--list`；推送前拦四条硬门槛 |

### 常用命令

```bash
# 选题
node scripts\search_videos.mjs --query "AI startup founder interview,20VC interview" --limit 12 --enrich 8 --max-age-days 14

# 抓稿
node scripts\fetch_transcript.mjs --video <video_id 或 URL> --out-dir <期目录>

# 机检（硬门槛）
node scripts\check_ai_flavor.mjs --md <文章.md> --transcript <逐字稿.txt> --json <report.json>

# 排版
node scripts\render_article.mjs --in <文章.md> --out <文章.html> --template podcast-interview

# 出图
node scripts\generate_art.mjs --name <slug> --out-dir <期目录> --subject "…" [--motif "…"]
node scripts\make_social_cover.mjs --name <slug> --title "第一行|第二行**高亮**" --kicker "对话 XX" --stat "39 亿|融资额" --quote "金句" --art <插画.png> --out-dir <期目录> --sizes h,3x4,1x1,quote
python scripts\check_art_faces.py <期目录>

# 推草稿
node scripts\push_to_wechat_draft.mjs --check
node scripts\push_to_wechat_draft.mjs --html <文章.html> --title "…" --digest "…" --cover <横版封面.png> [--dry-run]
```

## 排版契约（Markdown 约定）

`render_article.mjs` 认这些写法：

| 写法 | 渲染成 |
| --- | --- |
| `# 标题` | 丢弃（规范要求正文无 H1） |
| 文末的 `> 编译说明` 引用块 | 文末编译说明卡片（写在开头也会被移到文末） |
| `## 来源` + 下面 4 条列表 | 文末「来源信息」块 |
| `## 小节标题`（可自带 `01 ` 前缀） | 带编号的小节标题；`主要观点` 这类汇总小节不编号 |
| 行首 `**主持人**：内容` / `**嘉宾**：内容` | 浅橘底橙字说话人标签 + 段落 |
| 行内 `**词**` | 朱红橙加粗 |
| `[文字](链接)` | 只保留文字（正文禁外链） |
| `![图](路径)` | 丢弃（正文禁图），并在报告里计数 |

## 推送前四条硬门槛

1. `check_ai_flavor.mjs` FAIL = 0
2. 正文 md 图片数 0 且 html `img` 数 0
3. 文末编译说明 + 来源四项齐全（来源信息与说明都放文末，正文内不出现）
4. `check_art_faces.py` 0 废图

外加一条：字数 ≮ 逐字稿承载量的 1/3（防退化成摘要，`--transcript` 校验）。

推送本身还有一层校验：标题 ≤32 字、摘要 ≤120 字、HTML 无 `img`、无外链、无 H1；封面必须横版。只推标题 / 摘要 / 正文 HTML / 横版封面；口播稿、切片、逐字稿、贴图封面都不推。

## 出图铁律

- 插画必须带人物五官，提示词带 `CRITICAL FACE REQUIREMENT`
- **插画重出必须重合成贴图**（旧产线漏过这步，空白脸贴图发出去过）
- 3x4 配竖版插画，1x1 配方版插画，不允许裁竖版当方版用
- 中文字一律 HTML + Chrome 渲染，不交给生图模型
- 贴图封面不进公众号草稿箱

## 凭证

脚本自己读，顺序是 `D:\内容生产\.env` → `D:\项目\AI内容生产\.env`（后者优先），也认环境变量：

| 变量 | 用途 |
| --- | --- |
| `TIKHUB_API_KEY` / `TIKHUB_BASE_URL` | 选题搜索与抓字幕 |
| `AI98_生图_API_Key`（或 `AI98_API_KEY`）/ `AI98_BaseUrl` | 出插画 |
| `WECHAT_APPID` / `WECHAT_SECRET`（或 `WECHAT_APPSECRET`）/ `WECHAT_AUTHOR` | 推草稿箱 |

微信公众号后台要把本机出口 IP 加进「设置与开发 → 基本配置 → IP 白名单」，否则取 token 直接失败（`40164`）。

## 编排（自动跑批）

| 脚本 | 作用 |
| --- | --- |
| `scripts\run-automation.ps1` | 完整一轮：`runner.lock` 单实例 → `codex exec` 跑创作半程 → 调 `publish-episode.ps1` |
| `scripts\publish-episode.ps1` | 确定性半程：机检 → 排版 → 生图 → 封面 → 人脸机检 → 推草稿 → 回写清单 |
| `scripts\run-rebuild.ps1` | 按 `重做清单.json` 批量重做存量 |

给 `codex exec` 的指令提示词在 `assets\prompts\`：`run-one-episode.md`（生产一期）、`rebuild-one-episode.md`（重做一期）。

```powershell
# 自动选题跑一轮
powershell -File scripts\run-automation.ps1

# 指定视频跑一轮（跳过选题搜索）
powershell -File scripts\run-automation.ps1 -Video "https://www.youtube.com/watch?v=xxxx"

# 只跑确定性半程（已有 run-meta.json 时）
powershell -File scripts\publish-episode.ps1 -Slug <slug> [-SkipPush]
```

两个约定：

- `-Root` 默认 `D:\项目\AI内容生产`（数据与凭证所在），可用参数覆盖；`-SkillsRoot` 默认按脚本自身位置反推，不用手填。
- `D:\项目\AI内容生产\公众号产出\` 下留着同名薄转发脚本（几行，转调本 skill 的实现）。计划任务 `ZongziWechatContent` 指向那个稳定入口，所以升级 skill 不需要改任务。

计划任务 `ZongziWechatContent`：每 2 小时触发一次，单轮上限 150 分钟，只进草稿箱不群发。停用：`Disable-ScheduledTask -TaskName ZongziWechatContent`。

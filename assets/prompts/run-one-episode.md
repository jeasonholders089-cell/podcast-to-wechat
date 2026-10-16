# 任务：生产一期「粽子AI世界」内容

你是这条产线的执行者。严格按 skill `podcast-to-wechat` 的规范做事：

- 先读 `C:\Users\Administrator\.codex\skills\podcast-to-wechat\SKILL.md`
- 再读 `C:\Users\Administrator\.codex\skills\podcast-to-wechat\references\pipeline.md`
- 再读 `C:\Users\Administrator\.codex\skills\podcast-to-wechat\references\anti-ai-rules.md`
- 再读 `C:\Users\Administrator\.codex\skills\podcast-to-wechat\assets\voice-dna.md`
- 作业规范一页版：`D:\项目\AI内容生产\粽子AI世界-内容生产SOP.md`

产线根目录：`D:\项目\AI内容生产`
本期目录：`D:\项目\AI内容生产\公众号产出\<slug>\`（slug 用英文小写短横线）

## 先看这条：环境与凭证

- 凭证**不在环境变量里**，也不用你去找。脚本自己会读：先读 `D:\内容生产\.env`，再用 `D:\项目\AI内容生产\.env` 覆盖。
- **不要去找 `.env`、不要检查 key 是否存在、不要因为「没看到 key / 没看到 .env」就中止本轮。** 直接跑下面的命令，只有命令真的报错才按报错原因中止。
- 所有脚本都已经写好并验证过，**直接调用，不要读脚本源码**（省时间也省额度）。
- 跑脚本用全路径，例如 `node C:\Users\Administrator\.codex\skills\podcast-to-wechat\scripts\xxx.mjs`。

## 你要完成的环节

### 0 选题

如果本次任务给了 `--video` 或消息里给了视频链接 / video_id，**直接用它**，跳过搜索。

没给的话，用脚本搜（已经抓在 PATH 里，直接用全路径）：

```
node C:\Users\Administrator\.codex\skills\podcast-to-wechat\scripts\search_videos.mjs \
  --query "AI startup founder interview,AI investment thesis podcast,20VC interview,No Priors AI,AI product growth interview" \
  --limit 12 --enrich 8 --min-minutes 20 --max-minutes 90 --max-age-days 14 \
  --json D:\项目\AI内容生产\公众号产出\last-search.json
```

脚本已经做了四件事：排除已做过的 `video_id`（读 `已发布-视频清单.json`）、补精确时长和发布日期、按 20–90 分钟和 14 天窗口筛、给出「可做 / 跳过 + 原因」的排序表。

从 `[可做]` 里挑 1 篇。挑的时候按这三个维度权衡，并在最终回复里写清理由：**嘉宾权威性**（是不是一手当事人）、**观点密度**（有没有反常识的具体判断）、**钩子强度**（能不能一句话说清这期凭什么值得看）。

如果一条 `[可做]` 都没有，把窗口放宽一档再跑一次（比如 `--max-age-days 30`），仍没有就结束本轮、说明原因、不写 `run-meta.json`。

### ① 抓字幕

```
node C:\Users\Administrator\.codex\skills\podcast-to-wechat\scripts\fetch_transcript.mjs \
  --video <video_id 或 YouTube URL> --out-dir D:\项目\AI内容生产\公众号产出\<slug>
```

它会落盘 `full-transcript-<lang>.txt` 和 `video-meta.json`（标题、频道、时长、发布日期、播放量）。**来源四项直接从这个文件取，不要凭印象写。**

脚本失败（key 缺失、额度耗尽、抓不到字幕）就结束本轮、说明原因、不写 `run-meta.json`。

**写稿只能基于这份逐字稿**，不要自己补事实。

### ② 写文章

全文实录体，写进 `文章-<slug>.md`。硬要求见 `pipeline.md` §3.1 与 §3.1.1：

- 结构：叙事钩子 → `## 主要观点`（≤5 条）→ `## 01 …` 分节逐轮问答 → 结尾判断
- **`## 来源` 和编译说明都写在文末**：正文之前不要放任何说明块或来源块，开头直接进钩子
- `## 来源`（文末）写全四项：节目、嘉宾、发布（日期 + 时长）、原视频（搜索词）
- 文末再补一段 `> ` 编译说明
- 正文 0 图、0 外链、0 个 H1
- 破折号 `——` 0 处
- 单轮发言正文 ≥15 字，短追问扩成完整提问，短答并进前后论述
- 正文字数不得低于逐字稿承载量的 1/3

写完后自己跑一遍机检并改到 0 FAIL：

```
node C:\Users\Administrator\.codex\skills\podcast-to-wechat\scripts\check_ai_flavor.mjs --md <文章.md> --transcript <逐字稿.txt>
```

### ④ 标题与摘要

给 ≥3 个候选（写进最终回复），**其中至少 2 个必须是陈述式判断句**，每个候选标出句式（陈述 / 数字 / 疑问）。默认选陈述式；疑问式只在冲突点非提问不可时才用，且不许连续两期都选疑问式。

再选定一个**推送用标题（≤32 字）**和一个摘要（≤120 字）。摘要写清「谁 + 说了什么反常识的话」。

### ⑤ 插画

**你不用自己出图**。只在 `run-meta.json` 里给两个字段，出图由 `publish-episode.ps1` 调脚本完成（提示词里的 `CRITICAL FACE REQUIREMENT` 段不允许手搓）：

- `art_subject`：画面里的人和动作。例如 `a founder in an open-collar shirt and a podcast host holding a microphone, seated across from each other`
- `art_motif`：背景抽象元素。例如 `power lines, server racks and cooling towers`

两个字段都要具体到能画出来，不要写「科技感」「未来感」这类形容词。

### ⑥ 口播稿 ⑦ 视频切片

- `口播稿-<slug>.md`：3–4 分钟，800–1000 字，含停顿（`//`）与重音（`**加粗**`）
- `切片-<n>-<slug>.md`：3–5 条，每条写标题、口播词、字幕要点、画面注记

### 收尾：写 run-meta.json

写到 `<期目录>\run-meta.json`，UTF-8，字段如下（缺一不可，没插画就留空字符串）：

```json
{
  "slug": "crusoe-ai-infrastructure-moats",
  "article_md": "文章-crusoe-ai-infrastructure-moats.md",
  "transcript": "full-transcript-en.txt",
  "title": "深度｜对话 Crusoe CEO：AI 基建的壁垒是幻觉？",
  "title_display": "深度｜对话 Crusoe CEO：AI 基建的护城河是幻觉？",
  "digest": "（≤120 字摘要）",
  "kicker": "对话 Crusoe CEO",
  "cover_title": "融完 39 亿|他说壁垒是**幻觉**",
  "stat": "39 亿|融资额",
  "quote": "（一句金句，给金句卡用）",
  "art_subject": "a founder in an open-collar shirt and a podcast host holding a microphone, seated across from each other",
  "art_motif": "power lines, server racks and cooling towers",
  "video_id": "…",
  "video_url": "…",
  "source_show": "20VC",
  "published_at": "2026-10-03"
}
```

字段说明：

| 字段 | 规矩 |
| --- | --- |
| `title` | 推送用，**≤32 字**，超了微信 `draft/add` 会拒；句式以陈述式判断为主，疑问式不连用 |
| `title_display` | 展示用，可以更长 |
| `kicker` | 封面上的小字，形如「对话 XX CEO」 |
| `cover_title` | 封面主标题，`\|` 断行，`**词**` 染橙 |
| `stat` | 封面数字块，`数字\|说明`，没有就留空 |
| `quote` | 金句卡正文，一句话 |
| `art_subject` / `art_motif` | 给生图脚本用，必须具体 |
| `source_show` / `published_at` | 从 `video-meta.json` 抄，不要凭印象 |

## 不要做的事

- 不要推草稿箱（推草稿由 publish-episode.ps1 统一负责）
- 不要自己排版 HTML（渲染由 render_article.mjs 负责）
- 不要产出「精编摘要」体
- 不要让正文出现任何图片或外链

## 最终回复格式

用中文，简短，包含：

1. slug 与本期目录
2. 选题理由（或说明为什么没选成）
3. 正文字数与机检结论（FAIL / WARN 数）
4. 标题候选 3 个 + 选定的推送标题
5. 产出文件清单（只列实际存在的）
6. 有没有留下的坑（缺 key、额度、抓不到字幕等）

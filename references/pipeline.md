# pipeline.md · 细节规范

## §1 选题

- 时间窗：最近 7 天
- 方向：AI 赚钱 / AI 产品 / AI 创业 / AI 投资 / 认知 / 营销
- 形态：访谈类播客视频，20–90 分钟，英文一手优先
- 排序维度：热度、嘉宾权威性、观点密度、可提取性
- 硬条件：必须能取到**完整逐字稿**；只能拿到摘要片段的直接放弃
- 输出：`video_id` + 3 条选题理由（为什么值得做、差异化在哪、钩子是什么）

## §2 去重与持久化

- 读 `公众号产出\已发布-视频清单.json`，`items[].video_id` 命中就换一篇
- 无新片：只往 `automation-run.log` 写一行 `no-new-video`，本轮结束
- 成功后回写 JSON（UTF-8、不转义中文），字段：

```json
{
  "video_id": "…",
  "slug": "…",
  "title": "…",
  "source": "节目名",
  "published_at": "2026-09-28",
  "done_at": "2026-10-10T08:32:00+08:00",
  "draft_media_id": "…"
}
```

## §3 抓字幕

```bash
node scripts/fetch_transcript.mjs --video <video_id 或 URL> --out-dir <期目录>
```

- 走 TikHub（`TIKHUB_BASE_URL` + `TIKHUB_API_KEY`），一次调用同步返回全文
- 落盘 `full-transcript-<lang>.txt` 和 `video-meta.json`
- 来源四项（节目、嘉宾、发布、原视频）一律从 `video-meta.json` 抄，不要凭印象
- 抓不到就结束本轮，不拿半截稿写文章

## §3.1 写文章

体例：全文实录体对谈稿。

骨架：

1. 叙事钩子（1–2 段，从原片最有张力的一个事实/一句话切入）
2. `## 主要观点`（≤5 条，每条一句话）
3. 正文分节（`## 01 标题` …，逐轮问答）
4. 结尾判断（1–2 段，写清这期最值得记住的是什么）

### §3.1.1 回合整理（硬要求）

反面例子（原文里真实出现过，不许出现在成稿里）：

```
**主持人**：不。
**嘉宾**：说吧。
**主持人**：好。
```

要求：

- 主持人的短追问要扩成完整提问
- 嘉宾的短答要并进前后论述
- 同一话题的连续短问答可以合并成一次完整问答
- 允许：补主语和连接词、顺成书面语、合并回合、删语气词
- **不允许：新增嘉宾没说过的观点和数据**
- 单轮发言正文 < 15 字，机检直接 FAIL

篇幅红线：正文有效字数不得低于逐字稿承载量的 1/3。低于就是写成摘要了。

## §3.2 去 AI 味 + 终检

先按 `anti-ai-rules.md` 改写，再跑：

```bash
node scripts/check_ai_flavor.mjs --md <文章.md> --transcript <逐字稿.txt>
```

FAIL 必须回改，直到 0 FAIL。WARN 可保留但要逐条判断。

## §4 排版

```bash
node <skill>\scripts\render_article.mjs \
  --in <文章.md> --out <文章.html> --template podcast-interview
```

渲染后检查 report：`html_img_tags = 0`、`html_external_links = 0`、`html_h1_tags = 0`。

## §5 标题与摘要

- 形态：`深度｜对话{机构或人物}：{一个观点式提问}？`
- 给 ≥3 个候选，标注各自的钩子和风险
- 展示用 ≤64 字；推送用 ≤32 字（超出用 `--title` 传短标题）
- 摘要 ≤120 字，写清「谁 + 说了什么反常识的话」

## §6 封面与配图

### §6.1 插画

出图由脚本做，agent 只提供两个字段（写在 `run-meta.json`）：

- `art_subject`：画面里的人和动作
- `art_motif`：背景抽象元素

```bash
node scripts/generate_art.mjs --name <slug> --out-dir <期目录> --subject "…" [--motif "…"]
```

提示词模板见 `assets/social-art-prompt.md`，`CRITICAL FACE REQUIREMENT` 段内嵌在脚本里，不允许手搓绕开。

- 竖版：3x4 用
- 方版：1x1 用，**单独出，不许裁竖版**
- 可用模型（降级链顺序）：`gpt-image-2` → `gpt-image-2.5-sunburst` → `gpt-image-2.5-flare`；`gpt-image-2.5` 实测 503，不要用

### §6.2 叠字出图

```bash
node scripts/make_social_cover.mjs --name <slug> \
  --title "第一行|第二行**高亮**" --kicker "对话 XX" \
  --stat "39 亿|融资额" --quote "金句" --art <插画.png> \
  --out-dir <期目录> --sizes 3x4,1x1,quote
```

标题里 `|` 断行、`**词**` 染橙。不给 `--art` 自动退回纯文字版。

### §6.3 出图后必做

1. `python scripts/check_art_faces.py <期目录>` —— 0 废图
2. 插画若重出，**必须重跑 §6.2 重合成两张贴图**
3. 贴图封面不进草稿箱

## §7 口播稿

- 3–4 分钟，800–1000 字
- 结构：钩子 15–30 秒 → 2–4 个观点、每个带一个例子 → 收尾一句话
- 标注停顿（`//`）和重音（`**加粗**`）

## §8 视频切片

- 3–5 条，9:16 竖版，30–60 秒
- 每条写：标题、口播词、字幕要点、画面注记
- 成片交给剪映 / Descript，本环节只出文案

## §9 推草稿箱

```bash
node <skill>\scripts\push_to_wechat_draft.mjs --check
node ... --html <文章.html> --title "…" --digest "…" --cover <横版封面.png> --dry-run
node ... --html <文章.html> --title "…" --digest "…" --cover <横版封面.png>
```

只推：标题、摘要、正文 HTML、横版封面。
不推：口播稿、切片、逐字稿、贴图封面。

## §10 每期目录

见 `SKILL.md` 的九环节表与本文各节的产物名。目录命名用英文小写短横线 slug。

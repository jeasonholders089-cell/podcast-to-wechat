# 任务：按新标准重做一期存量内容

重做对象：`{{SLUG}}`
旧稿路径：`{{OLD_ARTICLE}}`
逐字稿路径：`{{TRANSCRIPT}}`
本期目录：`D:\项目\AI内容生产\公众号产出\{{SLUG}}\`

先读规范：

- `C:\Users\Administrator\.codex\skills\podcast-to-wechat\SKILL.md`
- `C:\Users\Administrator\.codex\skills\podcast-to-wechat\references\pipeline.md`
- `C:\Users\Administrator\.codex\skills\podcast-to-wechat\references\anti-ai-rules.md`

## 要做的事

1. 读逐字稿全文，读旧稿看原来漏了什么
2. 按**全文实录体**重写：每个话题、每一轮问答都进文；主持人短追问扩成完整提问，嘉宾短答并进前后论述
3. 允许补主语和连接词、顺成书面语、合并回合、删语气词；**不允许新增嘉宾没说过的观点和数据**
4. **`## 来源` 与编译说明都放文末**：文末补 `## 来源` 四项（节目、嘉宾、发布+时长、原视频搜索词），下面再补一段 `> ` 编译说明；正文之前不要出现说明块或来源块
5. 正文 0 图、0 外链、0 个 H1、`——` 0 处、单轮发言 ≥15 字、字数 ≥逐字稿的 1/3
6. 写进 `文章-{{SLUG}}.md`（覆盖旧稿前先把旧稿备份成 `文章-{{SLUG}}.旧稿.md`）
7. 跑机检改到 0 FAIL：

```
node C:\Users\Administrator\.codex\skills\podcast-to-wechat\scripts\check_ai_flavor.mjs --md <文章.md> --transcript <逐字稿.txt>
```

8. 更新 `run-meta.json`（字段同 `prompts\run-one-episode.md`；`quote` / `cover_title` / `stat` 可以沿用旧稿里的信息重新提炼）

## 不要做的事

- 不要推草稿箱（由 publish-episode.ps1 负责）
- 不要排版 HTML
- 不要为了凑字数注水，也不要为了压缩删掉问答

## 最终回复格式

中文，简短：改了哪几处结构性问题（碎片回合 / 字数 / 来源四项）、重写后字数、机检结论、文件清单。

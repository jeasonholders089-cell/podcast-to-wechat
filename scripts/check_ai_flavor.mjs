#!/usr/bin/env node
// 去 AI 味 + 结构终检（环节 ②.5 的硬门槛）
// 用法：node check_ai_flavor.mjs --md <文章.md> [--transcript <逐字稿.txt>] [--json <report.json>]
// 退出码：0 = PASS，1 = FAIL

import { readFileSync, existsSync, writeFileSync } from "node:fs";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a.startsWith("--")) out[a.slice(2)] = argv[++i];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.md) {
console.log("用法: node check_ai_flavor.mjs --md <文章.md> [--transcript <逐字稿.txt>] [--json <report.json>] [--min-turn 15]");
  process.exit(args.help ? 0 : 2);
}
if (!existsSync(args.md)) {
  console.error(`找不到文件: ${args.md}`);
  process.exit(2);
}

const raw = readFileSync(args.md, "utf8").replace(/\r\n/g, "\n");
const lines = raw.split("\n");

const FAIL = [];
const WARN = [];
const INFO = {};

// ---- 1. 破折号必须 0 处 ----
const dashes = [];
lines.forEach((l, i) => {
  const n = (l.match(/——/g) || []).length;
  if (n) dashes.push({ line: i + 1, text: l.trim().slice(0, 60) });
});
INFO.dashes = dashes.length;
if (dashes.length) FAIL.push({ rule: "破折号", detail: `出现 ${dashes.length} 处「——」`, items: dashes.slice(0, 10) });

// ---- 2. 对谈碎片回合：单轮发言正文 < 15 字 ----
const MIN_TURN = Number(args["min-turn"]) > 0 ? Number(args["min-turn"]) : 15;
const fragments = [];
lines.forEach((l, i) => {
  const m = l.trim().match(/^\*\*([^*]{1,10})\*\*[：:]\s*(.+)$/);
  if (!m) return;
  const said = m[2].trim();
  if (said.length < MIN_TURN) fragments.push({ line: i + 1, who: m[1], chars: said.length, text: said.slice(0, 60) });
});
INFO.fragment_turns = fragments.length;
if (fragments.length) {
  FAIL.push({
    rule: "对谈碎片回合",
    detail: `${fragments.length} 处单轮发言少于 ${MIN_TURN} 字，必须合并进前后论述或扩成完整问答`,
    items: fragments.slice(0, 20),
  });
}

// ---- 3. 正文图片必须 0 张 ----
const imgs = [];
lines.forEach((l, i) => {
  if (/!\[[^\]]*\]\([^)]*\)/.test(l)) imgs.push({ line: i + 1, text: l.trim().slice(0, 60) });
});
INFO.body_images = imgs.length;
if (imgs.length) FAIL.push({ rule: "正文配图", detail: `${imgs.length} 张图片，规范要求正文 0 图`, items: imgs.slice(0, 10) });

// ---- 4. 编译说明（应在文末）----
const noteIndexes = lines.map((l, i) => (/^>\s*\S/.test(l.trim()) ? i : -1)).filter((i) => i >= 0);
// 正文起点：第一个「非来源」小节
const bodyStart = lines.findIndex((l) => /^##\s+/.test(l.trim()) && !/^##\s*来源/.test(l.trim()));
const noteStart = noteIndexes[0];
const hasNote = noteIndexes.length > 0;
const noteBeforeBody = hasNote && bodyStart >= 0 && noteStart < bodyStart;
const sourceLineIndex = lines.findIndex((l) => /^##\s*来源/.test(l.trim()));
const sourceBeforeBody = sourceLineIndex >= 0 && bodyStart >= 0 && sourceLineIndex < bodyStart;
INFO.notes = noteIndexes.length;
INFO.note_at_tail = hasNote && !noteBeforeBody;
if (!hasNote) FAIL.push({ rule: "编译说明", detail: "缺少编译说明引用块（以 `> ` 开头，写在文末）" });
if (noteBeforeBody || sourceBeforeBody) {
  WARN.push({
    rule: "文末归属",
    detail: "来源信息 / 编译说明出现在正文之前；排版时会自动移到文末，但建议直接写在文末",
  });
}
if (noteIndexes.length > 1) {
  WARN.push({ rule: "编译说明", detail: `有 ${noteIndexes.length} 段编译说明，建议只保留文末一段` });
}

// ---- 5. 来源四项 ----
const sourceMatch = raw.match(/##\s*来源[\s\S]*?(?=\n##\s|\s*$)/);
const sourceText = sourceMatch ? sourceMatch[0] : "";
const needSource = ["节目", "嘉宾", "发布", "原视频"];
const missingSource = sourceText ? needSource.filter((k) => !sourceText.includes(k)) : needSource;
INFO.source_found = !!sourceText;
if (!sourceText || missingSource.length) {
  FAIL.push({
    rule: "来源四项",
    detail: sourceText ? `来源块缺少：${missingSource.join("、")}` : "找不到「## 来源」小节",
  });
}

// ---- 6. 字数 ≮ 逐字稿承载量的 1/3 ----
if (args.transcript && existsSync(args.transcript)) {
  const t = readFileSync(args.transcript, "utf8");
  const transcriptChars = t.replace(/\s+/g, "").length;
  const bodyOnly = raw
    .replace(/^#.*$/gm, "")
    .replace(/^>.*$/gm, "")
    .replace(/##\s*来源[\s\S]*?(?=\n##\s|\s*$)/, "");
  const bodyChars = bodyOnly.replace(/\s+/g, "").length;
  const ratio = transcriptChars > 0 ? bodyChars / transcriptChars : 1;
  INFO.transcript_chars = transcriptChars;
  INFO.body_chars = bodyChars;
  INFO.ratio = Number(ratio.toFixed(3));
  if (ratio < 1 / 3) {
    FAIL.push({
      rule: "全文实录",
      detail: `正文 ${bodyChars} 字 / 逐字稿 ${transcriptChars} 字 = ${(ratio * 100).toFixed(1)}%，低于 1/3，属于写成摘要`,
    });
  }
} else {
  WARN.push({ rule: "全文实录", detail: "未提供 --transcript，跳过字数比例校验" });
}

// ---- 7. AI 腔词表 ----
const BANNED = [
  ["综上所述", "总结套话"],
  ["总而言之", "总结套话"],
  ["不难看出", "总结套话"],
  ["由此可见", "总结套话"],
  ["值得注意的是", "套话"],
  ["众所周知", "套话"],
  ["在当今", "套话"],
  ["赋能", "黑话"],
  ["抓手", "黑话"],
  ["闭环", "黑话"],
  ["颗粒度", "黑话"],
  ["底层逻辑", "黑话"],
  ["生态位", "黑话"],
  ["不仅是", "假升华"],
  ["值得我们深思", "假升华"],
  ["引人深思", "假升华"],
  ["某种程度上", "空转副词"],
  ["一定程度上", "空转副词"],
  ["极大地", "空转副词"],
  ["深刻地", "空转副词"],
];
const bannedHits = [];
for (const line of lines) {
  for (const [word, kind] of BANNED) {
    if (line.includes(word)) bannedHits.push({ word, kind, text: line.trim().slice(0, 60) });
  }
}
INFO.banned_hits = bannedHits.length;
if (bannedHits.length) {
  WARN.push({ rule: "AI 腔词表", detail: `${bannedHits.length} 处命中，建议改写`, items: bannedHits.slice(0, 20) });
}

const report = {
  file: args.md,
  result: FAIL.length ? "FAIL" : "PASS",
  fail_count: FAIL.length,
  warn_count: WARN.length,
  info: INFO,
  fail: FAIL,
  warn: WARN,
};

if (args.json) writeFileSync(args.json, JSON.stringify(report, null, 2), "utf8");

console.log(`\n${report.result}  ${FAIL.length} FAIL / ${WARN.length} WARN  —— ${args.md}`);
console.log(
  `破折号 ${INFO.dashes} · 碎片回合 ${INFO.fragment_turns} · 正文图 ${INFO.body_images} · 编译说明 ${INFO.notes} 段（${INFO.note_at_tail ? "文末" : "在开头"}） · 来源块 ${INFO.source_found ? "有" : "无"}${INFO.ratio !== undefined ? ` · 字数比 ${(INFO.ratio * 100).toFixed(1)}%` : ""}`,
);
for (const f of FAIL) {
  console.log(`\n✗ [${f.rule}] ${f.detail}`);
  for (const it of f.items ?? []) console.log(`    L${it.line} ${it.who ? it.who + "：" : ""}${it.text ?? ""}`);
}
for (const w of WARN) {
  console.log(`\n! [${w.rule}] ${w.detail}`);
  for (const it of w.items ?? []) console.log(`    ${it.word ? it.word + "（" + it.kind + "）：" : ""}${it.text ?? ""}`);
}

process.exit(FAIL.length ? 1 : 0);

#!/usr/bin/env node
// 平台规则机检（环节 ②.6 的硬门槛 / 推送前的最后一道闸）
//
// 用法：
//   node check_platform_rules.mjs --md <文章.md> [--title "…"] [--digest "…"] [--json <report.json>]
//   node check_platform_rules.mjs --html <文章.html> [--title "…"] [--digest "…"]
//   node check_platform_rules.mjs --html <贴图正文.txt|html> --kind newspic --title "…"
//
// 不给 --title / --digest 时，会自动从同目录 run-meta.json 找。
// 退出码：0 = PASS（WARN 可以带），1 = FAIL，2 = 用法或文件错误。
//
// 规则说明见 references/platform-rules.md。推送脚本 push_to_wechat_draft.mjs 用的是同一套 lib，
// 这里只是给创作阶段的自检入口，不要在两边分别维护规则表。

import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { inspect, format } from "./lib/platform-rules.mjs";

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
if (args.help || (!args.md && !args.html)) {
  console.log(
    [
      "用法:",
      "  node check_platform_rules.mjs --md <文章.md>   [--title ...] [--digest ...] [--json <report.json>]",
      "  node check_platform_rules.mjs --html <文章.html> [--title ...] [--digest ...]",
      "  node check_platform_rules.mjs --html <贴图正文> --kind newspic --title ...",
    ].join("\n")
  );
  process.exit(args.help ? 0 : 2);
}

const file = resolve(args.md ?? args.html);
if (!existsSync(file)) {
  console.error(`找不到文件: ${file}`);
  process.exit(2);
}

const content = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
const kind = args.kind === "newspic" ? "newspic" : "article";

// 没显式传标题/摘要就读同目录 run-meta.json，避免每期手抄一遍
let title = args.title ?? "";
let digest = args.digest ?? "";
const metaPath = join(dirname(file), "run-meta.json");
if ((!title || !digest) && existsSync(metaPath)) {
  try {
    const meta = JSON.parse(readFileSync(metaPath, "utf8"));
    if (!title) title = kind === "newspic" ? meta.note_title || meta.title || "" : meta.title || "";
    if (!digest) digest = meta.digest || "";
  } catch {
    /* run-meta.json 坏了不该让机检崩，后面按缺字段处理 */
  }
}

const result = inspect({ title, digest, contentHtml: content, kind });

const head = [
  `kind   ${kind}`,
  `file   ${file}`,
  `title  ${title || "(空)"}  ${[...(title ?? "")].length} 字`,
  kind === "article" ? `digest ${[...(digest ?? "")].length} 字` : "",
  `FAIL   ${result.fail.length}`,
  `WARN   ${result.warn.length}`,
]
  .filter(Boolean)
  .join("\n");

const body = format(result);
console.log(head);
if (body) console.log("\n" + body);

if (args.json) {
  writeFileSync(
    resolve(args.json),
    JSON.stringify({ ok: result.fail.length === 0, kind, title, digest, ...result }, null, 2),
    "utf8"
  );
}

process.exit(result.fail.length === 0 ? 0 : 1);

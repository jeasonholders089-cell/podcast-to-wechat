#!/usr/bin/env node
// 把公众号里已发布的成品同步成仓库示例：每篇一个目录，含「文章.html + 封面.jpg」。
//
// 数据来源：微信公众号「草稿箱」接口（cgi-bin/draft/batchget，no_content=0）。
// 已发布文章会留在草稿箱里，所以这里拿到的就是发布时的排好版成品（内联样式 HTML）与封面。
//
// 用法：
//   node tools/sync-published-examples.mjs [--env-file <path>] [--out examples/published]
//        [--limit 50] [--min-html 2000] [--dry-run]

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const ENV_FILES = ["D:/内容生产/.env", "D:/项目/AI内容生产/.env"];
const API = "https://api.weixin.qq.com";

function parseArgs(argv) {
  const out = { out: "examples/published", limit: 50, "min-html": 2000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--dry-run") out["dry-run"] = true;
    else if (a.startsWith("--")) out[a.slice(2)] = argv[++i];
  }
  return out;
}

function loadEnvFile(path) {
  const env = {};
  if (!path || !existsSync(path)) return env;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(`用法: node tools/sync-published-examples.mjs [--out examples/published] [--limit 50] [--min-html 2000] [--dry-run]`);
  process.exit(0);
}

const envFiles = args["env-file"] ? [args["env-file"]] : ENV_FILES;
const fileEnv = Object.assign({}, ...envFiles.map(loadEnvFile));
const appid = process.env.WECHAT_APPID || fileEnv.WECHAT_APPID;
const secret = process.env.WECHAT_SECRET || process.env.WECHAT_APPSECRET || fileEnv.WECHAT_SECRET || fileEnv.WECHAT_APPSECRET;
if (!appid || !secret) {
  console.error(`缺少 WECHAT_APPID / WECHAT_SECRET（查找位置：${envFiles.join(" / ")}）`);
  process.exit(2);
}

const outRoot = resolve(args.out);
const limit = Number(args.limit) || 50;
const minHtml = Number(args["min-html"]) || 0;
const dryRun = !!args["dry-run"];

const token = await (async () => {
  const res = await fetch(`${API}/cgi-bin/stable_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grant_type: "client_credential", appid, secret }),
  });
  const data = await res.json();
  if (!data.access_token) {
    console.error(`取 token 失败：errcode=${data.errcode} errmsg=${data.errmsg}`);
    process.exit(2);
  }
  return data.access_token;
})();

const items = [];
for (let offset = 0; offset < limit; offset += 20) {
  const res = await fetch(`${API}/cgi-bin/draft/batchget?access_token=${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ offset, count: Math.min(20, limit - offset), no_content: 0 }),
  });
  const data = await res.json();
  if (data.errcode) {
    console.error(`读取草稿失败：errcode=${data.errcode} errmsg=${data.errmsg}`);
    break;
  }
  for (const it of data.item || []) items.push(it);
  if (items.length >= (data.total_count ?? 0)) break;
}
console.log(`草稿箱取到 ${items.length} 条`);

function slugify(title) {
  return String(title)
    .replace(/[｜|？?！!，,。.：:；;、"'“”‘’（）()\[\]【】<>《》\s/\\]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

if (!dryRun) mkdirSync(outRoot, { recursive: true });

const rows = [];
let index = 0;
for (const it of items) {
  const news = (it.content && it.content.news_item) || [];
  const first = news[0] || {};
  const html = first.content || "";
  const title = first.title || "(无标题)";
  const date = new Date((it.update_time || 0) * 1000).toISOString().slice(0, 10);
  if (html.length < minHtml) {
    console.log(`  跳过（正文仅 ${html.length} 字节，疑似空草稿）：${title}`);
    continue;
  }
  index += 1;
  const dirName = `${String(index).padStart(2, "0")}_${date}_${slugify(title)}`;
  const dir = join(outRoot, dirName);

  if (dryRun) {
    console.log(`  [dry-run] ${dirName}  html=${html.length}  cover=${(first.thumb_url || "").slice(0, 50)}`);
    continue;
  }

  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "文章.html"), html, "utf8");

  let coverName = "";
  if (first.thumb_url) {
    const url = String(first.thumb_url).replace(/^http:/, "https:");
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const ext = /\.png$/i.test(url) ? "png" : "jpg";
      coverName = `封面.${ext}`;
      writeFileSync(join(dir, coverName), buf);
    } catch (err) {
      console.error(`  ! 封面下载失败 ${title.slice(0, 20)}: ${err.message}`);
    }
  }

  writeFileSync(
    join(dir, "meta.json"),
    JSON.stringify(
      { title, date, media_id: it.media_id, cover: coverName, cover_url: first.thumb_url || null, html_chars: html.length },
      null,
      2,
    ),
    "utf8",
  );
  rows.push({ index, date, title, dirName, cover: coverName });
  console.log(`  ${dirName}  html=${html.length}  ${coverName || "(无封面)"}`);
}

if (!dryRun && rows.length) {
  const lines = [
    "# 已发布成品示例",
    "",
    "从公众号同步下来的真实排版成品：每篇一个目录，含 `文章.html`（内联样式，公众号可直接粘贴的那一版）与 `封面`。",
    "",
    "同步脚本：`node tools/sync-published-examples.mjs`",
    "",
    `共 ${rows.length} 篇。`,
    "",
    "| # | 日期 | 标题 | 目录 |",
    "| --- | --- | --- | --- |",
    ...rows.map((r) => `| ${r.index} | ${r.date} | ${r.title.replace(/\|/g, "\\|")} | \`${r.dirName}\` |`),
    "",
  ];
  writeFileSync(join(outRoot, "README.md"), lines.join("\n"), "utf8");
  console.log(`\n写出索引：${join(outRoot, "README.md")}`);
}

console.log(`完成：${rows.length} 篇${dryRun ? "（dry-run）" : ""}`);

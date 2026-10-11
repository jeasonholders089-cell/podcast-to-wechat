#!/usr/bin/env node
// 把公众号里已发布的成品同步成仓库示例：每篇一个目录，含「文章.html + 封面.jpg」。
//
// 数据来源：微信公众号「草稿箱」接口（cgi-bin/draft/batchget，no_content=0）。
// 已发布文章会留在草稿箱里，所以这里拿到的就是发布时的排好版成品（内联样式 HTML）与封面。
//
// 选篇规则：默认读 <out>/selected.json 里的白名单（按 media_id 固定，顺序即展示顺序），
// 这样公众号继续发文也不会把示例顶掉；白名单不存在时才回退到「取最新 --limit 篇」。
//
// 用法：
//   node tools/sync-published-examples.mjs [--env-file <path>] [--out examples/published]
//        [--limit 50] [--min-html 2000] [--dry-run] [--no-preview] [--selected <json>]

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

const ENV_FILES = ["D:/内容生产/.env", "D:/项目/AI内容生产/.env"];
const API = "https://api.weixin.qq.com";

function parseArgs(argv) {
  const out = { out: "examples/published", limit: 50, "min-html": 2000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--dry-run") out["dry-run"] = true;
    else if (a === "--no-preview") out["no-preview"] = true;
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
  console.log(`用法: node tools/sync-published-examples.mjs [--out examples/published] [--limit 4] [--min-html 2000] [--dry-run] [--no-preview]`);
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
const wantPreview = !args["no-preview"];
const selectedPath = args.selected ? resolve(args.selected) : join(outRoot, "selected.json");
let pins = null;
if (existsSync(selectedPath)) {
  try {
    const cfg = JSON.parse(readFileSync(selectedPath, "utf8"));
    pins = (cfg.items || []).map((x) => (typeof x === "string" ? x : x.media_id)).filter(Boolean);
    console.log(`选篇白名单：${selectedPath}（${pins.length} 篇）`);
  } catch (err) {
    console.error(`白名单读取失败（${err.message}），回退到取最新 ${limit} 篇`);
  }
}

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean);
const chrome = CHROME_CANDIDATES.find((p) => existsSync(p));

// 文章排版首屏截图：公众号正文是 HTML 片段，没有 charset，直接截图中文会乱码，所以要包一层
function makePreview(html, outPath) {
  if (!chrome) return false;
  const dir = join(tmpdir(), "wx-preview-" + randomUUID());
  mkdirSync(dir, { recursive: true });
  const page = join(dir, "page.html");
  const wrapped = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:#fff;}
body{padding:28px;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;}
</style></head><body>${html}</body></html>`;
  writeFileSync(page, wrapped, "utf8");
  try {
    execFileSync(
      chrome,
      [
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--no-first-run",
        "--no-default-browser-check",
        `--user-data-dir=${join(dir, "profile")}`,
        "--force-device-scale-factor=1",
        "--window-size=900,1300",
        `--screenshot=${outPath}`,
        "file:///" + page.replace(/\\/g, "/"),
      ],
      { stdio: "pipe", timeout: 60000 },
    );
    return true;
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

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
// 有白名单时要把草稿箱翻全，才能找到被固定下来的那几篇
const fetchLimit = pins ? 100 : limit;
for (let offset = 0; offset < fetchLimit; offset += 20) {
  const res = await fetch(`${API}/cgi-bin/draft/batchget?access_token=${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ offset, count: Math.min(20, fetchLimit - offset), no_content: 0 }),
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

if (pins) {
  const byId = new Map(items.map((it) => [it.media_id, it]));
  const missing = pins.filter((id) => !byId.has(id));
  if (missing.length) console.error(`  白名单里有 ${missing.length} 篇在草稿箱里找不到（可能已删除）：${missing.join(", ")}`);
  items.length = 0;
  for (const id of pins) if (byId.has(id)) items.push(byId.get(id));
  console.log(`按白名单选中 ${items.length} 篇`);
}

function slugify(title) {
  return String(title)
    // 去掉标点与 URL 里容易出问题的字符（% # & + 等）
    .replace(/[｜|？?！!，,。.：:；;、"'“”‘’（）()\[\]【】<>《》%#&+\s/\\]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

// 只转义 URL 里真正有歧义的字符；中文原样保留，源码更好读
const escPath = (p) => String(p).replace(/%/g, "%25").replace(/ /g, "%20").replace(/#/g, "%23").replace(/\?/g, "%3F");

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

  let previewName = "";
  if (wantPreview && makePreview(html, join(dir, "预览.png"))) previewName = "预览.png";

  writeFileSync(
    join(dir, "meta.json"),
    JSON.stringify(
      { title, date, media_id: it.media_id, cover: coverName, preview: previewName, cover_url: first.thumb_url || null, html_chars: html.length },
      null,
      2,
    ),
    "utf8",
  );
  rows.push({ index, date, title, dirName, cover: coverName, preview: previewName });
  console.log(`  ${dirName}  html=${html.length}  ${coverName || "(无封面)"}  ${previewName || "(无预览)"}`);
}

if (!dryRun && rows.length) {
  const lines = [
    "# 已发布成品示例",
    "",
    "从公众号同步下来的真实排版成品。每篇一个目录，含：",
    "",
    "- `文章.html` —— 发布时的排版成品（内联样式，公众号编辑器可直接粘贴的那一版）",
    "- `封面.jpg` —— 对应的 1280×544 公众号封面",
    "- `预览.png` —— 正文首屏截图，用来直观看到排版效果",
    "- `meta.json` —— 标题、日期、media_id",
    "",
    "选篇由 `selected.json` 的白名单固定（按 media_id），公众号继续发文不会把这里的示例顶掉；想换哪篇改那个文件再跑同步脚本。",
    "",
    "```bash",
    "node tools/sync-published-examples.mjs              # 按白名单同步",
    "node tools/sync-published-examples.mjs --limit 4    # 不看白名单，取最新 4 篇",
    "node tools/sync-published-examples.mjs --dry-run    # 只预览不落盘",
    "```",
    "",
  ];
  for (const r of rows) {
    const base = r.dirName.split("/").pop();
    lines.push(`## ${r.title}`, "", `${r.date} · [成品 HTML](${escPath(base)}/文章.html)`, "");
    if (r.cover) lines.push(`![封面](${escPath(base)}/${escPath(r.cover)})`, "");
    if (r.preview) lines.push(`![排版效果](${escPath(base)}/${escPath(r.preview)})`, "");
  }
  writeFileSync(join(outRoot, "README.md"), lines.join("\n"), "utf8");
  console.log(`\n写出索引：${join(outRoot, "README.md")}`);
}

console.log(`完成：${rows.length} 篇${dryRun ? "（dry-run）" : ""}`);

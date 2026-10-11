#!/usr/bin/env node
// 微信公众号草稿箱推送
//   --check                     只验证凭证 / 取 token
//   --dry-run                   组包但不发送
//   --list [--count N]          查看草稿箱最近条目
//   正式推送：--html <file> --title <t> --digest <d> --cover <png> [--author <a>]

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// 先读共享 env，再用产线自己的 .env 覆盖（后者优先）
const DEFAULT_ENV_FILES = ["D:/内容生产/.env", "D:/项目/AI内容生产/.env"];
const API = "https://api.weixin.qq.com";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--check" || a === "--dry-run" || a === "--help" || a === "-h") out[a.replace(/^--/, "")] = true;
    else if (a === "--list") out.list = true;
    else if (a.startsWith("--")) out[a.slice(2)] = argv[++i];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(`用法:
  node push_to_wechat_draft.mjs --check
  node push_to_wechat_draft.mjs --list --count 5
  node push_to_wechat_draft.mjs --html <html> --title <t> --digest <d> --cover <png> [--author <a>] [--dry-run]`);
  process.exit(0);
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

const envFiles = args["env-file"] ? [args["env-file"]] : DEFAULT_ENV_FILES;
const fileEnv = Object.assign({}, ...envFiles.map(loadEnvFile));
const appid = args.appid || process.env.WECHAT_APPID || fileEnv.WECHAT_APPID;
const secret =
  args.secret || process.env.WECHAT_APPSECRET || process.env.WECHAT_SECRET || fileEnv.WECHAT_APPSECRET || fileEnv.WECHAT_SECRET;
const author = args.author || process.env.WECHAT_AUTHOR || fileEnv.WECHAT_AUTHOR || "粽子AI世界";

function fail(msg, extra) {
  console.error(`\n✗ ${msg}`);
  if (extra) console.error(JSON.stringify(extra, null, 2));
  process.exit(1);
}

const cjkLen = (s) => [...(s ?? "")].length;

async function getToken() {
  if (!appid || !secret) fail(`缺少 WECHAT_APPID / WECHAT_SECRET（环境变量或 ${envFiles.join(" / ")}）`);
  const res = await fetch(`${API}/cgi-bin/stable_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grant_type: "client_credential", appid, secret, force_refresh: false }),
  });
  const data = await res.json();
  if (!data.access_token) fail(`取 token 失败：errcode=${data.errcode} errmsg=${data.errmsg}`, data);
  return data.access_token;
}

async function uploadCover(token, coverPath) {
  if (!existsSync(coverPath)) fail(`封面文件不存在：${coverPath}`);
  const buf = readFileSync(coverPath);
  const name = coverPath.split(/[\\/]/).pop();
  const fd = new FormData();
  fd.append("media", new Blob([buf], { type: "image/png" }), name);
  const res = await fetch(`${API}/cgi-bin/material/add_material?access_token=${token}&type=image`, {
    method: "POST",
    body: fd,
  });
  const data = await res.json();
  if (!data.media_id) fail(`封面上传失败：errcode=${data.errcode} errmsg=${data.errmsg}`, data);
  return data.media_id;
}

async function listDrafts(token, count) {
  const res = await fetch(`${API}/cgi-bin/draft/batchget?access_token=${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ offset: 0, count: Number(count) || 5, no_content: 1 }),
  });
  const data = await res.json();
  if (data.errcode) fail(`读取草稿箱失败：errcode=${data.errcode} errmsg=${data.errmsg}`, data);
  const items = (data.item ?? []).map((it) => ({
    media_id: it.media_id,
    update_time: new Date((it.update_time ?? 0) * 1000).toISOString(),
    title: (it.content?.news_item ?? []).map((n) => n.title).join(" | "),
  }));
  console.log(JSON.stringify({ total: data.total_count, items }, null, 2));
}

// ---- 主流程 ----

if (args.check) {
  const token = await getToken();
  console.log(JSON.stringify({ ok: true, appid, token_prefix: token.slice(0, 12), token_len: token.length }, null, 2));
  process.exit(0);
}

if (args.list) {
  const token = await getToken();
  await listDrafts(token, args.count);
  process.exit(0);
}

if (!args.html || !args.title) {
  fail("缺少 --html 或 --title。用 --dry-run 可只组包。");
}
if (!existsSync(args.html)) fail(`正文文件不存在：${args.html}`);

const content = readFileSync(args.html, "utf8");
const title = args.title;
const digest = args.digest ?? "";

const problems = [];
if (cjkLen(title) > 32) problems.push(`标题 ${cjkLen(title)} 字 > 32 字上限，请用 --title 传短标题`);
if (cjkLen(digest) > 120) problems.push(`摘要 ${cjkLen(digest)} 字 > 120 字上限`);
if ((content.match(/<img/g) ?? []).length > 0) problems.push("正文 HTML 里有 img 标签（规范要求正文 0 图）");
if ((content.match(/href="https?:/g) ?? []).length > 0) problems.push("正文 HTML 里有外链（规范要求 0 外链）");
if (/<h1[\s>]/i.test(content)) problems.push("正文 HTML 里有 H1（规范要求无 H1）");

if (problems.length) fail("硬门槛不通过：\n  - " + problems.join("\n  - "), problems);

const payloadPreview = {
  title,
  title_chars: cjkLen(title),
  digest,
  digest_chars: cjkLen(digest),
  author,
  content_html_chars: content.length,
  cover: args.cover ?? "(未提供，正式推送必须提供)",
};

if (args["dry-run"]) {
  console.log(JSON.stringify({ ok: true, dry_run: true, payload: payloadPreview }, null, 2));
  process.exit(0);
}

if (!args.cover) fail("正式推送必须提供 --cover（横版封面）");

const token = await getToken();
const thumbMediaId = await uploadCover(token, resolve(args.cover));

const body = {
  articles: [
    {
      title,
      author,
      digest,
      content,
      thumb_media_id: thumbMediaId,
      need_open_comment: 0,
      only_fans_can_comment: 0,
    },
  ],
};

const res = await fetch(`${API}/cgi-bin/draft/add?access_token=${token}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const data = await res.json();
if (!data.media_id) fail(`推送失败：errcode=${data.errcode} errmsg=${data.errmsg}`, data);

console.log(
  JSON.stringify(
    {
      ok: true,
      media_id: data.media_id,
      title,
      title_chars: cjkLen(title),
      thumb_media_id: thumbMediaId,
      duck: "只进草稿箱，未群发",
    },
    null,
    2,
  ),
);

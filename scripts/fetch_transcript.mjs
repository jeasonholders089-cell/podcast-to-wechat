#!/usr/bin/env node
// 环节 ① 抓字幕：用 TikHub 取完整逐字稿 + 视频元信息（来源四项要用）。
//
// 用法：
//   node fetch_transcript.mjs --video <video_id 或 URL> --out-dir <期目录> [--lang en] [--json]

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const ENV_FILES = ["D:/内容生产/.env", "D:/项目/AI内容生产/.env"];

function parseArgs(argv) {
  const out = { lang: "en" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--json") out.json = true;
    else if (a.startsWith("--")) out[a.slice(2)] = argv[++i];
  }
  return out;
}

function loadEnvFile(path) {
  const env = {};
  if (!existsSync(path)) return env;
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
if (args.help || !args.video || !args["out-dir"]) {
  console.log(`用法: node fetch_transcript.mjs --video <video_id 或 URL> --out-dir <期目录> [--lang en]`);
  process.exit(args.help ? 0 : 2);
}

function extractVideoId(value) {
  const s = String(value).trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  const patterns = [/[?&]v=([A-Za-z0-9_-]{11})/, /youtu\.be\/([A-Za-z0-9_-]{11})/, /\/shorts\/([A-Za-z0-9_-]{11})/, /\/embed\/([A-Za-z0-9_-]{11})/];
  for (const p of patterns) {
    const m = s.match(p);
    if (m) return m[1];
  }
  return null;
}

const videoId = extractVideoId(args.video);
if (!videoId) {
  console.error(`无法从 "${args.video}" 解析出 video_id`);
  process.exit(2);
}

const fileEnv = Object.assign({}, ...ENV_FILES.map(loadEnvFile));
const apiKey = process.env.TIKHUB_API_KEY || fileEnv.TIKHUB_API_KEY;
const baseUrl = (process.env.TIKHUB_BASE_URL || fileEnv.TIKHUB_BASE_URL || "https://api.tikhub.dev").replace(/\/$/, "");
if (!apiKey) {
  console.error("缺少 TIKHUB_API_KEY");
  process.exit(2);
}

async function tikGet(path) {
  const res = await fetch(baseUrl + path, { headers: { Authorization: `Bearer ${apiKey}` } });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`非 JSON 响应 (${res.status}) ${text.slice(0, 160)}`);
  }
  if (res.status !== 200 || (body.code && body.code !== 200)) {
    const msg = (body.detail && (body.detail.message || body.detail)) || body.message || JSON.stringify(body).slice(0, 160);
    throw new Error(`TikHub ${res.status}: ${msg}`);
  }
  return body.data;
}

const info = await tikGet(`/api/v1/youtube/web_v2/get_video_info?video_id=${videoId}`);

const langCandidates = [...new Set([args.lang, "en", ""].filter((x) => x !== undefined))];
let transcript = null;
let usedLang = null;
for (const lang of langCandidates) {
  try {
    const q = `/api/v1/youtube/web_v2/get_video_captions?video_id=${videoId}&format=txt${lang ? `&language_code=${lang}` : ""}`;
    const cap = await tikGet(q);
    const content = (cap && cap.content) || "";
    if (content.trim().length > 0) {
      transcript = content;
      usedLang = cap.language_code || lang || "auto";
      break;
    }
  } catch (err) {
    console.error(`  ! 字幕 ${lang || "auto"} 失败：${err.message}`);
  }
}

if (!transcript) {
  console.error(`抓不到字幕：${videoId}（试过语言 ${langCandidates.map((l) => l || "auto").join(", ")}）`);
  process.exit(1);
}

const outDir = args["out-dir"];
mkdirSync(outDir, { recursive: true });

const transcriptPath = join(outDir, `full-transcript-${usedLang}.txt`);
writeFileSync(transcriptPath, transcript.trim() + "\n", "utf8");

const metaPath = join(outDir, "video-meta.json");
const meta = {
  video_id: videoId,
  title: info.title ?? null,
  channel: info.author ?? null,
  duration_seconds: info.length_seconds ?? null,
  duration_minutes: info.length_seconds ? Math.round(info.length_seconds / 60) : null,
  publish_date: info.publish_date ?? null,
  upload_date: info.upload_date ?? null,
  view_count: info.view_count ?? null,
  url: `https://www.youtube.com/watch?v=${videoId}`,
  transcript_path: transcriptPath,
  transcript_lang: usedLang,
  transcript_chars: transcript.replace(/\s+/g, "").length,
};
writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf8");

const summary = { ok: true, ...meta, meta_path: metaPath };
if (args.json) console.log(JSON.stringify(summary, null, 2));
else {
  console.log(`逐字稿：${transcriptPath}`);
  console.log(`  语言 ${usedLang} · ${meta.transcript_chars} 字（去空白）`);
  console.log(`  ${meta.title}`);
  console.log(`  ${meta.channel} · ${meta.duration_minutes} 分钟 · 发布 ${meta.publish_date} · 播放 ${meta.view_count}`);
}

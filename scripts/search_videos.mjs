#!/usr/bin/env node
// 环节 0 选题：用 TikHub 搜 YouTube 访谈播客，筛出能直接开做的候选。
//
// 用法：
//   node search_videos.mjs --query "AI data center" [--limit 10] [--enrich 6]
//        [--min-minutes 20] [--max-minutes 90] [--max-age-days 14]
//        [--registry "D:/项目/AI内容生产/公众号产出/已发布-视频清单.json"] [--json out.json]

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const ENV_FILES = ["D:/内容生产/.env", "D:/项目/AI内容生产/.env"];
const DEFAULT_REGISTRY = "D:/项目/AI内容生产/公众号产出/已发布-视频清单.json";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
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
if (args.help || !args.query) {
  console.log(`用法: node search_videos.mjs --query "…" [--limit 10] [--enrich 6]
       [--min-minutes 20] [--max-minutes 90] [--max-age-days 14] [--registry <json>] [--json <out>]`);
  process.exit(args.help ? 0 : 2);
}

// --query 支持逗号分隔的多条查询词，结果合并去重（选题通常要覆盖多个方向）
const queries = String(args.query)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const fileEnv = Object.assign({}, ...ENV_FILES.map(loadEnvFile));
const apiKey = process.env.TIKHUB_API_KEY || fileEnv.TIKHUB_API_KEY;
const baseUrl = (process.env.TIKHUB_BASE_URL || fileEnv.TIKHUB_BASE_URL || "https://api.tikhub.dev").replace(/\/$/, "");
if (!apiKey) {
  console.error("缺少 TIKHUB_API_KEY");
  process.exit(2);
}

const limit = Number(args.limit) || 10;
const enrichCount = Number(args.enrich ?? 6);
const minMinutes = Number(args["min-minutes"] ?? 20);
const maxMinutes = Number(args["max-minutes"] ?? 90);
const maxAgeDays = Number(args["max-age-days"] ?? 14);
const registryPath = args.registry || DEFAULT_REGISTRY;

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

function lengthToSeconds(value) {
  if (typeof value === "number") return value;
  if (!value) return null;
  const parts = String(value).split(":").map(Number);
  if (parts.some((n) => Number.isNaN(n))) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

function parsePublishDate(value) {
  if (!value) return null;
  const s = String(value).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const rel = s.match(/(\d+)\s*(hour|day|week|month|year)/i);
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2].toLowerCase();
    const days = { hour: n / 24, day: n, week: n * 7, month: n * 30, year: n * 365 }[unit];
    const d = new Date(Date.now() - days * 86400000);
    return d.toISOString().slice(0, 10);
  }
  return null;
}

function ageInDays(dateStr) {
  if (!dateStr) return null;
  return Math.floor((Date.now() - new Date(dateStr + "T00:00:00Z").getTime()) / 86400000);
}

let seen = new Set();
if (existsSync(registryPath)) {
  try {
    const reg = JSON.parse(readFileSync(registryPath, "utf8"));
    seen = new Set((reg.items || []).map((i) => i.video_id).filter(Boolean));
  } catch {
    /* 清单坏了也不拦流程 */
  }
}

const collected = [];
for (const q of queries) {
  try {
    const search = await tikGet(
      `/api/v1/youtube/web/search_video?search_query=${encodeURIComponent(q)}&language_code=en&country_code=US`,
    );
    for (const v of search.videos || []) collected.push({ ...v, _query: q });
  } catch (err) {
    console.error(`  ! 查询失败 "${q}": ${err.message}`);
  }
}
const byId = new Map();
for (const v of collected) if (!byId.has(v.video_id)) byId.set(v.video_id, v);

let videos = [...byId.values()].filter((v) => !v.is_live_content && v.type === "NORMAL");
videos = videos.filter((v) => !seen.has(v.video_id));
videos.sort((a, b) => (b.number_of_views || 0) - (a.number_of_views || 0));
videos = videos.slice(0, limit);
videos = videos.slice(0, limit);

// 取前 N 条补精确时长与发布日期（每次调用都计费，所以限量）
const enrichTargets = videos.slice(0, enrichCount);
const details = new Map();
for (const v of enrichTargets) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const info = await tikGet(`/api/v1/youtube/web_v2/get_video_info?video_id=${v.video_id}`);
      if (info && info.length_seconds) {
        details.set(v.video_id, info);
        break;
      }
      if (attempt === 2) console.error(`  ! 补详情为空 ${v.video_id}`);
    } catch (err) {
      if (attempt === 2) console.error(`  ! 补详情失败 ${v.video_id}: ${err.message}`);
      else await new Promise((r) => setTimeout(r, 1200));
    }
  }
}

const rows = videos.map((v) => {
  const info = details.get(v.video_id) || {};
  const seconds = Number(info.length_seconds ?? lengthToSeconds(v.video_length)) || null;
  const publishedAt = parsePublishDate(info.publish_date || info.upload_date || v.published_time);
  const minutes = seconds ? Math.round(seconds / 60) : null;
  const age = ageInDays(publishedAt);
  const reasons = [];
  if (minutes === null) reasons.push("时长未知");
  else if (minutes < minMinutes) reasons.push(`时长 ${minutes} 分钟偏短`);
  else if (minutes > maxMinutes) reasons.push(`时长 ${minutes} 分钟偏长`);
  if (age !== null && age > maxAgeDays) reasons.push(`${age} 天前，超出 ${maxAgeDays} 天窗口`);
  return {
    video_id: v.video_id,
    title: v.title,
    author: v.author,
    minutes,
    published_at: publishedAt,
    published_text: v.published_time,
    age_days: age,
    views: Number(info.view_count ?? v.number_of_views) || null,
    url: `https://www.youtube.com/watch?v=${v.video_id}`,
    eligible: reasons.length === 0,
    reject_reasons: reasons,
  };
});

rows.sort((a, b) => Number(b.eligible) - Number(a.eligible) || String(b.published_at || "").localeCompare(String(a.published_at || "")) || (b.views || 0) - (a.views || 0));

const report = {
  query: args.query,
  queries,
  queried_at: new Date().toISOString(),
  filters: { min_minutes: minMinutes, max_minutes: maxMinutes, max_age_days: maxAgeDays },
  registry: registryPath,
  eligible_count: rows.filter((r) => r.eligible).length,
  rows,
};
if (args.json) writeFileSync(args.json, JSON.stringify(report, null, 2));

console.log(`query="${args.query}"  候选 ${rows.length} 条，其中合格 ${report.eligible_count} 条\n`);
for (const r of rows) {
  const mark = r.eligible ? "[可做]" : "[跳过]";
  console.log(`${mark} ${String(r.minutes ?? "?").padStart(3)}min  ${r.published_at || r.published_text || "?"}  ${String(r.views ?? "").padStart(9)}  ${r.video_id}  ${r.title.slice(0, 62)}`);
  if (!r.eligible) console.log(`        ↳ ${r.reject_reasons.join("；")}`);
}

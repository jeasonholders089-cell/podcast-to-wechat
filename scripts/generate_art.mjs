#!/usr/bin/env node
// 插画生成（环节 ⑤ 的前半段）：调 AI98 网关出「没字的画面」，中文标题交给 make_social_cover.mjs 叠。
//
// 用法：
//   node generate_art.mjs --name crusoe --out-dir <期目录> \
//     --subject "a founder in an open-collar shirt and a podcast host holding a microphone, seated across from each other" \
//     --motif "power lines and server racks" [--sizes vertical,square] [--model gpt-image-2]
//
// 铁律：CRITICAL FACE REQUIREMENT 段永远写在提示词里（旧产线漏过，出过空白脸/纯黑剪影的废图）。
// 竖版与方版分开出，不允许裁竖版当方版用。

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const ENV_FILES = ["D:/内容生产/.env", "D:/项目/AI内容生产/.env"];
const MODEL_CHAIN = ["gpt-image-2", "gpt-image-2.5-sunburst", "gpt-image-2.5-flare"];
const SIZE_MAP = {
  vertical: "1024x1536",
  square: "1024x1024",
  horizontal: "1536x1024",
};

function parseArgs(argv) {
  const out = { sizes: "vertical,square" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a.startsWith("--")) out[a.slice(2)] = argv[++i];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.name || !args["out-dir"] || !args.subject) {
  console.log(`用法: node generate_art.mjs --name <slug> --out-dir <dir> --subject "…" [--motif "…"]
         [--sizes vertical,square] [--model gpt-image-2] [--dry-run]`);
  process.exit(args.help ? 0 : 2);
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

const fileEnv = Object.assign({}, ...ENV_FILES.map(loadEnvFile));
const apiKey = process.env.AI98_API_KEY || process.env.AI98_生图_API_Key || fileEnv.AI98_API_KEY || fileEnv.AI98_生图_API_Key;
const baseUrl = (process.env.AI98_BASE_URL || process.env.AI98_BaseUrl || fileEnv.AI98_BASE_URL || fileEnv.AI98_BaseUrl || "https://ai98pro.xyz").replace(/\/$/, "");
const timeoutMs = Number(process.env.AI98_IMAGE_TIMEOUT_MS || fileEnv.AI98_IMAGE_TIMEOUT_MS || 300000);

if (!apiKey) {
  console.error(`缺少 AI98 key（AI98_生图_API_Key / AI98_API_KEY，查找位置：${ENV_FILES.join(" / ")}）`);
  process.exit(2);
}

const STYLE = `Editorial illustration for a technology podcast cover.
Style: two-tone charcoal-and-cream printmaking, screen-print texture, subtle paper grain.
Palette: cream paper #F5F1E9, vermilion orange #E8552D, charcoal #2B2B2B. No other colors.`;

const FACE = `CRITICAL FACE REQUIREMENT: every person in the image MUST have a fully rendered face —
two clearly visible eyes with pupils, eyebrows, nose, and mouth. Faces must be drawn with visible
linework and shading, NOT blank, NOT a solid black silhouette, NOT a featureless white shape.
Both characters must be recognizable as human figures with distinct facial features.`;

const NEGATIVE = `no text, no letters, no watermark, no logo, no blank faces, no faceless figures,
no solid black head shapes, no extra limbs, no distorted hands`;

function buildPrompt(orientation) {
  return `${STYLE}
Composition: ${orientation}, generous negative space in the upper third for headline text overlay.
${FACE}
Scene: ${args.subject}, leaning slightly forward mid-conversation. Background abstract geometry${
    args.motif ? ` suggesting ${args.motif},` : ""
  } one large orange circle partially cropped at the edge.
${NEGATIVE}`;
}

async function generateOne(model, prompt, size) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/v1/images/generations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, prompt, size, n: 1 }),
      signal: controller.signal,
    });
    const text = await res.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      return { ok: false, reason: `非 JSON 响应 (${res.status}): ${text.slice(0, 160)}` };
    }
    if (res.status !== 200 || !body.data || !body.data[0]) {
      const msg = (body.error && (body.error.message || body.error.type)) || JSON.stringify(body).slice(0, 160);
      return { ok: false, reason: `HTTP ${res.status} ${msg}` };
    }
    const item = body.data[0];
    if (item.b64_json) return { ok: true, bytes: Buffer.from(item.b64_json, "base64") };
    if (item.url) {
      const ir = await fetch(item.url);
      return { ok: true, bytes: Buffer.from(await ir.arrayBuffer()) };
    }
    return { ok: false, reason: "响应里既没有 b64_json 也没有 url" };
  } catch (err) {
    return { ok: false, reason: `请求异常: ${err.message}` };
  } finally {
    clearTimeout(timer);
  }
}

const models = args.model ? [args.model] : MODEL_CHAIN;
const orientations = {
  vertical: "VERTICAL 2:3",
  square: "SQUARE 1:1",
  horizontal: "HORIZONTAL 3:2",
};
const suffix = { vertical: "竖版", square: "方版", horizontal: "横版" };

mkdirSync(args["out-dir"], { recursive: true });
const produced = [];
const failures = [];

for (const key of String(args.sizes).split(",").map((s) => s.trim()).filter(Boolean)) {
  const size = SIZE_MAP[key];
  if (!size) {
    failures.push({ size: key, reason: `未知尺寸 ${key}` });
    continue;
  }
  const prompt = buildPrompt(orientations[key]);
  if (args["dry-run"]) {
    console.log(`--- dry-run ${key} (${size}) ---\n${prompt}\n`);
    continue;
  }
  let done = false;
  for (const model of models) {
    const r = await generateOne(model, prompt, size);
    if (r.ok) {
      const outPath = join(args["out-dir"], `插画-${args.name}-${suffix[key]}.png`);
      writeFileSync(outPath, r.bytes);
      produced.push({ size: key, model, path: outPath, bytes: r.bytes.length });
      done = true;
      break;
    }
    console.error(`  ! ${key} / ${model} 失败：${r.reason}`);
  }
  if (!done) failures.push({ size: key, reason: "模型链全部失败" });
}

const result = { ok: failures.length === 0, base_url: baseUrl, produced, failures };
console.log(JSON.stringify(result, null, 2));
process.exit(failures.length ? 1 : 0);

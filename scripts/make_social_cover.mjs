#!/usr/bin/env node
// 贴图封面 / 金句卡出图（HTML 排版 + Chrome 无头截图）
// 用法：
//   node make_social_cover.mjs --name crusoe --title "融完 39 亿|他说壁垒是幻觉" --out-dir <dir>
//   [--kicker "对话 Crusoe CEO"] [--stat "39 亿|融资额"] [--quote "金句原文"] [--art <png>] [--sizes 3x4,1x1,quote]
// 中文一律由 Chrome 渲染，不交给生图模型。

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

const PAPER = "#F5F1E9";
const ACCENT = "#E8552D";
const INK = "#2B2B2B";

function parseArgs(argv) {
  const out = { sizes: "3x4,1x1", kicker: "", stat: "", quote: "" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a.startsWith("--")) out[a.slice(2)] = argv[++i];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.name || !args.title || !args["out-dir"]) {
  console.log(`用法: node make_social_cover.mjs --name <slug> --title "第一行|第二行" --out-dir <dir>
         [--kicker "..."] [--stat "39 亿|融资额"] [--quote "金句"] [--art <png>] [--sizes 3x4,1x1,quote]`);
  process.exit(args.help ? 0 : 2);
}

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean);
const chrome = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chrome) {
  console.error("找不到 Chrome/Edge 可执行文件，可用 CHROME_PATH 环境变量指定。");
  process.exit(1);
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// 标题：`|` 断行，`**词**` 染橙
const renderTitleLines = (raw) =>
  raw
    .split("|")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<div class="tl">${esc(line).replace(/\*\*([^*]+)\*\*/g, `<span class="hl">$1</span>`)}</div>`)
    .join("");

let artDataUri = null;
if (args.art) {
  if (!existsSync(args.art)) {
    console.error(`找不到插画文件: ${args.art}`);
    process.exit(1);
  }
  artDataUri = `data:image/png;base64,${readFileSync(args.art).toString("base64")}`;
}

const baseCss = [
  "* { margin:0; padding:0; box-sizing:border-box; }",
  `html,body { background:${PAPER}; font-family:"Microsoft YaHei","PingFang SC",sans-serif; color:${INK}; }`,
  ".canvas { position:relative; overflow:hidden; background:" + PAPER + "; }",
  ".art { position:absolute; inset:0; background-size:cover; background-position:center top; }",
  ".scrim { position:absolute; left:0; right:0; top:0; height:62%; background:linear-gradient(180deg, rgba(245,241,233,.95) 0%, rgba(245,241,233,.80) 60%, rgba(245,241,233,0) 100%); }",
  `.dot { position:absolute; width:132px; height:132px; border-radius:50%; background:${ACCENT}; right:-34px; top:-34px; }`,
  ".dot span { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; color:#fff; font-size:62px; font-weight:800; }",
  ".content { position:relative; padding:96px 84px; height:100%; display:flex; flex-direction:column; }",
  `.kicker { font-size:30px; color:${ACCENT}; font-weight:700; letter-spacing:.06em; margin-bottom:36px; }`,
  ".title { font-size:96px; font-weight:800; line-height:1.18; }",
  ".title .tl { }",
  `.hl { color:${ACCENT}; }`,
  ".stat { position:absolute; left:84px; bottom:170px; }",
  `.stat .num { font-size:104px; font-weight:800; color:${ACCENT}; line-height:1; text-shadow:0 0 16px rgba(245,241,233,.95), 0 0 34px rgba(245,241,233,.9); }`,
  ".stat .cap { font-size:28px; opacity:.92; margin-top:10px; letter-spacing:.04em; text-shadow:0 0 14px rgba(245,241,233,.95), 0 0 30px rgba(245,241,233,.9); }",
  ".brand { position:absolute; left:84px; bottom:64px; font-size:26px; letter-spacing:.18em; opacity:.66; }",
  ".quote { position:relative; padding:120px 88px; height:100%; display:flex; flex-direction:column; justify-content:center; }",
  `.quote .mark { font-size:150px; color:${ACCENT}; line-height:.7; font-weight:800; }`,
  ".quote .text { font-size:72px; font-weight:700; line-height:1.42; margin-top:18px; }",
  ".quote .from { margin-top:52px; font-size:28px; opacity:.66; letter-spacing:.06em; }",
  ".hwrap { position:relative; width:2048px; height:1152px; overflow:hidden; background:" + PAPER + "; }",
  ".hscrim { position:absolute; left:0; top:0; bottom:0; width:68%; background:linear-gradient(90deg, rgba(245,241,233,.97) 0%, rgba(245,241,233,.88) 55%, rgba(245,241,233,0) 100%); }",
  ".hcontent { position:absolute; left:96px; top:120px; width:1080px; }",
  ".hcontent .title { font-size:112px; font-weight:800; line-height:1.16; }",
  ".hbrand { position:absolute; left:96px; bottom:72px; font-size:30px; letter-spacing:.18em; opacity:.66; }",
].join("\n");

const htmlFor = (body) =>
  `<!doctype html><html><head><meta charset="utf-8"><style>${baseCss}</style></head><body>${body}</body></html>`;

function shot(html, width, height, outPath) {
  const dir = join(tmpdir(), "zongzi-cover-" + randomUUID());
  mkdirSync(dir, { recursive: true });
  const htmlPath = join(dir, "page.html");
  const profile = join(dir, "profile");
  writeFileSync(htmlPath, html, "utf8");
  execFileSync(
    chrome,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      `--user-data-dir=${profile}`,
      "--force-device-scale-factor=1",
      `--window-size=${width},${height}`,
      `--screenshot=${outPath}`,
      "file:///" + htmlPath.replace(/\\/g, "/"),
    ],
    { stdio: "pipe", timeout: 60000 },
  );
  rmSync(dir, { recursive: true, force: true });
  return outPath;
}

const statBlock = args.stat
  ? (() => {
      const [num, cap] = String(args.stat).split("|");
      return `<div class="stat"><div class="num">${esc(num)}</div>${cap ? `<div class="cap">${esc(cap)}</div>` : ""}</div>`;
    })()
  : "";

const artLayer = artDataUri
  ? `<div class="art" style="background-image:url('${artDataUri}')"></div><div class="scrim"></div>`
  : "";
const kicker = args.kicker ? `<div class="kicker">${esc(args.kicker)}</div>` : "";
const titleBlock = `<div class="title">${renderTitleLines(args.title)}</div>`;
const brandRow = `<div class="brand">粽子AI世界</div>`;

const outDir = args["out-dir"];
mkdirSync(outDir, { recursive: true });
const sizes = String(args.sizes).split(",").map((s) => s.trim()).filter(Boolean);
const produced = [];

for (const size of sizes) {
  if (size === "3x4") {
    const body = `<div class="canvas" style="width:1080px;height:1440px">${artLayer}<div class="dot"><span>Z</span></div>
      <div class="content">${kicker}${titleBlock}</div>${statBlock}${brandRow}</div>`;
    produced.push(shot(htmlFor(body), 1080, 1440, join(outDir, `封面-${args.name}-贴图3x4.png`)));
  } else if (size === "1x1") {
    const body = `<div class="canvas" style="width:1080px;height:1080px">${artLayer}<div class="dot"><span>Z</span></div>
      <div class="content" style="padding:80px 72px">${kicker}${titleBlock}</div>${brandRow}</div>`;
    produced.push(shot(htmlFor(body), 1080, 1080, join(outDir, `封面-${args.name}-贴图1x1.png`)));
  } else if (size === "quote") {
    if (!args.quote) {
      console.error("跳过 quote：未提供 --quote");
      continue;
    }
    const body = `<div class="canvas" style="width:1080px;height:1350px">
      <div class="quote"><div class="mark">“</div><div class="text">${esc(args.quote)}</div>
      <div class="from">粽子AI世界${args.kicker ? " · " + esc(args.kicker) : ""}</div></div>${brandRow}</div>`;
    produced.push(shot(htmlFor(body), 1080, 1350, join(outDir, `配图-${args.name}-金句卡.png`)));
  } else if (size === "h" || size === "horizontal") {
    const body = `<div class="hwrap">${artDataUri ? `<div class="art" style="background-image:url('${artDataUri}')"></div>` : ""}
      ${artDataUri ? '<div class="hscrim"></div>' : ""}<div class="dot"><span>Z</span></div>
      <div class="hcontent">${kicker}${titleBlock}</div><div class="hbrand">粽子AI世界</div></div>`;
    produced.push(shot(htmlFor(body), 2048, 1152, join(outDir, `封面-${args.name}-横版.png`)));
  }
}

console.log(JSON.stringify({ ok: true, chrome, art: args.art ? "used" : "none", produced }, null, 2));

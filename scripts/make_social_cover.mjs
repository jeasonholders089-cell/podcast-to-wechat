#!/usr/bin/env node
// 贴图封面 / 横版封面 / 金句卡出图（HTML 排版 + Chrome 无头截图）
// 版式 v2（2026-10-14 改版）：文字带 + 满幅插画 + 品牌条；横版左文右图，文字落在微信 2.35:1 安全区
// 用法：
//   node make_social_cover.mjs --name crusoe --title "融完 39 亿|他说壁垒是**幻觉**" --out-dir <dir>
//   [--kicker "对话 Crusoe CEO"] [--stat "39 亿|融资额"] [--quote "金句原文"] [--art <竖版.png>] [--art-square <方版.png>] [--sizes h,3x4,1x1,quote]
// 中文一律由 Chrome 渲染，不交给生图模型。标题里 `|` 断行、`**词**` 染橙；字号按行宽自适应。

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
  console.log(`用法: node cover-v2.mjs --name <slug> --title "行1|行2" --out-dir <dir> [--kicker ..] [--stat "数字|说明"] [--quote ..] [--art 竖版.png] [--art-square 方版.png] [--sizes h,3x4,1x1,quote]`);
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
  console.error("找不到 Chrome/Edge");
  process.exit(1);
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const dataUri = (p) => `data:image/png;base64,${readFileSync(p).toString("base64")}`;
const plain = (s) => String(s).replace(/\*\*/g, "");

let artV = null;
let artS = null;
if (args.art) {
  if (!existsSync(args.art)) throw new Error(`找不到插画 ${args.art}`);
  artV = dataUri(args.art);
}
if (args["art-square"]) {
  if (!existsSync(args["art-square"])) throw new Error(`找不到方版插画 ${args["art-square"]}`);
  artS = dataUri(args["art-square"]);
}
const artFor = (which) => (which === "square" ? artS || artV : artV || artS);

// ---- 标题自适应：按字宽估算，选出不溢出的最大字号 ----
const charEm = (ch) => {
  const cp = ch.codePointAt(0);
  if (/[A-Za-z0-9@#$%&]/.test(ch)) return 0.56;
  if (ch === " " || ch === "·") return 0.34;
  if (cp >= 0x2e80) return 1.0;
  return 0.4;
};
const lineEm = (line) => [...plain(line)].reduce((a, ch) => a + charEm(ch), 0);

const titleLines = String(args.title).split("|").map((s) => s.trim()).filter(Boolean);
function fitTitle(avail, base, min = 52) {
  const widest = Math.max(...titleLines.map(lineEm));
  const size = Math.floor(avail / (widest * 1.02));
  return Math.max(min, Math.min(base, size));
}
const renderTitle = (fs) =>
  titleLines
    .map((line) => `<div class="tl" style="font-size:${fs}px">${esc(line).replace(/\*\*([^*]+)\*\*/g, `<span class="hl">$1</span>`)}</div>`)
    .join("");

const [statNum, statCap] = args.stat ? String(args.stat).split("|") : ["", ""];

const css = `
* { margin:0; padding:0; box-sizing:border-box; }
html,body { background:${PAPER}; }
.cv { position:relative; overflow:hidden; background:${PAPER};
  font-family:"Microsoft YaHei","PingFang SC",sans-serif; color:${INK};
  -webkit-font-smoothing:antialiased; }
.grain { position:absolute; inset:0; pointer-events:none; z-index:9;
  background: radial-gradient(115% 85% at 10% 2%, rgba(255,255,255,.50) 0%, rgba(255,255,255,0) 52%),
              radial-gradient(85% 70% at 92% 100%, rgba(232,85,45,.05) 0%, rgba(232,85,45,0) 62%); }
.hl { color:${ACCENT}; }
.rule { width:84px; height:9px; background:${ACCENT}; }
.kick { font-size:32px; font-weight:700; color:${ACCENT}; letter-spacing:.10em; }
.tl { font-weight:800; line-height:1.13; letter-spacing:-.005em; }
.num { font-weight:800; color:${ACCENT}; line-height:1; font-variant-numeric:tabular-nums; }
.cap { color:rgba(43,43,43,.62); }
.brand { font-size:27px; letter-spacing:.20em; color:rgba(43,43,43,.84); }
.latin { font-family:Georgia,"Times New Roman",serif; font-size:21px; letter-spacing:.26em; color:rgba(43,43,43,.42); }
.strip { display:flex; align-items:center; justify-content:space-between; background:${PAPER}; }
.artwrap { position:relative; overflow:hidden; flex:1 1 auto; background:${PAPER}; }
.art { position:absolute; inset:0; background-size:cover; background-repeat:no-repeat; }
`;

const html = (body) => `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${body}</body></html>`;

function shot(body, w, h, outPath) {
  const dir = join(tmpdir(), "zongzi-cover2-" + randomUUID());
  mkdirSync(dir, { recursive: true });
  const htmlPath = join(dir, "p.html");
  writeFileSync(htmlPath, html(body), "utf8");
  execFileSync(
    chrome,
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      `--user-data-dir=${join(dir, "prof")}`,
      "--force-device-scale-factor=1",
      `--window-size=${w},${h}`,
      `--screenshot=${outPath}`,
      "file:///" + htmlPath.replace(/\\/g, "/"),
    ],
    { stdio: "pipe", timeout: 60000 },
  );
  rmSync(dir, { recursive: true, force: true });
  return outPath;
}

const outDir = args["out-dir"];
mkdirSync(outDir, { recursive: true });
const produced = [];

const KICK = args.kicker ? `<div class="kick" style="margin-top:28px">${esc(args.kicker)}</div>` : "";
const statRow = (numFs, capFs) =>
  statNum
    ? `<div style="display:flex;align-items:baseline;gap:16px">
         <div class="num" style="font-size:${numFs}px">${esc(statNum)}</div>
         ${statCap ? `<div class="cap" style="font-size:${capFs}px">${esc(statCap)}</div>` : ""}
       </div>`
    : "";

for (const size of String(args.sizes).split(",").map((s) => s.trim()).filter(Boolean)) {
  if (size === "h") {
    // 横版：左文右图。文字全部落在微信 2.35:1 中心裁切安全区（y 186..966）内
    const W = 2048,
      H = 1152,
      LW = 1010;
    const fs = fitTitle(LW - 96 - 76, 96);
    const body = `<div class="cv" style="width:${W}px;height:${H}px">
      <div style="position:absolute;right:0;top:0;bottom:0;width:${W - LW}px">
        <div class="art" style="background-image:url('${artFor("portrait")}');background-position:center 30%"></div>
      </div>
      <div style="position:absolute;left:${LW - 3}px;top:0;bottom:0;width:3px;background:${ACCENT}"></div>
      <div class="strip" style="position:absolute;left:0;top:0;bottom:0;width:${LW}px;flex-direction:column;align-items:stretch;justify-content:space-between;padding:186px 76px 172px 96px">
        <div>
          <div class="rule"></div>
          ${KICK}
          <div style="margin-top:34px">${renderTitle(fs)}</div>
        </div>
        <div>
          ${statNum ? `<div style="margin-bottom:56px">${statRow(84, 26)}</div>` : ""}
          <div style="height:1px;background:rgba(43,43,43,.13);margin-bottom:26px"></div>
          <div style="display:flex;align-items:baseline;justify-content:space-between">
            <div class="brand">粽子AI世界</div>
            <div class="latin" style="font-size:19px">ZONGZI AI WORLD</div>
          </div>
        </div>
      </div>
      <div class="grain"></div>
    </div>`;
    produced.push(shot(body, W, H, join(outDir, `封面-${args.name}-横版.png`)));
  } else if (size === "3x4") {
    const W = 1080,
      H = 1440,
      STRIP = 100;
    const fs = fitTitle(W - 84 - 84, 90);
    const body = `<div class="cv" style="width:${W}px;height:${H}px;display:flex;flex-direction:column">
      <div style="padding:76px 84px 40px;background:${PAPER}">
        <div class="rule"></div>
        ${KICK}
        <div style="margin-top:32px">${renderTitle(fs)}</div>
        ${statNum ? `<div style="margin-top:38px">${statRow(52, 24)}</div>` : ""}
      </div>
      <div class="artwrap">
        <div class="art" style="background-image:url('${artFor("portrait")}');background-position:center 44%"></div>
      </div>
      <div class="strip" style="height:${STRIP}px;padding:0 84px;border-top:1px solid rgba(43,43,43,.10)">
        <div class="brand">粽子AI世界</div>
        <div class="latin">ZONGZI AI WORLD</div>
      </div>
      <div class="grain"></div>
    </div>`;
    produced.push(shot(body, W, H, join(outDir, `封面-${args.name}-贴图3x4.png`)));
  } else if (size === "1x1") {
    const W = 1080,
      H = 1080,
      STRIP = 92;
    const fs = fitTitle(W - 76 - 76, 78);
    const body = `<div class="cv" style="width:${W}px;height:${H}px;display:flex;flex-direction:column">
      <div style="padding:62px 76px 34px;background:${PAPER}">
        <div class="rule"></div>
        ${KICK}
        <div style="margin-top:28px">${renderTitle(fs)}</div>
      </div>
      <div class="artwrap">
        <div class="art" style="background-image:url('${artFor("square")}');background-position:center 40%"></div>
      </div>
      <div class="strip" style="height:${STRIP}px;padding:0 76px;border-top:1px solid rgba(43,43,43,.10)">
        <div class="brand">粽子AI世界</div>
        <div class="latin">ZONGZI AI WORLD</div>
      </div>
      <div class="grain"></div>
    </div>`;
    produced.push(shot(body, W, H, join(outDir, `封面-${args.name}-贴图1x1.png`)));
  } else if (size === "quote") {
    if (!args.quote) continue;
    const W = 1080,
      H = 1350;
    // 金句自适应：按可用高度算最大字号，避免长句溢出
    const qAvail = 880,
      qMaxH = 620;
    let qFs = 74;
    for (; qFs > 40; qFs -= 2) {
      const cpl = Math.max(1, Math.floor(qAvail / qFs));
      const lines = Math.ceil([...plain(args.quote)].length / cpl);
      if (lines * qFs * 1.44 <= qMaxH) break;
    }
    const body = `<div class="cv" style="width:${W}px;height:${H}px">
      <div style="position:absolute;inset:50px;border:1px solid rgba(43,43,43,.09)"></div>
      <div style="position:absolute;left:100px;right:100px;top:300px;bottom:230px;display:flex;flex-direction:column;justify-content:flex-start">
        <div style="font-family:Georgia,serif;font-size:132px;line-height:.56;color:${ACCENT};font-weight:800">&ldquo;</div>
        <div style="font-size:${qFs}px;font-weight:700;line-height:1.44;margin-top:34px;text-wrap:balance">${esc(args.quote)}</div>
        <div style="margin-top:52px;display:flex;align-items:center;gap:20px">
          <div style="width:54px;height:3px;background:${ACCENT}"></div>
          <div class="cap" style="font-size:27px;letter-spacing:.04em">${esc(args.kicker ? `粽子AI世界 · ${args.kicker}` : "粽子AI世界")}</div>
        </div>
      </div>
      <div style="position:absolute;left:100px;right:100px;bottom:104px;height:1px;background:rgba(43,43,43,.12)"></div>
      <div style="position:absolute;left:100px;bottom:56px" class="latin">ZONGZI AI WORLD · DECONSTRUCT TO CONNECT</div>
      <div class="grain"></div>
    </div>`;
    produced.push(shot(body, W, H, join(outDir, `配图-${args.name}-金句卡.png`)));
  }
}

console.log(JSON.stringify({ ok: true, produced }, null, 2));

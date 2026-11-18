#!/usr/bin/env node
// 图文笔记出图：把一期内容渲染成一套竖版图文（每页 1080×1440），HTML 排版 + Chrome 无头截图。
// 中文一律由 Chrome 渲染；配图复用该期已出好的插画（竖版 / 方版），不重新生成，避免废图。
//
// 用法：
//   node make_image_note.mjs --spec <spec.json> --out-dir <dir> [--report <report.json>]
//   node make_image_note.mjs --spec <spec.json> --validate        # 只校验文案放不放得下，不出图、不需要插画
//
// spec.json 结构（文案与版式分离；art* 字段都有默认值，通常不用写）：
// {
//   "name": "<slug>",                          // 必填：用来定位 ../插画-<name>-竖版.png 等配图
//   "brand": "粽子AI世界",
//   "kicker": "对话微软 CEO 纳德拉",
//   "title": "软件第一次有了|**边际成本**",       // `|` 断行，`**词**` 染橙
//   "subtitle": "他讲完功能，自己把话题拐到了账本上",
//   "pages": [ … ]
// }
//
// 页面 kind：
//   cover   封面：kicker + 标题 + 副标题 + 满幅方版插画（人物落在画面中央）
//   lead    导语页：heading + paras，纯文字
//   figure  整幅大图页：竖版插画近全幅（人物完整）+ 一行图注
//   points  要点页：heading + items（自动编号）
//   section 分节正文页：no + heading + paras [+ closing]
//   closing 收尾页：heading + paras + closing
// 每页可覆盖：art(portrait|square|wide)、artPos(CSS background-position)、artHeight、artTop、out(文件名)
//
// 行内标记：**词** 朱红橙加粗；==词== 朱红橙下划线。
// 图文笔记的图内不写来源块（来源只留在文章里）；导流写在正文文案 正文-<slug>-图文笔记.md 的末行。
// 退出码：0 完成 / 1 配图缺失 / 2 文案放不下或参数错 / 3 找不到浏览器

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

const PAPER = "#F5F1E9";
const ACCENT = "#E8552D";
const INK = "#2B2B2B";

const W = 1080;
const H = 1440;
const PADX = 96;
const TOP = 92;
const FOOT = 92;
const TEXTW = W - PADX * 2;

// 版式默认值（改这里等于改所有期的图文笔记版式）
const COVER_ART_TOP = 520;
const COVER_ART_POS = "center 100%"; // 插画里人物在下半幅，下对齐裁切才让他们落在画面中央
const FIGURE_ART_TOP = 140;
const FIGURE_CAPTION_H = 150;
const FIGURE_ART_POS = "center 100%";
const BAND_H = 400;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--validate") out.validate = true;
    else if (a.startsWith("--")) out[a.slice(2)] = argv[++i];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const validateOnly = !!args.validate;
const USAGE =
  "用法: node make_image_note.mjs --spec <spec.json> --out-dir <dir> [--report <report.json>] [--validate]";
if (args.help || !args.spec || (!validateOnly && !args["out-dir"])) {
  console.log(USAGE);
  process.exit(args.help ? 0 : 2);
}

const specPath = resolve(args.spec);
if (!existsSync(specPath)) {
  console.error(`找不到 spec: ${specPath}`);
  process.exit(2);
}
const spec = JSON.parse(readFileSync(specPath, "utf8"));
const specDir = dirname(specPath);
const resolveLocal = (p) => (/^([A-Za-z]:|[\\/])/.test(p) ? p : resolve(specDir, p));

if (!spec.name) {
  console.error("spec 缺少 name 字段（用来定位插画文件）");
  process.exit(2);
}

// ---- 配图：显式路径优先，否则按 name 找本期已出好的插画 ----
const ART_SPEC_KEY = { portrait: "artPortrait", square: "artSquare", wide: "artWide" };
const ART_DEFAULT_REL = {
  portrait: (n) => `../插画-${n}-竖版.png`,
  square: (n) => `../插画-${n}-方版.png`,
  wide: (n) => `../封面-${n}-横版.png`,
};

function artPathFor(kind) {
  if (!kind) return null;
  const explicit = spec[ART_SPEC_KEY[kind]];
  const rel = explicit || ART_DEFAULT_REL[kind](spec.name);
  const p = resolveLocal(rel);
  return existsSync(p) ? p : null;
}
function resolveArtKind(preferred) {
  for (const k of [preferred, "portrait", "square", "wide"]) {
    if (artPathFor(k)) return k;
  }
  return null;
}
const hasAnyArt = ["portrait", "square", "wide"].some((k) => artPathFor(k));

const artCache = new Map();
function artUri(kind) {
  const p = artPathFor(kind);
  if (!p) return null;
  if (!artCache.has(p)) artCache.set(p, `data:image/png;base64,${readFileSync(p).toString("base64")}`);
  return artCache.get(p);
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const plain = (s) => String(s).replace(/\*\*/g, "").replace(/==/g, "");
const rich = (s) =>
  esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<span class="hl">$1</span>')
    .replace(/==([^=]+)==/g, '<span class="ul">$1</span>');

// ---- 字宽估算（中文 1em，拉丁 ~0.56em）：自适应字号 + 判定「放不下」 ----
const charEm = (ch) => {
  const cp = ch.codePointAt(0);
  if (/[A-Za-z0-9@#$%&]/.test(ch)) return 0.56;
  if (ch === " " || ch === "·") return 0.34;
  if (cp >= 0x2e80) return 1.0;
  return 0.4;
};
const widthEm = (s) => [...plain(s)].reduce((a, ch) => a + charEm(ch), 0);

function fitTitleLines(lines, availW, availH, base, min) {
  if (!lines.length) return { fs: 0, ok: true, overflow: 0, height: 0 };
  const widest = Math.max(1, ...lines.map(widthEm));
  const byWidth = Math.floor(availW / (widest * 1.02));
  let fs = Math.max(min, Math.min(base, byWidth));
  const heightAt = (s) => lines.length * s * 1.18;
  for (; fs > min; fs -= 2) if (heightAt(fs) <= availH) break;
  const height = heightAt(fs);
  return { fs, ok: height <= availH, overflow: Math.max(0, Math.round(height - availH)), height };
}
function titleHtml(lines, fs) {
  return lines.map((l) => `<div class="tl" style="font-size:${fs}px">${rich(l)}</div>`).join("");
}
function blockHeight(texts, fs, availW, lh, gap) {
  let h = 0;
  texts.forEach((t, i) => {
    const cpl = Math.max(1, availW / fs);
    h += Math.max(1, Math.ceil(widthEm(t) / cpl)) * fs * lh + (i < texts.length - 1 ? gap : 0);
  });
  return h;
}
function fitText(texts, availW, availH, base, min, lh, gap) {
  let fs = base;
  for (; fs > min; fs -= 2) if (blockHeight(texts, fs, availW, lh, gap) <= availH) break;
  const height = blockHeight(texts, fs, availW, lh, gap);
  return { fs, ok: height <= availH, overflow: Math.max(0, Math.round(height - availH)) };
}

const css = `
* { margin:0; padding:0; box-sizing:border-box; }
html,body { background:${PAPER}; }
.cv { position:relative; overflow:hidden; background:${PAPER}; color:${INK};
  font-family:"Microsoft YaHei","PingFang SC",sans-serif; -webkit-font-smoothing:antialiased; }
.grain { position:absolute; inset:0; pointer-events:none; z-index:9;
  background: radial-gradient(115% 85% at 10% 2%, rgba(255,255,255,.50) 0%, rgba(255,255,255,0) 52%),
              radial-gradient(85% 70% at 92% 100%, rgba(232,85,45,.05) 0%, rgba(232,85,45,0) 62%); }
.hl { color:${ACCENT}; font-weight:700; }
.ul { color:${ACCENT}; font-weight:700; text-decoration:underline;
  text-decoration-color:rgba(232,85,45,.45); text-underline-offset:8px; text-decoration-thickness:4px; }
.rule { width:84px; height:9px; background:${ACCENT}; }
.kick { font-size:32px; font-weight:700; color:${ACCENT}; letter-spacing:.10em; }
.tl { font-weight:800; line-height:1.15; letter-spacing:-.005em; }
.para { font-weight:400; letter-spacing:.01em; }
.lead { color:rgba(43,43,43,.66); }
.cap { color:rgba(43,43,43,.55); }
.brand { font-size:27px; letter-spacing:.20em; color:rgba(43,43,43,.84); font-weight:700; }
.latin { font-family:Georgia,"Times New Roman",serif; font-size:20px; letter-spacing:.26em; color:rgba(43,43,43,.42); }
.no { font-family:Georgia,"Times New Roman",serif; font-weight:800; color:${ACCENT}; line-height:1; font-variant-numeric:tabular-nums; }
.art { position:absolute; inset:0; background-size:cover; background-repeat:no-repeat; }
`;

const htmlDoc = (body) => `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${body}</body></html>`;

let chrome = null;
function shot(body, w, h, outPath) {
  const dir = join(tmpdir(), "zongzi-imgnote-" + randomUUID());
  mkdirSync(dir, { recursive: true });
  const htmlPath = join(dir, "p.html");
  writeFileSync(htmlPath, htmlDoc(body), "utf8");
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
      "--default-background-color=00000000",
      `--window-size=${w},${h}`,
      `--screenshot=${outPath}`,
      "file:///" + htmlPath.replace(/\\/g, "/"),
    ],
    { stdio: "pipe", timeout: 60000 },
  );
  rmSync(dir, { recursive: true, force: true });
  return outPath;
}

const brand = spec.brand || "粽子AI世界";
const footer = `<div style="position:absolute;left:${PADX}px;right:${PADX}px;bottom:0;height:${FOOT}px;
  border-top:1px solid rgba(43,43,43,.10);display:flex;align-items:center;justify-content:space-between">
  <div class="brand">${esc(brand)}</div><div class="latin">ZONGZI AI WORLD</div></div>`;

// artBand(top, bottomOffset)：bottomOffset 是「距页面底部的偏移」，不是绝对 y
function artBand(kind, top, bottomOffset, posOverride, warn) {
  const resolved = resolveArtKind(kind);
  if (!resolved) {
    warn.push(`配图缺失：找不到 ${kind} 插画（预期 ../插画-${spec.name}-竖版.png 或 -方版.png）`);
    return { html: "", art: null };
  }
  const pos =
    posOverride ||
    (resolved === "portrait" ? "center 32%" : resolved === "wide" ? "center 34%" : "center 40%");
  return {
    html: `<div style="position:absolute;left:0;right:0;top:${top}px;bottom:${bottomOffset}px;overflow:hidden">
      <div class="art" style="background-image:url('${artUri(resolved)}');background-position:${pos}"></div></div>`,
    art: resolved,
  };
}

function renderPage(page, index) {
  const label = `第 ${index + 1} 页（${page.kind}）`;
  const errors = [];
  const warns = [];
  const fail = (msg, overflow) => errors.push(`${label}${msg}${overflow ? `，超出约 ${overflow}px` : ""}`);

  if (page.kind === "cover") {
    const lines = String(spec.title || "").split("|").map((s) => s.trim()).filter(Boolean);
    if (!lines.length) fail("缺少 title");
    const artTop = page.artTop || spec.coverArtTop || COVER_ART_TOP;
    const availH = artTop - TOP - 40;
    const t = fitTitleLines(lines, TEXTW, availH - 200, 96, 56);
    if (!t.ok) fail("标题放不下", t.overflow);
    const lead = spec.subtitle
      ? `<div class="lead" style="font-size:36px;line-height:1.62;margin-top:36px">${rich(spec.subtitle)}</div>`
      : "";
    const band = artBand(page.art || "square", artTop, FOOT, page.artPos || COVER_ART_POS, warns);
    if (hasAnyArt && !band.art) fail("封面没拿到配图");
    const inner = `<div style="position:absolute;left:${PADX}px;right:${PADX}px;top:${TOP}px">
        <div class="rule"></div>
        ${spec.kicker ? `<div class="kick" style="margin-top:30px">${esc(spec.kicker)}</div>` : ""}
        <div style="margin-top:34px">${titleHtml(lines, t.fs)}</div>
        ${lead}
      </div>${band.html}`;
    return { html: inner, fs: t.fs, art: band.art, errors, warns };
  }

  if (page.kind === "figure") {
    const bandTop = page.artTop || FIGURE_ART_TOP;
    const captionH = page.caption ? FIGURE_CAPTION_H : 40;
    const bandH = page.artHeight || H - FOOT - bandTop - captionH;
    const band = artBand(
      page.art || "portrait",
      bandTop,
      H - bandTop - bandH,
      page.artPos || FIGURE_ART_POS,
      warns,
    );
    if (hasAnyArt && !band.art) fail("整幅图页没拿到配图");
    const caption = page.caption
      ? `<div style="position:absolute;left:${PADX}px;right:${PADX}px;top:${bandTop + bandH + 40}px">
          <div class="cap" style="font-size:27px;line-height:1.6">${rich(page.caption)}</div></div>`
      : "";
    return { html: `${band.html}${caption}`, fs: 0, art: band.art, errors, warns };
  }

  const hasArt = !!page.art;
  const bandH = page.artHeight || BAND_H;
  const bottomOfText = hasArt ? H - FOOT - bandH - 30 : H - FOOT - 40;
  const bandHtml = hasArt ? artBand(page.art, H - FOOT - bandH, FOOT, page.artPos, warns).html : "";

  if (page.kind === "points") {
    const headFs = 46;
    const headH = 9 + (page.heading ? 34 + headFs * 1.3 : 0);
    const blockTop = TOP + headH;
    const availH = bottomOfText - blockTop;
    const items = page.items || [];
    if (!items.length) fail("要点页没有 items");
    const f = fitText(items, TEXTW - 70, availH, 37, 26, 1.66, 30);
    if (!f.ok) fail("要点放不下（删减文字或拆成两页）", f.overflow);
    const rows = items
      .map(
        (it, i) => `<div style="display:flex;gap:26px;margin-top:${i ? 30 : 0}px">
          <div class="no" style="font-size:${f.fs}px;padding-top:${Math.round(f.fs * 0.14)}px">${String(i + 1).padStart(2, "0")}</div>
          <div class="para" style="flex:1;font-size:${f.fs}px;line-height:1.66">${rich(it)}</div>
        </div>`,
      )
      .join("");
    const inner = `<div style="position:absolute;left:${PADX}px;right:${PADX}px;top:${TOP}px">
        <div class="rule"></div>
        ${page.heading ? `<div style="font-size:${headFs}px;font-weight:800;margin-top:34px;letter-spacing:.02em">${rich(page.heading)}</div>` : ""}
      </div>
      <div style="position:absolute;left:${PADX}px;right:${PADX}px;top:${blockTop}px;height:${availH}px;
        display:flex;flex-direction:column;justify-content:center">${rows}</div>
      ${bandHtml}`;
    return { html: inner, fs: f.fs, art: null, errors, warns };
  }

  // lead / section / closing
  const noBlock = page.no ? `<div class="no" style="font-size:64px">${esc(page.no)}</div>` : "";
  const headTop = page.no ? 30 : 34;
  const headBase = page.kind === "closing" ? 62 : page.kind === "lead" ? 58 : 56;
  const headLines = page.heading
    ? String(page.heading).split("|").map((s) => s.trim()).filter(Boolean)
    : [];
  const t = fitTitleLines(headLines, TEXTW, 220, headBase, 34);
  if (headLines.length && !t.ok) fail("小标题放不下", t.overflow);
  const headH = 9 + (page.no ? 64 + headTop : 0) + (headLines.length ? t.height + headTop + 8 : 0);
  const blockTop = TOP + headH;
  const paras = page.paras || [];
  const closingH = page.closing ? 150 : 0;
  const availH = bottomOfText - blockTop - closingH;
  const f = fitText(paras, TEXTW, availH, 37, 26, 1.8, 34);
  if (!f.ok) fail("正文放不下（删减文字或拆页）", f.overflow);
  const paraRows = paras
    .map((p, i) => `<div class="para" style="font-size:${f.fs}px;line-height:1.8;margin-top:${i ? 34 : 0}px">${rich(p)}</div>`)
    .join("");
  const closing = page.closing
    ? `<div style="margin-top:52px">
        <div style="font-size:44px;font-weight:800;line-height:1.5">${rich(page.closing)}</div></div>`
    : "";
  const inner = `<div style="position:absolute;left:${PADX}px;right:${PADX}px;top:${TOP}px">
      <div class="rule"></div>${noBlock}
      ${headLines.length ? `<div style="margin-top:${headTop - 8}px">${titleHtml(headLines, t.fs)}</div>` : ""}
    </div>
    <div style="position:absolute;left:${PADX}px;right:${PADX}px;top:${blockTop}px;height:${availH + closingH}px;
      display:flex;flex-direction:column;justify-content:center">${paraRows}${closing}</div>
    ${bandHtml}`;
  return { html: inner, fs: f.fs, art: null, errors, warns };
}

function writeReport(obj) {
  if (!args.report) return;
  const p = resolve(args.report);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(obj, null, 2), "utf8");
}

// ---------- pass 1：排版与校验（不需要浏览器） ----------
const pages = spec.pages || [];
if (!pages.length) {
  console.error("spec.pages 为空");
  process.exit(2);
}

const planned = pages.map((page, i) => {
  const out = page.out || `图文笔记-${i + 1}-${page.name || page.kind}.png`;
  const r = renderPage(page, i);
  return { page: i + 1, kind: page.kind, file: out, fs: r.fs, art: r.art, errors: r.errors, warns: r.warns, html: r.html };
});

const errors = planned.flatMap((p) => p.errors);
const warnings = planned.flatMap((p) => p.warns);
const report = {
  ok: errors.length === 0,
  mode: validateOnly ? "validate" : "render",
  name: spec.name,
  count: planned.length,
  pages: planned.map(({ html, ...rest }) => rest),
  warnings,
  errors,
};

function abortWithErrors() {
  console.error(`图文笔记校验失败（${errors.length} 处）：`);
  errors.forEach((e) => console.error("  - " + e));
  console.error("提示：删减该页文字、把长页拆成两页，或缩短标题；文案阶段可以先用 --validate 自检。");
  writeReport(report);
  process.exit(2);
}

if (validateOnly) {
  if (errors.length) abortWithErrors();
  console.log(`图文笔记校验通过：${planned.length} 页`);
  planned.forEach((p) => console.log(`  ${String(p.page).padStart(2, "0")} ${p.kind.padEnd(7)} fs=${p.fs} ${p.file}`));
  warnings.forEach((w) => console.log("  WARN " + w));
  writeReport(report);
  process.exit(0);
}

// ---------- pass 2：出图 ----------
// 插画还没出（比如 -NoArt 那轮）就先跳过，不算失败
if (!hasAnyArt) {
  report.skipped = "no-art";
  report.ok = true;
  console.log(`图文笔记跳过：本期还没有插画（${spec.name}）`);
  writeReport(report);
  process.exit(0);
}

if (errors.length) abortWithErrors();

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean);
chrome = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chrome) {
  console.error("找不到 Chrome/Edge");
  process.exit(3);
}

// 注意：Chrome 的 --screenshot 只认绝对路径，相对路径会静默不写盘
const outDir = resolve(args["out-dir"]);
mkdirSync(outDir, { recursive: true });

for (const item of planned) {
  const outPath = join(outDir, item.file);
  shot(
    `<div class="cv" style="width:${W}px;height:${H}px">${item.html}${footer}<div class="grain"></div></div>`,
    W,
    H,
    outPath,
  );
  if (!existsSync(outPath)) {
    console.error(`Chrome 没有写出文件: ${outPath}`);
    process.exit(1);
  }
}

console.log(`图文笔记 ${planned.length} 页 -> ${outDir}`);
planned.forEach((p) => console.log(`  ${String(p.page).padStart(2, "0")} ${p.kind.padEnd(7)} fs=${String(p.fs).padStart(3)} ${p.file}`));
warnings.forEach((w) => console.log("  WARN " + w));

report.produced = planned.map((p) => join(outDir, p.file));
writeReport(report);

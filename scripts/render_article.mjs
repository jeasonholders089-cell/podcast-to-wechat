#!/usr/bin/env node
// Markdown → 微信公众号可粘贴 HTML（内联样式）
// 用法：node render_article.mjs --in <md> --out <html> [--template podcast-interview] [--report <json>]

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_ROOT = resolve(HERE, "..", "templates");

function parseArgs(argv) {
  const out = { template: "podcast-interview" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a.startsWith("--")) out[a.slice(2)] = argv[++i];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.in || !args.out) {
  console.log(`用法: node render_article.mjs --in <md> --out <html> [--template podcast-interview] [--report <json>]`);
  process.exit(args.help ? 0 : 2);
}

const templatePath = join(TEMPLATE_ROOT, args.template, "template.json");
if (!existsSync(templatePath)) {
  console.error(`找不到模板: ${templatePath}`);
  process.exit(2);
}
const T = JSON.parse(readFileSync(templatePath, "utf8"));
const S = T.styles;
const RULES = T.rules ?? {};

const stats = {
  template: T.id,
  headings_dropped_h1: 0,
  images_dropped: 0,
  external_links_stripped: 0,
  sections: 0,
  speaker_turns: 0,
  shortest_turn_chars: null,
  shortest_turn: "",
  notes: 0,
  source_blocks: 0,
  body_chars: 0,
};

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// 行内处理：**粗体** → 朱红橙；[文字](链接) → 文字；![图](路径) → 丢弃
function inline(text) {
  let t = text;
  t = t.replace(/!\[[^\]]*\]\(([^)]*)\)/g, () => {
    stats.images_dropped++;
    return "";
  });
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^)]*)\)/g, (_m, label) => {
    stats.external_links_stripped++;
    return label;
  });
  t = t.replace(/\[([^\]]+)\]\(([^)]*)\)/g, "$1");
  t = t.replace(/\*\*([^*]+)\*\*/g, `<strong style="${S.strong}">$1</strong>`);
  t = t.replace(/`([^`]+)`/g, "$1");
  return esc(t).replace(/&lt;strong style="([^"]*)"&gt;/g, '<strong style="$1">').replace(/&lt;\/strong&gt;/g, "</strong>");
}

const lines = readFileSync(args.in, "utf8").replace(/\r\n/g, "\n").split("\n");

const blocks = [];
let mode = "lead"; // lead | body
let current = null; // {kind:'section'|'source'|'note', title, items:[]}
let paragraph = [];
let sectionIndex = 0;

function flushParagraph() {
  if (!paragraph.length) return;
  const text = paragraph.join(" ").trim();
  paragraph = [];
  if (!text) return;
  const speaker = text.match(/^\*\*([^*]{1,10})\*\*[：:]\s*(.+)$/);
  if (speaker && !/[。！？]$/.test(speaker[1])) {
    const who = speaker[1].trim();
    const said = speaker[2].trim();
    stats.speaker_turns++;
    if (stats.shortest_turn_chars === null || said.length < stats.shortest_turn_chars) {
      stats.shortest_turn_chars = said.length;
      stats.shortest_turn = `${who}：${said}`.slice(0, 60);
    }
    blocks.push({
      kind: "speaker",
      who,
      said,
    });
  } else {
    blocks.push({ kind: mode === "lead" ? "lead" : "para", text });
  }
}

function closeBlock() {
  if (current) {
    blocks.push(current);
    current = null;
  }
}

for (const raw of lines) {
  const line = raw.trimEnd();
  const trimmed = line.trim();

  if (/^#\s+/.test(trimmed)) {
    stats.headings_dropped_h1++;
    continue;
  }

  const h2 = trimmed.match(/^##\s+(.*)$/);
  if (h2) {
    flushParagraph();
    closeBlock();
    mode = "body";
    const title = h2[1].trim();
    if (/^来源/.test(title)) {
      current = { kind: "source", title, items: [] };
      stats.source_blocks++;
    } else {
      stats.sections++;
      // 标题里已经写了「01 xxx」就用它，不要重复编号
      const explicit = title.match(/^(\d{1,2})[\.、\s]+(.*)$/);
      const titleText = explicit ? explicit[2].trim() : title;
      // 「主要观点」这类汇总小节不参与编号
      const isSummary = /^(主要观点|核心观点|要点)$/.test(titleText);
      const numbered = !!explicit || !isSummary;
      if (numbered) sectionIndex = explicit ? Number(explicit[1]) : sectionIndex + 1;
      blocks.push({ kind: "section", title: titleText, index: numbered ? sectionIndex : null });
    }
    continue;
  }

  const quote = trimmed.match(/^>\s?(.*)$/);
  if (quote) {
    flushParagraph();
    closeBlock();
    current = { kind: "note", text: quote[1] };
    stats.notes++;
    continue;
  }

  const bullet = trimmed.match(/^[-*]\s+(.*)$/);
  if (bullet) {
    flushParagraph();
    if (current && current.kind === "source") current.items.push(bullet[1]);
    else blocks.push({ kind: "bullet", text: bullet[1] });
    continue;
  }

  if (!trimmed) {
    flushParagraph();
    continue;
  }

  if (current && current.kind === "note") {
    current.text += ` ${trimmed}`;
    continue;
  }
  paragraph.push(trimmed);
}
flushParagraph();
closeBlock();

const html = [];
html.push(`<div style="${S.wrapper}">`);
for (const b of blocks) {
  if (b.kind === "lead") {
    html.push(`<p style="${S.lead}">${inline(b.text)}</p>`);
  } else if (b.kind === "para") {
    html.push(`<p style="${S.body}">${inline(b.text)}</p>`);
  } else if (b.kind === "bullet") {
    html.push(`<p style="${S.bullet}">· ${inline(b.text)}</p>`);
  } else if (b.kind === "speaker") {
    html.push(`<p style="${S.speakerPara}"><span style="${S.speakerLabel}">${esc(b.who)}</span>${inline(b.said)}</p>`);
  } else if (b.kind === "section") {
    const num =
      RULES.autoNumberSections && b.index
        ? `<span style="${S.sectionNumber}">${String(b.index).padStart(2, "0")}</span>`
        : "";
    html.push(`<h2 style="${S.sectionTitle}">${num}${inline(b.title)}</h2>`);
  } else if (b.kind === "source") {
    const rows = b.items
      .map((it) => {
        const m = it.match(/^([^：:]{1,6})[：:]\s*(.*)$/);
        const label = m ? m[1] : "";
        const value = m ? m[2] : it;
        return `<p style="${S.bullet}">${label ? `<span style="${S.sourceLabel}">${esc(label)}：</span>` : ""}${inline(value)}</p>`;
      })
      .join("");
    html.push(`<div style="${S.sourceBox}">${rows || `<p style="${S.bullet}">（来源信息待补）</p>`}</div>`);
  } else if (b.kind === "note") {
    html.push(`<div style="${S.note}"><p style="${S.noteTitle}">编译说明</p><p style="margin:0">${inline(b.text)}</p></div>`);
  }
}
html.push("</div>");

const out = html.join("\n");
writeFileSync(args.out, out, "utf8");

stats.body_chars = out.replace(/<[^>]+>/g, "").replace(/\s+/g, "").length;
const imgCount = (out.match(/<img/g) || []).length;
const extLinks = (out.match(/href="https?:/g) || []).length;

const report = {
  ...stats,
  out: args.out,
  html_img_tags: imgCount,
  html_external_links: extLinks,
  html_h1_tags: (out.match(/<h1[\s>]/gi) || []).length,
  rules: RULES,
  // ok 只表示「输出是否符合正文规范」：0 图、0 外链、无 H1
  ok: imgCount === 0 && extLinks === 0 && (out.match(/<h1[\s>]/gi) || []).length === 0,
};

if (args.report) writeFileSync(args.report, JSON.stringify(report, null, 2), "utf8");
console.log(JSON.stringify(report, null, 2));

// 微信公众号平台规则机检（产线共用逻辑，不要在两处各写一份）
//
// 依据见 references/platform-rules.md，核心三条：
//   1. 《人工智能生成合成内容标识办法》第十条 + 微信 2025-08-31 公告：发布 AI 生成合成内容须主动声明
//   2. 《微信公众平台运营规范》4.11 / 2024-02 标题夸大营销公告：标题不得夸张、惊悚、断章取义
//   3. 3.6.1.5：未获独家授权的翻译、采访稿整理不得声明原创（本产线一律不勾原创，见 platform-rules.md）
//
// 分级原则：踩红线用 FAIL 拦住推送；口径风险用 WARN 提示人工确认，不阻断。

/** 标题党 / 夸大营销词表：出现即 FAIL（4.11 + 2024-02 公告列举的典型词） */
export const TITLE_BAIT = [
  "震惊", "惊呆", "速看", "速转", "删前", "紧急", "刚刚", "重磅",
  "全网", "疯传", "沸腾", "炸了", "彻底", "史上最", "不看后悔", "必看",
  "内幕", "真相曝光", "逆天", "吊打", "封杀", "史上", "绝了",
];

/** 涉企贬损 / 定性词：出现在标题里要确认是"转述嘉宾观点"，否则可能踩 9.2 不实或夸大攻击 */
export const DEFAMING = ["幻觉", "骗局", "崩盘", "造假", "割韭菜", "末日", "完蛋", "收智商税"];

/** 投资类选题词：正文出现即提示补"不构成投资建议"（非官方强制，但降低误导认定概率） */
export const INVESTING = [
  "股价", "估值", "市值", "泡沫", "买入", "卖出", "持仓", "仓位",
  "牛市", "熊市", "回报率", "收益率", "抄底", "做空", "目标价",
];

/** AI 声明必须同时出现的两个信号词。
 *  不用「AI 生成」做信号：正文里"AI 生成的内容"是话题本身，会误判；
 *  用「人工编译 / AI 辅助」这组只可能出现在声明句里的词。 */
export const AI_DECLARE_SIGNALS = ["人工编译", "AI 辅助"];

/** 来源四项（渲染成小字加灰的来源块里必须都在） */
export const SOURCE_FIELDS = ["节目", "嘉宾", "发布", "原视频"];

const cjkLen = (s) => [...(s ?? "")].length;

function hitAny(text, words) {
  const s = text ?? "";
  return words.filter((w) => s.includes(w));
}

/**
 * @param {object} o
 * @param {string} o.title        推送标题 / 贴图标题
 * @param {string} [o.digest]     摘要（≤120）
 * @param {string} [o.contentHtml] 正文 HTML（文章）或纯文本（贴图）
 * @param {"article"|"newspic"} [o.kind]
 * @returns {{fail: string[], warn: string[]}}
 */
export function inspect({ title = "", digest = "", contentHtml = "", kind = "article" }) {
  const fail = [];
  const warn = [];
  const isNote = kind === "newspic";

  // ---- 标题字数 ----
  // 文章：draft/add 硬限 32；贴图：2026 版正标题约 20 字（以编辑器为准）
  const titleLimit = isNote ? 20 : 32;
  const tl = cjkLen(title);
  if (tl > titleLimit) fail.push(`标题 ${tl} 字 > ${titleLimit} 字上限（${isNote ? "贴图正标题" : "draft/add 硬限"}）`);
  if (tl < 8) warn.push(`标题只有 ${tl} 字，搜一搜关键词权重会偏弱`);

  // ---- 标题党 ----
  const bait = hitAny(title, TITLE_BAIT);
  if (bait.length) fail.push(`标题含夸大/惊悚词：${bait.join("、")}（运营规范 4.11）`);

  // ---- 标题涉企定性 ----
  const defame = hitAny(title, DEFAMING);
  if (defame.length) warn.push(`标题含定性词 ${defame.join("、")}，确认是"转述嘉宾观点"而不是本号判断（规范 9.2）`);

  if (!isNote) {
    // ---- 摘要 ----
    // 不填摘要时卡片抓正文前 54 字；100–120 字才能同时喂搜一搜和转发卡片
    const dl = cjkLen(digest);
    if (!dl) fail.push("缺摘要：转发卡片会抓正文前 54 字，搜一搜也少一路关键词");
    else if (dl > 120) fail.push(`摘要 ${dl} 字 > 120 字上限`);
    else if (dl < 100) warn.push(`摘要 ${dl} 字，建议 100–120 字（转发卡片 + 搜一搜长尾）`);

    // ---- AI 声明（标识办法第十条 + 微信 2025-08-31 公告）----
    const missingSignal = AI_DECLARE_SIGNALS.filter((s) => !(contentHtml ?? "").includes(s));
    if (missingSignal.length) {
      fail.push(
        `正文缺 AI 声明（缺 ${missingSignal.join(" / ")}）。在「## 来源」块最后加一行：` +
          "`- AI 说明：本文由人工编译与校对，AI 辅助整理，封面与插画由 AI 生成。`"
      );
    }

    // ---- 来源四项 ----
    const missingSrc = SOURCE_FIELDS.filter((f) => !(contentHtml ?? "").includes(f));
    if (missingSrc.length) fail.push(`来源块缺项：${missingSrc.join("、")}`);

    // ---- 投资类提示 ----
    const inv = hitAny(contentHtml, INVESTING);
    if (inv.length && !(contentHtml ?? "").includes("不构成投资建议")) {
      warn.push(`正文涉投资表述（${inv.slice(0, 4).join("、")}），建议在来源块前补「本文不构成任何投资建议」`);
    }
  }

  // ---- 通用版式硬门槛（与产物规范一致）----
  if (!isNote && contentHtml) {
    if (/<img/i.test(contentHtml)) fail.push("正文含 img 标签（规范要求 0 图）");
    if (/href="https?:/i.test(contentHtml)) fail.push("正文含外链（规范要求 0 外链）");
    if (/<h1[\s>]/i.test(contentHtml)) fail.push("正文含 H1（规范要求无 H1）");
  }

  return { fail, warn };
}

/** 给 CLI 和脚本共用的一段结果格式化 */
export function format(result) {
  const lines = [];
  for (const f of result.fail) lines.push(`FAIL  ${f}`);
  for (const w of result.warn) lines.push(`WARN  ${w}`);
  return lines.join("\n");
}

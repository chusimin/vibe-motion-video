// voice 模块共享文本工具:分词(中文按字 / 英文按空格)、时长估算、词级时间戳的比例分配。
// 这些函数被 providers(mock / elevenlabs 字符级合并)与 align(whisper 段级→词级)复用。

// 判断一个字符是否属于"CJK 表意/假名/谚文"等"按字成词"的文字。
// 命中者每个字符自成一个 token;否则按空格切词(英文/数字/拉丁)。
export function isCJKChar(ch) {
  const cp = ch.codePointAt(0);
  return (
    (cp >= 0x3040 && cp <= 0x30ff) ||   // 日文假名
    (cp >= 0x3400 && cp <= 0x4dbf) ||   // CJK 扩展 A
    (cp >= 0x4e00 && cp <= 0x9fff) ||   // CJK 基本
    (cp >= 0xf900 && cp <= 0xfaff) ||   // CJK 兼容
    (cp >= 0xac00 && cp <= 0xd7af) ||   // 谚文音节
    (cp >= 0x20000 && cp <= 0x2ffff)    // CJK 扩展 B+
  );
}

// 把一段文本切成"展示用 token"。规则:
//   - CJK 字符:每字一个 token(中文/日文按字滚动)。
//   - 连续的非 CJK、非空白:聚成一个英文/数字"词"。
//   - 标点单独成不可见停顿?—— 不,标点黏附到相邻 token,避免出现只有标点的字幕词。
// 返回 [{ text }],顺序与原文一致(仅去掉纯空白)。
export function tokenizeWords(text) {
  const s = (text || "").toString();
  const tokens = [];
  let buf = "";          // 正在累积的英文/数字词
  const flushBuf = () => { if (buf) { tokens.push({ text: buf }); buf = ""; } };

  for (const ch of s) {
    if (/\s/.test(ch)) {
      // 空白:英文词的分隔符
      flushBuf();
      continue;
    }
    if (isCJKChar(ch)) {
      flushBuf();
      tokens.push({ text: ch });
      continue;
    }
    // 标点:黏到上一个 token 尾部(若有),否则并入正在攒的英文词
    if (isPunct(ch)) {
      if (buf) { buf += ch; }
      else if (tokens.length) { tokens[tokens.length - 1].text += ch; }
      else { buf += ch; }
      continue;
    }
    // 普通拉丁/数字:累积成词
    buf += ch;
  }
  flushBuf();
  return tokens;
}

function isPunct(ch) {
  // 常见中英标点(用于黏附,不单独成词)
  return /[，。、！？；：·…—,.!?;:"'`~@#%^&*()_+\-=\[\]{}|\\/<>“”‘’（）《》【】]/.test(ch);
}

// 估算"权重":CJK 字按 1,英文词按其字符数(让长单词占更多时间)。最小 1。
export function tokenWeight(tok) {
  const t = tok.text || "";
  // 单个 CJK 字
  if ([...t].length === 1 && isCJKChar(t)) return 1;
  // 英文/数字词:用可见字符数(去标点)做权重,至少 1
  const visible = t.replace(/[^\p{L}\p{N}]/gu, "").length;
  return Math.max(1, visible);
}

// 估算一段文本的朗读时长(秒)。中文≈5 字/秒,英文≈3 词/秒,受 speed 影响。
// 实现:把每个 token 折算成"等效中文字数"(英文词≈按字符数/2.5 折算,最少 1),
// 再按 5 字/秒;最后整体除以 speed。给一个合理下限避免 0。
export function estimateDurationSec(text, speed = 1) {
  const toks = tokenizeWords(text);
  if (!toks.length) return 0.3;
  let cjk = 0;
  let enWords = 0;
  for (const tok of toks) {
    const t = tok.text;
    if ([...t].some(isCJKChar)) cjk += [...t].filter(isCJKChar).length;
    else enWords += 1;
  }
  // 中文:5 字/秒;英文:3 词/秒。两者相加。
  const sec = cjk / 5 + enWords / 3;
  const spd = Number.isFinite(speed) && speed > 0 ? speed : 1;
  return Math.max(0.3, sec / spd);
}

// ── 核心:把已知 text 的词,按"字符权重比例"分配进若干"时间锚段"。────────────
// anchors: [{ startSec, endSec, text? }] —— 来自 whisper 段级时间戳(text 可空)。
// 整体保证:words 覆盖 [0, totalDurationSec],startSec 单调不减,endSec≤totalDurationSec。
//
// 做法:
//   1) 先按 tokenizeWords 把已知 text 切成有序词。
//   2) 把这些词"摊"到 anchors 的总时间轴上 —— 不依赖 whisper 的文字内容(可能与脚本不符),
//      只用 whisper 段的"时间分布"作为节奏锚:按各 anchor 时长占比,决定多少个词落在该段,
//      段内再按字符权重均匀分。这样既贴合真实语速的快慢起伏,又保证文字 == 原始脚本。
export function distributeWordsOverAnchors(text, anchors, totalDurationSec) {
  const words = tokenizeWords(text);
  const total = clampPos(totalDurationSec);
  if (!words.length) return [];

  // 规整锚段:按时间升序、夹进 [0,total]、丢弃非正时长段;空则退化为单段 [0,total]。
  let segs = (anchors || [])
    .map((a) => ({ start: clamp01(a.startSec, total), end: clamp01(a.endSec, total) }))
    .filter((a) => a.end > a.start + 1e-6)
    .sort((a, b) => a.start - b.start);
  // 修复重叠:让段首尾相接、单调
  for (let i = 1; i < segs.length; i++) {
    if (segs[i].start < segs[i - 1].end) segs[i].start = segs[i - 1].end;
    if (segs[i].end < segs[i].start) segs[i].end = segs[i].start;
  }
  segs = segs.filter((a) => a.end > a.start + 1e-6);
  if (!segs.length) segs = [{ start: 0, end: total }];

  // 各 token 权重 & 前缀和
  const w = words.map(tokenWeight);
  const totalW = w.reduce((a, b) => a + b, 0) || words.length;

  // 段总时长(用于按比例分配词数)
  const segDur = segs.map((s) => s.end - s.start);
  const segTotal = segDur.reduce((a, b) => a + b, 0) || total;

  // 给每个 token 一个全局"权重位置" wPos∈[0,totalW],映射到全局时间 [0, segTotal 投影]。
  // 为贴合语速起伏:把"权重轴"按 anchor 段的时长比例切块——
  // 即把 [0,totalW] 按 segDur 占比划成若干权重区间,每个权重区间线性映射到对应 anchor 的时间区间。
  // 这样"词的累计权重"在慢段走得慢(占时间多)、快段走得快,贴近真实朗读。
  const wEdges = [0];
  for (let i = 0; i < segs.length; i++) wEdges.push(wEdges[i] + totalW * (segDur[i] / segTotal));
  // 数值修正末端
  wEdges[wEdges.length - 1] = totalW;

  // 把全局权重位置 wp 映射到时间
  function wpToTime(wp) {
    // 落在哪个权重区间
    let i = 0;
    while (i < segs.length - 1 && wp > wEdges[i + 1]) i++;
    const w0 = wEdges[i], w1 = wEdges[i + 1] || totalW;
    const frac = w1 > w0 ? (wp - w0) / (w1 - w0) : 0;
    return segs[i].start + frac * (segs[i].end - segs[i].start);
  }

  const out = [];
  let acc = 0;
  let prevEnd = segs[0].start;
  for (let i = 0; i < words.length; i++) {
    const startWp = acc;
    acc += w[i];
    const endWp = acc;
    let startSec = wpToTime(startWp);
    let endSec = wpToTime(endWp);
    // 单调修复:start 不早于上一个 end;end 不早于 start(给最小 1ms)
    if (startSec < prevEnd) startSec = prevEnd;
    if (endSec < startSec + 1e-3) endSec = Math.min(total, startSec + 1e-3);
    startSec = round3(clamp01(startSec, total));
    endSec = round3(clamp01(endSec, total));
    if (endSec <= startSec) endSec = round3(Math.min(total, startSec + 0.001));
    out.push({ text: words[i].text, startSec, endSec });
    prevEnd = endSec;
  }
  // 最后一个词收尾贴到 total(避免尾巴空一截)
  if (out.length) out[out.length - 1].endSec = round3(total);
  return out;
}

// 均匀分布兜底:无任何时间锚时,把词在 [0,total] 上按权重均匀铺开。
export function distributeWordsUniform(text, totalDurationSec) {
  return distributeWordsOverAnchors(text, [{ startSec: 0, endSec: totalDurationSec }], totalDurationSec);
}

function clampPos(x) { const n = Number(x); return Number.isFinite(n) && n > 0 ? n : 0.3; }
function clamp01(x, total) { const n = Number(x) || 0; return Math.max(0, Math.min(total, n)); }
function round3(x) { return Math.round(x * 1000) / 1000; }

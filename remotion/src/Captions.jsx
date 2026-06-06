// Captions —— 词级字幕。读 words 时间戳(相对 scene 起点),逐词高亮当前词。
// 放在安全区底部、平台 UI 之上。样式由 config.captions.style 决定:
//   karaoke = 卡拉OK 整句显示+当前词高亮上色
//   block   = 当前短语整块大字(逐词推进,一次显示一小窗)
//   line    = 整句一行、当前词加重(轻量)
//   minimal = 仅当前词/短语,极简居中
//
// 字幕的时间基准:本组件被放在 scene 的 <Sequence> 内,useCurrentFrame() 即 scene 相对帧。
import React from "react";
import { useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import { GLOBAL_TEXT_STYLE } from "./fonts.js";
import { withAlpha } from "./theme.js";

// 当前时间(秒,scene 相对)
function useNowSec() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return frame / fps;
}

// 找到当前正在朗读的词索引;-1 表示还没开始或已结束。
function activeIndex(words, now) {
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (now >= (w.startSec ?? 0) && now < (w.endSec ?? 0)) return i;
  }
  // 词间空隙:落在上一个已结束词之后、下一个词之前 → 归到上一个(保持显示)
  let last = -1;
  for (let i = 0; i < words.length; i++) {
    if (now >= (words[i].endSec ?? 0)) last = i;
    else break;
  }
  return last;
}

// 把词按"短语窗口"分组(block/minimal 用):遇到句读或累计字数超阈值断一组。
function groupPhrases(words, maxChars = 12) {
  const groups = [];
  let cur = [];
  let len = 0;
  for (const w of words) {
    cur.push(w);
    len += (w.text || "").length;
    if (/[，。！？、,.!?；;]$/.test(w.text || "") || len >= maxChars) {
      groups.push(cur);
      cur = [];
      len = 0;
    }
  }
  if (cur.length) groups.push(cur);
  return groups;
}

export default function Captions({ caption, theme, safeArea, style = "karaoke", maxCharsPerLine = 14 }) {
  const now = useNowSec();
  const { width } = useVideoConfig();
  const { size, fonts, palette, accent } = theme;
  const words = Array.isArray(caption?.words) ? caption.words : [];

  // 没有词级数据但有整句文本:降级为静态整句(line 风格)
  const hasWords = words.length > 0;

  // 字幕带定位:贴安全区底,但留一点呼吸。
  const bottom = (safeArea.bottom ?? 60) * 0.55;
  const sidePad = Math.max(safeArea.left ?? 60, safeArea.right ?? 60);
  const boxMaxWidth = width - sidePad * 2;

  const baseBox = {
    position: "absolute",
    left: "50%",
    transform: "translateX(-50%)",
    bottom,
    maxWidth: boxMaxWidth,
    width: "max-content",
    textAlign: "center",
    ...GLOBAL_TEXT_STYLE,
    fontFamily: fonts.body,
  };

  if (!hasWords) {
    const text = caption?.text || "";
    if (!text) return null;
    return (
      <div
        style={{
          ...baseBox,
          fontWeight: 700,
          fontSize: size.caption,
          lineHeight: 1.3,
          color: palette.fg,
          textShadow: `0 2px 14px ${withAlpha("#000000", 0.6)}`,
          padding: `${size.small * 0.3}px ${size.body * 0.5}px`,
        }}
      >
        {text}
      </div>
    );
  }

  const ai = activeIndex(words, now);

  // ── karaoke / line:整句一行,当前词上色(karaoke 更醒目) ──
  if (style === "karaoke" || style === "line") {
    return (
      <div
        style={{
          ...baseBox,
          padding: `${size.small * 0.35}px ${size.body * 0.6}px`,
          borderRadius: size.small * 0.4,
          background: style === "karaoke" ? withAlpha("#000000", 0.42) : "transparent",
        }}
      >
        <span style={{ display: "inline" }}>
          {words.map((w, i) => {
            const spoken = i < ai;
            const active = i === ai;
            const color = active ? accent(0) : spoken ? palette.fg : withAlpha(palette.fg, 0.45);
            // 当前词轻微放大,做卡拉OK跳动
            const scale = active ? 1.0 : 1.0;
            return (
              <span
                key={i}
                style={{
                  color,
                  fontWeight: active ? 900 : 700,
                  fontSize: size.caption,
                  lineHeight: 1.28,
                  transition: "none",
                  textShadow: `0 2px 12px ${withAlpha("#000000", 0.55)}`,
                  display: "inline-block",
                  transform: `scale(${scale})`,
                }}
              >
                {w.text}
                {/* 中文不加空格;英文词间补空格 */}
                {/[a-zA-Z0-9]$/.test(w.text || "") ? " " : ""}
              </span>
            );
          })}
        </span>
      </div>
    );
  }

  // ── block / minimal:只显示当前短语窗口(大字),逐窗推进 ──
  const groups = groupPhrases(words, maxCharsPerLine);
  // 找到当前词所在的组
  let activeGroup = groups[0] || [];
  if (ai >= 0) {
    let acc = 0;
    for (const g of groups) {
      if (ai < acc + g.length) { activeGroup = g; break; }
      acc += g.length;
    }
  }
  const groupStartIdx = words.indexOf(activeGroup[0]);

  if (style === "minimal") {
    // 极简:仅当前词,居中超大
    const cur = words[Math.max(0, ai)] || activeGroup[0];
    return (
      <div
        style={{
          ...baseBox,
          fontWeight: 900,
          fontFamily: fonts.display,
          fontSize: size.caption * 1.15,
          color: palette.fg,
          textShadow: `0 2px 16px ${withAlpha("#000000", 0.6)}`,
        }}
      >
        {cur?.text || ""}
      </div>
    );
  }

  // block:当前短语整块,词内当前词高亮
  return (
    <div
      style={{
        ...baseBox,
        padding: `${size.small * 0.4}px ${size.body * 0.7}px`,
        borderRadius: size.small * 0.5,
        background: withAlpha("#000000", 0.5),
        fontFamily: fonts.display,
      }}
    >
      {activeGroup.map((w, j) => {
        const gi = groupStartIdx + j;
        const active = gi === ai;
        return (
          <span
            key={gi}
            style={{
              color: active ? accent(0) : palette.fg,
              fontWeight: 900,
              fontSize: size.caption * 1.05,
              lineHeight: 1.2,
              display: "inline-block",
            }}
          >
            {w.text}
            {/[a-zA-Z0-9]$/.test(w.text || "") ? " " : ""}
          </span>
        );
      })}
    </div>
  );
}

// BigTypeReveal —— 覆盖 title。editorial-saas 的开场招牌:
// 满屏巨字、左对齐可切边(出血)、负字距 800、逐行遮罩揭示(clip-path + spring),
// 亮底近黑字,关键词可染强调色;可选小标签在上方(对应 ObiN「Founder / Obin Studio」式 eyebrow)。
//
// props 与 _base/Title.jsx 同款:{ scene, theme, safeArea, captionsReserve, justify }
import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { GLOBAL_TEXT_STYLE } from "../../../fonts.js";
import { DISPLAY_TRACKING, DISPLAY_WEIGHT, splitEmphasis, maskReveal, smoothSpring } from "./_shared.jsx";

// 把标题切成「视觉行」:优先用显式换行;否则按词数粗分，让巨字占满高度而非缩成一行。
function toLines(text) {
  const t = String(text || "").trim();
  if (!t) return [];
  if (/\n/.test(t)) return t.split(/\s*\n\s*/).filter(Boolean);
  const words = t.split(/\s+/).filter(Boolean);
  // 英文按 ~2 词/行堆成巨字块;中文(无空格)整句一行。
  if (words.length <= 1) return [t];
  const perLine = words.length >= 6 ? 2 : (words.length >= 3 ? 2 : 1);
  const lines = [];
  for (let i = 0; i < words.length; i += perLine) lines.push(words.slice(i, i + perLine).join(" "));
  return lines;
}

export default function BigTypeReveal({ scene = {}, theme, safeArea, captionsReserve = 0 }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { motion, size, fonts, palette, accent } = theme;

  const title = scene.onScreenText || scene.visual?.value || scene.purpose || "";
  const eyebrow = scene.visual?.subtitle || scene.visual?.eyebrow || "";
  const lines = toLines(title);

  // 巨字:吃满高度,逼近出血。竖屏一行字宽可超出安全区左右(切边),用负 margin 让左缘咬住画面边。
  // 字号取 hero 再放大;按行数收敛防溢出。
  const lineCount = Math.max(1, lines.length);
  const fontSize = Math.round(size.hero * (lineCount >= 3 ? 0.92 : 1.12));

  const top = safeArea.top ?? 60;
  const left = safeArea.left ?? 60;
  const right = safeArea.right ?? 60;
  const bottom = (safeArea.bottom ?? 60) + captionsReserve;

  // eyebrow 入场
  const ebS = smoothSpring({ frame, fps, delay: 2, motion });
  const ebOpacity = interpolateClamp(ebS, 0, 1);

  return (
    <AbsoluteFill style={{ backgroundColor: palette.bg }}>
      <AbsoluteFill
        style={{
          paddingTop: top,
          paddingBottom: bottom,
          // 左缘切边:负内边距让巨字咬住画面左侧(出血感);右侧给一点呼吸
          paddingLeft: Math.round(left * 0.5),
          paddingRight: right,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "flex-start",
        }}
      >
        {eyebrow ? (
          <div
            style={{
              opacity: ebOpacity,
              transform: `translateY(${(1 - ebS) * 12}px)`,
              ...GLOBAL_TEXT_STYLE,
              fontFamily: fonts.body,
              fontWeight: 600,
              fontSize: size.small,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: accent(0),
              marginBottom: Math.round(fontSize * 0.18),
              marginLeft: Math.round(left * 0.5),
            }}
          >
            {eyebrow}
          </div>
        ) : null}

        {lines.map((line, li) => {
          // 逐行错峰揭示:每行晚 ~5 帧,平滑 spring 驱动遮罩升出。
          const s = smoothSpring({ frame, fps, delay: 4 + li * 5, motion });
          const reveal = maskReveal(s);
          const parts = splitEmphasis(line);
          return (
            <div
              key={li}
              style={{
                overflow: "hidden", // 让 clip-path 的「升出」有遮罩边界
                width: "100%",
              }}
            >
              <div
                style={{
                  ...reveal,
                  ...GLOBAL_TEXT_STYLE,
                  fontFamily: fonts.display,
                  fontWeight: DISPLAY_WEIGHT,
                  fontSize,
                  lineHeight: 1.0,
                  letterSpacing: DISPLAY_TRACKING,
                  color: palette.fg,
                  whiteSpace: "nowrap", // 巨字不换行 → 真切边出血
                }}
              >
                {parts.map((p, i) => (
                  <span key={i} style={{ color: p.accent ? accent(0) : palette.fg }}>
                    {p.text}
                    {p.trailing ? <span style={{ color: palette.fg }}>{p.trailing}</span> : null}
                    {i < parts.length - 1 ? " " : ""}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

function interpolateClamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

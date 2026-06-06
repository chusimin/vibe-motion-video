// BigTypeReveal —— 覆盖 title。editorial-saas 的开场招牌:
// 满屏巨字、左对齐可切边(出血)、负字距 800、逐行**快**砸入(snap overshoot ~6-9 帧到位),
// 之后**全程**缓慢横扫 + scale drift(永不静止),亮底近黑字,关键词可染强调色。
// 对标 ObiN「orph.network」满屏出血、字一直在涨/横移。
//
// props 与 _base/Title.jsx 同款:{ scene, theme, safeArea, captionsReserve, justify }
import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { GLOBAL_TEXT_STYLE } from "../../../fonts.js";
import {
  DISPLAY_TRACKING, DISPLAY_WEIGHT, splitEmphasis, maskReveal,
  snapSpring, shotProgress, driftScale, driftXY,
} from "./_shared.jsx";

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
  const { fps, durationInFrames } = useVideoConfig();
  const { size, fonts, palette, accent } = theme;

  const title = scene.onScreenText || scene.visual?.value || scene.purpose || "";
  const eyebrow = scene.visual?.subtitle || scene.visual?.eyebrow || "";
  const lines = toLines(title);

  // 巨字:吃满高度,逼近出血。字号再放大(比原来 +~12%),短词更狠,允许切边。
  const lineCount = Math.max(1, lines.length);
  const fontSize = Math.round(size.hero * (lineCount >= 3 ? 1.04 : 1.28));

  const top = safeArea.top ?? 60;
  const left = safeArea.left ?? 60;
  const right = safeArea.right ?? 60;
  const bottom = (safeArea.bottom ?? 60) + captionsReserve;

  // 镜头进度:驱动全程不静止的横扫 + scale drift。
  const t = shotProgress(frame, durationInFrames);
  // 整块持续:scale 1.0→1.07 缓推 + 缓慢左移横扫(像镜头慢慢扫过巨字),竖向极轻浮动。
  const blockScale = driftScale(t, 1.0, 1.07);
  const sweep = driftXY(t, { creepX: -fontSize * 0.16, ampY: fontSize * 0.012, loops: 1 });

  // eyebrow 快入场(snap)。
  const ebS = snapSpring({ frame, fps, delay: 1 });
  const ebOpacity = clamp01(ebS);

  return (
    <AbsoluteFill style={{ backgroundColor: palette.bg, overflow: "hidden" }}>
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
          // 整块持续运动:横扫 + 推进。transformOrigin 左中,保证向左出血而非缩小。
          transform: `translate(${sweep.x}px, ${sweep.y}px) scale(${blockScale})`,
          transformOrigin: "0% 50%",
          willChange: "transform",
        }}
      >
        {eyebrow ? (
          <div
            style={{
              opacity: ebOpacity,
              transform: `translateY(${(1 - ebS) * 16}px)`,
              ...GLOBAL_TEXT_STYLE,
              fontFamily: fonts.body,
              fontWeight: 600,
              fontSize: size.small,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: accent(0),
              marginBottom: Math.round(fontSize * 0.16),
              marginLeft: Math.round(left * 0.5),
            }}
          >
            {eyebrow}
          </div>
        ) : null}

        {lines.map((line, li) => {
          // 逐行**快**砸入:每行只晚 ~3 帧,snap overshoot(~6-9 帧到位),遮罩升出。
          const s = snapSpring({ frame, fps, delay: 2 + li * 3 });
          const reveal = maskReveal(s);
          // 每行额外的细微独立呼吸(行间错相,避免整块一坨):极轻字距脉动。
          const lineTrack = -0.03 + 0.006 * Math.sin(t * Math.PI * 2 + li * 1.3);
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
                  lineHeight: 0.98,
                  letterSpacing: `${lineTrack}em`,
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

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

// WordEmphasisKinetic —— 覆盖 kinetic-text。editorial-saas 的铺陈招牌:
// 词**快速逐个砸入**(snap overshoot,每词差 ~2 帧),**唯一关键词**额外 scale punch + 全程微跳;
// 整块持续极轻缩放/浮动,镜头内永不静止。字更大(h2 放大)。
// 对标 ObiN「Built around You, instead of us」——一帧一个焦点,但每帧都在动。
//
// props 与 _base/KineticText.jsx 同款:{ scene, theme, safeArea, captionsReserve, justify }
import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { SafeFrame } from "../../../lib/anim.jsx";
import { GLOBAL_TEXT_STYLE } from "../../../fonts.js";
import { splitEmphasis, snapSpring, shotProgress, driftScale } from "./_shared.jsx";

export default function WordEmphasisKinetic({ scene = {}, theme, safeArea, captionsReserve = 0, justify = "center" }) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const { size, fonts, palette, accent, layout } = theme;

  const text = scene.onScreenText || scene.vo || scene.purpose || "";
  const parts = splitEmphasis(text);
  const maxW = layout?.maxContentWidth || "94%";

  // 整句字号再放大(比原 h2 大 ~22%),少字时更冲。关键词额外更大。
  const wordSize = Math.round(size.h2 * 1.22);

  // 镜头进度:整块持续运动(永不静止)。
  const t = shotProgress(frame, durationInFrames);
  const blockScale = driftScale(t, 1.0, 1.05); // 整块缓推
  const blockY = Math.sin(t * Math.PI * 2) * (wordSize * 0.02); // 极轻整块浮动

  return (
    <SafeFrame safeArea={safeArea} extraBottom={captionsReserve} justify={justify}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          alignItems: "baseline",
          gap: `${wordSize * 0.1}px ${wordSize * 0.22}px`,
          maxWidth: maxW,
          transform: `translateY(${blockY}px) scale(${blockScale})`,
          transformOrigin: "center center",
          willChange: "transform",
        }}
      >
        {parts.map((p, i) => {
          // 词**快速逐个砸入**:每词差 ~2 帧,snap overshoot(~6 帧到位),从下方冲入。
          const base = snapSpring({ frame, fps, delay: 1 + i * 2 });
          const opacity = clamp01(base * 1.4);
          const y = (1 - clamp01(base)) * (wordSize * 0.3);

          // 关键词:落定后额外 scale punch(snap 越过 1)+ 全程微跳(永不静止)。
          let scale = 1;
          let color = palette.fg;
          if (p.accent) {
            const pop = snapSpring({ frame, fps, delay: 2 + parts.length * 2 });
            // pop 会越过 1(overshoot),直接当 scale → 砸进来时冲到 ~1.1 再收。
            const bob = 1 + 0.03 * Math.sin(t * Math.PI * 2 * 2); // 持续微跳
            scale = (0.7 + 0.3 * pop) * bob;
            color = accent(0);
          }

          return (
            <span
              key={i}
              style={{
                display: "inline-block",
                opacity,
                transform: `translateY(${y}px) scale(${scale})`,
                transformOrigin: "center bottom",
                ...GLOBAL_TEXT_STYLE,
                fontFamily: fonts.display,
                fontWeight: p.accent ? 800 : 600,
                fontSize: p.accent ? Math.round(wordSize * 1.12) : wordSize,
                lineHeight: 1.08,
                letterSpacing: "-0.02em",
                color,
              }}
            >
              {p.text}
              {p.trailing ? <span style={{ color: palette.fg, fontWeight: 600 }}>{p.trailing}</span> : null}
            </span>
          );
        })}
      </div>
    </SafeFrame>
  );
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

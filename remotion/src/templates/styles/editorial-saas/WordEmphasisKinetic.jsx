// WordEmphasisKinetic —— 覆盖 kinetic-text。editorial-saas 的铺陈招牌:
// 整句中性色,**唯一关键词**(显式 **包裹** 或末位实义词)换 accent + 轻微 scale pop。
// 对标 ObiN「Built around You, instead of us」「a story of experimentation」——
// 一帧一个焦点,克制到只有一个词在动/换色,其余整句静中性。
//
// props 与 _base/KineticText.jsx 同款:{ scene, theme, safeArea, captionsReserve, justify }
import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { SafeFrame } from "../../../lib/anim.jsx";
import { GLOBAL_TEXT_STYLE } from "../../../fonts.js";
import { splitEmphasis, smoothSpring } from "./_shared.jsx";

export default function WordEmphasisKinetic({ scene = {}, theme, safeArea, captionsReserve = 0, justify = "center" }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { motion, size, fonts, palette, accent, layout } = theme;

  const text = scene.onScreenText || scene.vo || scene.purpose || "";
  const parts = splitEmphasis(text);
  const maxW = layout?.maxContentWidth || "92%";

  // 整句作为一个排版块:中性、中等大字(h2 量级,比巨字小,留白靠居中),逐词极轻错峰浮现。
  // 关键词晚一点单独 pop(scale 1.0→稍大),抓住唯一焦点。
  const emphasisIdx = parts.findIndex((p) => p.accent);

  return (
    <SafeFrame safeArea={safeArea} extraBottom={captionsReserve} justify={justify}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          alignItems: "baseline",
          gap: `${size.h2 * 0.12}px ${size.h2 * 0.26}px`,
          maxWidth: maxW,
        }}
      >
        {parts.map((p, i) => {
          // 词逐个浮现(很轻):整句先后差 ~2 帧;关键词额外延迟做独立 pop。
          const base = smoothSpring({ frame, fps, delay: 3 + i * 2, motion });
          const opacity = clamp01(base);
          const y = (1 - base) * (size.h2 * 0.14);

          // 关键词:在整句落定后再做一次干净的 scale pop（从 0.86 弹到 1）。
          let scale = 1;
          let color = palette.fg;
          if (p.accent) {
            const pop = smoothSpring({ frame, fps, delay: 3 + parts.length * 2 + 3, motion: { ...motion, overshoot: true } });
            scale = 0.86 + 0.14 * clamp01(pop);
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
                fontSize: size.h2,
                lineHeight: 1.12,
                letterSpacing: "-0.01em",
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

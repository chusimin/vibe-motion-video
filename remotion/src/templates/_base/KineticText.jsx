// KineticText —— 动感大字幕:逐词/逐行弹入,适合开场钩子。punchy 风格主力。
import React from "react";
import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { SafeFrame } from "../../lib/anim.jsx";
import { GLOBAL_TEXT_STYLE } from "../../fonts.js";

// 把文字切成"词组"——中文按字符块 + 标点断,英文按空格断。
function tokenize(text) {
  if (!text) return [];
  // 优先按显式换行/空格分组;再对长串中文按 4-6 字软切。
  const rawGroups = text.split(/\s*\n\s*/).filter(Boolean);
  const groups = [];
  for (const g of rawGroups) {
    if (/[a-zA-Z0-9]/.test(g) && /\s/.test(g)) {
      // 含英文且有空格:按空格分词
      for (const w of g.split(/\s+/)) if (w) groups.push(w);
    } else {
      // 中文/无空格:整组作为一行(让换行决定节奏)
      groups.push(g);
    }
  }
  return groups;
}

export default function KineticText({ scene = {}, theme, safeArea, captionsReserve = 0, justify = "center" }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { motion, size, fonts, palette, accent, layout } = theme;
  const text = scene.onScreenText || scene.vo || scene.purpose || "";
  const groups = tokenize(text);
  // 逐词间隔(帧):优先用 spec 的 motion.stagger(单位「秒」,需 ×fps 转帧);
  // 否则按 personality 的 speed 反推。punchy stagger 小→词砸得密;calm 大→从容。
  const perDelay = Number.isFinite(motion.stagger) && motion.stagger > 0
    ? Math.max(1, Math.round(motion.stagger * fps))
    : Math.max(2, Math.round(5 / (motion.speed || 1)));
  const maxW = layout?.maxContentWidth || "100%";

  return (
    <SafeFrame safeArea={safeArea} extraBottom={captionsReserve} justify={justify} style={{ gap: 0 }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          alignItems: "center",
          gap: `${size.h2 * 0.12}px ${size.h2 * 0.22}px`,
          maxWidth: maxW,
        }}
      >
        {groups.map((g, i) => {
          const delay = i * perDelay;
          const s = spring({
            frame: frame - delay,
            fps,
            config: { damping: motion.overshoot ? 12 : 20, mass: motion.mass, stiffness: motion.stiffness },
          });
          const y = interpolate(s, [0, 1], [motion.enterShiftPx, 0]);
          const opacity = interpolate(s, [0, 1], [0, 1], { extrapolateRight: "clamp" });
          const scale = interpolate(s, [0, 1], [0.85, 1]);
          // 交替高亮:偶数项用强调色,制造节奏
          const isAccent = i % 3 === 1;
          return (
            <span
              key={i}
              style={{
                ...GLOBAL_TEXT_STYLE,
                display: "inline-block",
                opacity,
                transform: `translateY(${y}px) scale(${scale})`,
                fontFamily: fonts.display,
                fontWeight: 900,
                fontSize: size.hero,
                lineHeight: 1.02,
                letterSpacing: "-0.02em",
                color: isAccent ? accent(0) : palette.fg,
                textAlign: "center",
              }}
            >
              {g}
            </span>
          );
        })}
      </div>
    </SafeFrame>
  );
}

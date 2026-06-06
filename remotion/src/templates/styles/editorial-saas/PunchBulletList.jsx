// PunchBulletList —— 覆盖 bullet-list。editorial-saas 的要点列表:
// items 错峰揭示(逐行遮罩升出),editorial 排版(大行距、左对齐、负字距标题),
// accent 标记(细长竖条而非俗气圆点),留白足。每行一个焦点,克制。
//
// props 与 _base/BulletList.jsx 同款:{ scene, theme, safeArea, captionsReserve, justify }
//   scene.onScreenText = 小标题(eyebrow/heading);scene.visual.items = 条目数组。
import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { SafeFrame } from "../../../lib/anim.jsx";
import { GLOBAL_TEXT_STYLE } from "../../../fonts.js";
import { DISPLAY_TRACKING, DISPLAY_WEIGHT, smoothSpring, maskReveal } from "./_shared.jsx";

export default function PunchBulletList({ scene = {}, theme, safeArea, captionsReserve = 0, justify = "center" }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { motion, size, fonts, palette, accent } = theme;
  const heading = scene.onScreenText || "";
  const items = Array.isArray(scene.visual?.items) ? scene.visual.items : [];

  // 小标题作 eyebrow（极小、强调色、大写字距）——editorial 的「分区标签」处理。
  const headS = smoothSpring({ frame, fps, delay: 2, motion });

  // 条目大字（h2 量级），逐行遮罩升出，行间留白足。
  const itemSize = Math.round(size.h2 * 0.92);

  return (
    <SafeFrame safeArea={safeArea} align="flex-start" justify={justify} extraBottom={captionsReserve}>
      {heading ? (
        <div
          style={{
            opacity: clamp01(headS),
            transform: `translateY(${(1 - headS) * 12}px)`,
            ...GLOBAL_TEXT_STYLE,
            fontFamily: fonts.body,
            fontWeight: 700,
            fontSize: size.small,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: accent(0),
            marginBottom: Math.round(itemSize * 0.5),
          }}
        >
          {heading}
        </div>
      ) : null}

      <div style={{ display: "flex", flexDirection: "column", gap: Math.round(itemSize * 0.42), width: "100%" }}>
        {items.map((it, i) => {
          // 逐条错峰：每条晚 ~6 帧，遮罩升出。
          const s = smoothSpring({ frame, fps, delay: 8 + i * 6, motion });
          const reveal = maskReveal(s);
          return (
            <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: Math.round(itemSize * 0.34), overflow: "hidden" }}>
              {/* accent 标记：细长竖条（非圆点），更 editorial、更克制 */}
              <div
                style={{
                  ...reveal,
                  flex: "0 0 auto",
                  width: Math.max(5, Math.round(itemSize * 0.07)),
                  height: `${itemSize * 0.86}px`,
                  marginTop: Math.round(itemSize * 0.1),
                  borderRadius: 999,
                  background: accent(0),
                }}
              />
              <div
                style={{
                  ...reveal,
                  ...GLOBAL_TEXT_STYLE,
                  fontFamily: fonts.display,
                  fontWeight: DISPLAY_WEIGHT,
                  fontSize: itemSize,
                  lineHeight: 1.04,
                  letterSpacing: DISPLAY_TRACKING,
                  color: palette.fg,
                }}
              >
                {it}
              </div>
            </div>
          );
        })}
      </div>
    </SafeFrame>
  );
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

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
import { DISPLAY_TRACKING, DISPLAY_WEIGHT, snapSpring, maskReveal, shotProgress, driftXY } from "./_shared.jsx";

export default function PunchBulletList({ scene = {}, theme, safeArea, captionsReserve = 0, justify = "center" }) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const { size, fonts, palette, accent } = theme;
  const heading = scene.onScreenText || "";
  const items = Array.isArray(scene.visual?.items) ? scene.visual.items : [];

  // 小标题作 eyebrow（极小、强调色、大写字距）——快入场。
  const headS = snapSpring({ frame, fps, delay: 1 });

  // 条目大字（h2 量级，再放大一点），逐行遮罩升出，行间留白足。
  const itemSize = Math.round(size.h2 * 1.0);

  // 镜头进度:整块持续极轻横向漂(永不静止)。
  const t = shotProgress(frame, durationInFrames);
  const blockDrift = driftXY(t, { ampX: itemSize * 0.04, ampY: itemSize * 0.02, loops: 1, creepX: itemSize * 0.05 });

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

      <div
        style={{
          display: "flex", flexDirection: "column", gap: Math.round(itemSize * 0.42), width: "100%",
          transform: `translate(${blockDrift.x}px, ${blockDrift.y}px)`,
          willChange: "transform",
        }}
      >
        {items.map((it, i) => {
          // 逐条**极快**错峰砸入:每条只晚 2-3 帧,snap overshoot(~6 帧到位),遮罩升出。
          const s = snapSpring({ frame, fps, delay: 3 + i * 3 });
          const reveal = maskReveal(s);
          // 标记竖条:落定后持续极轻竖向脉动(永不静止),错相避免整齐划一。
          const barPulse = 0.86 + 0.06 * Math.sin(t * Math.PI * 2 * 2 + i * 0.9);
          return (
            <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: Math.round(itemSize * 0.34), overflow: "hidden" }}>
              {/* accent 标记：细长竖条（非圆点），更 editorial；全程轻脉动 */}
              <div
                style={{
                  ...reveal,
                  flex: "0 0 auto",
                  width: Math.max(5, Math.round(itemSize * 0.07)),
                  height: `${itemSize * barPulse}px`,
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

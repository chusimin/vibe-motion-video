// BulletList —— 要点列表:逐条上滑淡入,左对齐,圆点用强调色。
import React from "react";
import { SafeFrame, useEnter } from "../lib/anim.jsx";
import { GLOBAL_TEXT_STYLE } from "../fonts.js";

export default function BulletList({ scene = {}, theme, safeArea, captionsReserve = 0 }) {
  const { motion, size, fonts, palette, accent } = theme;
  const heading = scene.onScreenText || "";
  const items = Array.isArray(scene.visual?.items) ? scene.visual.items : [];
  const headAnim = useEnter({ delay: 2, motion });

  return (
    <SafeFrame safeArea={safeArea} align="flex-start" justify="center" extraBottom={captionsReserve}>
      {heading ? (
        <div
          style={{
            ...headAnim,
            ...GLOBAL_TEXT_STYLE,
            fontFamily: fonts.display,
            fontWeight: 800,
            fontSize: size.h2,
            lineHeight: 1.1,
            letterSpacing: "-0.02em",
            color: palette.fg,
            marginBottom: size.h3 * 0.8,
          }}
        >
          {heading}
        </div>
      ) : null}
      <div style={{ display: "flex", flexDirection: "column", gap: size.body * 0.7, width: "100%" }}>
        {items.map((it, i) => {
          const a = useEnter({ delay: 8 + i * 6, motion, axis: "x", distance: motion.enterShiftPx });
          return (
            <div key={i} style={{ ...a, display: "flex", alignItems: "flex-start", gap: size.body * 0.5 }}>
              <div
                style={{
                  flex: "0 0 auto",
                  width: size.body * 0.42,
                  height: size.body * 0.42,
                  marginTop: size.body * 0.34,
                  borderRadius: 999,
                  background: accent(i % 3),
                }}
              />
              <div
                style={{
                  ...GLOBAL_TEXT_STYLE,
                  fontFamily: fonts.body,
                  fontWeight: 600,
                  fontSize: size.body,
                  lineHeight: 1.28,
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

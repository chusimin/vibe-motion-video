// Quote —— 金句/引用:大号引号 + 引文 + 署名。
import React from "react";
import { SafeFrame, useEnter } from "../../lib/anim.jsx";
import { GLOBAL_TEXT_STYLE } from "../../fonts.js";
import { withAlpha } from "../../theme.js";

export default function Quote({ scene = {}, theme, safeArea, captionsReserve = 0 }) {
  const { motion, size, fonts, palette, accent } = theme;
  const quote = scene.onScreenText || scene.vo || "";
  const author = scene.visual?.author || scene.visual?.value || "";
  const markAnim = useEnter({ delay: 0, motion });
  const quoteAnim = useEnter({ delay: 8, motion });
  const authorAnim = useEnter({ delay: 18, motion, distance: motion.enterShiftPx * 0.5 });

  return (
    <SafeFrame safeArea={safeArea} align="flex-start" extraBottom={captionsReserve}>
      <div
        style={{
          ...markAnim,
          ...GLOBAL_TEXT_STYLE,
          fontFamily: fonts.display,
          fontWeight: 900,
          fontSize: size.hero * 1.2,
          lineHeight: 0.8,
          color: accent(0),
          marginBottom: -size.h2 * 0.3,
        }}
      >
        “
      </div>
      <div
        style={{
          ...quoteAnim,
          ...GLOBAL_TEXT_STYLE,
          fontFamily: fonts.display,
          fontWeight: 700,
          fontSize: size.h2,
          lineHeight: 1.22,
          letterSpacing: "-0.01em",
          color: palette.fg,
          maxWidth: "100%",
          textWrap: "balance",
        }}
      >
        {quote}
      </div>
      {author ? (
        <div
          style={{
            ...authorAnim,
            ...GLOBAL_TEXT_STYLE,
            marginTop: size.h3 * 0.8,
            paddingLeft: size.body * 0.4,
            borderLeft: `${Math.max(4, size.body * 0.12)}px solid ${accent(0)}`,
            fontFamily: fonts.body,
            fontWeight: 600,
            fontSize: size.h3,
            color: withAlpha(palette.fg, 0.8),
          }}
        >
          {author}
        </div>
      ) : null}
    </SafeFrame>
  );
}

// BgOnly —— 纯背景镜:只有背景(由 VibeVideo 的 Background 负责),可选一行极简文字。
// 也作为未知 type 的兜底之一。
import React from "react";
import { SafeFrame, useEnter } from "../../lib/anim.jsx";
import { GLOBAL_TEXT_STYLE } from "../../fonts.js";

export default function BgOnly({ scene = {}, theme, safeArea, captionsReserve = 0, justify = "center" }) {
  const { motion, size, fonts, palette } = theme;
  const text = scene.onScreenText || "";
  const anim = useEnter({ delay: 4, motion });
  if (!text) return null; // 背景已由外层绘制
  return (
    <SafeFrame safeArea={safeArea} extraBottom={captionsReserve} justify={justify}>
      <div
        style={{
          ...anim,
          ...GLOBAL_TEXT_STYLE,
          fontFamily: fonts.display,
          fontWeight: 700,
          fontSize: size.h2,
          lineHeight: 1.1,
          letterSpacing: "-0.01em",
          color: palette.fg,
          textAlign: "center",
          maxWidth: "92%",
        }}
      >
        {text}
      </div>
    </SafeFrame>
  );
}

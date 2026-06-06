// PunchFrame —— 覆盖 bg-only。editorial-saas 的节拍重音:
// 整屏满色定格(从 punch 调色板取:绿/紫/暗场),可居中巨字,作对比与呼吸的「重音帧」。
// 对标 ObiN 满绿帧 / 满紫帧 / 暗场帧交替。整屏一个色块 + 至多一行字,极致克制。
//
// ⚠️ resolver 不透传 punchColors，这里用 _shared.punchPalette(theme) 自带（绿/紫/暗场）。
// 取色：scene.visual.value 若是 hex 直接用；若是数字索引取 punch 调色板；否则按 scene.id 末位轮播。
// 仍兼容 scene.bg（Background 已画），PunchFrame 自己也铺一层确保满色生效。
//
// props 与 _base/BgOnly.jsx 同款:{ scene, theme, safeArea, captionsReserve, justify }
import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { GLOBAL_TEXT_STYLE } from "../../../fonts.js";
import { DISPLAY_TRACKING, DISPLAY_WEIGHT, punchPalette, readableOn, DARK, punchIn, snapSpring, shotProgress, driftScale } from "./_shared.jsx";

function isHex(s) {
  return typeof s === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s.trim());
}

// 从 scene 决定满色帧的填充色。
function pickFill(scene, theme) {
  const v = scene.visual || {};
  const palette = punchPalette(theme);
  // 1) 显式 hex（visual.value 或 scene.bg）
  if (isHex(v.value)) return v.value.trim();
  if (isHex(scene.bg)) return scene.bg.trim();
  // 2) 数字索引
  const asNum = Number(v.value);
  if (Number.isFinite(asNum)) return palette[((asNum % palette.length) + palette.length) % palette.length];
  // 3) 按 scene.id 末位数字轮播（s01→绿, s02→紫, s03→暗…）保证整片满色帧不撞色
  const m = String(scene.id || "").match(/(\d+)\s*$/);
  const idx = m ? parseInt(m[1], 10) : 0;
  return palette[idx % palette.length];
}

export default function PunchFrame({ scene = {}, theme, safeArea, captionsReserve = 0 }) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const { size, fonts } = theme;
  const fill = pickFill(scene, theme);
  // 仅显示 onScreenText（填充色走 visual.value/bg，不会被误当文字）。
  const label = scene.onScreenText || "";

  // 满色帧文字配色：亮色块(绿/紫)上用近黑(darkFrame)做「印章」式重音；暗场块上用暖亮底色。
  const fg = readableOn(fill) === "#0B0B0C" ? DARK : "#F4F2EC";

  const top = safeArea.top ?? 60;
  const bottom = (safeArea.bottom ?? 60) + captionsReserve;
  const left = safeArea.left ?? 60;
  const right = safeArea.right ?? 60;

  // 闪帧:整屏满色立刻铺满(无淡入,色块就是重音)。文字**硬砸**进来:
  // 极快 scale punch(从 1.22 冲到 1,~4-6 帧)+ 轻 overshoot。适配 0.3-0.6s(9-18 帧)。
  const punch = punchIn({ frame, fps, delay: 1, amount: 0.22 });
  // 砸入后**持续**极轻 scale(让 0.5s 内也不静止)。
  const t = shotProgress(frame, durationInFrames);
  const hold = driftScale(t, 1.0, 1.04);
  const textScale = punch.scale * hold;
  const textOpacity = punch.opacity;
  // 满色帧的字要够大才算「重音」:短词放大占屏(再放大一档);按字数收敛防溢出。
  const wordLen = label.replace(/\s+/g, "").length;
  const punchSize = Math.round(size.hero * (wordLen <= 8 ? 1.6 : wordLen <= 14 ? 1.15 : 0.86));

  return (
    <AbsoluteFill style={{ backgroundColor: fill }}>
      {label ? (
        <AbsoluteFill
          style={{
            paddingTop: top,
            paddingBottom: bottom,
            paddingLeft: left,
            paddingRight: right,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              transform: `scale(${textScale})`,
              transformOrigin: "center center",
              opacity: textOpacity,
              willChange: "transform",
              ...GLOBAL_TEXT_STYLE,
              fontFamily: fonts.display,
              fontWeight: DISPLAY_WEIGHT,
              fontSize: punchSize,
              lineHeight: 0.96,
              letterSpacing: DISPLAY_TRACKING,
              color: fg,
              textAlign: "center",
              textWrap: "balance",
              maxWidth: "100%",
            }}
          >
            {label}
          </div>
        </AbsoluteFill>
      ) : null}
    </AbsoluteFill>
  );
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

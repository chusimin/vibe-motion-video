// EditorialStat —— 覆盖 stat。editorial-saas 的数据背书:
// 巨数字(负字距)+ 极小标签,大留白,数字滚动到位,数字染 accent。
// 对标 ObiN「200,000 VND」——大数字主体 + 小一号弱化后缀单位,层级狠。
//
// props 与 _base/Stat.jsx 同款:{ scene, theme, safeArea, captionsReserve, justify }
import React from "react";
import { useCurrentFrame, useVideoConfig, spring } from "remotion";
import { SafeFrame } from "../../../lib/anim.jsx";
import { GLOBAL_TEXT_STYLE } from "../../../fonts.js";
import { DISPLAY_TRACKING, snapSpring, shotProgress, driftScale } from "./_shared.jsx";

// 与 _base/Stat 同口径地拆「前缀/数字/后缀」。
function parseValue(raw) {
  const s = String(raw ?? "").trim();
  const m = s.match(/^([^\d.+-]*)([\d,.]+)(.*)$/);
  if (!m) return { prefix: "", num: null, suffix: s, decimals: 0 };
  const prefix = m[1] || "";
  const numStr = m[2].replace(/,/g, "");
  const suffix = m[3] || "";
  const decimals = (numStr.split(".")[1] || "").length;
  const num = Number(numStr);
  return { prefix, num: Number.isFinite(num) ? num : null, suffix, decimals, hasComma: m[2].includes(",") };
}

function formatNum(n, decimals, hasComma) {
  const fixed = n.toFixed(decimals);
  if (!hasComma) return fixed;
  const [int, dec] = fixed.split(".");
  const withSep = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return dec ? `${withSep}.${dec}` : withSep;
}

export default function EditorialStat({ scene = {}, theme, safeArea, captionsReserve = 0, justify = "center" }) {
  const frame = useCurrentFrame();
  const { fps, width, durationInFrames } = useVideoConfig();
  const { size, fonts, palette, accent } = theme;
  const v = scene.visual || {};
  const { prefix, num, suffix, decimals, hasComma } = parseValue(v.value);
  const label = scene.onScreenText || v.label || "";

  // 数字**快速**滚动到位:脆 spring 0→num,约 0.4-0.5s 冲满(适配短镜)。
  const roll = clamp01(spring({ frame: frame - 2, fps, config: { damping: 20, mass: 0.6, stiffness: 200 } }));
  const display = num != null ? formatNum(num * roll, decimals, hasComma) : (v.value ?? "");

  // 巨数字**快**砸入:snap overshoot(~6 帧到位),从下方升 + 冲过 1 再收。
  const numS = snapSpring({ frame, fps, delay: 1 });
  const numY = (1 - clamp01(numS)) * (size.statNumber * 0.14);
  const numOpacity = clamp01(numS * 1.6);

  // 镜头进度:数字落定后**持续**极轻 scale + 微浮(永不静止)。
  const t = shotProgress(frame, durationInFrames);
  const numDrift = driftScale(t, 1.0, 1.08);
  const numFloat = Math.sin(t * Math.PI * 2 * 1.1) * (size.statNumber * 0.012);

  // 极小标签:快出(比原来早很多),弱化、字距拉开,editorial 标签味。
  const labS = snapSpring({ frame, fps, delay: 6 });

  // 数字字号：要狠(独占画面)，但**整串必须完整可读**(对标 ObiN「200,000」全显，不切首位)。
  // 按最终串字符数估算宽度(等宽数字 ~0.6em，逗号/小数点 ~0.3em)，把字号收敛到 ≤ 安全区宽度。
  const finalStr = num != null ? formatNum(num, decimals, hasComma) : String(v.value ?? "");
  const emWidth = [...finalStr].reduce((w, ch) => w + (/[\d]/.test(ch) ? 0.6 : 0.3), 0)
    + (prefix ? prefix.length * 0.3 : 0) + (suffix ? suffix.trim().length * 0.28 : 0);
  const avail = width - (safeArea.left ?? 60) - (safeArea.right ?? 60);
  const maxByWidth = avail / Math.max(1, emWidth); // 字号上限：整串刚好塞进安全区宽
  const numSize = Math.round(Math.min(size.statNumber * 1.12, maxByWidth));

  return (
    <SafeFrame safeArea={safeArea} extraBottom={captionsReserve} justify={justify}>
      <div style={{ overflow: "hidden" }}>
        <div
          style={{
            transform: `translateY(${numY + numFloat}px) scale(${numDrift})`,
            transformOrigin: "center center",
            opacity: numOpacity,
            willChange: "transform",
            ...GLOBAL_TEXT_STYLE,
            fontFamily: fonts.display,
            fontWeight: 800,
            fontSize: numSize,
            lineHeight: 0.9,
            letterSpacing: DISPLAY_TRACKING,
            color: accent(0),
            fontVariantNumeric: "tabular-nums",
            fontFeatureSettings: '"tnum"',
            display: "flex",
            alignItems: "baseline",
            justifyContent: "center",
            whiteSpace: "nowrap",
          }}
        >
          {prefix ? <span style={{ fontSize: "0.46em", marginRight: "0.04em", color: palette.fg }}>{prefix}</span> : null}
          <span>{display}</span>
          {/* 后缀单位:小一大半、近黑非强调色 → 层级狠（对标 VND 弱化处理） */}
          {suffix ? <span style={{ fontSize: "0.4em", marginLeft: "0.06em", color: palette.fg, fontWeight: 700 }}>{suffix.trim()}</span> : null}
        </div>
      </div>
      {label ? (
        <div
          style={{
            marginTop: Math.round(numSize * 0.06),
            opacity: clamp01(labS),
            transform: `translateY(${(1 - labS) * 14}px)`,
            ...GLOBAL_TEXT_STYLE,
            fontFamily: fonts.body,
            fontWeight: 600,
            fontSize: size.small,
            lineHeight: 1.3,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: palette.fg,
            opacity: 0.85,
            textAlign: "center",
            maxWidth: "80%",
          }}
        >
          {label}
        </div>
      ) : null}
    </SafeFrame>
  );
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

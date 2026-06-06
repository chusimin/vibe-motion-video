// EditorialStat —— 覆盖 stat。editorial-saas 的数据背书:
// 巨数字(负字距)+ 极小标签,大留白,数字滚动到位,数字染 accent。
// 对标 ObiN「200,000 VND」——大数字主体 + 小一号弱化后缀单位,层级狠。
//
// props 与 _base/Stat.jsx 同款:{ scene, theme, safeArea, captionsReserve, justify }
import React from "react";
import { useCurrentFrame, useVideoConfig, spring } from "remotion";
import { SafeFrame } from "../../../lib/anim.jsx";
import { GLOBAL_TEXT_STYLE } from "../../../fonts.js";
import { DISPLAY_TRACKING, smoothSpring } from "./_shared.jsx";

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
  const { fps, width } = useVideoConfig();
  const { motion, size, fonts, palette, accent } = theme;
  const v = scene.visual || {};
  const { prefix, num, suffix, decimals, hasComma } = parseValue(v.value);
  const label = scene.onScreenText || v.label || "";

  // 数字滚动:平滑 spring 0→num，约 1.1s。
  const roll = spring({ frame: frame - 4, fps, config: { damping: 32, mass: 1, stiffness: 80 } });
  const display = num != null ? formatNum(num * roll, decimals, hasComma) : (v.value ?? "");

  // 巨数字入场:遮罩升出 + 轻 scale。
  const numS = smoothSpring({ frame, fps, delay: 3, motion });
  const numY = (1 - numS) * (size.statNumber * 0.1);
  const numOpacity = clamp01(numS * 1.3);

  // 极小标签:晚出，弱化、字距拉开，editorial 标签味。
  const labS = smoothSpring({ frame, fps, delay: 20, motion });

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
            transform: `translateY(${numY}px)`,
            opacity: numOpacity,
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

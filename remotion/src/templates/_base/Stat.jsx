// Stat —— 数据背书:超大数字滚动到目标值 + 标签。用于"用户数/节省时间/好评率"等。
import React from "react";
import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { SafeFrame, useEnter } from "../../lib/anim.jsx";
import { GLOBAL_TEXT_STYLE } from "../../fonts.js";

// 从 value 字符串里拆出:前缀、数字、后缀(如 "¥98" → ["¥","98",""];"3.5x" → ["","3.5","x"];"10,000+" → ["","10000","+"])
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

export default function Stat({ scene = {}, theme, safeArea, captionsReserve = 0, justify = "center" }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { motion, size, fonts, palette, accent } = theme;
  const v = scene.visual || {};
  const { prefix, num, suffix, decimals, hasComma } = parseValue(v.value);
  const label = scene.onScreenText || v.label || "";

  // 数字滚动:用 spring 驱动 0→num,约 1s 内滚到位
  const s = spring({ frame: frame - 4, fps, config: { damping: 30, mass: 1, stiffness: 90 } });
  const display = num != null ? formatNum(num * s, decimals, hasComma) : (v.value ?? "");

  const numAnim = useEnter({ delay: 2, motion, distance: motion.enterShiftPx * 0.5 });
  const labelAnim = useEnter({ delay: 16, motion });

  return (
    <SafeFrame safeArea={safeArea} extraBottom={captionsReserve} justify={justify}>
      <div
        style={{
          ...numAnim,
          ...GLOBAL_TEXT_STYLE,
          fontFamily: fonts.display,
          fontWeight: 900,
          fontSize: size.statNumber,
          lineHeight: 0.95,
          letterSpacing: "-0.03em",
          color: accent(0),
          fontVariantNumeric: "tabular-nums",
          fontFeatureSettings: '"tnum"',
          textAlign: "center",
          display: "flex",
          alignItems: "baseline",
          justifyContent: "center",
        }}
      >
        {prefix ? <span style={{ fontSize: "0.5em", marginRight: "0.05em" }}>{prefix}</span> : null}
        <span>{display}</span>
        {suffix ? <span style={{ fontSize: "0.5em", marginLeft: "0.05em" }}>{suffix}</span> : null}
      </div>
      {label ? (
        <div
          style={{
            ...labelAnim,
            ...GLOBAL_TEXT_STYLE,
            marginTop: size.h3 * 0.6,
            fontFamily: fonts.body,
            fontWeight: 600,
            fontSize: size.h3,
            lineHeight: 1.25,
            color: palette.fg,
            textAlign: "center",
            maxWidth: "92%",
          }}
        >
          {label}
        </div>
      ) : null}
    </SafeFrame>
  );
}

// anim.jsx —— 模板共用的动画与布局原语。
// 全部基于 useCurrentFrame/spring/interpolate,确定性、可被渲染器逐帧求值。

import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate, Easing } from "remotion";

// 标准入场:位移 + 淡入。delayFrames 控制出场顺序(逐项 stagger)。
// 返回可直接 spread 进 style 的 { opacity, transform }。
export function useEnter({ delay = 0, motion, axis = "y", distance, from = 1 } = {}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const dist = distance ?? (motion?.enterShiftPx ?? 48);
  const s = spring({
    frame: frame - delay,
    fps,
    config: {
      damping: motion?.damping ?? 26,
      mass: motion?.mass ?? 0.8,
      stiffness: motion?.stiffness ?? 120,
    },
    durationInFrames: undefined,
  });
  const opacity = interpolate(s, [0, 1], [0, 1], { extrapolateRight: "clamp" });
  const shift = interpolate(s, [0, 1], [dist * from, 0]);
  const transform = axis === "x" ? `translateX(${shift}px)` : `translateY(${shift}px)`;
  return { opacity, transform, progress: s };
}

// 缩放入场(用于数字/徽标弹入)。
export function usePopIn({ delay = 0, motion } = {}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({
    frame: frame - delay,
    fps,
    config: {
      damping: motion?.overshoot ? 12 : (motion?.damping ?? 18),
      mass: motion?.mass ?? 0.7,
      stiffness: motion?.stiffness ?? 160,
    },
  });
  const scale = interpolate(s, [0, 1], [0.6, 1]);
  const opacity = interpolate(s, [0, 1], [0, 1], { extrapolateRight: "clamp" });
  return { scale, opacity, transform: `scale(${scale})`, progress: s };
}

// 末尾收束:在 scene 末 fadeOutFrames 帧内淡出(避免硬切),返回 opacity 乘子。
export function useTailFade(fadeOutFrames = 0) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  if (!fadeOutFrames) return 1;
  const start = durationInFrames - fadeOutFrames;
  return interpolate(frame, [start, durationInFrames - 1], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
}

// Ken Burns / zoom / pan:按 motion 描述符返回作用于媒体的 transform。
// 在 [0, durationInFrames] 全程缓慢运动。
export function useKenBurns(motionDesc = "ken-burns") {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const t = interpolate(frame, [0, Math.max(1, durationInFrames - 1)], [0, 1], {
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.ease),
  });
  const d = (motionDesc || "ken-burns").toLowerCase();
  let scaleFrom = 1.08, scaleTo = 1.18, tx = 0, ty = 0;
  if (d.includes("zoom-out")) { scaleFrom = 1.2; scaleTo = 1.04; }
  else if (d.includes("zoom")) { scaleFrom = 1.04; scaleTo = 1.2; }
  if (d.includes("pan-left")) { tx = interpolate(t, [0, 1], [3, -3]); }
  else if (d.includes("pan-right")) { tx = interpolate(t, [0, 1], [-3, 3]); }
  else if (d.includes("pan-up")) { ty = interpolate(t, [0, 1], [3, -3]); }
  else if (d.includes("pan-down")) { ty = interpolate(t, [0, 1], [-3, 3]); }
  else if (d === "ken-burns" || d.includes("ken")) { tx = interpolate(t, [0, 1], [-2, 2]); ty = interpolate(t, [0, 1], [1.5, -1.5]); }
  const scale = interpolate(t, [0, 1], [scaleFrom, scaleTo]);
  return { transform: `scale(${scale}) translate(${tx}%, ${ty}%)` };
}

// 安全区布局容器:把内容收进平台安全区内(避开平台 UI 与字幕带)。
// extraBottom:为底部字幕额外预留(captionsEnabled 时由调用方传)。
// justify:竖直主轴对齐(响应式锚点)。模板可显式传(如 VibeVideo 透传的画幅锚点
//   center/flex-end);不传则用模板自带默认。
export function SafeFrame({ safeArea = {}, children, style, align = "center", justify = "center", extraBottom = 0 }) {
  const { top = 60, bottom = 60, left = 60, right = 60 } = safeArea;
  return (
    <AbsoluteFill
      style={{
        paddingTop: top,
        paddingBottom: bottom + extraBottom,
        paddingLeft: left,
        paddingRight: right,
        display: "flex",
        flexDirection: "column",
        alignItems: align,
        justifyContent: justify,
        ...style,
      }}
    >
      {children}
    </AbsoluteFill>
  );
}

// 把任意值夹到 [lo, hi]
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

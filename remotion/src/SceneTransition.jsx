// SceneTransition —— 入场/出场转场包装层。
// 不用 TransitionSeries(它要求顺序拼接且转场会"吃掉"时长,破坏帧级 startSec)。
// 改为在每个 scene 自己的 Sequence 内,用 useCurrentFrame 在头/尾若干帧做 in/out 动画。
// 支持:none / fade / wipe-left / wipe-right / slide-up / scale / clock。
import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, Easing } from "remotion";

const DEFAULT_DUR = 0.4; // 转场时长(秒)

// 计算入场进度 pin(0→1)与出场进度 pout(1→0,末尾收束)。
function useProgress(durSec) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const d = Math.max(1, Math.round(durSec * fps));
  const inP = interpolate(frame, [0, d], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const outStart = durationInFrames - d;
  const outP = interpolate(frame, [outStart, durationInFrames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.in(Easing.cubic),
  });
  return { inP, outP };
}

// 把一个方向的进度(0..1,1=完全显示)映射成该转场的 style。
function styleFor(kind, p, phase, width, height) {
  // p: 0=隐藏, 1=显示
  const hidden = 1 - p;
  switch (kind) {
    case "none":
      return {};
    case "fade":
      return { opacity: p };
    case "slide-up": {
      // 入场从下方进;出场往上走
      const dir = phase === "in" ? 1 : -1;
      return { opacity: p, transform: `translateY(${dir * hidden * height * 0.08}px)` };
    }
    case "wipe-left": {
      // 用 clip-path 从右往左揭开
      const pct = p * 100;
      return { clipPath: `inset(0 ${100 - pct}% 0 0)` };
    }
    case "wipe-right": {
      const pct = p * 100;
      return { clipPath: `inset(0 0 0 ${100 - pct}%)` };
    }
    case "scale": {
      const sc = interpolate(p, [0, 1], [phase === "in" ? 0.92 : 1.06, 1]);
      return { opacity: p, transform: `scale(${sc})` };
    }
    case "clock": {
      // 顺时针扇形揭开(conic mask 近似;Chromium 支持 mask-image conic-gradient)
      const deg = p * 360;
      const mask = `conic-gradient(#000 0deg ${deg}deg, transparent ${deg}deg 360deg)`;
      return {
        WebkitMaskImage: mask,
        maskImage: mask,
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
      };
    }
    default:
      return { opacity: p };
  }
}

export default function SceneTransition({ transitionIn = "fade", transitionOut = "none", durSec = DEFAULT_DUR, children }) {
  const { width, height } = useVideoConfig();
  const { inP, outP } = useProgress(durSec);

  // 入场只在前段生效(inP<1),出场只在末段生效(outP<1);中段两者都=1 → 无变换。
  const inStyle = inP < 1 ? styleFor(transitionIn, inP, "in", width, height) : {};
  const outStyle = outP < 1 ? styleFor(transitionOut, outP, "out", width, height) : {};

  // 合并:opacity 取乘积,transform 串联,clip/mask 谁生效用谁。
  const merged = { ...inStyle };
  for (const [k, v] of Object.entries(outStyle)) {
    if (k === "opacity") merged.opacity = (merged.opacity ?? 1) * v;
    else if (k === "transform") merged.transform = `${merged.transform ? merged.transform + " " : ""}${v}`;
    else merged[k] = v;
  }

  return <AbsoluteFill style={merged}>{children}</AbsoluteFill>;
}

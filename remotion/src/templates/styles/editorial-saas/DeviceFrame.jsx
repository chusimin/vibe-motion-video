// DeviceFrame —— 覆盖 product-capture。editorial-saas 的产品展示招牌:
// 截图(scene.visual._mediaSrc)放进手机/浏览器框,轻微 3D 倾斜(perspective + rotateY/X)
// + 慢漂移视差,坐落在一块饱和强调色面板上(对标 ObiN 手机置于满绿背景)。
// 无 media 时:优雅的「框 + 提示」占位,绝不黑屏。
//
// props 与 _base/ProductCapture.jsx 同款:{ scene, theme, safeArea, captionsReserve }
//   读 scene.visual._mediaSrc(VibeVideo 解析注入)、scene.onScreenText(顶部标签)、
//   scene.visual.device("phone"|"browser",缺省按画幅猜)。
import React from "react";
import { AbsoluteFill, Img, OffthreadVideo, useCurrentFrame, useVideoConfig } from "remotion";
import { GLOBAL_TEXT_STYLE } from "../../../fonts.js";
import { withAlpha } from "../../../theme.js";
import { DARK, snapSpring, readableOn, shotProgress, driftRot, driftXY, driftScale } from "./_shared.jsx";

function isVideoSrc(src) {
  return /\.(mp4|mov|webm|m4v|mkv)(\?|$)/i.test(src || "");
}

export default function DeviceFrame({ scene = {}, theme, safeArea, captionsReserve = 0 }) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const { size, fonts, palette, accent, aspect } = theme;
  const v = scene.visual || {};
  const src = v._mediaSrc;
  const label = scene.onScreenText || "";

  // 设备:显式 device 优先;否则横屏给浏览器框、竖/方给手机框。
  const device = v.device || (aspect === "landscape" ? "browser" : "phone");

  // 面板色:饱和强调色铺底(ObiN 满绿/满紫),用 accent(1)=绿 当主面板色,克制但有冲击。
  const panel = v.panelColor || accent(1);

  // 入场:整机**快**从下方砸入 + 轻 scale(snap overshoot,~6-8 帧到位)。
  const enter = snapSpring({ frame, fps, delay: 2 });
  const enterY = (1 - clamp01(enter)) * (size.hero * 0.5);
  const enterScale = 0.86 + 0.14 * enter; // enter 越过 1 → 砸进来时略冲过再收
  const enterOpacity = clamp01(enter * 1.6);

  // 镜头进度:全程**持续** 3D 漂移(永不静止),来回摆而非单向。
  const t = shotProgress(frame, durationInFrames);
  // rotateY 在 -8°..+2° 来回摆(loops=1),rotateX 轻摆,始终带透视体积感。
  const driftRotY = driftRot(t, { from: -7, to: -3, wobble: 5, loops: 1 });
  const driftRotX = driftRot(t, { from: 4, to: 1, wobble: 2.2, loops: 1 });
  // 整机上下 + 左右极轻视差漂(百分比)。
  const dpar = driftXY(t, { ampX: 1.0, ampY: 0.9, loops: 1 });
  const driftYpct = dpar.y - 0.4 + 0.8 * t; // 叠一点单向创动,避免完全周期回到原点
  const driftXpct = dpar.x;
  // 截图慢推:屏幕内容全程缓慢 scale(1.0→1.08),像镜头慢慢推近 UI。
  const screenPush = driftScale(t, 1.0, 1.08);

  const top = safeArea.top ?? 60;
  const bottom = (safeArea.bottom ?? 60) + captionsReserve;
  const sidePad = Math.round((safeArea.left ?? 60) * 0.7);

  // 设备框几何（相对画面）。手机竖、浏览器宽。
  const isPhone = device === "phone";
  const frameW = isPhone ? "62%" : "84%";
  const frameAR = isPhone ? 9 / 19.5 : 16 / 10; // 宽/高
  const radius = isPhone ? 54 : 22;
  const bezel = isPhone ? 12 : 0;

  const labelColor = readableOn(panel);

  return (
    <AbsoluteFill style={{ backgroundColor: palette.bg }}>
      {/* 饱和面板:从中心略大于设备的圆角块，作为「满色背景」承托设备 */}
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", paddingTop: top, paddingBottom: bottom, paddingLeft: sidePad, paddingRight: sidePad }}>
        <div
          style={{
            position: "relative",
            width: "100%",
            height: "100%",
            borderRadius: 40,
            background: panel,
            overflow: "hidden",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {/* 顶部标签:贴面板内顶,极小字距大写,色随面板亮度 */}
          {label ? (
            <div
              style={{
                position: "absolute",
                top: Math.round(size.h3 * 0.6),
                left: Math.round(size.h3 * 0.7),
                right: Math.round(size.h3 * 0.7),
                ...GLOBAL_TEXT_STYLE,
                fontFamily: fonts.display,
                fontWeight: 800,
                fontSize: size.h3,
                lineHeight: 1.1,
                letterSpacing: "-0.01em",
                color: labelColor,
                opacity: enterOpacity,
              }}
            >
              {label}
            </div>
          ) : null}

          {/* 设备框：3D 透视容器 */}
          <div style={{ perspective: 1600, perspectiveOrigin: "50% 40%" }}>
            <div
              style={{
                width: 0, // 用内部固定宽度，外层只做定位
              }}
            />
            <DeviceBody
              src={src}
              isPhone={isPhone}
              frameW={frameW}
              frameAR={frameAR}
              radius={radius}
              bezel={bezel}
              transform={`translateY(${enterY}px) translate(${driftXpct}%, ${driftYpct}%) scale(${enterScale}) rotateY(${driftRotY}deg) rotateX(${driftRotX}deg)`}
              opacity={enterOpacity}
              theme={theme}
              isVideo={src ? isVideoSrc(src) : false}
              screenPush={screenPush}
            />
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

// 设备本体：用一个相对画面尺寸的容器（vw 不稳，用 absolute 百分比经父级 flex 居中），
// 这里用内联固定比例盒（width=frameW of viewport via wrapper），所以放一个定宽包裹。
function DeviceBody({ src, isPhone, frameW, frameAR, radius, bezel, transform, opacity, theme, isVideo, screenPush = 1 }) {
  const { palette, fonts, size, accent } = theme;
  // 用 CSS：宽度按视口百分比，高度按宽高比。包一层 relative + aspect-ratio。
  return (
    <div
      style={{
        position: "relative",
        width: `min(${frameW === "62%" ? "62vw" : "84vw"}, ${isPhone ? "560px" : "1400px"})`,
        aspectRatio: `${frameAR}`,
        transform,
        opacity,
        transformStyle: "preserve-3d",
      }}
    >
      {/* 投影：设备底部柔和落影，增强浮起体积感 */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: radius,
          boxShadow: `0 ${isPhone ? 40 : 30}px ${isPhone ? 90 : 70}px ${withAlpha("#000000", 0.32)}`,
        }}
      />
      {/* 机身（深色边框 / 浏览器外壳） */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: radius,
          background: isPhone ? "#0C0C0E" : "#1A1A1E",
          padding: isPhone ? bezel : 0,
          overflow: "hidden",
          border: isPhone ? `2px solid ${withAlpha("#FFFFFF", 0.14)}` : "none",
        }}
      >
        {isPhone ? (
          // 手机：屏幕 + 灵动岛缺口
          <div style={{ position: "relative", width: "100%", height: "100%", borderRadius: radius - bezel, overflow: "hidden", background: palette.bg }}>
            <Screen src={src} isVideo={isVideo} theme={theme} push={screenPush} />
            {/* 灵动岛 */}
            <div
              style={{
                position: "absolute",
                top: "1.4%",
                left: "50%",
                transform: "translateX(-50%)",
                width: "26%",
                height: "3.2%",
                minHeight: 18,
                borderRadius: 999,
                background: "#0C0C0E",
              }}
            />
          </div>
        ) : (
          // 浏览器：顶栏 + 三圆点 + 地址条，下面屏幕
          <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#1A1A1E" }}>
            <div style={{ height: "9%", minHeight: 34, display: "flex", alignItems: "center", gap: 10, padding: "0 18px" }}>
              {["#FF5F57", "#FEBC2E", "#28C840"].map((c) => (
                <div key={c} style={{ width: 13, height: 13, borderRadius: 999, background: c }} />
              ))}
              <div style={{ marginLeft: 16, flex: 1, height: "46%", minHeight: 16, borderRadius: 999, background: withAlpha("#FFFFFF", 0.1) }} />
            </div>
            <div style={{ flex: 1, overflow: "hidden", background: palette.bg }}>
              <Screen src={src} isVideo={isVideo} theme={theme} push={screenPush} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// 屏幕内容：有 media 铺满；无 media 给优雅占位（不黑屏）。
// push:全程缓慢推近(scale),让截图不静止——镜头一直在「看」UI。
function Screen({ src, isVideo, theme, push = 1 }) {
  const { palette, fonts, size, accent } = theme;
  if (src) {
    const mediaStyle = {
      width: "100%", height: "100%", objectFit: "cover",
      transform: `scale(${push})`, transformOrigin: "center center", willChange: "transform",
    };
    return isVideo ? (
      <OffthreadVideo src={src} muted style={mediaStyle} />
    ) : (
      <Img src={src} style={mediaStyle} />
    );
  }
  // 占位：浅底 + 居中提示 + 一条强调色线，呼应「产品 UI 应在此」。
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: `linear-gradient(160deg, ${withAlpha(accent(0), 0.14)}, ${palette.bg} 60%)`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 18,
      }}
    >
      <div style={{ width: `${44 * push}%`, height: 8, borderRadius: 999, background: accent(0), opacity: 0.85, transition: "none" }} />
      <div
        style={{
          ...GLOBAL_TEXT_STYLE,
          fontFamily: fonts.body,
          fontWeight: 600,
          fontSize: Math.round(size.small * 0.9),
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: withAlpha(palette.fg, 0.5),
        }}
      >
        Product UI
      </div>
    </div>
  );
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

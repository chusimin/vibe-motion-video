// fonts.js —— 字体方案。
// 策略:不新增依赖。优先用 config.style.fonts 里声明的字体(SF Pro / Archivo 等),
// 通过系统已装字体生效;中文一律以系统中文字体兜底(PingFang SC / Source Han Sans),
// 避免渲染缺字变方块。@remotion/google-fonts 留作扩展点(此处不引入,避免新增依赖与联网)。
//
// 这里不做实际的 @font-face 注入——CSS font stack 已在 theme.js 里拼好中文兜底;
// 浏览器(Chromium 渲染器)会按 stack 逐个回退到系统字体。
// 若将来要内嵌自定义字体,在此用 @remotion/fonts 的 loadFont 接入即可。

// 全局基础样式:统一字距、抗锯齿、禁止文本选择高亮,保证跨机一致。
export const GLOBAL_TEXT_STYLE = {
  WebkitFontSmoothing: "antialiased",
  textRendering: "geometricPrecision",
  fontKerning: "normal",
  // 中文不需要 ligature,数字用等宽避免滚动跳动由各模板单独指定
};

// 扩展点:如需 Google Fonts,可在此动态 import @remotion/google-fonts/<Family>
// 并在组件渲染前 await loadFont()。当前版本依赖系统字体,留空。
export async function ensureFontsLoaded(/* theme */) {
  // no-op:系统字体即时可用,无需异步加载。
  return;
}

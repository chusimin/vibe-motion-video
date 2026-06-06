// 轻量彩色日志,无外部依赖
const C = {
  reset: "\x1b[0m", dim: "\x1b[2m", bold: "\x1b[1m",
  red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m",
  blue: "\x1b[34m", cyan: "\x1b[36m", gray: "\x1b[90m",
};
const tag = (t, c) => `${c}${t}${C.reset}`;

export const log = {
  info: (...a) => console.log(tag("·", C.cyan), ...a),
  ok: (...a) => console.log(tag("✓", C.green), ...a),
  warn: (...a) => console.warn(tag("!", C.yellow), ...a),
  err: (...a) => console.error(tag("✗", C.red), ...a),
  step: (n, t) => console.log(`\n${C.bold}${C.blue}[${n}]${C.reset} ${C.bold}${t}${C.reset}`),
  dim: (...a) => console.log(C.gray + a.join(" ") + C.reset),
  json: (o) => console.log(JSON.stringify(o, null, 2)),
  raw: (s) => process.stdout.write(s),
};

export class UserError extends Error {}

export function die(msg) {
  log.err(msg);
  process.exit(1);
}

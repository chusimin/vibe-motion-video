// 步骤① 后半:校验 agent 撰写的 brief.json(schema: brief)。
import { UserError } from "../lib/log.mjs";
import { FILES } from "../lib/project.mjs";
import { assertValid } from "../lib/validate.mjs";

export default async function run(ctx) {
  const { project, log } = ctx;
  log.step("brief", "校验 brief.json");

  const data = await project.readJSONSafe(FILES.brief);
  if (data == null) {
    throw new UserError(
      `找不到或无法解析 ${FILES.brief}。\n` +
      "  请先阅读 00_input/brief.raw.json,据此撰写 brief.json(字段:source/title/summary/keyPoints,可选 valueProps/facts/audience/language)。"
    );
  }

  await assertValid("brief", data);   // 失败抛 UserError 并列出问题

  await project.setStep("brief", "done");
  const kp = Array.isArray(data.keyPoints) ? data.keyPoints.length : 0;
  log.ok(`brief.json 校验通过 · 标题「${data.title}」· ${kp} 个重点`);
  log.dim("下一步:vibemotion config init --type <showreel|...> --platform <douyin|...>");
}

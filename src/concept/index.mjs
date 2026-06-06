// 步骤③ —— 方向(concept)。agent 写 concepts.json,这里只做机械校验 + 友好打印。
// concepts.json 结构: { options: [{ id, hook, angle, logline }], chosen: string|null }
// concepts 无独立 schema,手写校验。
import { FILES } from "../lib/project.mjs";
import { UserError } from "../lib/log.mjs";

// 读 concepts.json 并做结构校验,返回规范化后的 { options, chosen }
async function readConcepts(project) {
  const data = await project.readJSONSafe(FILES.concepts);
  if (!data) {
    throw new UserError(
      `找不到或无法解析 ${FILES.concepts}。请先写入方向:` +
      `{ "options": [{ "id", "hook", "angle", "logline" }], "chosen": null }`
    );
  }
  if (typeof data !== "object" || Array.isArray(data)) {
    throw new UserError(`${FILES.concepts} 应为对象 { options, chosen }。`);
  }
  if (!Array.isArray(data.options)) {
    throw new UserError(`${FILES.concepts}.options 必须是数组。`);
  }
  if (data.options.length < 2) {
    throw new UserError(`方向至少要 2 个(当前 ${data.options.length} 个),让用户有得选。`);
  }

  // 逐个校验 option:必须有 id + hook + angle
  const seen = new Set();
  const errors = [];
  data.options.forEach((opt, i) => {
    const where = `options[${i}]`;
    if (typeof opt !== "object" || opt === null || Array.isArray(opt)) {
      errors.push(`${where} 不是对象`);
      return;
    }
    const idOk = typeof opt.id === "string" && opt.id.trim() !== "";
    if (!idOk) errors.push(`${where}.id 缺失或为空`);
    if (typeof opt.hook !== "string" || opt.hook.trim() === "") errors.push(`${where}.hook 缺失或为空`);
    if (typeof opt.angle !== "string" || opt.angle.trim() === "") errors.push(`${where}.angle 缺失或为空`);
    if (idOk) {
      if (seen.has(opt.id)) errors.push(`${where}.id "${opt.id}" 与前面的方向重复`);
      seen.add(opt.id);
    }
  });
  if (errors.length) {
    throw new UserError(`concepts 校验失败:\n  - ${errors.join("\n  - ")}`);
  }

  // chosen 规范化:允许缺省 / null / 空串 视为未选
  const chosen = (typeof data.chosen === "string" && data.chosen.trim() !== "") ? data.chosen : null;
  return { ...data, options: data.options, chosen, _ids: seen };
}

export default async function run(ctx) {
  const { project, positionals, log } = ctx;
  const sub = positionals[0];

  const concepts = await readConcepts(project);

  if (sub === "show") {
    log.step("方向", `${concepts.options.length} 个候选`);
    concepts.options.forEach((opt, i) => {
      const isChosen = concepts.chosen && opt.id === concepts.chosen;
      const mark = isChosen ? "★" : `${i + 1}.`;
      log.raw(`\n  ${mark} [${opt.id}]${isChosen ? "  (已选)" : ""}\n`);
      log.raw(`     钩子 hook   : ${opt.hook}\n`);
      log.raw(`     角度 angle  : ${opt.angle}\n`);
      if (typeof opt.logline === "string" && opt.logline.trim() !== "") {
        log.raw(`     一句话 logline: ${opt.logline}\n`);
      }
    });
    log.raw("\n");
    if (!concepts.chosen) {
      log.warn("尚未选定方向。让用户挑 1 个,把它的 id 写回 concepts.json 的 chosen 字段。");
    } else {
      log.ok(`已选定方向:${concepts.chosen}`);
    }
    return;
  }

  if (sub && sub !== "validate") {
    throw new UserError(`未知子命令 concept ${sub}。可用:concept(校验)/ concept show。`);
  }

  // 默认(无子命令或 validate):校验 + 视 chosen 决定是否完成本步
  log.ok(`concepts 校验通过:${concepts.options.length} 个方向,结构完整。`);

  if (concepts.chosen) {
    // chosen 已匹配某 option.id(readConcepts 已确保 id 唯一且存在性在此校验)
    if (!concepts._ids.has(concepts.chosen)) {
      throw new UserError(
        `chosen="${concepts.chosen}" 不匹配任何方向的 id。可选:${[...concepts._ids].join(", ")}`
      );
    }
    await project.setStep("concept", "done");
    log.ok(`已选定方向 "${concepts.chosen}",concept 步骤完成 → 进入分镜(storyboard)。`);
  } else {
    log.warn("请让用户选定一个方向(把对应 id 写回 concepts.json 的 chosen 字段),再继续。");
    log.dim("提示:vibemotion concept show 可友好查看各方向。");
  }
}

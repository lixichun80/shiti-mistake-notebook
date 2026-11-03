export type PracticeQuestionKind = "concept" | "method" | "misconception" | "application" | "synthesis";
export type PracticeQuestionFormat = "choice" | "fill" | "chart" | "short";

export const practiceFormatLabels: Record<PracticeQuestionFormat, string> = {
  choice: "选择题", fill: "填空题", chart: "图表题", short: "解答题",
};

export const practiceKindLabels: Record<PracticeQuestionKind | "general", string> = {
  general: "练习题",
  concept: "基础概念",
  method: "典型方法",
  misconception: "易错辨析",
  application: "迁移应用",
  synthesis: "综合运用",
};

const plans: Record<3 | 5 | 10, PracticeQuestionKind[]> = {
  3: ["concept", "method", "application"],
  5: ["concept", "method", "method", "misconception", "application"],
  10: ["concept", "concept", "method", "method", "method", "misconception", "misconception", "application", "application", "synthesis"],
};

export function validPracticeCount(count: unknown): count is number {
  return typeof count === "number" && Number.isInteger(count) && count >= 1 && count <= 30;
}

export function practiceBlueprint(count: number): PracticeQuestionKind[] {
  if (!validPracticeCount(count)) throw new Error("题目数量应为 1 到 30 道");
  if (count === 3 || count === 5 || count === 10) return [...plans[count]];
  const cycle = plans[10];
  return Array.from({ length: count }, (_, index) => cycle[index % cycle.length]);
}

export function practiceFormatBlueprint(count: number): PracticeQuestionFormat[] {
  if (!validPracticeCount(count)) throw new Error("题目数量应为 1 到 30 道");
  const cycle: PracticeQuestionFormat[] = ["choice", "fill", "short", "choice", "chart", "fill", "short", "choice", "fill", "short"];
  return Array.from({ length: count }, (_, index) => cycle[index % cycle.length]);
}

export function kindForQuestion(kind: PracticeQuestionKind | undefined): PracticeQuestionKind | "general" {
  if (kind && kind in practiceKindLabels) return kind;
  return "general";
}

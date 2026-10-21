export type PracticeQuestionKind = "concept" | "method" | "misconception" | "application" | "synthesis";

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

export function practiceBlueprint(count: 3 | 5 | 10): PracticeQuestionKind[] {
  return [...plans[count]];
}

export function kindForQuestion(kind: PracticeQuestionKind | undefined): PracticeQuestionKind | "general" {
  if (kind && kind in practiceKindLabels) return kind;
  return "general";
}

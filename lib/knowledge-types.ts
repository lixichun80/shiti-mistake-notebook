export type KnowledgeGuide = {
  coreIdea: string;
  commonMistake: string;
  firstStep: string;
};

export type KnowledgeProfile = {
  subject: string;
  knowledgePoint: string;
  unitName: string;
  guide: KnowledgeGuide | null;
};

export function normalizeKnowledgePoint(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function knowledgeKey(subject: string, point: string): string {
  return `${subject.trim()}\u0000${normalizeKnowledgePoint(point)}`;
}

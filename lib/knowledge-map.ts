export type KnowledgeEvidence = {
  id: string;
  subject: string;
  knowledgePoint: string;
  sourceId: string;
  source: "mistake" | "practice";
  createdAt: string;
};

export type KnowledgeNode = {
  id: string;
  subject: string;
  name: string;
  total: number;
  mistakeCount: number;
  practiceCount: number;
  sessionCount: number;
  priority: "high" | "medium" | "new";
  latestAt: string;
  evidenceIds: string[];
};

/** Count evidence, not an accuracy rate: only incorrect answers are stored. */
export function buildKnowledgeMap(evidence: KnowledgeEvidence[]): KnowledgeNode[] {
  const groups = new Map<string, {
    subject: string; name: string; mistakeCount: number; practiceCount: number;
    sessions: Set<string>; latestAt: string; ids: string[];
  }>();
  for (const item of evidence) {
    const subject = item.subject.trim() || "其他";
    const name = item.knowledgePoint.trim().replace(/\s+/g, " ") || "待归类知识点";
    const key = `${subject}\u0000${name}`;
    const group = groups.get(key) || { subject, name, mistakeCount: 0, practiceCount: 0, sessions: new Set<string>(), latestAt: "", ids: [] };
    if (item.source === "mistake") group.mistakeCount++;
    else group.practiceCount++;
    group.sessions.add(`${item.source}:${item.sourceId}`);
    if (item.createdAt > group.latestAt) group.latestAt = item.createdAt;
    group.ids.push(item.id);
    groups.set(key, group);
  }
  return [...groups.entries()].map(([id, group]) => {
    const total = group.mistakeCount + group.practiceCount;
    return {
      id, subject: group.subject, name: group.name, total,
      mistakeCount: group.mistakeCount, practiceCount: group.practiceCount,
      sessionCount: group.sessions.size,
      priority: (total >= 3 && group.sessions.size >= 2 ? "high" : total >= 2 ? "medium" : "new") as KnowledgeNode["priority"],
      latestAt: group.latestAt, evidenceIds: group.ids,
    };
  }).sort((a, b) => b.total - a.total || b.sessionCount - a.sessionCount || b.latestAt.localeCompare(a.latestAt));
}

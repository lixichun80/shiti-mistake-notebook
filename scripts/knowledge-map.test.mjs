import { test } from "node:test";
import assert from "node:assert/strict";
import { buildKnowledgeMap } from "../lib/knowledge-map.ts";

test("knowledge map counts repeated errors across uploads and practice without mixing subjects", () => {
  const records = [
    { id: "m1", subject: "数学", knowledgePoint: " 一元一次方程 ", sourceId: "u1", source: "mistake", createdAt: "2026-01-01" },
    { id: "m2", subject: "数学", knowledgePoint: "一元一次方程", sourceId: "u1", source: "mistake", createdAt: "2026-01-01" },
    { id: "p1:0", subject: "数学", knowledgePoint: "一元一次方程", sourceId: "p1", source: "practice", createdAt: "2026-01-02" },
    { id: "m3", subject: "物理", knowledgePoint: "一元一次方程", sourceId: "u2", source: "mistake", createdAt: "2026-01-03" },
  ];
  const nodes = buildKnowledgeMap(records);
  assert.equal(nodes.length, 2);
  assert.deepEqual(nodes[0], {
    id: "数学\u0000一元一次方程", subject: "数学", name: "一元一次方程",
    total: 3, mistakeCount: 2, practiceCount: 1, sessionCount: 2,
    priority: "high", latestAt: "2026-01-02", evidenceIds: ["m1", "m2", "p1:0"],
  });
  assert.equal(nodes[1].subject, "物理");
  assert.equal(nodes[1].priority, "new");
});

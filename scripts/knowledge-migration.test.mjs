import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

test("knowledge unit migration keeps mappings separate by user and subject", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(readFileSync(new URL("../drizzle/0006_far_miracleman.sql", import.meta.url), "utf8"));
    const insert = db.prepare("INSERT INTO knowledge_units (user_id, subject, knowledge_point, unit_name, updated_at) VALUES (?, ?, ?, ?, ?)");
    insert.run("alice", "数学", "分数", "第一单元", "2026-01-01");
    insert.run("bob", "数学", "分数", "第二单元", "2026-01-01");
    insert.run("alice", "物理", "分数", "第三单元", "2026-01-01");
    assert.equal(db.prepare("SELECT unit_name FROM knowledge_units WHERE user_id = ? AND subject = ? AND knowledge_point = ?")
      .get("alice", "数学", "分数").unit_name, "第一单元");
    assert.throws(() => insert.run("alice", "数学", "分数", "重复", "2026-01-02"), /UNIQUE constraint failed/);
    db.prepare("UPDATE knowledge_units SET guide = ? WHERE user_id = ? AND subject = ? AND knowledge_point = ?")
      .run('{"coreIdea":"通分"}', "alice", "数学", "分数");
    const save = db.prepare("INSERT INTO knowledge_units (user_id, subject, knowledge_point, unit_name, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, subject, knowledge_point) DO UPDATE SET unit_name = excluded.unit_name, guide = CASE WHEN unit_name = excluded.unit_name THEN guide ELSE '' END, updated_at = excluded.updated_at");
    save.run("alice", "数学", "分数", "第一单元", "2026-01-02");
    assert.equal(db.prepare("SELECT guide FROM knowledge_units WHERE user_id = ? AND subject = ? AND knowledge_point = ?")
      .get("alice", "数学", "分数").guide, '{"coreIdea":"通分"}');
    save.run("alice", "数学", "分数", "分数单元", "2026-01-03");
    assert.equal(db.prepare("SELECT guide FROM knowledge_units WHERE user_id = ? AND subject = ? AND knowledge_point = ?")
      .get("alice", "数学", "分数").guide, "");
    assert.equal(db.prepare("SELECT unit_name FROM knowledge_units WHERE user_id = ? AND subject = ? AND knowledge_point = ?")
      .get("bob", "数学", "分数").unit_name, "第二单元");
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM knowledge_units").get().count, 3);
  } finally { db.close(); }
});

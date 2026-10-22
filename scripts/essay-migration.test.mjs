import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

test("essay report migration stores separate histories per user", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(readFileSync(new URL("../drizzle/0007_illegal_spectrum.sql", import.meta.url), "utf8"));
    const insert = db.prepare("INSERT INTO essay_reports (id, user_id, prompt_text, original_text, grade_level, report_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
    insert.run("one", "alice", "My Family", "I love my family.", "七年级", "{}", "2026-10-21");
    insert.run("two", "bob", "My School", "This is my school.", "七年级", "{}", "2026-10-22");
    const mine = db.prepare("SELECT id FROM essay_reports WHERE user_id = ? ORDER BY created_at DESC").all("alice");
    assert.deepEqual(mine.map(row => row.id), ["one"]);
    assert.equal(db.prepare("SELECT id FROM essay_reports WHERE id = ? AND user_id = ?").get("two", "alice"), undefined);
    db.prepare("DELETE FROM essay_reports WHERE user_id = ?").run("alice");
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM essay_reports").get().count, 1);
    const indexes = db.prepare("PRAGMA index_list('essay_reports')").all().map(row => row.name);
    assert.ok(indexes.includes("essay_reports_user_created_idx"));
  } finally { db.close(); }
});

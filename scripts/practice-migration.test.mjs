import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

test("practice migration creates per-user papers and preserves existing mistakes", () => {
  const db = new DatabaseSync(":memory:");
  try {
    for (const name of [
      "0000_sad_starjammers.sql", "0001_add_users.sql", "0002_parallel_marrow.sql",
      "0003_chilly_corsair.sql", "0004_open_talisman.sql",
    ]) db.exec(readFileSync(new URL(`../drizzle/${name}`, import.meta.url), "utf8"));
    db.prepare("INSERT INTO users (id, username, password_hash, display_name, created_at) VALUES (?, ?, ?, ?, ?)")
      .run("existing", "existing", "hash", "Existing", "2026-01-01T00:00:00Z");
    db.prepare("INSERT INTO uploads (id, user_id, subject, file_keys, file_names, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run("u1", "existing", "数学", "[]", "[]", "2026-01-01T00:00:00Z");
    db.prepare("INSERT INTO mistakes (id, upload_id, user_id, subject, question, incorrect_answer, correct_answer, reasoning, knowledge_point, page_number, source_name, similar_questions, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run("m1", "u1", "existing", "数学", "2x=4", "3", "2", "两边除以 2", "方程", 1, "练习.png", "[]", "2026-01-01T00:00:00Z");
    db.exec(readFileSync(new URL("../drizzle/0005_tricky_the_anarchist.sql", import.meta.url), "utf8"));
    const columns = db.prepare("PRAGMA table_info(practice_papers)").all().map(item => item.name);
    assert(columns.includes("user_id") && columns.includes("questions") && columns.includes("grading"));
    db.prepare("INSERT INTO practice_papers (id, user_id, subject, unit_name, questions, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run("p1", "existing", "数学", "一元一次方程", "[]", "2026-01-02T00:00:00Z");
    const paper = db.prepare("SELECT answers, grading, grade_level, graded_at FROM practice_papers WHERE id = ?").get("p1");
    assert.deepEqual({ ...paper }, { answers: "[]", grading: "[]", grade_level: "", graded_at: null });
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM users").get().count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM mistakes").get().count, 1);
  } finally { db.close(); }
});

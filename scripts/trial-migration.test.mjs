import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

test("trial migration preserves existing accounts without an expiry", () => {
  const db = new DatabaseSync(":memory:");
  try {
    for (let i = 0; i < 4; i++) {
      const name = [
        "0000_sad_starjammers.sql",
        "0001_add_users.sql",
        "0002_parallel_marrow.sql",
        "0003_chilly_corsair.sql",
      ][i];
      db.exec(readFileSync(new URL(`../drizzle/${name}`, import.meta.url), "utf8"));
    }
    db.prepare("INSERT INTO users (id, username, password_hash, display_name, created_at) VALUES (?, ?, ?, ?, ?)")
      .run("existing", "existing", "hash", "Existing", "2026-01-01T00:00:00.000Z");
    db.exec(readFileSync(new URL("../drizzle/0004_open_talisman.sql", import.meta.url), "utf8"));
    const row = db.prepare("SELECT trial_ends_at FROM users WHERE id = ?").get("existing");
    assert.equal(row?.trial_ends_at, null);
  } finally {
    db.close();
  }
});

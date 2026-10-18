// Read ignored .deploy.vars, create missing local accounts, preserve existing credentials.
import { loadEnvFile } from "node:process";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
process.chdir(root);
loadEnvFile(path.join(root, ".deploy.vars"));
const userId = process.env.SHITI_DEFAULT_ID || "shiti-user";
const adminId = process.env.SHITI_BOOTSTRAP_ID || "shiti";
if (
  userId === adminId ||
  process.env.SHITI_DEFAULT_USER?.trim().toLowerCase() ===
    process.env.SHITI_BOOTSTRAP_USER?.trim().toLowerCase()
) {
  throw new Error("默认用户与管理员的 ID、用户名必须不同");
}
const sql = [];
for (const args of [["--admin"], ["--default-user"]]) {
  const result = spawnSync(
    process.execPath,
    ["scripts/seed-user.mjs", ...args],
    { cwd: root, encoding: "utf8", windowsHide: true },
  );
  if (result.status !== 0) throw new Error(result.stderr || "账号配置校验失败");
  sql.push(result.stdout);
}
if (process.argv.includes("--dry-run")) {
  console.log("两组账号配置校验通过；未修改数据库，未输出密码或哈希。");
} else {
  const temporary = mkdtempSync(path.join(tmpdir(), "shiti-account-seed-"));
  const file = path.join(temporary, "accounts.sql");
  try {
    writeFileSync(file, sql.join("\n"), { mode: 0o600 });
    const result = spawnSync(
      process.execPath,
      [
        "node_modules/wrangler/bin/wrangler.js",
        "d1",
        "execute",
        "site-creator-d1",
        "--config",
        "dist/server/wrangler.json",
        "--local",
        "--persist-to",
        ".wrangler/state",
        "--file",
        file,
        "--yes",
      ],
      { cwd: root, encoding: "utf8", windowsHide: true },
    );
    if (result.status !== 0)
      throw new Error("本地账号初始化失败，请确认已经构建并应用数据库迁移。");
    console.log(
      "默认账号初始化完成。已有账号与密码保留；登录结果请以数据库现有账号为准。",
    );
  } finally {
    // Only the exact OS temporary directory created above is eligible for cleanup.
    if (
      !path.isAbsolute(temporary) ||
      path.dirname(temporary) !== path.resolve(tmpdir()) ||
      !path.basename(temporary).startsWith("shiti-account-seed-")
    )
      throw new Error("临时路径校验失败");
    rmSync(temporary, { recursive: true, force: true });
  }
}

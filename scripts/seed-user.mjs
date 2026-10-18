#!/usr/bin/env node
/**
 * 拾题 · 智能错题本 —— 播种登录账号
 *
 * 只把一条 INSERT OR IGNORE 语句写到 stdout，不直接连库；
 * 由 deploy.sh 转交给 `wrangler d1 execute --file` 执行。
 *
 * 这么做有两个原因：
 *   1. 密码明文不进命令行参数、不进进程列表、不进日志；
 *   2. INSERT OR IGNORE 配合 username 唯一约束，脚本天然幂等，可反复跑。
 *
 * 用法（deploy.sh 里）：
 *   node scripts/seed-user.mjs > /tmp/shiti-seed.sql
 *
 * 注意：因为用了 OR IGNORE，改了 SHITI_BOOTSTRAP_PASSWORD 再部署**不会**更新
 * 已有账号。改密码要单独执行 SQL，见 AGENTS.md。
 */
import { pbkdf2Sync, randomBytes } from "node:crypto";

const ITERATIONS = 600000;
const BYTES = 32;
const SALT_BYTES = 16;

const user = (process.env.SHITI_BOOTSTRAP_USER || "").trim().toLowerCase();
const password = process.env.SHITI_BOOTSTRAP_PASSWORD || "";
const name = (process.env.SHITI_BOOTSTRAP_NAME || "").trim() || user;
// 主键必须与 uploads/mistakes 里历史数据的 user_id 对齐，默认就是 "shiti"。
// 换成别的值，登录后错题本会因为查不到而看起来被清空了。
const id = (process.env.SHITI_BOOTSTRAP_ID || "").trim() || "shiti";

if (!user || !password) {
  console.error("缺少 SHITI_BOOTSTRAP_USER / SHITI_BOOTSTRAP_PASSWORD，无法播种。");
  process.exit(1);
}
if (password.length < 8) {
  console.error("SHITI_BOOTSTRAP_PASSWORD 太短，至少 8 位。");
  process.exit(1);
}

// Node 的 pbkdf2Sync 与 workerd 的 crypto.subtle.deriveBits 都是 PBKDF2-HMAC-SHA256，
// 相同参数下产出的字节完全一致，所以这里算的哈希能在应用里通过校验。
const salt = randomBytes(SALT_BYTES);
const derived = pbkdf2Sync(password, salt, ITERATIONS, BYTES, "sha256");
const b64url = (buffer) =>
  buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const hash = `pbkdf2$${ITERATIONS}$${b64url(salt)}$${b64url(derived)}`;

const quote = (value) => String(value).replace(/'/g, "''");

process.stdout.write(
  "INSERT OR IGNORE INTO users (id, username, password_hash, display_name, created_at)\n" +
    `VALUES ('${quote(id)}', '${quote(user)}', '${quote(hash)}', '${quote(name)}', '${new Date().toISOString()}');\n`,
);

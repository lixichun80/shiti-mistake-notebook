#!/usr/bin/env node
// 把本地 D1 的结构导出成 { 表名: [列名...] } 的 JSON，供 apply-migration.mjs 判断
// 「这条 ALTER TABLE ADD COLUMN 还需不需要执行」。结果打到 stdout，其余信息一律走 stderr。
//
// 两个实测踩过的坑，别再踩回去：
//   1. 不能写成 `JOIN pragma_table_info(m.name)` —— D1 的 SQL 授权器只允许表值函数形式的
//      pragma 收**字面量**参数，把列名传进去会直接 `not authorized: SQLITE_AUTH`。
//      所以先查 sqlite_master 拿表名，再在 node 里拼成「字面量参数的 UNION ALL」一次问完。
//   2. 不能用 `npx` 起 wrangler —— Windows 上 spawnSync 不带 shell 起不了 npx.cmd，
//      报出来的是 `status === null`（spawn 本身失败），看着像 wrangler 崩了，
//      其实进程根本没起来。直接拿 node 跑 node_modules 里的 wrangler 入口，跨平台一致。
//
// 环境变量（deploy.sh 提供）：SHITI_D1_DB / SHITI_WRANGLER_CFG / SHITI_PERSIST
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DB = process.env.SHITI_D1_DB;
const CFG = process.env.SHITI_WRANGLER_CFG;
const PERSIST = process.env.SHITI_PERSIST;

if (!DB || !CFG || !PERSIST) {
  console.error("dump-schema: 需要 SHITI_D1_DB / SHITI_WRANGLER_CFG / SHITI_PERSIST");
  process.exit(1);
}

// 以仓库根为基准，这样 --persist-to 这种相对路径不受「从哪个目录调起来」影响。
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WRANGLER = join(repoRoot, "node_modules", "wrangler", "bin", "wrangler.js");
if (!existsSync(WRANGLER)) {
  console.error(`dump-schema: 找不到 wrangler 入口 ${WRANGLER}（先在仓库根跑 npm ci）`);
  process.exit(1);
}

function tryParse(text) {
  try {
    return JSON.parse(text.trim());
  } catch {
    return null;
  }
}

// --json 下 stdout 就是纯 JSON。留一层兜底，万一以后混进 banner 也能截出来。
function parseJson(stdout) {
  const direct = tryParse(stdout);
  if (direct) return direct;
  const lines = stdout.split(/\r?\n/);
  const start = lines.findIndex((line) => /^\s*[[{]/.test(line));
  if (start !== -1) {
    for (let i = start; i < lines.length; i += 1) {
      const parsed = tryParse(lines.slice(i).join("\n"));
      if (parsed) return parsed;
    }
  }
  console.error(`dump-schema: wrangler 输出不是 JSON：\n${stdout}`);
  process.exit(1);
}

// wrangler 的 --json 是「每条语句一个元素」的数组，元素形如 {results, success, meta}。
// 形状不对就当场报错，绝不吞掉错误退化成空结构 —— 空结构会让 apply-migration 以为
// 「库里什么都没有」，把所有 ADD COLUMN 全重放一遍，撞 duplicate column name。
function runQuery(sql, label) {
  const result = spawnSync(
    process.execPath,
    [WRANGLER, "d1", "execute", DB, "--config", CFG, "--local",
     "--persist-to", PERSIST, "--json", "--command", sql],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], cwd: repoRoot },
  );
  if (result.error) {
    console.error(`dump-schema: 起不动 wrangler —— ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`dump-schema: wrangler 退出码 ${result.status}\n${result.stderr || ""}`);
    process.exit(1);
  }
  const parsed = parseJson(result.stdout);
  if (!Array.isArray(parsed)) {
    console.error(`dump-schema: ${label} 的 --json 输出不是数组：\n${JSON.stringify(parsed)}`);
    process.exit(1);
  }
  for (const entry of parsed) {
    if (!entry || entry.success !== true) {
      console.error(`dump-schema: ${label} 有语句执行失败：\n${JSON.stringify(entry)}`);
      process.exit(1);
    }
  }
  return parsed[0]?.results ?? [];
}

// SQLite 标识符引用：双引号包裹，内部双引号翻倍。
function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

// 字符串字面量引用：单引号包裹，内部单引号翻倍。
function quoteLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

// `_cf_METADATA` 是 D1 的内部表，必须排除。
const tables = runQuery(
  "SELECT name FROM sqlite_master WHERE type='table' " +
  "AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name",
  "列表名",
).map((row) => row.name);

const schema = Object.create(null);
for (const table of tables) schema[table] = [];

if (tables.length > 0) {
  const union = tables
    .map((t) => `SELECT ${quoteLiteral(t)} AS tbl, name AS col FROM pragma_table_info(${quoteIdent(t)})`)
    .join(" UNION ALL ");
  for (const row of runQuery(union, "查列名")) {
    if (Object.hasOwn(schema, row.tbl)) schema[row.tbl].push(row.col);
  }
}

process.stdout.write(`${JSON.stringify(schema, null, 2)}\n`);

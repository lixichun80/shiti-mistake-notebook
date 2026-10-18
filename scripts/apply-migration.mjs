#!/usr/bin/env node
// 把 drizzle 生成的迁移转成「可以重复执行」的 SQL。不连库，纯文本处理。
//
// 为什么需要它：deploy.sh 每次都全量重放 drizzle/*.sql（没有「已应用」记录表），
// 所以每条语句都必须幂等。CREATE TABLE / CREATE INDEX 能加 IF NOT EXISTS，
// 但 SQLite 没有 ALTER TABLE ... ADD COLUMN IF NOT EXISTS —— 靠
// 「先问库结构（--schema 给的 JSON），列已存在就丢掉这条」来补上。
//
// 用法：
//   node scripts/apply-migration.mjs --schema <schema.json> --out <目录> drizzle/*.sql
//
// 一次性收下**全部**迁移文件，而不是一个文件起一次进程：迁移之间有依赖
// （0000 建表、0002 给它加列），必须共用一份「本次已输出过哪些列」的视图，
// 否则同一个 (表, 列) 可能被两个文件各输出一次，执行时撞 duplicate column name。
//
// 每个迁移的输出写到 <目录>/<原文件名>；没有待执行语句就不写文件（deploy.sh 用 -s 判断）。
// 空文件绝不送去 d1 execute —— 那是白白多一次 workerd 启动。
//
// 只放行 ALTER TABLE ... ADD COLUMN。DROP / RENAME / ALTER COLUMN 一律拒绝退出：
// 它们没法靠「看一眼当前结构」判断该不该执行，硬做会静默改错数据。
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const BREAKPOINT = /-{2,}>\s*statement-breakpoint/;

// 会静默改错数据的语句形态。DROP ... IF EXISTS 本身是幂等的，放行。
const DESTRUCTIVE = [
  [/\bDROP\s+TABLE\b(?!\s+IF\s+EXISTS)/i, "DROP TABLE"],
  [/\bDROP\s+INDEX\b(?!\s+IF\s+EXISTS)/i, "DROP INDEX"],
  [/\bDROP\s+COLUMN\b/i, "DROP COLUMN"],
  [/\bRENAME\s+TO\b/i, "RENAME TO"],
  [/\bALTER\s+COLUMN\b/i, "ALTER COLUMN"],
];

function parseArgs(argv) {
  let schemaPath = null;
  let outDir = null;
  const files = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--schema") {
      schemaPath = argv[i + 1] ?? null;
      i += 1;
    } else if (argv[i] === "--out") {
      outDir = argv[i + 1] ?? null;
      i += 1;
    } else {
      files.push(argv[i]);
    }
  }
  return { schemaPath, outDir, files };
}

// 读 { 表名: [列名] } 的结构快照。表名与列名都归一成小写做比较 ——
// SQLite 的标识符比较对 ASCII 是不区分大小写的。
//
// 读不到 / 解析失败时返回空表：空表 = 「库里什么都没有」，所有 ADD COLUMN 都会输出。
// 这个方向是安全的 —— 真在已有库上重放 ADD COLUMN 会报 duplicate column name，
// 部署当场中止（响），不会静默建出一个缺列的库（哑）。
function loadSchema(path) {
  if (!path) return new Map();
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return new Map();
  }
  const map = new Map();
  for (const [table, columns] of Object.entries(raw ?? {})) {
    map.set(String(table).toLowerCase(), new Set((columns ?? []).map((c) => String(c).toLowerCase())));
  }
  return map;
}

// SQLite 标识符：可以是 `反引号` / "双引号" / [方括号] 包裹的，也可以是裸词。
function readIdent(text, pos) {
  let i = pos;
  while (i < text.length && /\s/.test(text[i])) i += 1;
  const open = text[i];
  const closers = { "`": "`", '"': '"', "[": "]" };
  if (closers[open]) {
    const close = closers[open];
    const end = text.indexOf(close, i + 1);
    if (end === -1) return null;
    return { name: text.slice(i + 1, end), next: end + 1 };
  }
  const match = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(text.slice(i));
  if (!match) return null;
  return { name: match[0], next: i + match[0].length };
}

// 只认 `ALTER TABLE <表> ADD [COLUMN] <列> ...`，其余形态返回 null。
function parseAlterAddColumn(stmt) {
  const head = /^\s*ALTER\s+TABLE\s+/i.exec(stmt);
  if (!head) return null;
  const table = readIdent(stmt, head[0].length);
  if (!table) return null;
  const add = /^\s+ADD\s+(?:COLUMN\s+)?/i.exec(stmt.slice(table.next));
  if (!add) return null;
  const column = readIdent(stmt, table.next + add[0].length);
  if (!column) return null;
  return { table: table.name, column: column.name };
}

function addIfNotExists(stmt) {
  return stmt
    .replace(/^(\s*CREATE\s+TABLE\s+)(?!IF\s+NOT\s+EXISTS\b)/i, "$1IF NOT EXISTS ")
    .replace(/^(\s*CREATE\s+UNIQUE\s+INDEX\s+)(?!IF\s+NOT\s+EXISTS\b)/i, "$1IF NOT EXISTS ")
    .replace(/^(\s*CREATE\s+INDEX\s+)(?!IF\s+NOT\s+EXISTS\b)/i, "$1IF NOT EXISTS ");
}

const { schemaPath, outDir, files } = parseArgs(process.argv.slice(2));
if (files.length === 0) {
  console.error("apply-migration: 没有给迁移文件");
  process.exit(1);
}
if (!outDir) {
  console.error("apply-migration: 缺少 --out 目录");
  process.exit(1);
}

const known = loadSchema(schemaPath); // 库里已经有的列
const emitted = new Set();            // 本次已经输出过的 (表, 列)，跨文件去重
mkdirSync(outDir, { recursive: true });

let total = 0;
for (const file of files) {
  const text = readFileSync(file, "utf8").replace(/\r/g, "");
  const chunks = text.split(BREAKPOINT).map((chunk) => chunk.trim()).filter(Boolean);
  const out = [];

  for (const chunk of chunks) {
    const destructive = DESTRUCTIVE.find(([pattern]) => pattern.test(chunk));
    if (destructive) {
      console.error(
        `apply-migration: ${file} 里有 ${destructive[1]}，它不幂等，还可能删掉真实数据。\n` +
        `这类迁移没法自动判断该不该执行，必须人工处理。\n--- 语句原文 ---\n${chunk}`,
      );
      process.exit(1);
    }

    if (/^CREATE\s+TABLE\b/i.test(chunk) || /^CREATE\s+(UNIQUE\s+)?INDEX\b/i.test(chunk)) {
      out.push(addIfNotExists(chunk));
      continue;
    }

    if (/^\s*ALTER\s+TABLE\b/i.test(chunk)) {
      const target = parseAlterAddColumn(chunk);
      if (!target) {
        console.error(
          `apply-migration: ${file} 里有非 ADD COLUMN 形态的 ALTER TABLE，无法做到幂等。\n` +
          `SQLite 只有 ADD COLUMN 能靠「查一下这列在不在」判断该不该执行。\n--- 语句原文 ---\n${chunk}`,
        );
        process.exit(1);
      }
      const key = `${target.table.toLowerCase()}.${target.column.toLowerCase()}`;
      // 快照里没有这张表，说明库里确实还没这张表（表名是从 sqlite_master 全量查出来的），
      // 那这条 ADD COLUMN 就得执行 —— 前面的 CREATE TABLE 建出来的是当时那份 DDL。
      if (known.get(target.table.toLowerCase())?.has(target.column.toLowerCase())) continue;
      if (emitted.has(key)) continue;
      emitted.add(key);
      out.push(chunk);
      continue;
    }

    // INSERT OR IGNORE / UPDATE ... WHERE 这类由作者自己保证幂等，原样放行。
    out.push(chunk);
  }

  // 兜底自检：按断点切分是按 drizzle 的约定来的。万一某个迁移漏写了断点、
  // 把多条语句塞进一个块里，上面会漏掉里面的 ALTER，这里拦下来。
  const lineStartAlters = text.split("\n").filter((line) => /^\s*ALTER\s+TABLE\b/i.test(line)).length;
  const handledAlters = chunks.filter((chunk) => /^\s*ALTER\s+TABLE\b/i.test(chunk)).length;
  if (lineStartAlters !== handledAlters) {
    console.error(
      `apply-migration: ${file} 里有 ${lineStartAlters} 条 ALTER TABLE，` +
      `但只按 --> statement-breakpoint 切出了 ${handledAlters} 个 ALTER 块。` +
      `多半是漏了语句分隔符，请检查迁移文件的格式。`,
    );
    process.exit(1);
  }

  if (out.length > 0) {
    writeFileSync(join(outDir, basename(file)), `${out.join("\n")}\n`);
    total += out.length;
    console.error(`apply-migration: ${basename(file)} → ${out.length} 条待执行`);
  } else {
    console.error(`apply-migration: ${basename(file)} → 无待执行语句`);
  }
}

console.error(`apply-migration: 合计 ${total} 条待执行`);

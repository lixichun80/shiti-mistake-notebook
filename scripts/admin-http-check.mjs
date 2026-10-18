// Build first, then run: node scripts/admin-http-check.mjs [--keep-server]
// Automation tools must use tty=true for --keep-server so stdin remains open for cleanup.
// All accounts, secrets, database and bucket objects live in a disposable OS temp directory.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";
import { setTimeout as delay } from "node:timers/promises";

const root = fileURLToPath(new URL("../", import.meta.url));
const temporary = mkdtempSync(path.join(tmpdir(), "shiti-admin-http-"));
const secret = randomBytes(32).toString("hex");
const password = randomBytes(18).toString("base64url");
const nextPassword = `${password}2`;
const wrangler = path.join(root, "node_modules/wrangler/bin/wrangler.js");
const configPath = path.join(temporary, "wrangler.json");
const statePath = path.join(temporary, "state");
const runtimeEnv = {
  ...process.env,
  CLOUDFLARE_CF_FETCH_ENABLED: "false",
  WRANGLER_SEND_METRICS: "false",
  WRANGLER_REGISTRY_PATH: path.join(temporary, "registry"),
  WRANGLER_LOG_PATH: path.join(temporary, "logs"),
  WRANGLER_WRITE_LOGS: "false",
};
let child;
let logs = "";
let checks = 0;
function cli(args) {
  const result = spawnSync(process.execPath, [wrangler, ...args], {
    cwd: temporary,
    env: runtimeEnv,
    encoding: "utf8",
    timeout: 90_000,
    windowsHide: true,
  });
  if (result.status !== 0)
    throw new Error(
      `Wrangler command failed: ${result.stderr || result.stdout || result.error}`,
    );
  return result.stdout;
}
function sql(value) {
  const file = path.join(temporary, "query.sql");
  writeFileSync(file, value);
  return cli([
    "d1",
    "execute",
    "site-creator-d1",
    "--config",
    configPath,
    "--local",
    "--persist-to",
    statePath,
    "--file",
    file,
    "--yes",
  ]);
}
function token(id, epoch) {
  const payload = {
    v: 1,
    uid: id,
    name: id,
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  if (epoch !== undefined) payload.ep = epoch;
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `shiti_session=${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}
const port = await new Promise((resolve, reject) => {
  const socket = net.createServer();
  socket.once("error", reject);
  socket.listen(0, "127.0.0.1", () => {
    const value = socket.address().port;
    socket.close(() => resolve(value));
  });
});
const base = `http://127.0.0.1:${port}`;
async function request(
  url,
  expected,
  cookie,
  method = "GET",
  body,
  headers = {},
) {
  const response = await fetch(`${base}${url}`, {
    method,
    redirect: "manual",
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  assert.equal(
    response.status,
    expected,
    `${method} ${url}: expected ${expected}, got ${response.status}; ${response.status === expected ? "" : await response.text()}`,
  );
  checks++;
  return response;
}
try {
  const config = JSON.parse(
    readFileSync(path.join(root, "dist/server/wrangler.json"), "utf8"),
  );
  config.main = path.join(root, "dist/server", config.main);
  config.assets.directory = path.resolve(
    root,
    "dist/server",
    config.assets.directory,
  );
  config.name = `shiti-http-${randomBytes(4).toString("hex")}`;
  config.vars = {
    SESSION_SECRET: secret,
    DEEPSEEK_API_KEY: "local-e2e-dummy-key",
    TRUST_OAI_HEADERS: "0",
  };
  delete config.build;
  writeFileSync(configPath, JSON.stringify(config));
  const migrations = readdirSync(path.join(root, "drizzle"))
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => readFileSync(path.join(root, "drizzle", name), "utf8"))
    .join("\n");
  const salt = randomBytes(16);
  const hash = `pbkdf2$600000$${salt.toString("base64url")}$${pbkdf2Sync(password, salt, 600000, 32, "sha256").toString("base64url")}`;
  sql(`${migrations}\nINSERT INTO users (id,username,password_hash,display_name,created_at,role) VALUES ('http-admin','httpadmin','${hash}','HTTP Admin',datetime('now'),'admin'),('http-user','httpuser','${hash}','HTTP User',datetime('now'),'user');
INSERT INTO uploads VALUES ('http-batch','http-user','数学','["test-photo"]','["test.png"]',datetime('now'));
INSERT INTO mistakes VALUES ('http-mistake','http-batch','http-user','数学','1+1=?','3','2','加法','整数',1,'test.png','[]',datetime('now'));`);
  // Local R2 object proves the delete route works against the actual bucket implementation.
  const photo = path.join(temporary, "test-photo.txt");
  writeFileSync(photo, "isolated HTTP regression object");
  cli([
    "r2",
    "object",
    "put",
    "site-creator-r2/test-photo",
    "--config",
    configPath,
    "--local",
    "--persist-to",
    statePath,
    "--file",
    photo,
  ]);
  child = spawn(
    process.execPath,
    [
      wrangler,
      "dev",
      "--config",
      configPath,
      "--local",
      "--persist-to",
      statePath,
      "--ip",
      "127.0.0.1",
      "--port",
      String(port),
      "--inspector-port",
      "0",
    ],
    {
      cwd: temporary,
      env: runtimeEnv,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (data) => {
      logs = `${logs}${data}`.slice(-12000);
    });
  let ready = false;
  for (let attempt = 0; attempt < 90; attempt++) {
    try {
      const response = await fetch(`${base}/api/status`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.status === 200) {
        ready = true;
        break;
      }
    } catch {
      /* startup */
    }
    if (child.exitCode !== null)
      throw new Error(`Worker exited during startup: ${logs}`);
    await delay(1000);
  }
  assert.ok(ready, `Worker startup timed out: ${logs}`);
  console.log("Isolated local worker ready; checking HTTP contracts.");
  const admin = token("http-admin", 0);
  const user = token("http-user", 0);
  const legacy = token("http-user");
  await request("/login", 200);
  await request("/register", 200);
  await request("/api/mistakes", 401);
  await request("/api/mistakes", 401, undefined, "GET", undefined, {
    "oai-authenticated-user-id": "http-admin",
  });
  for (const endpoint of ["users", "stats", "mistakes", "uploads", "system"]) {
    await request(`/api/admin/${endpoint}`, 401);
    await request(`/api/admin/${endpoint}`, 403, user);
    await request(`/api/admin/${endpoint}`, 200, admin);
  }
  await request("/admin", 200, admin);
  const ordinaryPage = await fetch(`${base}/admin`, {
    headers: { Cookie: user },
    redirect: "manual",
  });
  assert.notEqual(ordinaryPage.status, 200);
  checks++;
  await request("/api/mistakes", 200, legacy);
  await request("/api/auth/login", 401, undefined, "POST", {
    username: "httpuser",
    password: "wrong-password",
  });
  const login = await request("/api/auth/login", 200, undefined, "POST", {
    username: "httpuser",
    password,
  });
  const loginCookie = login.headers.get("set-cookie").split(";")[0];
  await request("/api/mistakes", 200, loginCookie);
  const logout = await request(
    "/api/auth/logout",
    200,
    loginCookie,
    "POST",
    {},
  );
  assert.match(
    logout.headers.get("set-cookie"),
    /shiti_session=.*(?:Max-Age=0|expires=)/i,
  );
  await request("/api/admin/users/http-admin", 400, admin, "PATCH", {
    status: "disabled",
  });
  await request("/api/admin/users/http-admin", 400, admin, "DELETE");
  await request("/api/admin/users/http-user", 200, admin, "PATCH", {
    password: nextPassword,
  });
  await request("/api/mistakes", 401, loginCookie);
  await request("/api/mistakes", 401, legacy);
  const newLogin = await request("/api/auth/login", 200, undefined, "POST", {
    username: "httpuser",
    password: nextPassword,
  });
  const newCookie = newLogin.headers.get("set-cookie").split(";")[0];
  await request("/api/mistakes", 200, newCookie);
  await request("/api/admin/users/http-user", 200, admin, "PATCH", {
    status: "disabled",
  });
  await request("/api/mistakes", 401, newCookie);
  await request("/api/admin/users/http-user", 200, admin, "PATCH", {
    status: "active",
  });
  await request("/api/mistakes", 401, newCookie);
  await request("/api/admin/mistakes/http-mistake", 400, admin, "PATCH", {
    question: "",
  });
  await request("/api/admin/mistakes/http-mistake", 200, admin, "PATCH", {
    question: "2+2=?",
    correctAnswer: "4",
  });
  const found = await (
    await request("/api/admin/mistakes?search=2%2B2", 200, admin)
  ).json();
  assert.equal(found.mistakes[0].correctAnswer, "4");
  await request("/api/admin/mistakes/missing", 404, admin, "PATCH", {
    question: "missing",
  });
  await request("/api/admin/mistakes/missing", 404, admin, "DELETE");
  await request("/api/admin/mistakes?page=-1", 400, admin);
  await request("/api/admin/system", 400, admin, "POST", { action: "test-ai" });
  await request("/api/admin/uploads/http-batch", 200, admin, "DELETE");
  const empty = await (await request("/api/admin/mistakes", 200, admin)).json();
  assert.equal(empty.total, 0);
  await request("/api/admin/uploads/http-batch", 404, admin, "DELETE");
  const registration = {
    username: "httpregistered",
    password,
    displayName: "HTTP Registered",
  };
  await request("/api/auth/register", 200, undefined, "POST", registration);
  await request("/api/auth/register", 409, undefined, "POST", registration);
  const created = await (
    await request("/api/admin/users", 200, admin, "POST", {
      username: "httpcreated",
      password,
      displayName: "HTTP Created",
    })
  ).json();
  await request(`/api/admin/users/${created.id}`, 200, admin, "DELETE");
  console.log(
    `Admin HTTP checks passed (${checks} requests/assertions). No real AI calls made.`,
  );
  if (process.argv.includes("--keep-server")) {
    sql(`INSERT INTO uploads VALUES ('preview-batch','http-user','数学','[]','["数学周练.png"]',datetime('now'));
INSERT INTO mistakes VALUES ('preview-math','preview-batch','http-user','数学','计算：(-3)² + 2 × (-4)','-17','1','先算乘方得9，再算乘法得-8，最后相加得1。','有理数混合运算',1,'数学周练.png','[]',datetime('now'));
INSERT INTO mistakes VALUES ('preview-english','preview-batch','http-user','英语','She ___ to school every day. (go)','go','goes','主语She是第三人称单数，一般现在时动词加-es。','一般现在时',1,'英语作业.png','[]',datetime('now'));`);
    console.log(
      `Temporary preview server: ${base}\nTemporary admin username: httpadmin\nTemporary admin password: ${password}\nStop with Ctrl+C or type stop + Enter to remove all temporary storage.`,
    );
    await new Promise((resolve) => {
      process.once("SIGINT", resolve);
      process.once("SIGTERM", resolve);
      process.stdin.resume();
      process.stdin.once("data", resolve);
    });
    process.stdin.pause();
  }
} finally {
  if (child && child.exitCode === null) {
    child.kill();
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      delay(5000),
    ]);
    if (child.exitCode === null && process.platform === "win32")
      spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
  }
  // Only remove the exact directory returned by mkdtemp; never user project storage.
  assert.ok(path.isAbsolute(temporary));
  assert.equal(path.dirname(temporary), path.resolve(tmpdir()));
  assert.ok(path.basename(temporary).startsWith("shiti-admin-http-"));
  rmSync(temporary, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 300,
  });
}

// Run with node scripts/admin-api-check.mjs. Uses isolated bindings; never touches persisted data.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const env = {};
let fetchImpl;
let authResult = { user: { id: "test-admin", role: "admin" } };
function load(file, dependencies = {}) {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText;
  const loaded = { exports: {} };
  vm.runInNewContext(
    code,
    {
      module: loaded,
      exports: loaded.exports,
      console,
      Response,
      Request,
      URL,
      URLSearchParams,
      SyntaxError,
      AbortController,
      setTimeout,
      clearTimeout,
      fetch: (...args) => fetchImpl(...args),
      require: (name) => {
        if (name === "cloudflare:workers") return { env };
        if (name === "@/lib/api-guard")
          return { authenticateAdmin: async () => authResult };
        if (dependencies[name]) return dependencies[name];
        throw new Error(`Unexpected dependency: ${name}`);
      },
    },
    { filename: file },
  );
  return loaded.exports;
}
const admin = load("lib/admin.ts");
const routes = (name) =>
  load(`app/api/admin/${name}/route.ts`, { "@/lib/admin": admin });
const mistakes = routes("mistakes/[id]");
const uploads = routes("uploads/[id]");
const list = routes("mistakes");
const system = routes("system");
const params = { params: Promise.resolve({ id: "batch-1" }) };
const req = (body, method = "PATCH") =>
  new Request("http://localhost/api/admin/test", {
    method,
    body: JSON.stringify(body),
  });
const events = [];
let exists = true;
let keys = '["photo-1","photo-2"]';
let failR2 = false;
env.DB = {
  prepare() {
    return {
      bind() {
        return this;
      },
      async first() {
        events.push("lookup");
        return exists ? { file_keys: keys } : null;
      },
      async run() {
        return { meta: { changes: exists ? 1 : 0 } };
      },
    };
  },
  async batch() {
    events.push("database-delete");
    exists = false;
  },
};
env.BUCKET = {
  async delete() {
    events.push("r2-delete");
    if (failR2) throw new Error("simulated R2 outage");
  },
};

failR2 = true;
await assert.rejects(admin.deleteAdminUpload("batch-1"), /simulated R2 outage/);
assert.equal(exists, true);
assert.equal(events.includes("database-delete"), false);
failR2 = false;
events.length = 0;
await admin.deleteAdminUpload("batch-1");
assert.equal(events.join(","), "lookup,r2-delete,database-delete");
assert.equal((await uploads.DELETE(req({}, "DELETE"), params)).status, 404);
assert.equal((await mistakes.DELETE(req({}, "DELETE"), params)).status, 404);
assert.equal(
  (await mistakes.PATCH(req({ question: "Valid question" }), params)).status,
  404,
);
exists = true;
for (const body of [
  null,
  [],
  {},
  { question: " " },
  { question: 123 },
  { userId: "other" },
]) {
  assert.equal((await mistakes.PATCH(req(body), params)).status, 400);
}
const malformed = new Request("http://localhost", {
  method: "PATCH",
  body: "{",
});
assert.equal((await mistakes.PATCH(malformed, params)).status, 400);
for (const query of [
  "page=-1",
  "page=1.2",
  "page=abc",
  "pageSize=101",
  "pageSize=0",
]) {
  assert.equal(
    (await list.GET(new Request(`http://localhost?${query}`))).status,
    400,
  );
}
keys = "corrupt-json";
events.length = 0;
await assert.rejects(admin.deleteAdminUpload("batch-1"));
assert.equal(events.includes("database-delete"), false);
keys = '["photo-1"]';
delete env.BUCKET;
await assert.rejects(admin.deleteAdminUpload("batch-1"), /R2/);
assert.equal(exists, true);

env.DEEPSEEK_API_KEY = "local-e2e-dummy-key";
assert.equal(
  (await system.POST(req({ action: "test-ai" }, "POST"))).status,
  400,
);
env.DEEPSEEK_API_KEY = "isolated-test-key";
fetchImpl = async (url, options) => {
  assert.equal(url, "https://api.deepseek.com/responses");
  assert.equal(JSON.parse(options.body).model, "deepseek-flash");
  assert.ok(options.signal);
  return Response.json({
    output: [{ content: [{ type: "output_text", text: "OK" }] }],
  });
};
assert.equal(
  (await system.POST(req({ action: "test-ai" }, "POST"))).status,
  200,
);
fetchImpl = async () => Response.json({ output: [] });
assert.equal(
  (await system.POST(req({ action: "test-ai" }, "POST"))).status,
  502,
);
fetchImpl = async () =>
  new Response("DO-NOT-REFLECT-UPSTREAM-DETAIL", { status: 401 });
const failed = await system.POST(req({ action: "test-ai" }, "POST"));
assert.equal(failed.status, 502);
assert.equal((await failed.text()).includes("DO-NOT-REFLECT"), false);
for (const status of [401, 403, 503]) {
  authResult = { response: new Response(null, { status }) };
  assert.equal((await system.GET()).status, status);
  assert.equal(
    (await uploads.DELETE(req({}, "DELETE"), params)).status,
    status,
  );
  assert.equal(
    (await mistakes.PATCH(req({ question: "test" }), params)).status,
    status,
  );
  assert.equal(
    (await list.GET(new Request("http://localhost"))).status,
    status,
  );
}
console.log(
  "Admin API checks passed: safe deletion/retry, validation, 404, guard propagation, real AI contract.",
);

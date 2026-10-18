// Non-mutating public-proxy checks: an empty form must reach validation, while cross-origin requests stay blocked.
import assert from "node:assert/strict";
const origins = process.argv.slice(2);
if (!origins.length) throw new Error("请传入实际对外入口，例如 https://study.zxai.studio http://198.44.177.126:8095");
for (const value of origins) {
  const origin = new URL(value).origin;
  for (const [sentOrigin, expected] of [[origin, 400], ["https://untrusted.invalid", 403]]) {
    const response = await fetch(`${origin}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: sentOrigin, "Sec-Fetch-Site": "same-origin" },
      body: "{}",
      signal: AbortSignal.timeout(20_000),
    });
    assert.equal(response.status, expected, `${origin}: Origin=${sentOrigin} 应返回 ${expected}，实际 ${response.status}`);
  }
  console.log(`PASS ${origin}: 同源请求可达注册校验，跨源请求被拒绝；未创建账号。`);
}

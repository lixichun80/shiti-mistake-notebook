import { authenticateAdmin } from "@/lib/api-guard";
import { getAdminSystemStatus } from "@/lib/admin";
import { env } from "cloudflare:workers";

export async function GET() {
  const auth = await authenticateAdmin();
  if ("response" in auth) return auth.response;

  try {
    const status = await getAdminSystemStatus();
    return Response.json(status, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Failed to get system status", error);
    return Response.json({ error: "获取系统状态失败" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const auth = await authenticateAdmin();
  if ("response" in auth) return auth.response;

  try {
    const body = (await request.json().catch(() => null)) as {
      action?: string;
    } | null;
    if (body?.action === "test-ai") {
      const apiKey = env.DEEPSEEK_API_KEY?.trim();
      if (
        !apiKey ||
        ["placeholder_key", "local-e2e-dummy-key"].includes(apiKey)
      ) {
        return Response.json(
          { ok: false, message: "DEEPSEEK_API_KEY 未在环境变量中配置" },
          { status: 400 },
        );
      }

      const start = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20_000);
      try {
        // Probe the same model and endpoint as the actual analysis service.
        const response = await fetch("https://api.deepseek.com/responses", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: "deepseek-flash",
            input: [
              {
                role: "user",
                content: [{ type: "input_text", text: "Reply only with OK." }],
              },
            ],
            max_output_tokens: 32,
          }),
          signal: controller.signal,
        });

        const elapsed = Date.now() - start;
        if (!response.ok) {
          await response.body?.cancel();
          return Response.json(
            {
              ok: false,
              message: `DeepSeek API 响应异常（HTTP ${response.status}）`,
              latencyMs: elapsed,
            },
            { status: 502 },
          );
        }

        const result = (await response.json()) as {
          output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
        };
        const output = result?.output
          ?.flatMap((item) => item.content ?? [])
          .find((item) => item.type === "output_text" && item.text?.trim());
        if (!output)
          return Response.json(
            {
              ok: false,
              message: "AI 未返回可读取的模型结果",
              latencyMs: Date.now() - start,
            },
            { status: 502 },
          );
        return Response.json({
          ok: true,
          message: "deepseek-flash 文本连通正常（未测试图片识别）",
          latencyMs: elapsed,
        });
      } catch {
        return Response.json(
          {
            ok: false,
            message: controller.signal.aborted
              ? "AI 服务连接超时，请稍后重试"
              : "AI 服务连接失败，请稍后重试",
            latencyMs: Date.now() - start,
          },
          { status: controller.signal.aborted ? 504 : 502 },
        );
      } finally {
        clearTimeout(timer);
      }
    }

    return Response.json({ error: "未知操作" }, { status: 400 });
  } catch {
    return Response.json({ error: "请求失败" }, { status: 500 });
  }
}

"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight, BookOpen, LoaderCircle } from "lucide-react";

export default function LoginForm({ returnTo }: { returnTo: string }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    setPending(true);
    setError("");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      // nginx 限流返回的是 HTML，解析失败要兜住，否则会把 SyntaxError 抛给用户
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(
          data.error ||
            (response.status === 429 ? "尝试次数过多，请稍后再试" : "登录失败，请重试"),
        );
      }

      // 整页跳转而不是 router.push：要让服务端重新读一次 cookie 再渲染，
      // 否则会先闪一下未登录状态。
      window.location.href = returnTo;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "登录失败，请重试");
      setPending(false);
    }
  }

  return (
    <div className="login-page">
      <span className="login-glow" aria-hidden="true" />
      <main className="login-card">
        <div className="login-brand">
          <span className="brand-mark">
            <BookOpen size={25} strokeWidth={2.2} />
          </span>
          <span>
            <strong>拾题</strong>
            <small>把每一次错误，变成进步</small>
          </span>
        </div>

        <h1>欢迎回来</h1>
        <p className="login-subtitle">登录后继续整理你的错题本。</p>

        <form className="login-form" onSubmit={submit}>
          <label>
            <span>用户名</span>
            <input
              name="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoFocus
              required
            />
          </label>

          <label>
            <span>密码</span>
            <input
              name="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </label>

          {error && (
            <div className="login-error" role="alert">
              {error}
            </div>
          )}

          <button
            type="submit"
            className="login-submit"
            disabled={pending || !username || !password}
          >
            {pending ? (
              <>
                <LoaderCircle size={17} className="spin" />
                正在登录...
              </>
            ) : (
              <>
                进入学习空间 <ArrowRight size={16} />
              </>
            )}
          </button>
        </form>

        <p className="login-switch">
          还没有账号？
          {/* vinext 客户端 Link 跳转会报错，认证入口使用整页导航。 */}
          <a href="/register" className="login-link">立即注册</a>
        </p>

        <p className="login-footnote">
          错题只对登录的账号可见，登录状态保留 30 天。忘记密码请联系管理员重置。
        </p>
      </main>
    </div>
  );
}

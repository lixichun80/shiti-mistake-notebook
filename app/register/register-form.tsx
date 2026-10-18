"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowRight, BookOpen, LoaderCircle } from "lucide-react";

export default function RegisterForm() {
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const mismatched = confirm.length > 0 && confirm !== password;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    // 确认密码只在前端比对，后端根本不收这个字段 —— 它防的是打错字，不是攻击。
    if (password !== confirm) {
      setError("两次输入的密码不一致");
      return;
    }

    setPending(true);
    setError("");

    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, displayName }),
      });
      // nginx 限流返回的是 HTML，解析失败要兜住，否则会把 SyntaxError 抛给用户
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(
          data.error ||
            (response.status === 429 ? "操作太频繁，请稍后再试" : "注册失败，请重试"),
        );
      }

      // 整页跳转而不是 router.push：要让服务端重新读一次 cookie 再渲染，
      // 否则会先闪一下未登录状态。
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = "/";
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "注册失败，请重试");
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

        <span className="section-kicker">01 / SIGN UP</span>
        <h1>创建账号</h1>
        <p className="login-subtitle">注册后立刻拥有自己的错题本，和别人互不可见。</p>

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
            <small className="login-hint">3-32 位小写字母、数字、下划线或短横线</small>
          </label>

          <label>
            <span>昵称</span>
            <input
              name="displayName"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              autoComplete="nickname"
              placeholder="留空就用用户名"
            />
          </label>

          <label>
            <span>密码</span>
            <input
              name="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              required
            />
            <small className="login-hint">至少 8 位</small>
          </label>

          <label>
            <span>确认密码</span>
            <input
              name="confirm"
              type="password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              autoComplete="new-password"
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
            disabled={pending || !username || !password || !confirm || mismatched}
          >
            {pending ? (
              <>
                <LoaderCircle size={17} className="spin" />
                正在创建...
              </>
            ) : (
              <>
                创建并进入 <ArrowRight size={16} />
              </>
            )}
          </button>
        </form>

        <p className="login-switch">
          已经有账号了？<Link href="/login" className="login-link">返回登录</Link>
        </p>

        <p className="login-footnote">
          这里不收集邮箱，所以没有「找回密码」——忘记密码请联系管理员重置。
        </p>
      </main>
    </div>
  );
}

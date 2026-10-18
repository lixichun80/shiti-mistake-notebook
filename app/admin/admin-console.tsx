"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BookOpen,
  LoaderCircle,
  Plus,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserX,
} from "lucide-react";

// 类型就地定义，不从 lib/users.ts import：那个模块 import 了 `cloudflare:workers`，
// 虽然 `import type` 会被擦除，但让客户端组件完全不碰它是更稳的做法。
type AdminUser = {
  id: string;
  username: string;
  displayName: string;
  role: "user" | "admin";
  status: "active" | "disabled";
  createdAt: string;
  lastLoginAt: string | null;
  mistakeCount: number;
};

function formatDate(value: string | null): string {
  if (!value) return "从未登录";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

/** 模块作用域：只负责取数，不碰 state，这样 effect 里就不会出现「同步 setState」。 */
async function fetchUsers(): Promise<AdminUser[]> {
  const response = await fetch("/api/admin/users", { cache: "no-store" });
  const data = (await response.json().catch(() => ({}))) as {
    users?: AdminUser[];
    error?: string;
  };
  if (!response.ok) throw new Error(data.error || "读取账号列表失败");
  return data.users ?? [];
}

const LOAD_FAILED = "读取账号列表失败";

export default function AdminConsole({
  currentUserId,
  currentUserName,
}: {
  currentUserId: string;
  currentUserName: string;
}) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState("");

  const [newUsername, setNewUsername] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newIsAdmin, setNewIsAdmin] = useState(false);
  const [creating, setCreating] = useState(false);

  /** 变更操作后重新拉一次列表。 */
  const load = useCallback(async () => {
    try {
      setUsers(await fetchUsers());
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : LOAD_FAILED);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // 这里走 .then 而不是直接调 load()：load 是 async 函数，直接调用会被
    // lint 的 react-hooks/set-state-in-effect 判成「effect 体内同步 setState」。
    // 实际 setState 全在 await 之后，没有级联渲染问题，但绕开更省事。
    fetchUsers()
      .then((list) => {
        setUsers(list);
        setError("");
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : LOAD_FAILED);
      })
      .finally(() => setLoading(false));
  }, []);

  async function call(
    path: string,
    init: RequestInit,
    fallback: string,
  ): Promise<{ ok: boolean; data: { error?: string } }> {
    try {
      const response = await fetch(path, {
        ...init,
        headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error || fallback);
      return { ok: true, data };
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : fallback);
      return { ok: false, data: {} };
    }
  }

  async function mutate(
    id: string,
    body: Record<string, unknown>,
    successNote: string,
  ): Promise<void> {
    if (busyId) return;
    setBusyId(id);
    setError("");
    setNotice("");
    const result = await call(
      `/api/admin/users/${id}`,
      { method: "PATCH", body: JSON.stringify(body) },
      "操作失败",
    );
    if (result.ok) {
      setNotice(successNote);
      await load();
    }
    setBusyId("");
  }

  async function resetPassword(user: AdminUser): Promise<void> {
    const password = window.prompt(`给「${user.displayName}」设置新密码（至少 8 位）`);
    if (password === null) return;
    // 改密码会递增 session_epoch，该用户手上所有 cookie 立刻作废 —— 这是有意的
    await mutate(user.id, { password }, `已重置 ${user.displayName} 的密码，他需要重新登录`);
  }

  async function remove(user: AdminUser): Promise<void> {
    const confirmed = window.confirm(
      `确定要彻底删除「${user.displayName}」（@${user.username}）吗？\n\n` +
        `这会一并删掉他的 ${user.mistakeCount} 道错题和上传的原图，**无法恢复**。`,
    );
    if (!confirmed) return;

    if (busyId) return;
    setBusyId(user.id);
    setError("");
    setNotice("");
    const result = await call(
      `/api/admin/users/${user.id}`,
      { method: "DELETE" },
      "删除失败",
    );
    if (result.ok) {
      setNotice(`已删除 ${user.displayName}`);
      await load();
    }
    setBusyId("");
  }

  async function create(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (creating) return;
    setCreating(true);
    setError("");
    setNotice("");
    const result = await call(
      "/api/admin/users",
      {
        method: "POST",
        body: JSON.stringify({
          username: newUsername,
          password: newPassword,
          displayName: newDisplayName,
          role: newIsAdmin ? "admin" : "user",
        }),
      },
      "创建账号失败",
    );
    if (result.ok) {
      setNotice(`已创建账号 ${newUsername}`);
      setNewUsername("");
      setNewDisplayName("");
      setNewPassword("");
      setNewIsAdmin(false);
      await load();
    }
    setCreating(false);
  }

  return (
    <div className="admin-page">
      <header className="admin-topbar">
        <div className="admin-brand">
          <span className="brand-mark">
            <BookOpen size={22} strokeWidth={2.2} />
          </span>
          <span>
            <strong>拾题 · 管理后台</strong>
            <small>当前管理员：{currentUserName}</small>
          </span>
        </div>
        <Link href="/" className="admin-back">
          <ArrowLeft size={15} />
          返回错题本
        </Link>
      </header>

      <main className="admin-content">
        <section className="admin-panel">
          <span className="section-kicker">01 / NEW ACCOUNT</span>
          <h2>新建账号</h2>
          <p className="admin-hint">
            客户也可以自己在登录页注册。这里建号适合当面交付，或者直接给他管理员权限。
          </p>

          <form className="admin-create" onSubmit={create}>
            <label>
              <span>用户名</span>
              <input
                value={newUsername}
                onChange={(event) => setNewUsername(event.target.value)}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="3-32 位小写字母、数字、_ 或 -"
                required
              />
            </label>
            <label>
              <span>昵称</span>
              <input
                value={newDisplayName}
                onChange={(event) => setNewDisplayName(event.target.value)}
                placeholder="留空就用用户名"
              />
            </label>
            <label>
              <span>初始密码</span>
              <input
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                autoComplete="new-password"
                placeholder="至少 8 位"
                required
              />
            </label>
            <label className="admin-checkbox">
              <input
                type="checkbox"
                checked={newIsAdmin}
                onChange={(event) => setNewIsAdmin(event.target.checked)}
              />
              <span>设为管理员</span>
            </label>
            <button
              type="submit"
              className="login-submit admin-create-submit"
              disabled={creating || !newUsername || !newPassword}
            >
              {creating ? (
                <>
                  <LoaderCircle size={16} className="spin" />
                  创建中...
                </>
              ) : (
                <>
                  <Plus size={16} />
                  创建账号
                </>
              )}
            </button>
          </form>
        </section>

        <section className="admin-panel">
          <span className="section-kicker">02 / ACCOUNTS</span>
          <h2>账号列表</h2>
          <p className="admin-hint">
            停用或重置密码会让该账号**已经登录的设备立刻掉线**，不需要等他重新打开页面。
          </p>

          {error && (
            <div className="login-error" role="alert">
              {error}
            </div>
          )}
          {notice && <div className="admin-notice">{notice}</div>}

          {loading ? (
            <div className="admin-empty">
              <LoaderCircle size={18} className="spin" />
              正在读取...
            </div>
          ) : users.length === 0 ? (
            <div className="admin-empty">还没有任何账号。</div>
          ) : (
            <div className="admin-list">
              {users.map((user) => {
                const isSelf = user.id === currentUserId;
                const busy = busyId === user.id;
                return (
                  <div className="recent-item admin-row" key={user.id}>
                    <span className="avatar">{user.displayName.slice(0, 1) || "?"}</span>
                    <span className="admin-who">
                      <strong>
                        {user.displayName}
                        {isSelf && <em className="admin-self">（我）</em>}
                      </strong>
                      <small>
                        @{user.username} · {user.mistakeCount} 道错题 · 上次登录{" "}
                        {formatDate(user.lastLoginAt)}
                      </small>
                    </span>
                    <span className="admin-tags">
                      {user.role === "admin" && (
                        <span className="admin-tag admin-tag-role">管理员</span>
                      )}
                      {user.status === "disabled" && (
                        <span className="admin-tag admin-tag-off">已停用</span>
                      )}
                    </span>
                    <span className="admin-actions">
                      <button
                        type="button"
                        className="admin-action"
                        disabled={busy}
                        onClick={() =>
                          void mutate(
                            user.id,
                            { status: user.status === "active" ? "disabled" : "active" },
                            user.status === "active"
                              ? `已停用 ${user.displayName}`
                              : `已启用 ${user.displayName}`,
                          )
                        }
                      >
                        {user.status === "active" ? <UserX size={14} /> : <UserCheck size={14} />}
                        {user.status === "active" ? "停用" : "启用"}
                      </button>

                      <button
                        type="button"
                        className="admin-action"
                        disabled={busy}
                        onClick={() => void resetPassword(user)}
                      >
                        <ShieldCheck size={14} />
                        重置密码
                      </button>

                      <button
                        type="button"
                        className="admin-action"
                        disabled={busy || isSelf}
                        title={isSelf ? "不能取消自己的管理员权限" : undefined}
                        onClick={() =>
                          void mutate(
                            user.id,
                            { role: user.role === "admin" ? "user" : "admin" },
                            user.role === "admin"
                              ? `已取消 ${user.displayName} 的管理员权限`
                              : `已把 ${user.displayName} 设为管理员`,
                          )
                        }
                      >
                        <ShieldCheck size={14} />
                        {user.role === "admin" ? "取消管理员" : "设为管理员"}
                      </button>

                      <button
                        type="button"
                        className="admin-action admin-action-danger"
                        disabled={busy || isSelf}
                        title={isSelf ? "不能删除自己的账号" : undefined}
                        onClick={() => void remove(user)}
                      >
                        <Trash2 size={14} />
                        删除
                      </button>

                      {busy && <LoaderCircle size={14} className="spin" />}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

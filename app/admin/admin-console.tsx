"use client";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BookOpen,
  Users,
  Files,
  Settings,
  LayoutDashboard,
  RefreshCw,
  X,
  ArrowLeft,
} from "lucide-react";
import type {
  AdminOverviewStats,
  AdminMistakeItem,
  AdminUploadItem,
  AdminSystemStatus,
} from "@/lib/admin";
import {
  checkPassword,
  checkUsername,
  checkDisplayName,
  checkWechat,
  normalizeUsername,
  normalizeWechat,
} from "@/lib/credentials";
import "./admin.css";

type User = {
  id: string;
  username: string;
  displayName: string;
  role: "user" | "admin";
  status: "active" | "disabled";
  mistakeCount: number;
  createdAt: string;
  lastLoginAt: string | null;
  wechat: string | null;
  trialEndsAt: string | null;
};
type Page = {
  total: number;
  page: number;
  totalPages: number;
  mistakes?: AdminMistakeItem[];
  uploads?: AdminUploadItem[];
};
const tabs = [
  { id: "overview", label: "数据概览", icon: LayoutDashboard },
  { id: "users", label: "用户管理", icon: Users },
  { id: "mistakes", label: "错题中心", icon: BookOpen },
  { id: "uploads", label: "上传批次", icon: Files },
  { id: "system", label: "系统诊断", icon: Settings },
] as const;
type Tab = (typeof tabs)[number]["id"];
const subjects = [
  "数学",
  "语文",
  "英语",
  "物理",
  "化学",
  "生物",
  "历史",
  "地理",
  "政治",
];
const message = (e: unknown) =>
  e instanceof Error ? e.message : "操作失败，请重试";
const date = (v: string | null) =>
  v ? new Date(v).toLocaleString("zh-CN", { hour12: false }) : "从未登录";
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const data = (await res.json()) as T & { error?: string; message?: string };
  if (!res.ok)
    throw new Error(data.error || data.message || `请求失败（${res.status}）`);
  return data;
}
function useData<T>(url: string) {
  const [state, setState] = useState<{
    data?: T;
    error?: string;
    url?: string;
    version?: number;
  }>({});
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    request<T>(url)
      .then((data) => {
        if (active) setState({ data, url, version });
      })
      .catch((e) => {
        if (active) setState({ error: message(e), url, version });
      });
    return () => {
      active = false;
    };
  }, [url, version]);
  const loading = state.url !== url || state.version !== version;
  return {
    data: loading ? undefined : state.data,
    error: loading ? undefined : state.error,
    refresh: () => setVersion((v) => v + 1),
  };
}
function Loading({ error, retry }: { error?: string; retry: () => void }) {
  return (
    <div className="ac-empty">
      {error ? (
        <>
          <p role="alert">{error}</p>
          <button onClick={retry}>重新加载</button>
        </>
      ) : (
        <p role="status">正在加载…</p>
      )}
    </div>
  );
}
function Empty() {
  return <div className="ac-empty">暂无符合条件的记录</div>;
}
function Badge({ children }: { children: ReactNode }) {
  return <span className="ac-badge">{children}</span>;
}
function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="ac-panel">
      <h2>{title}</h2>
      {children}
    </section>
  );
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="ac-field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function Modal({
  title,
  children,
  close,
  busy = false,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="ac-dialog"
      aria-labelledby="ac-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) close();
      }}
    >
      <header>
        <h2 id="ac-dialog-title">{title}</h2>
        <button
          type="button"
          aria-label="关闭弹窗"
          disabled={busy}
          onClick={close}
        >
          <X size={18} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
function Pager({
  page,
  total,
  totalPages,
  change,
}: {
  page: number;
  total: number;
  totalPages: number;
  change: (p: number) => void;
}) {
  return (
    <footer className="ac-pager">
      <span>
        共 {total} 条 · 第 {page} / {totalPages} 页
      </span>
      <div>
        <button disabled={page <= 1} onClick={() => change(page - 1)}>
          上一页
        </button>
        <button disabled={page >= totalPages} onClick={() => change(page + 1)}>
          下一页
        </button>
      </div>
    </footer>
  );
}
export default function AdminConsole({
  currentUserId,
  currentUserName,
}: {
  currentUserId: string;
  currentUserName: string;
}) {
  const [tab, setTab] = useState<Tab>("overview");
  const [revision, setRevision] = useState(0);
  return (
    <div className="ac-shell">
      <aside className="ac-sidebar">
        <div className="ac-brand">
          <BookOpen size={26} />
          <div>
            <strong>拾题</strong>
            <small>管理后台</small>
          </div>
        </div>
        <nav aria-label="后台导航">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={tab === id ? "selected" : ""}
              aria-current={tab === id ? "page" : undefined}
              onClick={() => setTab(id)}
            >
              <Icon size={18} />
              {label}
            </button>
          ))}
        </nav>
        <footer>
          <span>管理员 · {currentUserName}</span>
          <Link href="/">
            <ArrowLeft size={16} />
            返回错题本
          </Link>
        </footer>
      </aside>
      <main className="ac-main">
        <header className="ac-top">
          <h1>{tabs.find((t) => t.id === tab)?.label}</h1>
          <button onClick={() => setRevision((v) => v + 1)}>
            <RefreshCw size={15} />
            刷新
          </button>
        </header>
        <div className="ac-content" key={`${tab}-${revision}`}>
          {tab === "overview" ? (
            <Overview />
          ) : tab === "users" ? (
            <UserManager self={currentUserId} />
          ) : tab === "system" ? (
            <System />
          ) : (
            <ContentManager kind={tab} />
          )}
        </div>
      </main>
    </div>
  );
}
function Overview() {
  const { data, error, refresh } =
    useData<AdminOverviewStats>("/api/admin/stats");
  if (!data) return <Loading error={error} retry={refresh} />;
  return (
    <>
      <p className="ac-intro">查看全站数据与最近活动。</p>
      <div className="ac-stats">
        {[
          ["用户总数", data.totalUsers],
          ["启用账号", data.activeUsers],
          ["错题总数", data.totalMistakes],
          ["上传批次", data.totalUploads],
          ["举一反三题数", data.totalSimilarQuestions],
        ].map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <div className="ac-grid">
        <Panel title="学科分布">
          {data.subjectDistribution.length ? (
            data.subjectDistribution.map((s) => (
              <div className="ac-distribution" key={s.subject}>
                <div>
                  <span>{s.subject}</span>
                  <small>
                    {s.count} 题 · {s.percentage}%
                  </small>
                </div>
                <progress max={100} value={s.percentage} />
              </div>
            ))
          ) : (
            <Empty />
          )}
        </Panel>
        <Panel title="最近录入的错题">
          {data.recentMistakes.length ? (
            data.recentMistakes.map((m) => (
              <article className="ac-activity" key={m.id}>
                <Badge>{m.subject}</Badge>
                <p>{m.question}</p>
                <small>
                  {m.displayName} · {date(m.createdAt)}
                </small>
              </article>
            ))
          ) : (
            <Empty />
          )}
        </Panel>
        <Panel title="最新注册用户">
          {data.recentUsers.length ? (
            data.recentUsers.map((u) => (
              <article className="ac-activity" key={u.id}>
                <strong>{u.displayName}</strong>{" "}
                <small>
                  @{u.username} · {u.role === "admin" ? "管理员" : "普通用户"}
                </small>
                <small>{date(u.createdAt)}</small>
              </article>
            ))
          ) : (
            <Empty />
          )}
        </Panel>
        <Panel title="最近上传批次">
          {data.recentUploads.length ? (
            data.recentUploads.map((u) => (
              <article className="ac-activity" key={u.id}>
                <p>{u.fileNames.join("、") || "未命名文件"}</p>
                <small>
                  {u.displayName} · {u.subject} · {u.mistakeCount} 道错题 ·{" "}
                  {date(u.createdAt)}
                </small>
              </article>
            ))
          ) : (
            <Empty />
          )}
        </Panel>
      </div>
    </>
  );
}
type UserModal =
  | { mode: "create" }
  | { mode: "edit" | "password" | "delete" | "status" | "trial"; user: User };
function UserManager({ self }: { self: string }) {
  const { data, error, refresh } = useData<{ users: User[] }>(
    "/api/admin/users",
  );
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState<UserModal | null>(null);
  const [notice, setNotice] = useState("");
  const list = (data?.users || []).filter(
    (u) =>
      `${u.username} ${u.displayName} ${u.wechat || ""}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (!role || u.role === role) &&
      (!status || u.status === status),
  );
  const totalPages = Math.max(1, Math.ceil(list.length / 20));
  const shownPage = Math.min(page, totalPages);
  // 剪贴板 API 只在 HTTPS 下可用；IP 直连的 http 入口会失败，此时提示手动复制
  async function copyWechat(wechat: string) {
    try {
      await navigator.clipboard.writeText(wechat);
      setNotice(`已复制微信号 ${wechat}，可到微信里搜索添加`);
    } catch {
      setNotice(`复制失败，请手动选中微信号：${wechat}`);
    }
  }
  return (
    <>
      <p className="ac-intro">
        管理账号资料、登录状态与权限。停用或重置密码后，原有登录立即失效。
      </p>
      {notice && (
        <p className="ac-notice" role="status">
          {notice}
        </p>
      )}
      <div className="ac-toolbar">
        <input
          aria-label="搜索用户"
          placeholder="搜索昵称、用户名或微信号"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <select
          aria-label="用户角色"
          value={role}
          onChange={(e) => {
            setRole(e.target.value);
            setPage(1);
          }}
        >
          <option value="">全部角色</option>
          <option value="admin">管理员</option>
          <option value="user">普通用户</option>
        </select>
        <select
          aria-label="用户状态"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">全部状态</option>
          <option value="active">已启用</option>
          <option value="disabled">已停用</option>
        </select>
        <button
          className="ac-primary"
          onClick={() => setModal({ mode: "create" })}
        >
          新建用户
        </button>
      </div>
      {!data ? (
        <Loading error={error} retry={refresh} />
      ) : (
        <div className="ac-panel">
          <div className="ac-scroll">
            <table>
              <thead>
                <tr>
                  <th>用户</th>
                  <th>微信号</th>
                  <th>角色 / 状态</th>
                  <th>试用权限</th>
                  <th>错题</th>
                  <th>最近登录</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {list.slice((shownPage - 1) * 20, shownPage * 20).map((u) => (
                  <tr key={u.id}>
                    <td>
                      <strong>
                        {u.displayName}
                        {u.id === self && "（我）"}
                      </strong>
                      <small>@{u.username}</small>
                    </td>
                    <td>
                      {u.wechat ? (
                        <div className="ac-wechat">
                          <span>{u.wechat}</span>
                          <button
                            type="button"
                            onClick={() => copyWechat(u.wechat!)}
                          >
                            复制
                          </button>
                        </div>
                      ) : (
                        <span className="ac-muted">未填写</span>
                      )}
                    </td>
                    <td>
                      <Badge>
                        {u.role === "admin" ? "管理员" : "普通用户"}
                      </Badge>{" "}
                      <Badge>
                        {u.status === "active" ? "已启用" : "已停用"}
                      </Badge>
                    </td>
                    <td>{u.trialEndsAt === null ? "长期可用" : Date.parse(u.trialEndsAt) <= Date.now() ? "试用已到期" : `试用至 ${date(u.trialEndsAt)}`}</td>
                    <td>{u.mistakeCount}</td>
                    <td>{date(u.lastLoginAt)}</td>
                    <td>
                      <div className="ac-actions">
                        <button
                          onClick={() => setModal({ mode: "edit", user: u })}
                        >
                          编辑
                        </button>
                        <button
                          onClick={() =>
                            setModal({ mode: "password", user: u })
                          }
                        >
                          重置密码
                        </button>
                        {u.trialEndsAt !== null && <button onClick={() => setModal({ mode: "trial", user: u })}>试用期</button>}
                        <button
                          disabled={u.id === self}
                          title={
                            u.id === self ? "不能停用自己的账号" : undefined
                          }
                          onClick={() => setModal({ mode: "status", user: u })}
                        >
                          {u.status === "active" ? "停用" : "启用"}
                        </button>
                        <button
                          className="ac-danger"
                          disabled={u.id === self}
                          onClick={() => setModal({ mode: "delete", user: u })}
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!list.length && <Empty />}
          <Pager
            page={shownPage}
            total={list.length}
            totalPages={totalPages}
            change={setPage}
          />
        </div>
      )}
      {modal && (
        <UserEditor
          modal={modal}
          self={self}
          close={() => setModal(null)}
          saved={(text) => {
            setModal(null);
            setNotice(text);
            refresh();
          }}
        />
      )}
    </>
  );
}
function UserEditor({
  modal,
  self,
  close,
  saved,
}: {
  modal: UserModal;
  self: string;
  close: () => void;
  saved: (text: string) => void;
}) {
  const router = useRouter();
  const user = "user" in modal ? modal.user : undefined;
  const [username, setUsername] = useState("");
  const [name, setName] = useState(user?.displayName || "");
  const [wechat, setWechat] = useState(user?.wechat || "");
  const [role, setRole] = useState(user?.role || "user");
  const [password, setPassword] = useState("");
  const [trialAction, setTrialAction] = useState<"extend7" | "unlimited">("extend7");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const title = {
    create: "新建用户",
    edit: "编辑用户资料",
    password: "重置密码",
    delete: "删除用户",
    status: user?.status === "active" ? "停用用户" : "启用用户",
    trial: "管理试用期",
  }[modal.mode];
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    let invalid: string | null = null;
    if (modal.mode === "create")
      invalid = checkUsername(normalizeUsername(username));
    if (modal.mode === "create" || modal.mode === "edit")
      invalid ||=
        checkDisplayName(name.trim()) ||
        checkWechat(normalizeWechat(wechat), false);
    if (modal.mode === "create" || modal.mode === "password")
      invalid ||=
        checkPassword(password) ||
        (password !== confirm ? "两次密码不一致" : null);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const body =
        modal.mode === "create"
          ? { username, displayName: name, role, password, wechat }
          : modal.mode === "edit"
            ? { displayName: name, role, wechat }
            : modal.mode === "password"
              ? { password }
              : modal.mode === "trial"
                ? { trialAction }
              : { status: user?.status === "active" ? "disabled" : "active" };
      await request(
        user
          ? `/api/admin/users/${encodeURIComponent(user.id)}`
          : "/api/admin/users",
        {
          method:
            modal.mode === "delete"
              ? "DELETE"
              : modal.mode === "create"
                ? "POST"
                : "PATCH",
          body: modal.mode === "delete" ? undefined : JSON.stringify(body),
        },
      );
      if (modal.mode === "password" && user?.id === self) {
        router.push("/login?return_to=%2Fadmin");
        return;
      }
      saved(`${title}成功`);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={title} close={close} busy={busy}>
      <form onSubmit={submit}>
        <div className="ac-dialog-body">
          {user && (
            <p>
              {user.displayName} · @{user.username}
            </p>
          )}
          {modal.mode === "create" && (
            <Field label="用户名">
              <input
                required
                autoComplete="off"
                placeholder="3–32 位小写字母、数字、_ 或 -"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </Field>
          )}
          {(modal.mode === "create" || modal.mode === "edit") && (
            <>
              <Field label="昵称">
                <input
                  required={modal.mode === "edit"}
                  maxLength={24}
                  placeholder="留空则使用用户名"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
              <Field label="微信号">
                <input
                  maxLength={40}
                  autoComplete="off"
                  placeholder="选填，留空表示未填写"
                  value={wechat}
                  onChange={(e) => setWechat(e.target.value)}
                />
              </Field>
              <Field label="角色">
                <select
                  disabled={user?.id === self}
                  value={role}
                  onChange={(e) => setRole(e.target.value as User["role"])}
                >
                  <option value="user">普通用户</option>
                  <option value="admin">管理员</option>
                </select>
              </Field>
              {user?.id === self && <small>不能取消自己的管理员权限。</small>}
            </>
          )}
          {(modal.mode === "create" || modal.mode === "password") && (
            <>
              <Field label={modal.mode === "create" ? "初始密码" : "新密码"}>
                <input
                  type="password"
                  required
                  minLength={8}
                  maxLength={128}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>
              <Field label="确认密码">
                <input
                  type="password"
                  required
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </Field>
              {modal.mode === "password" && (
                <p className="ac-warning">
                  重置后，该用户所有设备需要重新登录。
                  {user?.id === self && "你也将退出当前登录。"}
                </p>
              )}
            </>
          )}
          {modal.mode === "delete" && (
            <p className="ac-warning">
              将永久删除该账号、{user?.mistakeCount}{" "}
              道错题和全部上传原图，无法恢复。
            </p>
          )}
          {modal.mode === "status" && (
            <p>
              {user?.status === "active"
                ? "停用后立即退出所有设备，该用户暂时无法登录。已有错题保留。"
                : "启用后，该用户可以重新登录。"}
            </p>
          )}
          {modal.mode === "trial" && (
            <Field label="使用权限">
              <select value={trialAction} onChange={(e) => setTrialAction(e.target.value as "extend7" | "unlimited")}>
                <option value="extend7">延长 7 天</option>
                <option value="unlimited">开通长期使用</option>
              </select>
            </Field>
          )}
          {error && (
            <p className="ac-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer>
          <button type="button" disabled={busy} onClick={close}>
            取消
          </button>
          <button
            className={
              modal.mode === "delete" ? "ac-destructive" : "ac-primary"
            }
            disabled={busy}
          >
            {busy
              ? "处理中…"
              : modal.mode === "delete"
                ? "确认永久删除"
                : "确认"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
function ContentManager({ kind }: { kind: "mistakes" | "uploads" }) {
  const [filters, setFilters] = useState({
    search: "",
    subject: "",
    userId: "",
  });
  const [draft, setDraft] = useState(filters);
  const [page, setPage] = useState(1);
  const query = new URLSearchParams({
    ...filters,
    page: String(page),
    pageSize: "20",
  });
  const { data, error, refresh } = useData<Page>(`/api/admin/${kind}?${query}`);
  const users = useData<{ users: User[] }>("/api/admin/users");
  const [editing, setEditing] = useState<AdminMistakeItem | null>(null);
  const [deleting, setDeleting] = useState<
    AdminMistakeItem | AdminUploadItem | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  async function remove() {
    if (!deleting || busy) return;
    setBusy(true);
    setActionError("");
    try {
      await request(`/api/admin/${kind}/${encodeURIComponent(deleting.id)}`, {
        method: "DELETE",
      });
      setDeleting(null);
      setNotice("删除成功");
      if (page > 1 && (data?.mistakes || data?.uploads || []).length === 1)
        setPage(page - 1);
      else refresh();
    } catch (e) {
      setActionError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function exportData(format: "csv" | "json") {
    setBusy(true);
    setActionError("");
    setNotice("");
    try {
      const rows: AdminMistakeItem[] = [];
      let next = 1;
      let pages = 1;
      do {
        const q = new URLSearchParams({
          ...filters,
          page: String(next),
          pageSize: "100",
        });
        const batch = await request<Page>(`/api/admin/mistakes?${q}`);
        rows.push(...batch.mistakes!);
        pages = batch.totalPages;
        next++;
      } while (next <= pages);
      if (!rows.length) throw new Error("当前筛选下没有可导出的错题");
      const cols: [keyof AdminMistakeItem, string][] = [
        ["id", "错题ID"],
        ["username", "用户名"],
        ["displayName", "昵称"],
        ["subject", "学科"],
        ["question", "题干"],
        ["incorrectAnswer", "错误答案"],
        ["correctAnswer", "正确答案"],
        ["reasoning", "解题思路"],
        ["knowledgePoint", "知识点"],
        ["sourceName", "来源"],
        ["createdAt", "录入时间"],
      ];
      const cell = (value: unknown) => {
        let s = String(value ?? "");
        if (/^\s*[=+@-]/.test(s) || /^[\t\r\n]/.test(s)) s = "'" + s;
        return `"${s.replaceAll('"', '""')}"`;
      };
      const content =
        format === "json"
          ? JSON.stringify(rows, null, 2)
          : "\uFEFF" +
            [
              cols.map((c) => cell(c[1])).join(","),
              ...rows.map((row) => cols.map((c) => cell(row[c[0]])).join(",")),
            ].join("\r\n");
      const url = URL.createObjectURL(
        new Blob([content], {
          type:
            format === "json"
              ? "application/json;charset=utf-8"
              : "text/csv;charset=utf-8",
        }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `拾题-错题-${new Date().toISOString().slice(0, 10)}.${format}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(`已导出当前筛选的 ${rows.length} 道错题`);
    } catch (e) {
      setActionError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <p className="ac-intro">
        {kind === "mistakes"
          ? "查询全站错题，查看解析并纠正内容。导出包含当前筛选下的所有分页。"
          : "查看每次上传的文件与题量，整批删除会同时清理错题和原图。"}
      </p>
      {notice && (
        <p className="ac-notice" role="status">
          {notice}
        </p>
      )}
      {actionError && !deleting && (
        <p className="ac-error" role="alert">
          {actionError}
        </p>
      )}
      <form
        className="ac-toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          setFilters(draft);
          setPage(1);
        }}
      >
        <input
          aria-label="搜索内容"
          placeholder={
            kind === "mistakes" ? "题干、知识点、答案或来源" : "文件名或学科"
          }
          value={draft.search}
          onChange={(e) => setDraft({ ...draft, search: e.target.value })}
        />
        {kind === "mistakes" && (
          <select
            aria-label="筛选学科"
            value={draft.subject}
            onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
          >
            <option value="">全部学科</option>
            {subjects.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        )}
        <select
          aria-label="筛选用户"
          value={draft.userId}
          onChange={(e) => setDraft({ ...draft, userId: e.target.value })}
        >
          <option value="">
            {users.error ? "用户列表加载失败" : "全部用户"}
          </option>
          {users.data?.users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.displayName} (@{u.username})
            </option>
          ))}
        </select>
        <button className="ac-primary" type="submit">
          查询
        </button>
        <button
          type="button"
          onClick={() => {
            const empty = { search: "", subject: "", userId: "" };
            setFilters(empty);
            setDraft(empty);
            setPage(1);
          }}
        >
          重置
        </button>
        {kind === "mistakes" && (
          <div className="ac-export">
            <button
              type="button"
              disabled={busy || !data}
              onClick={() => void exportData("csv")}
            >
              导出 CSV
            </button>
            <button
              type="button"
              disabled={busy || !data}
              onClick={() => void exportData("json")}
            >
              导出 JSON
            </button>
          </div>
        )}
      </form>
      {!data ? (
        <Loading error={error} retry={refresh} />
      ) : (
        <div className="ac-panel">
          <div className="ac-scroll">
            <table>
              <thead>
                <tr>
                  <th>{kind === "mistakes" ? "题干 / 知识点" : "上传文件"}</th>
                  <th>学科 / 用户</th>
                  <th>{kind === "mistakes" ? "来源 / 时间" : "题量 / 时间"}</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {kind === "mistakes"
                  ? data.mistakes?.map((m) => (
                      <tr key={m.id}>
                        <td className="ac-question">
                          <p>{m.question}</p>
                          <small>{m.knowledgePoint || "未标注知识点"}</small>
                        </td>
                        <td>
                          <Badge>{m.subject}</Badge>
                          <small>
                            {m.displayName} · @{m.username}
                          </small>
                        </td>
                        <td>
                          {m.sourceName || "未标注来源"}
                          <small>{date(m.createdAt)}</small>
                        </td>
                        <td>
                          <div className="ac-actions">
                            <button onClick={() => setEditing(m)}>
                              查看 / 编辑
                            </button>
                            <button
                              className="ac-danger"
                              disabled={busy}
                              onClick={() => {
                                setActionError("");
                                setDeleting(m);
                              }}
                            >
                              删除
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  : data.uploads?.map((u) => (
                      <tr key={u.id}>
                        <td className="ac-question">
                          {u.fileNames.map((n, i) => (
                            <p key={i}>{n}</p>
                          ))}
                          {!u.fileNames.length && "无文件名"}
                          <small>{u.fileNames.length} 个文件</small>
                        </td>
                        <td>
                          <Badge>{u.subject}</Badge>
                          <small>
                            {u.displayName} · @{u.username}
                          </small>
                        </td>
                        <td>
                          {u.mistakeCount} 道错题
                          <small>{date(u.createdAt)}</small>
                        </td>
                        <td>
                          <button
                            className="ac-danger"
                            disabled={busy}
                            onClick={() => {
                              setActionError("");
                              setDeleting(u);
                            }}
                          >
                            删除整批
                          </button>
                        </td>
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>
          {!(data.mistakes || data.uploads || []).length && <Empty />}
          <Pager
            page={data.page}
            total={data.total}
            totalPages={data.totalPages}
            change={setPage}
          />
        </div>
      )}
      {editing && (
        <MistakeEditor
          item={editing}
          close={() => setEditing(null)}
          saved={() => {
            setEditing(null);
            setNotice("错题已保存");
            refresh();
          }}
        />
      )}
      {deleting && (
        <Modal
          title={kind === "mistakes" ? "删除错题" : "删除上传批次"}
          busy={busy}
          close={() => setDeleting(null)}
        >
          <div className="ac-dialog-body">
            <p className="ac-warning">
              {kind === "mistakes"
                ? "将永久删除这道错题及其举一反三练习，上传原图保留。"
                : `将永久删除本批次的 ${(deleting as AdminUploadItem).mistakeCount} 道错题及全部原图，无法恢复。`}
            </p>
            <p className="ac-preview">
              {"question" in deleting
                ? deleting.question
                : deleting.fileNames.join("、")}
            </p>
            {actionError && (
              <p className="ac-error" role="alert">
                {actionError}
              </p>
            )}
          </div>
          <footer>
            <button disabled={busy} onClick={() => setDeleting(null)}>
              取消
            </button>
            <button
              className="ac-destructive"
              disabled={busy}
              onClick={() => void remove()}
            >
              {busy ? "删除中…" : "确认永久删除"}
            </button>
          </footer>
        </Modal>
      )}
    </>
  );
}
function MistakeEditor({
  item,
  close,
  saved,
}: {
  item: AdminMistakeItem;
  close: () => void;
  saved: () => void;
}) {
  const [form, setForm] = useState(item);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const fields = [
    ["question", "题干"],
    ["incorrectAnswer", "错误答案"],
    ["correctAnswer", "正确答案"],
    ["reasoning", "AI 解题思路"],
    ["knowledgePoint", "知识点"],
  ] as const;
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await request(`/api/admin/mistakes/${encodeURIComponent(item.id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          subject: form.subject,
          ...Object.fromEntries(fields.map(([key]) => [key, form[key]])),
        }),
      });
      saved();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="查看与编辑错题" close={close} busy={busy}>
      <form onSubmit={submit}>
        <div className="ac-dialog-body">
          <p className="ac-muted">
            {item.displayName} · {item.sourceName || "未标注来源"} · 第{" "}
            {item.pageNumber} 页
          </p>
          <Field label="学科">
            <input
              required
              maxLength={30}
              value={form.subject}
              onChange={(e) => setForm({ ...form, subject: e.target.value })}
            />
          </Field>
          {fields.map(([key, label]) => (
            <Field key={key} label={label}>
              <textarea
                rows={key === "question" || key === "reasoning" ? 5 : 2}
                required={key === "question" || key === "correctAnswer"}
                value={form[key]}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
              />
            </Field>
          ))}
          {!!item.similarQuestions.length && (
            <details>
              <summary>举一反三练习（{item.similarQuestions.length}）</summary>
              {item.similarQuestions.map((s, i) => (
                <article className="ac-activity" key={i}>
                  <p>{s.question}</p>
                  <p>答案：{s.answer}</p>
                  <p>{s.explanation}</p>
                </article>
              ))}
            </details>
          )}
          {error && (
            <p className="ac-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer>
          <button type="button" disabled={busy} onClick={close}>
            取消
          </button>
          <button className="ac-primary" disabled={busy}>
            {busy ? "保存中…" : "保存修改"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
function System() {
  const { data, error, refresh } =
    useData<AdminSystemStatus>("/api/admin/system");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    ok: boolean;
    message: string;
    latencyMs?: number;
  } | null>(null);
  async function test() {
    setBusy(true);
    setResult(null);
    try {
      setResult(
        await request("/api/admin/system", {
          method: "POST",
          body: JSON.stringify({ action: "test-ai" }),
        }),
      );
    } catch (e) {
      setResult({ ok: false, message: message(e) });
    } finally {
      setBusy(false);
    }
  }
  if (!data) return <Loading error={error} retry={refresh} />;
  return (
    <>
      <p className="ac-intro">
        检查数据存储、AI 配置与登录安全。更新于 {date(data.timestamp)}。
      </p>
      <div className="ac-grid">
        <Panel title="数据存储">
          <div className="ac-check">
            <span>数据库连接</span>
            <Badge>
              {data.dbStatus === "ok"
                ? `正常 · ${data.dbLatencyMs} ms`
                : "连接异常"}
            </Badge>
          </div>
          {Object.entries(data.tableStats).map(([key, count]) => (
            <div className="ac-check" key={key}>
              <span>
                {{ users: "用户", uploads: "上传批次", mistakes: "错题" }[key]}
              </span>
              <strong>{count}</strong>
            </div>
          ))}
          <div className="ac-check">
            <span>图片存储绑定</span>
            <Badge>{data.r2Configured ? "已绑定" : "未绑定"}</Badge>
          </div>
        </Panel>
        <Panel title="AI 服务">
          <div className="ac-check">
            <span>API 密钥</span>
            <Badge>{data.aiConfigured ? "已配置" : "未配置"}</Badge>
          </div>
          <p>{data.aiModel}</p>
          <p className="ac-muted">
            连通测试会发送一次简短请求，可能产生少量用量。
          </p>
          <button
            className="ac-primary"
            disabled={busy || !data.aiConfigured}
            onClick={() => void test()}
          >
            {busy ? "测试中…" : "测试 AI 连通性"}
          </button>
          {result && (
            <p
              role={result.ok ? "status" : "alert"}
              className={result.ok ? "ac-notice" : "ac-error"}
            >
              {result.message}
              {result.latencyMs !== undefined && ` · ${result.latencyMs} ms`}
            </p>
          )}
        </Panel>
        <Panel title="登录安全">
          <div className="ac-check">
            <span>会话密钥 ≥ 32 字符</span>
            <Badge>
              {data.security.sessionSecretConfigured ? "通过" : "需要配置"}
            </Badge>
          </div>
          <div className="ac-check">
            <span>不信任外部身份请求头</span>
            <Badge>
              {data.security.trustOaiHeadersDisabled ? "通过" : "存在风险"}
            </Badge>
          </div>
        </Panel>
      </div>
    </>
  );
}

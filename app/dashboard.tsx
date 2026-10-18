"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { makeMistakeDocx, mistakeDocxFilename } from "@/lib/mistake-docx";
import { ArrowRight, BookOpen, CalendarDays, Camera, Check, CheckCircle2, ChevronDown, Clock3, CloudUpload, FileImage, Filter, Lightbulb, LoaderCircle, LogOut, Menu, Plus, FileDown, Search, Sparkles, Trash2, UploadCloud, X } from "lucide-react";

type Similar = { question: string; answer: string; explanation: string };
type Mistake = {
  id: string; uploadId: string; subject: string; question: string; incorrectAnswer: string;
  correctAnswer: string; reasoning: string; knowledgePoint: string; pageNumber: number;
  sourceName: string; similarQuestions: Similar[]; createdAt: string;
};
type Analysis = { subject: string; summary: string; uncertainNote: string; mistakes: Mistake[] };
type SelectedFile = { file: File; preview: string };
type Tab = "home" | "notebook" | "results";

const subjectColors: Record<string, string> = { 数学: "lavender", 语文: "coral", 英语: "mint", 物理: "blue", 化学: "amber", 生物: "green", 历史: "sand", 地理: "teal", 政治: "rose" };
const formatDate = (date: string) => new Date(date).toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" });

/**
 * 会话过期时接口返回 401，把用户送回登录页，而不是让他停在空页面上发呆。
 *
 * 这里必须整页跳转而不是 router.push：会话变了，客户端攒下的错题、筛选条件
 * 全都得丢掉重新从服务端取。
 */
function redirectIfUnauthorized(response: Response): boolean {
  if (response.status !== 401) return false;
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.href = "/login";
  return true;
}

async function shrinkImage(file: File): Promise<File> {
  if (file.size < 2.5 * 1024 * 1024) return file;
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = objectUrl;
    });
    const scale = Math.min(1, 2200 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.fillStyle = "#fff"; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.9));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } finally { URL.revokeObjectURL(objectUrl); }
}

function SubjectPill({ subject }: { subject: string }) {
  return <span className={`subject-pill ${subjectColors[subject] || "sand"}`}>{subject}</span>;
}

function SimilarExercise({ item, index }: { item: Similar; index: number }) {
  const [showReasoning, setShowReasoning] = useState(false);
  const [showAnswer, setShowAnswer] = useState(false);
  return <div className="similar-item"><span className="similar-index">{String(index + 1).padStart(2, "0")}</span><div><strong>{item.question}</strong><div className="reveal-actions"><button type="button" onClick={() => { setShowReasoning(!showReasoning); if (showReasoning) setShowAnswer(false); }} aria-expanded={showReasoning}>{showReasoning ? "收起思路" : "查看思路"}</button><button type="button" onClick={() => setShowAnswer(!showAnswer)} disabled={!showReasoning} aria-expanded={showAnswer} title={!showReasoning ? "请先查看思路" : undefined}>{showAnswer ? "收起答案" : "查看答案"}</button></div>{showReasoning && <p className="reveal-content"><b>思路：</b>{item.explanation}</p>}{showAnswer && <p className="reveal-content answer"><b>答案：</b>{item.answer}</p>}</div></div>;
}

function MistakeCard({ item, onSimilar, onExport, onDelete, busy, showDelete = false }: {
  item: Mistake; onSimilar: (id: string, count: number) => void; onExport: (item: Mistake) => void; onDelete: (id: string) => void; busy: boolean; showDelete?: boolean;
}) {
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null);
  const [similarCount, setSimilarCount] = useState("3");
  const answersOpen = userExpanded !== null ? userExpanded : (item.similarQuestions.length > 0);
  return <article className="question-card">
    <div className="question-top"><div className="question-tags"><SubjectPill subject={item.subject} /><span className="knowledge-tag">{item.knowledgePoint || "知识点待确认"}</span></div><span className="question-date"><CalendarDays size={14} />{formatDate(item.createdAt)}</span></div>
    <h3>{item.question}</h3>
    <div className="answer-grid"><div className="answer-box wrong"><span className="answer-label">我的答案</span><p>{item.incorrectAnswer || "图片中未能读清"}</p></div><div className="answer-box correct"><span className="answer-label">正确答案</span><p>{item.correctAnswer}</p></div></div>
    <div className="reasoning"><div className="reasoning-heading"><Lightbulb size={18} /><strong>解题思路</strong></div><p>{item.reasoning}</p></div>
    <div className="question-footer"><span className="source-line"><FileImage size={14} />{item.sourceName} · 第 {item.pageNumber} 页</span><div className="question-actions"><button className="export-button" onClick={() => onExport(item)}><FileDown size={15} />生成 Word</button>{showDelete && <button className="icon-action" title="移除这道错题" onClick={() => onDelete(item.id)}><Trash2 size={16} /></button>}<div className="similar-request"><label htmlFor={`similar-count-${item.id}`}>再给我出 <input id={`similar-count-${item.id}`} className="similar-count" type="number" min="1" max="5" step="1" inputMode="numeric" value={similarCount} onChange={event => { if (/^[1-5]?$/.test(event.target.value)) setSimilarCount(event.target.value); }} aria-label="类似题数量，1 到 5 道" /> 道类似题目</label><button className="similar-button" onClick={() => onSimilar(item.id, Number(similarCount))} disabled={busy || !/^[1-5]$/.test(similarCount)}>{busy ? <LoaderCircle size={16} className="spin" /> : <Sparkles size={16} />}生成</button></div>{item.similarQuestions.length > 0 && <button className="similar-toggle" onClick={() => setUserExpanded(!answersOpen)} aria-expanded={answersOpen}>{answersOpen ? "收起" : "查看"}已生成的 {item.similarQuestions.length} 道题<ChevronDown size={15} className={answersOpen ? "turn" : ""} /></button>}</div></div>
    {item.similarQuestions.length > 0 && answersOpen && <div className="similar-list"><div className="similar-title"><Sparkles size={17} />举一反三 · {item.similarQuestions.length} 道练习</div>{item.similarQuestions.map((similar, index) => <SimilarExercise item={similar} index={index} key={index} />)}</div>}
  </article>;
}

export default function Dashboard({ name }: { name: string }) {
  const [tab, setTab] = useState<Tab>("home");
  const [mistakes, setMistakes] = useState<Mistake[]>([]);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [selected, setSelected] = useState<SelectedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  // 初值就是 true：挂载后必定拉一次错题本，等请求落地再置回 false
  const [loadingList, setLoadingList] = useState(true);
  const [aiReady, setAiReady] = useState<boolean | null>(null);
  const [busySimilar, setBusySimilar] = useState<string | null>(null);
  const [exportFile, setExportFile] = useState<{ url: string; name: string } | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [subject, setSubject] = useState("全部科目");
  const [month, setMonth] = useState("");
  const [mobileMenu, setMobileMenu] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/status").then(r => r.json() as Promise<{ aiConfigured: boolean }>).then(data => setAiReady(Boolean(data.aiConfigured))).catch(() => setAiReady(false));
    fetch("/api/mistakes").then(r => redirectIfUnauthorized(r) ? null : r.json() as Promise<{ mistakes?: Mistake[] }>).then(data => { if (data && Array.isArray(data.mistakes)) setMistakes(data.mistakes); }).catch(() => setError("错题本加载失败，请刷新页面重试")).finally(() => setLoadingList(false));
  }, []);

  useEffect(() => () => { selected.forEach(item => URL.revokeObjectURL(item.preview)); }, [selected]);
  useEffect(() => () => { if (exportFile) URL.revokeObjectURL(exportFile.url); }, [exportFile]);

  const subjects = useMemo(() => [...new Set(mistakes.map(item => item.subject))], [mistakes]);
  const filtered = useMemo(() => mistakes.filter(item => (subject === "全部科目" || item.subject === subject) && (!month || item.createdAt.slice(0, 7) === month) && (!query || `${item.question} ${item.knowledgePoint} ${item.sourceName}`.toLowerCase().includes(query.toLowerCase()))), [mistakes, subject, month, query]);
  const groups = useMemo(() => {
    const result: Record<string, Mistake[]> = {};
    for (const item of filtered) (result[item.createdAt.slice(0, 10)] ||= []).push(item);
    return Object.entries(result);
  }, [filtered]);

  function addFiles(list: FileList | null) {
    if (!list) return;
    const incoming = Array.from(list).filter(file => ["image/jpeg", "image/png", "image/webp"].includes(file.type));
    if (incoming.length !== list.length) setError("只支持 JPG、PNG、WEBP 图片"); else setError("");
    if (selected.length + incoming.length > 4) setError("一次最多上传 4 张图片");
    setSelected(current => {
      const next = [...current, ...incoming.map(file => ({ file, preview: URL.createObjectURL(file) }))];
      if (next.length > 4) next.slice(4).forEach(item => URL.revokeObjectURL(item.preview));
      return next.slice(0, 4);
    });
  }

  async function analyze() {
    if (!selected.length) { fileRef.current?.click(); return; }
    if (aiReady === false) { setError("AI 服务尚未配置，当前不能自动分析。请完成服务端密钥配置。"); return; }
    setUploading(true); setError("");
    try {
      const form = new FormData();
      for (const item of selected) form.append("files", await shrinkImage(item.file));
      const response = await fetch("/api/analyze", { method: "POST", body: form });
      if (redirectIfUnauthorized(response)) return;
      const data = await response.json() as Analysis & { error?: string };
      if (!response.ok) throw new Error(data.error || "分析失败，请重试");
      setAnalysis(data); setMistakes(current => [...data.mistakes, ...current]); setSelected([]); setTab("results");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "分析失败，请稍后重试"); }
    finally { setUploading(false); }
  }

  async function requestSimilar(id: string, count: number) {
    setBusySimilar(id); setError("");
    try {
      const response = await fetch(`/api/mistakes/${id}/similar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ count }) });
      if (redirectIfUnauthorized(response)) return;
      const data = await response.json() as { questions: Similar[]; error?: string };
      if (!response.ok) throw new Error(data.error || "生成失败");
      setMistakes(current => current.map(item => item.id === id ? { ...item, similarQuestions: data.questions } : item));
      setAnalysis(current => current ? { ...current, mistakes: current.mistakes.map(item => item.id === id ? { ...item, similarQuestions: data.questions } : item) } : current);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "生成失败，请重试"); }
    finally { setBusySimilar(null); }
  }

  async function removeMistake(id: string) {
    if (!window.confirm("确定移除这道错题吗？")) return;
    try {
      const response = await fetch(`/api/mistakes/${id}`, { method: "DELETE" });
      if (redirectIfUnauthorized(response)) return;
      if (!response.ok) throw new Error("移除失败，请重试");
      setMistakes(current => current.filter(item => item.id !== id));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "移除失败"); }
  }

  function exportMistake(item: Mistake) {
    setError("");
    try {
      const bytes = makeMistakeDocx(item);
      const blob = new Blob([bytes.buffer], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const name = mistakeDocxFilename(item);
      link.href = url; link.download = name;
      setExportFile({ url, name });
      document.body.appendChild(link);
      try { link.click(); } finally { link.remove(); }
    } catch {
      setError("Word 文档生成失败，请重试。");
    }
  }

  async function signOut() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // 请求失败也照常跳转：本地会话是无状态的，cookie 会随 30 天有效期自然过期
    }
    // 整页跳转，把内存里的错题和筛选条件一起清掉
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = "/login";
  }

  const recent = mistakes.slice(0, 2);
  return <><div className="app-shell">
    <aside className={`sidebar ${mobileMenu ? "open" : ""}`}>
      <button className="brand" onClick={() => { setTab("home"); setMobileMenu(false); }}><span className="brand-mark"><BookOpen size={25} strokeWidth={2.2} /></span><span><strong>拾题</strong><small>把每一次错误，变成进步</small></span></button>
      <div className="sidebar-section-label">学习空间</div>
      <nav className="side-nav"><button className={tab === "home" ? "active" : ""} onClick={() => { setTab("home"); setMobileMenu(false); }}><span><Sparkles size={19} />学习工作台</span><ArrowRight size={16} /></button><button className={tab === "notebook" ? "active" : ""} onClick={() => { setTab("notebook"); setMobileMenu(false); }}><span><BookOpen size={19} />我的错题本</span><em>{mistakes.length}</em></button></nav>
      <div className="sidebar-section-label subjects-label">科目分类</div>
      <div className="subject-nav">{(subjects.length ? subjects : ["数学", "语文", "英语"]).slice(0, 6).map((item, index) => <button key={item} onClick={() => { setSubject(item); setTab("notebook"); setMobileMenu(false); }}><span className={`subject-dot ${subjectColors[item] || "sand"}`} />{item}<span className="subject-count">{subjects.length ? mistakes.filter(m => m.subject === item).length : index === 0 ? "" : ""}</span></button>)}</div>
      <div className="sidebar-spacer" />
      <div className="sidebar-tip"><div className="tip-icon"><Lightbulb size={19} /></div><strong>每道错题都值得被看见</strong><p>拍照上传，整理思路，练习同类题。</p></div>
      <div className="sidebar-profile"><span className="avatar">{name.slice(0, 1)}</span><div><strong>{name}</strong><small>我的学习空间</small></div><button className="logout-button" onClick={signOut} title="退出登录" aria-label="退出登录"><LogOut size={15} /></button></div>
    </aside>

    <main className="main-area">
      <header className="topbar"><button className="mobile-menu" onClick={() => setMobileMenu(!mobileMenu)} aria-label="打开菜单"><Menu size={22} /></button><div className="breadcrumb">学习空间 <span>/</span> <strong>{tab === "home" ? "学习工作台" : tab === "results" ? "分析结果" : "我的错题本"}</strong></div><div className="top-right"><span className="today"><CalendarDays size={16} />{new Date().toLocaleDateString("zh-CN", { month: "long", day: "numeric" })}</span><span className="small-avatar">{name.slice(0, 1)}</span></div></header>
      <div className="content-wrap">
        {error && <div className="error-banner" role="alert"><span>{error}</span><button onClick={() => setError("")} aria-label="关闭提示"><X size={17} /></button></div>}
        {exportFile && <div className="notice-card" role="status"><span>Word 文档已生成，可在下载列表打开后编辑、打印。</span><a className="word-download-link" href={exportFile.url} download={exportFile.name}>下载 Word</a><button className="icon-action" onClick={() => setExportFile(null)} aria-label="关闭下载提示"><X size={17} /></button></div>}
        {tab === "home" && <>
          <section className="welcome-row"><div><div className="eyebrow"><span className="eyebrow-line" /> YOUR LEARNING DESK</div><h1>你好，{name}<span className="wave">✳</span></h1><p>把今天不懂的题，变成明天会做的题。</p></div><span className="welcome-date"><Clock3 size={16} />今天也在认真进步</span></section>
          <section className="hero-card"><div className="hero-content"><span className="hero-kicker"><Sparkles size={14} /> SMART STUDY COMPANION</span><h2>错题有解，<br /><em>成长有迹。</em></h2><p>上传试卷或作业照片，自动识别错题，逐题梳理解题思路，收藏到你的专属错题本。</p><button className="hero-cta" onClick={() => fileRef.current?.click()}>开始整理错题 <ArrowRight size={17} /></button></div><div className="hero-art" aria-hidden="true"><span className="art-orbit orbit-one" /><span className="art-orbit orbit-two" /><div className="art-paper back"><span /><span /><span /></div><div className="art-paper front"><div className="paper-badge"><Check size={17} /></div><span className="paper-line wide" /><span className="paper-line medium" /><span className="paper-line short" /><div className="paper-formula">2x + 6 = 14</div><div className="paper-solution">x = 4 <span>✓</span></div></div><div className="art-spark top">✦</div><div className="art-spark bottom">✳</div></div></section>
          <section className="stats-row"><div className="stat-card"><div className="stat-icon violet"><BookOpen size={21} /></div><div><strong>{mistakes.length}</strong><span>已整理错题</span></div><small>持续积累</small></div><div className="stat-card"><div className="stat-icon peach"><Filter size={21} /></div><div><strong>{subjects.length}</strong><span>涉及科目</span></div><small>自动分类</small></div><div className="stat-card"><div className="stat-icon mint"><Sparkles size={21} /></div><div><strong>{mistakes.filter(item => item.similarQuestions.length).length}</strong><span>已生成练习</span></div><small>举一反三</small></div></section>
          <div className="dashboard-grid"><section className="panel upload-panel"><div className="panel-heading"><div><span className="section-kicker">01 / UPLOAD</span><h2>上传你的题目</h2><p>试卷、练习册、课作本，拍一张就能开始整理。</p></div><span className="heading-icon"><CloudUpload size={24} /></span></div><div className="upload-zone" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); addFiles(event.dataTransfer.files); }} onClick={() => fileRef.current?.click()} role="button" tabIndex={0} onKeyDown={event => { if (event.key === "Enter") fileRef.current?.click(); }}><span className="upload-illustration"><UploadCloud size={31} /></span><strong>点击上传，或将图片拖到这里</strong><span>支持 JPG、PNG、WEBP · 最多 4 张</span><button type="button" onClick={event => { event.stopPropagation(); fileRef.current?.click(); }}>选择图片 <Plus size={16} /></button></div><div className="upload-actions"><button onClick={() => cameraRef.current?.click()}><Camera size={17} />拍照上传</button><span>图片将发送至 DeepSeek 分析，请遮盖姓名等个人信息</span></div>{selected.length > 0 && <div className="file-list">{selected.map((item, index) => <div className="selected-file" key={item.preview}><img src={item.preview} alt={`待上传第 ${index + 1} 张`} /><div><strong>{item.file.name}</strong><small>{(item.file.size / 1024 / 1024).toFixed(1)} MB</small></div><button aria-label="移除图片" onClick={() => setSelected(current => current.filter(file => file !== item))}><X size={17} /></button></div>)}<button className="analyze-button" onClick={analyze} disabled={uploading}>{uploading ? <><LoaderCircle className="spin" size={18} />正在识别并整理...</> : <><Sparkles size={18} />开始智能分析 <ArrowRight size={17} /></>}</button></div>}{aiReady === false && <p className="service-note">自动分析服务待配置。页面与错题本已就绪，配置后即可处理图片。</p>}</section>
          <section className="panel process-panel"><div className="panel-heading"><div><span className="section-kicker">HOW IT WORKS</span><h2>从拍照到掌握</h2><p>只需简单三步，理清每一次失误。</p></div></div><div className="steps"><div className="step"><span className="step-number">01</span><div><strong>上传图片</strong><p>拍摄试卷或作业，清晰显示题目与批改标记。</p></div><span className="step-icon lavender"><Camera size={20} /></span></div><div className="step"><span className="step-number">02</span><div><strong>逐题分析</strong><p>识别科目与明确错题，展示答案和解题思路。</p></div><span className="step-icon coral"><Lightbulb size={20} /></span></div><div className="step"><span className="step-number">03</span><div><strong>归档巩固</strong><p>按科目、时间保存，按需练习 1–5 道类似题。</p></div><span className="step-icon mint"><BookOpen size={20} /></span></div></div><div className="process-footer"><CheckCircle2 size={17} />错题仅对登录的你可见</div></section></div>
          <section className="recent-section"><div className="section-heading"><div><span className="section-kicker">YOUR PROGRESS</span><h2>最近整理</h2></div><button onClick={() => setTab("notebook")}>查看全部 <ArrowRight size={16} /></button></div>{loadingList ? <div className="empty-recent"><LoaderCircle className="spin" size={20} />正在加载错题本...</div> : recent.length ? <div className="recent-list">{recent.map(item => <button key={item.id} className="recent-item" onClick={() => { setSubject(item.subject); setQuery(item.question.slice(0, 12)); setTab("notebook"); }}><SubjectPill subject={item.subject} /><span>{item.question}</span><small>{formatDate(item.createdAt)}</small><ArrowRight size={16} /></button>)}</div> : <div className="empty-recent"><div className="empty-icon"><BookOpen size={24} /></div><div><strong>你的错题本还很清爽</strong><p>上传第一张试卷，开始积累属于自己的学习地图。</p></div></div>}</section>
        </>}
        {tab === "results" && analysis && <><section className="page-intro"><span className="section-kicker">ANALYSIS COMPLETE</span><h1>分析完成 <span className="success-check"><Check size={22} /></span></h1><p>{analysis.summary || "已完成图片分析。"}</p></section><div className="result-summary"><div><span>识别科目</span><SubjectPill subject={analysis.subject} /></div><div><span>发现错题</span><strong>{analysis.mistakes.length} 道</strong></div><div><span>归档状态</span><strong className="saved"><CheckCircle2 size={17} />已存入错题本</strong></div></div>{analysis.uncertainNote && <div className="notice-card"><Lightbulb size={17} /><span>{analysis.uncertainNote}</span></div>}{analysis.mistakes.length ? <div className="question-stack">{analysis.mistakes.map(item => <MistakeCard key={item.id} item={mistakes.find(saved => saved.id === item.id) || item} onSimilar={requestSimilar} onExport={exportMistake} onDelete={removeMistake} busy={busySimilar === item.id} />)}</div> : <div className="empty-state"><CheckCircle2 size={42} /><h2>没有识别到明确错题</h2><p>如果图片中的批改标记不清楚，可以换一张更清晰的照片再试。</p></div>}<button className="bottom-primary" onClick={() => { setTab("home"); fileRef.current?.click(); }}><Plus size={18} />继续上传</button></>}
        {tab === "notebook" && <><section className="page-intro notebook-intro"><span className="section-kicker">MY MISTAKE BOOK</span><h1>我的错题本</h1><p>每道认真整理过的题，都在这里等你重新掌握。</p></section><div className="notebook-toolbar"><div className="search-field"><Search size={18} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索题目或知识点" aria-label="搜索题目或知识点" /></div><div className="filters"><label><Filter size={16} /><select value={subject} onChange={event => setSubject(event.target.value)} aria-label="筛选科目"><option>全部科目</option>{subjects.map(item => <option key={item}>{item}</option>)}</select></label><label><CalendarDays size={16} /><input type="month" value={month} onChange={event => setMonth(event.target.value)} aria-label="筛选月份" /></label></div></div><div className="notebook-count">共 <strong>{filtered.length}</strong> 道错题 {subject !== "全部科目" && <button onClick={() => { setSubject("全部科目"); setQuery(""); setMonth(""); }}>清除筛选 <X size={13} /></button>}</div>{groups.length ? groups.map(([date, items]) => <section className="date-group" key={date}><div className="date-heading"><span className="date-dot" /><h2>{formatDate(date)}</h2><span>{items.length} 道错题</span></div><div className="question-stack">{items.map(item => <MistakeCard key={item.id} item={item} onSimilar={requestSimilar} onExport={exportMistake} onDelete={removeMistake} busy={busySimilar === item.id} showDelete />)}</div></section>) : <div className="empty-state"><BookOpen size={42} /><h2>{mistakes.length ? "没有找到符合条件的题目" : "错题本还是空的"}</h2><p>{mistakes.length ? "试试更换科目、时间或搜索词。" : "上传试卷或作业，错题会自动按科目和时间存入这里。"}</p><button onClick={() => { setTab("home"); setSubject("全部科目"); setQuery(""); setMonth(""); }}>去上传题目 <ArrowRight size={16} /></button></div>}</>}
      </div>
    </main>
    <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={event => { addFiles(event.target.files); event.target.value = ""; }} />
    <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={event => { addFiles(event.target.files); event.target.value = ""; }} />
  </div></>;
}

"use client";

import MathText from "./math-text";

import { useMemo, useRef, useState } from "react";
import { ArrowRight, CheckCircle2, Download, FileText, Lightbulb, LoaderCircle, Plus, RotateCcw, Sparkles, X } from "lucide-react";
import type { PracticeDetail, PracticeSummary } from "@/lib/practice-types";
import { practiceBlueprint, practiceKindLabels, kindForQuestion } from "@/lib/practice-blueprint";
import { normalizeKnowledgePoint } from "@/lib/knowledge-types";

function redirectIfUnauthorized(response: Response): boolean {
  if (response.status !== 401) return false;
  // Full navigation clears practice answers held in memory after session expiry.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.href = "/login";
  return true;
}

function paperSummary(paper: PracticeDetail): PracticeSummary {
  return {
    id: paper.id, subject: paper.subject, unitName: paper.unitName, gradeLevel: paper.gradeLevel,
    questionCount: paper.questionCount, createdAt: paper.createdAt, gradedAt: paper.gradedAt,
    correctCount: paper.correctCount, incorrectCount: paper.incorrectCount,
    uncertainCount: paper.uncertainCount, wrongKnowledgePoints: paper.wrongKnowledgePoints,
    correctKnowledgePoints: paper.correctKnowledgePoints,
  };
}

const draftKey = (id: string) => `shiti-practice-draft:${id}`;

export default function UnitPractice({ subjects, papers, weakPoints, initialSubject, initialUnit, initialPoint, trialExpired, aiReady, onSaved, onTrialExpired, onReviewPoint }: {
  subjects: string[];
  papers: PracticeSummary[];
  weakPoints: Array<{ subject: string; knowledgePoint: string }>;
  initialSubject: string;
  initialUnit: string;
  initialPoint: string;
  trialExpired: boolean;
  aiReady: boolean | null;
  onSaved: (paper: PracticeSummary) => void;
  onTrialExpired: () => void;
  onReviewPoint: (subject: string, point: string) => void;
}) {
  const [subject, setSubject] = useState(initialSubject || subjects[0] || "数学");
  const [unitName, setUnitName] = useState(initialUnit);
  const [gradeLevel, setGradeLevel] = useState("");
  const [count, setCount] = useState<3 | 5 | 10>(initialPoint ? 3 : 5);
  const [selectedPoints, setSelectedPoints] = useState<string[]>(initialPoint ? [normalizeKnowledgePoint(initialPoint)] : []);
  const [customPoint, setCustomPoint] = useState("");
  const [paper, setPaper] = useState<PracticeDetail | null>(null);
  const [answers, setAnswers] = useState<string[]>([]);
  const [retaking, setRetaking] = useState(false);
  const [busy, setBusy] = useState<"generate" | "grade" | "download" | string | null>(null);
  const [error, setError] = useState("");
  const paperRef = useRef<HTMLElement>(null);
  const suggestions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of weakPoints) if (item.subject === subject) {
      const point = normalizeKnowledgePoint(item.knowledgePoint);
      if (point) counts.set(point, (counts.get(point) || 0) + 1);
    }
    for (const paperItem of papers) if (paperItem.subject === subject) {
      for (const name of paperItem.wrongKnowledgePoints) {
        const point = normalizeKnowledgePoint(name);
        if (point) counts.set(point, (counts.get(point) || 0) + 1);
      }
    }
    return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([name, hits]) => ({ name, hits }));
  }, [weakPoints, papers, subject]);
  const plan = practiceBlueprint(count);

  function togglePoint(point: string) {
    setError("");
    if (selectedPoints.includes(point)) {
      setSelectedPoints(current => current.filter(item => item !== point));
    } else if (selectedPoints.length >= Math.min(count, 4)) {
      setError(`这份卷最多选择 ${Math.min(count, 4)} 个知识点。`);
    } else {
      setSelectedPoints(current => [...current, point]);
    }
  }

  function addCustomPoint() {
    const point = normalizeKnowledgePoint(customPoint);
    if (!point || point.length > 100) { setError("知识点名称应为 1 到 100 个字。"); return; }
    if (!selectedPoints.includes(point)) {
      if (selectedPoints.length >= Math.min(count, 4)) { setError(`这份卷最多选择 ${Math.min(count, 4)} 个知识点。`); return; }
      togglePoint(point);
    }
    setCustomPoint("");
  }

  const scrollToPaper = () => window.setTimeout(() => paperRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);

  async function readJson(response: Response) {
    if (redirectIfUnauthorized(response)) return null;
    const data = await response.json() as { paper?: PracticeDetail; error?: string; code?: string };
    if (data.code === "TRIAL_EXPIRED") onTrialExpired();
    if (!response.ok) throw new Error(data.error || "操作失败，请重试");
    return data;
  }

  async function openPaper(id: string) {
    setBusy(id); setError("");
    try {
      const data = await readJson(await fetch(`/api/practice-papers/${id}`));
      if (!data?.paper) return;
      const savedAnswers = data.paper.answers.length ? data.paper.answers : data.paper.questions.map(() => "");
      let draft: string[] | null = null;
      try {
        const raw = window.sessionStorage.getItem(draftKey(id));
        if (raw) {
          const parsed = JSON.parse(raw) as unknown;
          if (Array.isArray(parsed) && parsed.length === data.paper.questions.length && parsed.every(item => typeof item === "string")) draft = parsed;
        }
      } catch { /* Browser storage may be disabled. */ }
      setPaper(data.paper); setAnswers(draft || savedAnswers);
      setRetaking(Boolean(draft));
      scrollToPaper();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "练习卷加载失败"); }
    finally { setBusy(null); }
  }

  async function generate() {
    if (trialExpired) { setError("免费体验已结束，请联系管理员开通后再生成练习卷。"); return; }
    if (!subject.trim() || !unitName.trim()) { setError("请填写科目和单元名称。"); return; }
    setBusy("generate"); setError("");
    try {
      const response = await fetch("/api/practice-papers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subject: subject.trim(), unitName: unitName.trim(), gradeLevel: gradeLevel.trim(), count, focusPoints: selectedPoints }) });
      const data = await readJson(response);
      if (!data?.paper) return;
      setPaper(data.paper); setAnswers(data.paper.questions.map(() => "")); setRetaking(false);
      onSaved(paperSummary(data.paper));
      scrollToPaper();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "生成练习卷失败"); }
    finally { setBusy(null); }
  }

  async function grade() {
    if (!paper) return;
    if (trialExpired) { setError("免费体验已结束，请联系管理员开通后再批改练习卷。"); return; }
    if (!answers.some(answer => answer.trim())) { setError("请至少完成一题再提交批改。"); return; }
    setBusy("grade"); setError("");
    try {
      const response = await fetch(`/api/practice-papers/${paper.id}/grade`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answers }) });
      const data = await readJson(response);
      if (!data?.paper) return;
      setPaper(data.paper); setAnswers(data.paper.answers); setRetaking(false);
      try { window.sessionStorage.removeItem(draftKey(paper.id)); } catch { /* Browser storage may be disabled. */ }
      onSaved(paperSummary(data.paper));
      scrollToPaper();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "批改失败，请重试"); }
    finally { setBusy(null); }
  }

  async function downloadWord() {
    if (!paper) return;
    setBusy("download"); setError("");
    try {
      const response = await fetch(`/api/practice-papers/${paper.id}/word`);
      if (redirectIfUnauthorized(response)) return;
      if (!response.ok) throw new Error("Word 下载失败，请重试");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `拾题-${paper.subject}-${paper.unitName}-单元练习卷`.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 90) + ".docx";
      document.body.appendChild(link);
      try { link.click(); } finally { link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 60_000); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Word 下载失败"); }
    finally { setBusy(null); }
  }

  const showGrading = Boolean(paper?.gradedAt && !retaking);
  function updateAnswer(index: number, value: string) {
    const next = answers.map((answer, i) => i === index ? value : answer);
    setAnswers(next);
    if (paper) {
      try { window.sessionStorage.setItem(draftKey(paper.id), JSON.stringify(next)); } catch { /* Browser storage may be disabled. */ }
    }
  }
  return <>
    <section className="page-intro"><span className="section-kicker">UNIT PRACTICE</span><h1>单元练习卷</h1><p>先确认要练的知识点，再按基础、方法、易错辨析和应用出卷。可在线批改，也可下载 Word。</p></section>
    {error && <div className="practice-error" role="alert">{error}</div>}
    <section className="practice-create panel"><div className="panel-heading"><div><span className="section-kicker">CREATE A PAPER</span><h2>先定练什么，再出卷</h2><p>保留手动输入单元名称；知识点由你确认，避免把其他单元的错题混进来。</p></div><span className="heading-icon"><FileText size={23} /></span></div>
      <div className="practice-form">
        <label>科目<input value={subject} onChange={event => setSubject(event.target.value)} list="practice-subjects" maxLength={30} placeholder="如：数学" /><datalist id="practice-subjects">{subjects.map(item => <option key={item} value={item} />)}</datalist></label>
        <label>单元名称<input value={unitName} onChange={event => setUnitName(event.target.value)} maxLength={80} placeholder="如：一元一次方程" /></label>
        <label>年级（选填）<input value={gradeLevel} onChange={event => setGradeLevel(event.target.value)} maxLength={30} placeholder="如：七年级上册" /></label>
        <label>练习模式<select value={count} onChange={event => { const next = Number(event.target.value) as 3 | 5 | 10; setCount(next); setSelectedPoints(current => current.slice(0, Math.min(next, 4))); }}><option value={3}>概念小测 · 3 道</option><option value={5}>快速诊断 · 5 道</option><option value={10}>单元巩固 · 10 道</option></select></label>
      </div>
      <div className="practice-focus"><div className="practice-focus-head"><strong>确认本次重点</strong><span>可选 {Math.min(count, 4)} 个；不选则覆盖本单元主要知识点</span></div>
        {suggestions.length > 0 && <div className="practice-suggestions">{suggestions.map(item => <button key={item.name} type="button" className={selectedPoints.includes(item.name) ? "selected" : ""} onClick={() => togglePoint(item.name)} aria-pressed={selectedPoints.includes(item.name)}>{item.name}<small>{item.hits} 次错误</small></button>)}</div>}
        <div className="practice-custom-point"><input value={customPoint} onChange={event => setCustomPoint(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); addCustomPoint(); } }} maxLength={100} placeholder="也可以自己输入知识点" aria-label="添加知识点" /><button type="button" onClick={addCustomPoint}><Plus size={15} />添加</button></div>
        {selectedPoints.length > 0 && <div className="practice-selected" aria-label="已确认知识点">{selectedPoints.map(point => <button type="button" key={point} onClick={() => togglePoint(point)} title="移除这个知识点">{point}<X size={13} /></button>)}</div>}
      </div>
      <div className="practice-blueprint" aria-label="本次出题结构"><strong>出题结构</strong><div>{plan.map((kind, index) => <span key={index}>{index + 1} · {practiceKindLabels[kind]}</span>)}</div></div>
      <button type="button" className="practice-primary" onClick={generate} disabled={busy !== null || trialExpired || aiReady === false}>{busy === "generate" ? <><LoaderCircle size={17} className="spin" />正在出卷...</> : <><Sparkles size={17} />{trialExpired ? "体验已到期" : "生成练习卷"}</>}</button>
      {aiReady === false && <p className="service-note">AI 服务尚未配置，暂时无法生成或批改练习卷。</p>}
    </section>
    {paper && <section className="practice-paper" ref={paperRef} aria-label="在线练习卷"><div className="practice-paper-head"><div><span className="section-kicker">PRACTICE PAPER</span><h2>{paper.subject} · {paper.unitName}</h2><p>{paper.gradeLevel || "单元练习"} · {paper.questionCount} 道题</p></div><button type="button" className="practice-word" onClick={downloadWord} disabled={busy !== null}>{busy === "download" ? <LoaderCircle size={16} className="spin" /> : <Download size={16} />}下载 Word 试卷</button></div>
      {showGrading && <div className="practice-score" role="status"><CheckCircle2 size={20} /><span>批改完成：正确 {paper.correctCount} 道，错误 {paper.incorrectCount} 道{paper.uncertainCount ? `，待核对 ${paper.uncertainCount} 道` : ""}。</span><button type="button" onClick={() => { const blank = paper.questions.map(() => ""); setAnswers(blank); setRetaking(true); try { window.sessionStorage.setItem(draftKey(paper.id), JSON.stringify(blank)); } catch { /* Browser storage may be disabled. */ } }} disabled={trialExpired}><RotateCcw size={15} />重新作答</button></div>}
      {showGrading && paper.wrongKnowledgePoints.length > 0 && <div className="practice-next"><strong>下一步先弄懂这些知识点</strong><div>{[...new Set(paper.wrongKnowledgePoints)].map(point => <button type="button" key={point} onClick={() => onReviewPoint(paper.subject, point)}>{point}<ArrowRight size={14} /></button>)}</div><p>先看概念与相关错题，再做一次 3 题小测；本次结果只说明这份卷的表现。</p></div>}
      <div className="practice-questions">{paper.questions.map((item, index) => {
        const gradeItem = showGrading ? paper.grading[index] : null;
        return <article className="practice-question" key={`${paper.id}-${index}`}><div className="practice-question-title"><span>{String(index + 1).padStart(2, "0")}</span><div><small>{practiceKindLabels[kindForQuestion(item.kind)]} · {item.knowledgePoint}</small><h3><MathText value={item.question} /></h3></div></div><label htmlFor={`practice-answer-${paper.id}-${index}`}>我的作答</label><textarea id={`practice-answer-${paper.id}-${index}`} value={answers[index] || ""} onChange={event => updateAnswer(index, event.target.value)} maxLength={2000} disabled={showGrading || busy === "grade"} placeholder="在这里写下答案或解题过程" rows={3} />{gradeItem && <div className={`practice-feedback ${gradeItem.verdict}`}><strong>{gradeItem.verdict === "correct" ? "回答正确" : gradeItem.verdict === "incorrect" ? "需要订正" : "建议人工核对"}</strong><p><MathText value={gradeItem.comment} /></p><p><b>参考答案：</b><MathText value={gradeItem.answer} /></p><p><b>解析：</b><MathText value={gradeItem.explanation} /></p></div>}</article>;
      })}</div>
      {!showGrading && <div className="practice-submit"><p><Lightbulb size={16} />提交后由 AI 逐题批改；答案和解析仅供学习参考。</p><button type="button" className="practice-primary" onClick={grade} disabled={busy !== null || trialExpired || aiReady === false}>{busy === "grade" ? <><LoaderCircle size={17} className="spin" />正在批改...</> : <>提交批改 <ArrowRight size={16} /></>}</button></div>}
    </section>}
    <section className="practice-history"><div className="section-heading"><div><span className="section-kicker">SAVED PAPERS</span><h2>已生成的练习卷</h2></div><span>{papers.length} 份</span></div>{papers.length ? <div className="practice-history-list">{papers.map(item => <button type="button" key={item.id} className={paper?.id === item.id ? "active" : ""} onClick={() => openPaper(item.id)} disabled={busy !== null}><FileText size={20} /><span><strong>{item.subject} · {item.unitName}</strong><small>{new Date(item.createdAt).toLocaleDateString("zh-CN")} · {item.questionCount} 道题 · {item.gradedAt ? `正确 ${item.correctCount} 道` : "尚未批改"}</small></span>{busy === item.id ? <LoaderCircle size={16} className="spin" /> : <ArrowRight size={16} />}</button>)}</div> : <div className="empty-recent">还没有练习卷。填写单元名称后即可生成。</div>}</section>
  </>;
}

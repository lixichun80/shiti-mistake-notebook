"use client";

import { useRef, useState } from "react";
import { ArrowRight, CheckCircle2, Download, FileText, Lightbulb, LoaderCircle, RotateCcw, Sparkles } from "lucide-react";
import type { PracticeDetail, PracticeSummary } from "@/lib/practice-types";

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
  };
}

const draftKey = (id: string) => `shiti-practice-draft:${id}`;

export default function UnitPractice({ subjects, papers, initialSubject, initialUnit, trialExpired, aiReady, onSaved, onTrialExpired }: {
  subjects: string[];
  papers: PracticeSummary[];
  initialSubject: string;
  initialUnit: string;
  trialExpired: boolean;
  aiReady: boolean | null;
  onSaved: (paper: PracticeSummary) => void;
  onTrialExpired: () => void;
}) {
  const [subject, setSubject] = useState(initialSubject || subjects[0] || "数学");
  const [unitName, setUnitName] = useState(initialUnit);
  const [gradeLevel, setGradeLevel] = useState("");
  const [count, setCount] = useState<5 | 10>(5);
  const [paper, setPaper] = useState<PracticeDetail | null>(null);
  const [answers, setAnswers] = useState<string[]>([]);
  const [retaking, setRetaking] = useState(false);
  const [busy, setBusy] = useState<"generate" | "grade" | "download" | string | null>(null);
  const [error, setError] = useState("");
  const paperRef = useRef<HTMLElement>(null);

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
      const response = await fetch("/api/practice-papers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subject: subject.trim(), unitName: unitName.trim(), gradeLevel: gradeLevel.trim(), count }) });
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
    <section className="page-intro"><span className="section-kicker">UNIT PRACTICE</span><h1>单元练习卷</h1><p>输入单元名称，围绕本单元和已有薄弱知识点出卷；在线完成后可批改，也可下载 Word。</p></section>
    {error && <div className="practice-error" role="alert">{error}</div>}
    <section className="practice-create panel"><div className="panel-heading"><div><span className="section-kicker">CREATE A PAPER</span><h2>生成一份新练习卷</h2><p>单元名称由你填写，已有错题中相关的知识点会优先用于出题。</p></div><span className="heading-icon"><FileText size={23} /></span></div>
      <div className="practice-form">
        <label>科目<input value={subject} onChange={event => setSubject(event.target.value)} list="practice-subjects" maxLength={30} placeholder="如：数学" /><datalist id="practice-subjects">{subjects.map(item => <option key={item} value={item} />)}</datalist></label>
        <label>单元名称<input value={unitName} onChange={event => setUnitName(event.target.value)} maxLength={80} placeholder="如：一元一次方程" /></label>
        <label>年级（选填）<input value={gradeLevel} onChange={event => setGradeLevel(event.target.value)} maxLength={30} placeholder="如：七年级上册" /></label>
        <label>题目数量<select value={count} onChange={event => setCount(Number(event.target.value) as 5 | 10)}><option value={5}>5 道</option><option value={10}>10 道</option></select></label>
      </div>
      <button type="button" className="practice-primary" onClick={generate} disabled={busy !== null || trialExpired || aiReady === false}>{busy === "generate" ? <><LoaderCircle size={17} className="spin" />正在出卷...</> : <><Sparkles size={17} />{trialExpired ? "体验已到期" : "生成练习卷"}</>}</button>
      {aiReady === false && <p className="service-note">AI 服务尚未配置，暂时无法生成或批改练习卷。</p>}
    </section>
    {paper && <section className="practice-paper" ref={paperRef} aria-label="在线练习卷"><div className="practice-paper-head"><div><span className="section-kicker">PRACTICE PAPER</span><h2>{paper.subject} · {paper.unitName}</h2><p>{paper.gradeLevel || "单元练习"} · {paper.questionCount} 道题</p></div><button type="button" className="practice-word" onClick={downloadWord} disabled={busy !== null}>{busy === "download" ? <LoaderCircle size={16} className="spin" /> : <Download size={16} />}下载 Word 试卷</button></div>
      {showGrading && <div className="practice-score" role="status"><CheckCircle2 size={20} /><span>批改完成：正确 {paper.correctCount} 道，错误 {paper.incorrectCount} 道{paper.uncertainCount ? `，待核对 ${paper.uncertainCount} 道` : ""}。</span><button type="button" onClick={() => { const blank = paper.questions.map(() => ""); setAnswers(blank); setRetaking(true); try { window.sessionStorage.setItem(draftKey(paper.id), JSON.stringify(blank)); } catch { /* Browser storage may be disabled. */ } }} disabled={trialExpired}><RotateCcw size={15} />重新作答</button></div>}
      <div className="practice-questions">{paper.questions.map((item, index) => {
        const gradeItem = showGrading ? paper.grading[index] : null;
        return <article className="practice-question" key={`${paper.id}-${index}`}><div className="practice-question-title"><span>{String(index + 1).padStart(2, "0")}</span><div><small>{item.knowledgePoint}</small><h3>{item.question}</h3></div></div><label htmlFor={`practice-answer-${paper.id}-${index}`}>我的作答</label><textarea id={`practice-answer-${paper.id}-${index}`} value={answers[index] || ""} onChange={event => updateAnswer(index, event.target.value)} maxLength={2000} disabled={showGrading || busy === "grade"} placeholder="在这里写下答案或解题过程" rows={3} />{gradeItem && <div className={`practice-feedback ${gradeItem.verdict}`}><strong>{gradeItem.verdict === "correct" ? "回答正确" : gradeItem.verdict === "incorrect" ? "需要订正" : "建议人工核对"}</strong><p>{gradeItem.comment}</p><p><b>参考答案：</b>{gradeItem.answer}</p><p><b>解析：</b>{gradeItem.explanation}</p></div>}</article>;
      })}</div>
      {!showGrading && <div className="practice-submit"><p><Lightbulb size={16} />提交后由 AI 逐题批改；答案和解析仅供学习参考。</p><button type="button" className="practice-primary" onClick={grade} disabled={busy !== null || trialExpired || aiReady === false}>{busy === "grade" ? <><LoaderCircle size={17} className="spin" />正在批改...</> : <>提交批改 <ArrowRight size={16} /></>}</button></div>}
    </section>}
    <section className="practice-history"><div className="section-heading"><div><span className="section-kicker">SAVED PAPERS</span><h2>已生成的练习卷</h2></div><span>{papers.length} 份</span></div>{papers.length ? <div className="practice-history-list">{papers.map(item => <button type="button" key={item.id} className={paper?.id === item.id ? "active" : ""} onClick={() => openPaper(item.id)} disabled={busy !== null}><FileText size={20} /><span><strong>{item.subject} · {item.unitName}</strong><small>{new Date(item.createdAt).toLocaleDateString("zh-CN")} · {item.questionCount} 道题 · {item.gradedAt ? `正确 ${item.correctCount} 道` : "尚未批改"}</small></span>{busy === item.id ? <LoaderCircle size={16} className="spin" /> : <ArrowRight size={16} />}</button>)}</div> : <div className="empty-recent">还没有练习卷。填写单元名称后即可生成。</div>}</section>
  </>;
}

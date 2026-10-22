"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Camera, CheckCircle2, FileImage, Lightbulb, LoaderCircle, PenLine, Plus, Sparkles, X } from "lucide-react";
import type { EssayDetail, EssayExtraction, EssayFeedback, EssaySummary } from "@/lib/essay-types";

type Photo = { file: File; preview: string };
type Props = { trialExpired: boolean; aiReady: boolean | null; onTrialExpired: () => void };

const tips = [
  "把作文题目和写作要求一起拍进去，点评才能核对是否切题。",
  "请先遮盖姓名、班级、学号和二维码等个人信息。",
  "最多上传 4 张图片；请让字迹清楚，尽量避开反光。",
  "识别后的原文可以修改；请先核对，再生成分析。",
  "润色建议是学习参考，先想想为什么这样改。",
];
const issueLabels = { spelling: "拼写", grammar: "语法", punctuation: "标点", expression: "表达" };

async function preparePhoto(file: File): Promise<File> {
  if (file.size < 2.5 * 1024 * 1024) return file;
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = url;
    });
    const scale = Math.min(1, 2200 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.9));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function FeedbackCard({ number, title, item }: { number: string; title: string; item: EssayFeedback }) {
  return <article className="essay-feedback-card"><div className="essay-card-heading"><span>{number}</span><h3>{title}</h3></div><dl><dt>做得好的地方</dt><dd>{item.strength || "这部分需要结合原文继续观察。"}</dd><dt>原文依据</dt><dd>{item.evidence || "照片或原文没有足够清晰的依据。"}</dd><dt>下一步建议</dt><dd>{item.improvement || "继续练习并与老师核对。"}</dd></dl></article>;
}

export default function EssayAnalysis({ trialExpired, aiReady, onTrialExpired }: Props) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const allUrls = useRef<string[]>([]);
  const chooseRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [promptText, setPromptText] = useState("");
  const [essayText, setEssayText] = useState("");
  const [gradeLevel, setGradeLevel] = useState("");
  const [extraction, setExtraction] = useState<EssayExtraction | null>(null);
  const [detail, setDetail] = useState<EssayDetail | null>(null);
  const [history, setHistory] = useState<EssaySummary[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [busy, setBusy] = useState<"recognizing" | "analyzing" | "loading" | null>(null);
  const [tipIndex, setTipIndex] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    fetch("/api/essays").then(async response => {
      // Full navigation drops any confirmed draft after the session expires.
      if (response.status === 401) { window.location.href = "/login"; return null; }
      if (!response.ok) throw new Error("作文记录加载失败，请刷新页面重试");
      return response.json() as Promise<{ essays: EssaySummary[] }>;
    }).then(data => { if (mounted && data) setHistory(data.essays); })
      .catch(cause => { if (mounted) setError(cause instanceof Error ? cause.message : "作文记录加载失败"); })
      .finally(() => { if (mounted) setLoadingHistory(false); });
    return () => { mounted = false; allUrls.current.forEach(url => URL.revokeObjectURL(url)); };
  }, []);

  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => setTipIndex(index => (index + 1) % tips.length), 5000);
    return () => window.clearInterval(timer);
  }, [busy]);

  function addPhotos(list: FileList | null) {
    if (!list) return;
    const incoming = Array.from(list);
    if (incoming.some(file => !["image/jpeg", "image/png", "image/webp"].includes(file.type) || !file.size || file.size > 8 * 1024 * 1024)) {
      setError("仅支持 JPG、PNG、WEBP，单张不超过 8 MB"); return;
    }
    if (photos.length + incoming.length > 4) { setError("一次最多上传 4 张图片"); return; }
    setError(""); setExtraction(null); setDetail(null);
    const next = incoming.map(file => ({ file, preview: URL.createObjectURL(file) }));
    allUrls.current.push(...next.map(item => item.preview));
    setPhotos(current => [...current, ...next]);
  }

  function removePhoto(preview: string) {
    setPhotos(current => current.filter(item => item.preview !== preview));
    setExtraction(null);
    setDetail(null);
    URL.revokeObjectURL(preview);
    allUrls.current = allUrls.current.filter(url => url !== preview);
  }

  function startNew() {
    allUrls.current.forEach(url => URL.revokeObjectURL(url));
    allUrls.current = [];
    setPhotos([]); setPromptText(""); setEssayText(""); setGradeLevel("");
    setExtraction(null); setDetail(null); setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleResponse(response: Response): Promise<Record<string, unknown> | null> {
    if (response.status === 401) { window.location.href = "/login"; return null; }
    const data = await response.json() as Record<string, unknown>;
    if (data.code === "TRIAL_EXPIRED") onTrialExpired();
    if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "操作失败，请重试");
    return data;
  }

  async function photoForm(): Promise<FormData> {
    const form = new FormData();
    for (const photo of photos) form.append("files", await preparePhoto(photo.file));
    return form;
  }

  async function recognize() {
    if (!photos.length) { setError("请先上传作文照片"); return; }
    if (trialExpired || aiReady === false) return;
    setBusy("recognizing"); setTipIndex(0); setError("");
    try {
      const form = await photoForm();
      form.append("promptHint", promptText);
      const response = await fetch("/api/essays/extract", { method: "POST", body: form });
      const data = await handleResponse(response);
      if (!data) return;
      const value = data.extraction as EssayExtraction;
      setExtraction(value);
      setEssayText(value.essayText);
      setPromptText(value.promptText || promptText);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "作文识别失败，请重试"); }
    finally { setBusy(null); }
  }

  async function analyze() {
    if (!extraction || !photos.length) { setError("请先识别并核对原文"); return; }
    if (!promptText.trim() || essayText.trim().length < 10) { setError("请补全题目要求和至少 10 字的英语原文"); return; }
    if (trialExpired || aiReady === false) return;
    setBusy("analyzing"); setTipIndex(0); setError("");
    try {
      const form = await photoForm();
      form.append("promptText", promptText.trim());
      form.append("confirmedText", essayText.trim());
      form.append("gradeLevel", gradeLevel.trim());
      const response = await fetch("/api/essays", { method: "POST", body: form });
      const data = await handleResponse(response);
      if (!data) return;
      const essay = data.essay as EssayDetail;
      setDetail(essay);
      setHistory(current => [{ id: essay.id, promptText: essay.promptText, excerpt: essay.excerpt, createdAt: essay.createdAt }, ...current]);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "作文分析失败，请重试"); }
    finally { setBusy(null); }
  }

  async function openHistory(id: string) {
    setBusy("loading"); setError("");
    try {
      const response = await fetch(`/api/essays/${encodeURIComponent(id)}`);
      const data = await handleResponse(response);
      if (!data) return;
      setDetail(data.essay as EssayDetail);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "报告加载失败，请重试"); }
    finally { setBusy(null); }
  }

  return <div className="essay-page">
    <section className="page-intro essay-intro"><span className="section-kicker">ENGLISH WRITING</span><h1>英语作文分析</h1><p>上传作文和题目，核对原文后，查看写作点评与逐句建议。</p></section>
    {error && <div className="error-banner" role="alert"><span>{error}</span><button type="button" onClick={() => setError("")} aria-label="关闭错误提示"><X size={17} /></button></div>}
    {detail ? <div className="essay-report">
      <div className="essay-report-top"><div className="essay-report-actions"><button type="button" className="essay-back" onClick={() => setDetail(null)}><ArrowLeft size={16} />返回上传与历史</button><button type="button" className="essay-back" onClick={startNew}><Plus size={16} />分析新作文</button></div><span>{new Date(detail.createdAt).toLocaleDateString("zh-CN")}</span></div>
      <section className="essay-report-hero"><span className="section-kicker">WRITING REVIEW</span><h2>这篇作文的学习报告 <CheckCircle2 size={24} /></h2><p>{detail.report.summary}</p><small>AI 建议仅供学习参考，字迹、语法和题意请结合原稿及老师意见核对。</small></section>
      <div className="essay-report-columns"><article className="essay-original"><h3>题目要求</h3><p>{detail.promptText}</p><h3>核对后的作文原文</h3><p lang="en">{detail.originalText}</p></article><section className="essay-feedback"><div className="essay-section-head"><span className="section-kicker">01 / OVERVIEW</span><h2>写作点评</h2></div><div className="essay-feedback-grid"><FeedbackCard number="01" title="内容" item={detail.report.content} /><FeedbackCard number="02" title="语言" item={detail.report.language} /><FeedbackCard number="03" title="结构" item={detail.report.structure} /><FeedbackCard number="04" title="书写" item={detail.report.handwriting} /></div>{!detail.report.handwriting.assessable && <p className="essay-caution">照片中字迹不够清晰，书写点评仅供参考。</p>}</section></div>
      <section className="essay-report-section"><div className="essay-section-head"><span className="section-kicker">02 / CORRECTIONS</span><h2>逐句批改</h2><p>仅列可以确认的问题；表达上的可选优化放在下一部分。</p></div>{detail.report.sentenceEdits.length ? <div className="essay-edit-list">{detail.report.sentenceEdits.map((item, index) => <article className="essay-edit" key={`${index}-${item.original}`}><div className="essay-edit-index">{String(index + 1).padStart(2, "0")}</div><div><span className="essay-issue">{issueLabels[item.issueType]}</span><p className="essay-before" lang="en">{item.original}</p><p className="essay-after" lang="en">{item.suggested}</p><p className="essay-reason">{item.explanation}</p></div></article>)}</div> : <p className="essay-empty">没有能够确认的逐句错误；可继续查看润色建议。</p>}</section>
      <section className="essay-report-section"><div className="essay-section-head"><span className="section-kicker">03 / POLISH</span><h2>个性化润色</h2><p>从你的原句出发，补充细节、衔接或更自然的表达。</p></div>{detail.report.polish.length ? <div className="essay-polish-grid">{detail.report.polish.map((item, index) => <article className="essay-polish" key={`${index}-${item.original}`}><span>建议 {String(index + 1).padStart(2, "0")}</span><div><small>原句</small><p lang="en">{item.original}</p></div><div><small>润色示例</small><p lang="en">{item.polished}</p></div><p className="essay-reason">{item.reason}</p></article>)}</div> : <p className="essay-empty">本次没有可靠的润色示例。</p>}</section>
      <section className="essay-report-section"><div className="essay-section-head"><span className="section-kicker">04 / EXPRESSIONS</span><h2>好词佳句参考</h2><p>用于学习开头、过渡和结尾，写作时请用自己的话表达。</p></div><div className="essay-reference-grid">{detail.report.references.map((item, index) => <article className="essay-reference" key={`${index}-${item.example}`}><span>{item.purpose}</span><p lang="en">{item.example}</p><small>{item.usage}</small></article>)}</div></section>
      {detail.report.uncertaintyNote && <div className="essay-caution"><Lightbulb size={17} /><span>待核对：{detail.report.uncertaintyNote}</span></div>}
    </div> : <div className="essay-workspace">
      <section className="essay-form-panel"><div className="essay-section-head"><span className="section-kicker">01 / PHOTOS</span><h2>上传作文与题目</h2><p>可分别拍摄作文和题目要求；照片只用于本次识别与分析，报告保存文字。</p></div>
        {trialExpired && <div className="essay-caution">免费体验已到期，可继续查看历史报告。需要新分析请联系管理员。</div>}
        {aiReady === false && <div className="essay-caution">AI 服务尚未配置，暂时无法识别和分析作文。</div>}
        <div className="essay-upload-actions"><button type="button" onClick={() => chooseRef.current?.click()} disabled={Boolean(busy) || trialExpired}><Plus size={17} />选择图片</button><button type="button" onClick={() => cameraRef.current?.click()} disabled={Boolean(busy) || trialExpired}><Camera size={17} />拍照上传</button><span>{photos.length}/4 张</span></div>
        {photos.length ? <div className="essay-photo-list">{photos.map((photo, index) => <div className="essay-photo" key={photo.preview}>{/* Local object URL preview; no remote image optimization is needed. */}<img src={photo.preview} alt={`作文照片 ${index + 1}`} /><span><FileImage size={14} />{photo.file.name}</span><button type="button" aria-label={`移除第 ${index + 1} 张照片`} onClick={() => removePhoto(photo.preview)} disabled={Boolean(busy)}><X size={16} /></button></div>)}</div> : <div className="essay-upload-empty"><PenLine size={29} /><strong>还没有作文照片</strong><span>支持 JPG、PNG、WEBP · 最多 4 张 · 单张不超过 8 MB</span></div>}
        <label className="essay-field">题目要求（可先补充，识别后请再核对）<textarea value={promptText} onChange={event => setPromptText(event.target.value)} maxLength={2000} placeholder="例如：My Family，介绍家庭成员的外貌、性格和爱好。" rows={3} disabled={Boolean(busy)} /></label>
        <button type="button" className="essay-primary" onClick={recognize} disabled={Boolean(busy) || !photos.length || trialExpired || aiReady === false}>{busy === "recognizing" ? <><LoaderCircle className="spin" size={17} />正在识别原文...</> : <><Sparkles size={17} />识别作文原文 <ArrowRight size={16} /></>}</button>
        {extraction && <div className="essay-confirm"><div className="essay-section-head"><span className="section-kicker">02 / CONFIRM</span><h2>核对识别结果</h2><p>下面文字可编辑。请对照原稿，特别检查拼写、标点和 [看不清] 标记。</p></div>
          {extraction.uncertainNote && <div className="essay-caution"><Lightbulb size={17} />{extraction.uncertainNote}</div>}
          {extraction.teacherMarksNote && <div className="essay-teacher-note">识别到的教师批注：{extraction.teacherMarksNote}。这些内容没有并入你的作文原文。</div>}
          <label className="essay-field">题目要求<textarea value={promptText} onChange={event => setPromptText(event.target.value)} maxLength={2000} rows={3} disabled={Boolean(busy)} /></label>
          <label className="essay-field">我的作文原文<textarea value={essayText} onChange={event => setEssayText(event.target.value)} maxLength={10000} rows={12} lang="en" spellCheck={false} disabled={Boolean(busy)} /></label>
          <label className="essay-field">年级（选填）<input value={gradeLevel} onChange={event => setGradeLevel(event.target.value)} maxLength={30} placeholder="例如：七年级" disabled={Boolean(busy)} /></label>
          <button type="button" className="essay-primary" onClick={analyze} disabled={Boolean(busy) || trialExpired || aiReady === false}>{busy === "analyzing" ? <><LoaderCircle className="spin" size={17} />正在生成报告...</> : <>原文已核对，生成分析 <ArrowRight size={16} /></>}</button>
        </div>}
        {(busy === "recognizing" || busy === "analyzing") && <div className="analysis-progress" role="status" aria-live="polite"><div className="analysis-progress-track" role="progressbar" aria-label="正在处理作文"><span /></div><p className="analysis-tip"><Lightbulb size={15} />{tips[tipIndex]}</p></div>}
      </section>
      <aside className="essay-history"><div className="essay-section-head"><span className="section-kicker">YOUR WRITING</span><h2>历史作文</h2><p>只显示你保存过的分析报告。</p></div>{loadingHistory ? <p className="essay-empty"><LoaderCircle className="spin" size={17} />正在加载...</p> : history.length ? <div className="essay-history-list">{history.map(item => <button type="button" key={item.id} onClick={() => openHistory(item.id)} disabled={Boolean(busy)}><strong>{item.promptText}</strong><span>{item.excerpt}</span><small>{new Date(item.createdAt).toLocaleDateString("zh-CN")} <ArrowRight size={14} /></small></button>)}</div> : <p className="essay-empty">完成第一篇作文分析后，报告会保存在这里。</p>}</aside>
    </div>}
    <input ref={chooseRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={event => { addPhotos(event.target.files); event.target.value = ""; }} />
    <input ref={cameraRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden onChange={event => { addPhotos(event.target.files); event.target.value = ""; }} />
  </div>;
}

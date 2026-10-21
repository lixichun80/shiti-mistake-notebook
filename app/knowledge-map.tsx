"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, BookOpen, CheckCircle2, Lightbulb, LoaderCircle, Network, Sparkles } from "lucide-react";
import { buildKnowledgeMap, type KnowledgeEvidence, type KnowledgeNode } from "@/lib/knowledge-map";
import { knowledgeKey, normalizeKnowledgePoint, type KnowledgeGuide, type KnowledgeProfile } from "@/lib/knowledge-types";
import type { PracticeSummary } from "@/lib/practice-types";
import MathText from "./math-text";

type Mistake = {
  id: string; uploadId: string; subject: string; knowledgePoint: string;
  question: string; incorrectAnswer: string; correctAnswer: string; reasoning: string; createdAt: string;
};

const priorityLabel: Record<KnowledgeNode["priority"], string> = {
  high: "优先弄懂", medium: "继续巩固", new: "等待更多证据",
};
const unassigned = "待归类";

export default function KnowledgeMap({ mistakes, papers, initialSubject, initialPoint, trialExpired, aiReady, onTrialExpired, onPractice, onOpenMistake }: {
  mistakes: Mistake[];
  papers: PracticeSummary[];
  initialSubject: string;
  initialPoint: string;
  trialExpired: boolean;
  aiReady: boolean | null;
  onTrialExpired: () => void;
  onPractice: (subject: string, unitName: string, point: string) => void;
  onOpenMistake: (item: Mistake) => void;
}) {
  const router = useRouter();
  const [selectedSubject, setSelectedSubject] = useState(initialSubject || "全部科目");
  const [selectedUnit, setSelectedUnit] = useState("全部单元");
  const [selectedId, setSelectedId] = useState(initialPoint ? knowledgeKey(initialSubject, initialPoint) : "");
  const [profiles, setProfiles] = useState<KnowledgeProfile[]>([]);
  const [unitDrafts, setUnitDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/knowledge").then(async response => {
      if (response.status === 401) { router.push("/login"); return null; }
      const data = await response.json() as { profiles?: KnowledgeProfile[]; error?: string };
      if (!response.ok) throw new Error(data.error || "知识点信息加载失败");
      return data;
    }).then(data => {
      if (!cancelled && data?.profiles) setProfiles(data.profiles);
    }).catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : "知识点信息加载失败"); });
    return () => { cancelled = true; };
  }, [router]);

  const evidence = useMemo<KnowledgeEvidence[]>(() => [
    ...mistakes.map(item => ({
      id: item.id, subject: item.subject, knowledgePoint: item.knowledgePoint,
      sourceId: item.uploadId, source: "mistake" as const, createdAt: item.createdAt,
    })),
    ...papers.flatMap(paper => [
      ...paper.wrongKnowledgePoints.map((point, index) => ({
        id: paper.id + ":wrong:" + index, subject: paper.subject, knowledgePoint: point,
        sourceId: paper.id, source: "practice" as const, createdAt: paper.gradedAt || paper.createdAt,
      })),
      ...(paper.correctKnowledgePoints || []).map((point, index) => ({
        id: paper.id + ":correct:" + index, subject: paper.subject, knowledgePoint: point,
        sourceId: paper.id, source: "practice_correct" as const, createdAt: paper.gradedAt || paper.createdAt,
      })),
    ]),
  ], [mistakes, papers]);
  const nodes = useMemo(() => buildKnowledgeMap(evidence), [evidence]);
  const profilesByKey = new Map(profiles.map(item => [knowledgeKey(item.subject, item.knowledgePoint), item]));
  const suggestedUnits = new Map<string, Set<string>>();
  for (const paper of papers) {
    for (const point of paper.wrongKnowledgePoints) {
      const key = knowledgeKey(paper.subject, point);
      const names = suggestedUnits.get(key) || new Set<string>();
      names.add(paper.unitName);
      suggestedUnits.set(key, names);
    }
  }
  const inferredUnit = (node: KnowledgeNode) => {
    const names = suggestedUnits.get(node.id);
    return names?.size === 1 ? [...names][0] : "";
  };
  const unitFor = (node: KnowledgeNode) => profilesByKey.get(node.id)?.unitName || inferredUnit(node) || unassigned;
  const subjects = [...new Set(nodes.map(node => node.subject))];
  const subjectNodes = nodes.filter(node => selectedSubject === "全部科目" || node.subject === selectedSubject);
  const units = [...new Set(subjectNodes.map(unitFor))].sort((a, b) => a === unassigned ? 1 : b === unassigned ? -1 : a.localeCompare(b, "zh-CN"));
  const visible = subjectNodes.filter(node => selectedUnit === "全部单元" || unitFor(node) === selectedUnit);
  const selected = visible.find(node => node.id === selectedId) || visible[0];
  const selectedProfile = selected ? profilesByKey.get(selected.id) : undefined;
  const unitDraft = selected ? (unitDrafts[selected.id] ?? selectedProfile?.unitName ?? inferredUnit(selected)) : "";
  const selectedUnitName = selected ? unitFor(selected) : "";
  const relatedMistakes = selected ? mistakes.filter(item =>
    item.subject === selected.subject && normalizeKnowledgePoint(item.knowledgePoint) === selected.name
  ).slice(0, 3) : [];
  const focus = subjectNodes.slice(0, 3);

  async function saveUnit() {
    if (!selected) return;
    const target = selected;
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/knowledge", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: target.subject, knowledgePoint: target.name, unitName: unitDraft }),
      });
      if (response.status === 401) { router.push("/login"); return; }
      const data = await response.json() as { profile?: KnowledgeProfile; error?: string };
      if (!response.ok || !data.profile) throw new Error(data.error || "单元归属保存失败");
      setProfiles(current => [...current.filter(item => knowledgeKey(item.subject, item.knowledgePoint) !== target.id), data.profile!]);
      setUnitDrafts(current => { const next = { ...current }; delete next[target.id]; return next; });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "单元归属保存失败"); }
    finally { setSaving(false); }
  }

  async function generateGuide() {
    if (!selected) return;
    const target = selected;
    setGenerating(true); setError("");
    try {
      const response = await fetch("/api/knowledge/guide", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: target.subject, knowledgePoint: target.name }),
      });
      if (response.status === 401) { router.push("/login"); return; }
      const data = await response.json() as { guide?: KnowledgeGuide; error?: string; code?: string };
      if (data.code === "TRIAL_EXPIRED") onTrialExpired();
      if (!response.ok || !data.guide) throw new Error(data.error || "概念提示生成失败");
      setProfiles(current => {
        const old = current.find(item => knowledgeKey(item.subject, item.knowledgePoint) === target.id);
        return [...current.filter(item => knowledgeKey(item.subject, item.knowledgePoint) !== target.id),
          { subject: target.subject, knowledgePoint: target.name, unitName: old?.unitName || "", guide: data.guide! }];
      });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "概念提示生成失败"); }
    finally { setGenerating(false); }
  }

  return <>
    <section className="page-intro"><span className="section-kicker">KNOWLEDGE MAP</span><h1>知识图谱</h1><p>从重复出错的概念出发：先看证据、弄懂方法，再用小测验证。</p></section>
    {error && <div className="practice-error" role="alert">{error}</div>}
    {!nodes.length ? <div className="empty-state"><Network size={42} /><h2>还没有可分析的错题</h2><p>上传并归档错题后，这里会显示需要优先弄懂的知识点。</p></div> : <>
      <div className="knowledge-intro"><Lightbulb size={17} /><span>优先级依据错误次数与作业来源；“练习做对”也只是最近一次练习的记录，不能推算真实掌握率。</span></div>
      <div className="knowledge-subjects" role="group" aria-label="按科目查看知识点">
        {["全部科目", ...subjects].map(item => <button type="button" key={item} className={selectedSubject === item ? "active" : ""} onClick={() => { setSelectedSubject(item); setSelectedUnit("全部单元"); setSelectedId(""); }}>{item}</button>)}
      </div>
      <section className="knowledge-focus"><div className="section-heading"><div><span className="section-kicker">START HERE</span><h2>先弄懂这几个知识点</h2></div></div><div className="knowledge-focus-list">
        {focus.map((node, index) => <button type="button" key={node.id} onClick={() => { setSelectedUnit("全部单元"); setSelectedId(node.id); }}><span>{String(index + 1).padStart(2, "0")}</span><strong>{node.name}</strong><small>{node.subject} · {node.total} 次错误 · {node.sessionCount} 次作业或练习</small><ArrowRight size={16} /></button>)}
      </div></section>
      <div className="knowledge-workspace">
        <section className="knowledge-catalog" aria-label="按单元查看薄弱知识点"><div className="knowledge-catalog-head"><div><span className="section-kicker">UNIT VIEW</span><h2>按单元查找</h2></div><span>{subjectNodes.length} 个知识点</span></div>
          <label className="knowledge-unit-filter">筛选单元<select value={selectedUnit} onChange={event => { setSelectedUnit(event.target.value); setSelectedId(""); }}><option>全部单元</option>{units.map(unit => <option key={unit}>{unit}</option>)}</select></label>
          {units.filter(unit => selectedUnit === "全部单元" || selectedUnit === unit).map(unit => {
            const items = visible.filter(node => unitFor(node) === unit);
            return <div className="knowledge-unit-group" key={unit}><h3>{unit}<span>{items.length} 个知识点</span></h3>
              {items.map(node => <button type="button" key={node.id} className={["knowledge-row", selected?.id === node.id ? "active" : ""].join(" ")} onClick={() => setSelectedId(node.id)}><span className={["knowledge-status-dot", node.priority].join(" ")} /><span className="knowledge-row-main"><strong>{node.name}</strong><small>{node.subject} · {node.sessionCount} 次作业或练习</small></span><span className="knowledge-row-count">{node.total} 次错</span><ArrowRight size={15} /></button>)}
            </div>;
          })}
        </section>
        <aside className="knowledge-detail knowledge-action-detail">
          {selected && <><span className={["knowledge-priority", selected.priority].join(" ")}>{priorityLabel[selected.priority]}</span><h2>{selected.name}</h2><p className="knowledge-detail-subject">{selected.subject} · {selectedUnitName}{!selectedProfile?.unitName && selectedUnitName !== unassigned ? "（根据练习卷推测）" : ""}</p>
            <div className="knowledge-counts"><div><strong>{selected.total}</strong><span>错误记录</span></div><div><strong>{selected.sessionCount}</strong><span>不同作业或练习</span></div><div><strong>{selected.correctCount}</strong><span>练习做对记录</span></div></div>
            <div className="knowledge-unit-editor"><label htmlFor="knowledge-unit-name">确认所属单元</label><div><input id="knowledge-unit-name" list="known-knowledge-units" value={unitDraft} onChange={event => setUnitDrafts(current => ({ ...current, [selected.id]: event.target.value }))} maxLength={80} placeholder="手动填写单元名称" /><datalist id="known-knowledge-units">{units.filter(name => name !== unassigned).map(name => <option value={name} key={name} />)}</datalist><button type="button" onClick={saveUnit} disabled={saving || unitDraft.trim() === (selectedProfile?.unitName || "")}>{saving ? <LoaderCircle size={15} className="spin" /> : <CheckCircle2 size={15} />}保存</button></div><small>归属由你确认；留空可归入“待归类”。</small></div>
            <div className="knowledge-guide"><h3><Lightbulb size={17} />先理解概念</h3>{selectedProfile?.guide ? <><strong>核心概念</strong><p><MathText value={selectedProfile.guide.coreIdea} /></p><strong>可能的误区</strong><p><MathText value={selectedProfile.guide.commonMistake} /></p><strong>先做哪一步</strong><p><MathText value={selectedProfile.guide.firstStep} /></p><small>AI 提示仅供学习参考，请结合课本和老师讲解核对。</small></> : <><p>先回想这个知识点的定义与关键步骤，再核对下方错题。需要帮助时可生成一份简短的概念提示。</p><button type="button" onClick={generateGuide} disabled={generating || trialExpired || aiReady === false}>{generating ? <LoaderCircle size={15} className="spin" /> : <Sparkles size={15} />}{trialExpired ? "体验已到期" : "生成概念提示"}</button></>}</div>
            {relatedMistakes.length > 0 && <div className="knowledge-examples"><h3>相关错题证据</h3>{relatedMistakes.map(item => <button type="button" key={item.id} onClick={() => onOpenMistake(item)}><BookOpen size={16} /><span><MathText value={item.question} /><small>查看原题、答案与解析</small></span><ArrowRight size={14} /></button>)}</div>}
            <button type="button" className="knowledge-practice-cta" onClick={() => onPractice(selected.subject, selectedUnitName === unassigned ? selected.name : selectedUnitName, selected.name)}><Sparkles size={16} />做 3 题概念小测<ArrowRight size={15} /></button>
          </>}
        </aside>
      </div>
    </>}
  </>;
}

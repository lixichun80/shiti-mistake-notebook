"use client";

import { useMemo, useState } from "react";
import { ArrowRight, BookOpen, Lightbulb, Network, Sparkles } from "lucide-react";
import { buildKnowledgeMap, type KnowledgeEvidence, type KnowledgeNode } from "@/lib/knowledge-map";
import type { PracticeSummary } from "@/lib/practice-types";
import MathText from "./math-text";

type Mistake = {
  id: string; uploadId: string; subject: string; knowledgePoint: string;
  question: string; createdAt: string;
};

const positions = [
  { x: 50, y: 13 }, { x: 79, y: 27 }, { x: 79, y: 69 },
  { x: 50, y: 85 }, { x: 21, y: 69 }, { x: 21, y: 27 },
];

const priorityLabel: Record<KnowledgeNode["priority"], string> = {
  high: "优先复习", medium: "持续关注", new: "继续观察",
};

export default function KnowledgeMap({ mistakes, papers, onPractice, onOpenMistake }: {
  mistakes: Mistake[];
  papers: PracticeSummary[];
  onPractice: (subject: string, point: string) => void;
  onOpenMistake: (item: Mistake) => void;
}) {
  const [selectedSubject, setSelectedSubject] = useState("全部科目");
  const [selectedId, setSelectedId] = useState("");
  const evidence = useMemo<KnowledgeEvidence[]>(() => [
    ...mistakes.map(item => ({ id: item.id, subject: item.subject, knowledgePoint: item.knowledgePoint, sourceId: item.uploadId, source: "mistake" as const, createdAt: item.createdAt })),
    ...papers.flatMap(paper => paper.wrongKnowledgePoints.map((point, index) => ({ id: `${paper.id}:${index}`, subject: paper.subject, knowledgePoint: point, sourceId: paper.id, source: "practice" as const, createdAt: paper.gradedAt || paper.createdAt }))),
  ], [mistakes, papers]);
  const nodes = useMemo(() => buildKnowledgeMap(evidence), [evidence]);
  const subjects = useMemo(() => [...new Set(nodes.map(node => node.subject))], [nodes]);
  const visible = useMemo(() => nodes.filter(node => selectedSubject === "全部科目" || node.subject === selectedSubject), [nodes, selectedSubject]);
  const selected = visible.find(node => node.id === selectedId) || visible[0];
  const graphNodes = visible.slice(0, 6);
  const relatedMistakes = selected ? mistakes.filter(item => item.subject === selected.subject && (item.knowledgePoint.trim().replace(/\s+/g, " ") || "待归类知识点") === selected.name).slice(0, 3) : [];
  const graphSubject = selectedSubject === "全部科目" ? "我的知识点" : selectedSubject;

  return <>
    <section className="page-intro"><span className="section-kicker">KNOWLEDGE MAP</span><h1>知识图谱</h1><p>把重复出错的知识点连起来看，先弄懂概念和方法，再安排练习。</p></section>
    {!nodes.length ? <div className="empty-state"><Network size={42} /><h2>还没有可分析的错题</h2><p>上传并归档错题后，这里会显示知识点与重复出错的情况。</p></div> : <>
      <div className="knowledge-intro"><Lightbulb size={17} /><span>圆点越显眼，代表相关错误记录越多。这里只统计已保存的错题和最近一次单元练习中的错题，不能据此计算真实掌握率。</span></div>
      <div className="knowledge-subjects" role="group" aria-label="按科目查看知识图谱">
        {["全部科目", ...subjects].map(item => <button type="button" key={item} className={selectedSubject === item ? "active" : ""} onClick={() => { setSelectedSubject(item); setSelectedId(""); }}>{item}</button>)}
      </div>
      <div className="knowledge-layout">
        <section className="knowledge-graph-card" aria-label="知识点关系图">
          <div className="knowledge-graph-head"><div><span className="section-kicker">WEAK POINTS</span><h2>错题关联图</h2></div><span>{visible.length} 个知识点</span></div>
          <div className="knowledge-stage">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              {graphNodes.map((node, index) => <line key={node.id} x1="50" y1="48" x2={positions[index].x} y2={positions[index].y} />)}
            </svg>
            <div className="knowledge-center"><Network size={21} /><strong>{graphSubject}</strong><small>{visible.reduce((sum, node) => sum + node.total, 0)} 次错误记录</small></div>
            {graphNodes.map((node, index) => <button type="button" key={node.id} className={`knowledge-node ${node.priority} ${selected?.id === node.id ? "selected" : ""}`} style={{ left: `${positions[index].x}%`, top: `${positions[index].y}%` }} onClick={() => setSelectedId(node.id)} aria-pressed={selected?.id === node.id} title={`${node.subject} · ${node.name}，${node.total} 次错误`}><strong>{node.name}</strong><small>{node.total} 次</small></button>)}
          </div>
          {visible.length > 6 && <p className="knowledge-more">图中显示错误记录最多的 6 个知识点；下方列表可查看全部。</p>}
        </section>
        <aside className="knowledge-detail">
          {selected && <><span className={`knowledge-priority ${selected.priority}`}>{priorityLabel[selected.priority]}</span><h2>{selected.name}</h2><p className="knowledge-detail-subject">{selected.subject} · 来自 {selected.sessionCount} 次作业或练习</p>
            <div className="knowledge-counts"><div><strong>{selected.total}</strong><span>错误记录</span></div><div><strong>{selected.mistakeCount}</strong><span>归档错题</span></div><div><strong>{selected.practiceCount}</strong><span>单元练习</span></div></div>
            <div className="knowledge-advice"><Lightbulb size={18} /><p>{selected.priority === "high" ? "这个知识点跨多次作业或练习重复出错。建议先复述概念、梳理基本步骤，再针对性练习。" : "先检查概念、公式或解题步骤是否理解，再用少量练习验证。"}</p></div>
            {relatedMistakes.length > 0 && <div className="knowledge-examples"><h3>相关错题</h3>{relatedMistakes.map(item => <button type="button" key={item.id} onClick={() => onOpenMistake(item)}><BookOpen size={15} /><span><MathText value={item.question} /></span><ArrowRight size={14} /></button>)}</div>}
            <button type="button" className="knowledge-practice-cta" onClick={() => onPractice(selected.subject, selected.name)}><Sparkles size={16} />围绕这个知识点出卷 <ArrowRight size={15} /></button>
          </>}
        </aside>
      </div>
      <section className="knowledge-all"><div className="section-heading"><div><span className="section-kicker">ALL TOPICS</span><h2>全部知识点</h2></div></div><div className="knowledge-list">{visible.map(node => <button type="button" key={node.id} className={selected?.id === node.id ? "active" : ""} onClick={() => setSelectedId(node.id)}><span className={`knowledge-list-dot ${node.priority}`} /><span className="knowledge-list-name">{node.name}<small>{node.subject} · {node.sessionCount} 次作业或练习</small></span><span className="knowledge-list-count">{node.total} 次</span><ArrowRight size={15} /></button>)}</div></section>
    </>}
  </>;
}

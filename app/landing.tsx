import { ArrowRight, BookOpen, Camera, CheckCircle2, Lightbulb, ShieldCheck, Sparkles } from "lucide-react";

export default function Landing() {
  return <div className="landing-page">
    <header className="landing-header">
      <a className="landing-brand" href="/" aria-label="拾题首页"><span className="landing-brand-mark"><BookOpen size={23} /></span><strong>拾题</strong><small>智能错题本</small></a>
      <nav aria-label="首页导航"><a href="#how-it-works">使用方法</a><a href="#features">功能介绍</a><a className="landing-login" href="/login">登录</a><a className="landing-nav-cta" href="/register">免费体验 <ArrowRight size={15} /></a></nav>
    </header>

    <main>
      <section className="landing-hero">
        <div className="landing-hero-copy">
          <span className="landing-offer"><Sparkles size={15} />新用户免费体验一周</span>
          <h1>把作业拍下来，<br /><em>让每道错题都有解。</em></h1>
          <p>已批改的试卷，帮你找出错题；还没批改的作业，先逐题判定，再整理答案、思路与知识点。</p>
          <div className="landing-hero-actions"><a className="landing-primary" href="/register">注册并开始 7 天体验 <ArrowRight size={18} /></a><a className="landing-secondary" href="/login">已有账号，去登录</a></div>
          <div className="landing-trust"><span><CheckCircle2 size={15} />注册后即可开始</span><span><ShieldCheck size={15} />错题仅自己可见</span></div>
        </div>
        <div className="landing-demo" aria-label="智能批改结果示意">
          <div className="landing-demo-top"><span><BookOpen size={17} />拾题 · 批改示例</span><span className="landing-demo-pill">分析完成</span></div>
          <div className="landing-demo-paper"><span className="landing-demo-label">数学 · 第 1 题</span><strong>解方程：2x + 6 = 14</strong><div><span>我的答案</span><b>x = 3</b><span className="landing-demo-wrong">需要订正</span></div><div><span>正确答案</span><b>x = 4</b><span className="landing-demo-right"><CheckCircle2 size={15} /></span></div></div>
          <div className="landing-demo-note"><Lightbulb size={17} /><span>先移项得到 2x = 8，再将两边同时除以 2。</span></div>
          <span className="landing-demo-caption">示意内容，实际结果以清晰图片和题目为准</span>
        </div>
      </section>

      <section className="landing-section" id="features"><div className="landing-section-head"><span>WHY SHITI</span><h2>从批改到巩固，一步步理清思路</h2></div><div className="landing-feature-grid">
        <article><span className="landing-feature-icon purple"><Camera size={22} /></span><h3>拍照就能开始</h3><p>上传试卷、作业或答题卷。一次最多 4 张图片，题目与作答放在一起更容易核对。</p></article>
        <article><span className="landing-feature-icon peach"><CheckCircle2 size={22} /></span><h3>逐题批改分析</h3><p>结合已有批改或智能判题，展示对错、正确答案和分步思路。不清楚的题留待核对。</p></article>
        <article><span className="landing-feature-icon mint"><BookOpen size={22} /></span><h3>错题归档练习</h3><p>错题按科目与时间整理进个人错题本，还能围绕同一知识点生成举一反三练习。</p></article>
      </div></section>

      <section className="landing-steps" id="how-it-works"><div><span>01 / 上传</span><strong>拍清题目与作答</strong></div><div><span>02 / 批改</span><strong>查看逐题结果与解析</strong></div><div><span>03 / 巩固</span><strong>收藏错题并继续练习</strong></div></section>

      <section className="landing-bottom"><div><span>给每一次认真作答一个好去处</span><h2>新用户免费体验 7 天</h2><p>体验到期后仍可查看已有错题；继续分析和生成练习，可联系管理员开通。</p></div><a href="/register">立即创建账号 <ArrowRight size={18} /></a></section>
    </main>
    <footer className="landing-footer"><span>拾题 · 把每一次错误，变成进步</span><span>智能批改供学习参考，请核对重要答案。</span></footer>
  </div>;
}

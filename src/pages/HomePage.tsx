import { lazy, Suspense, useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, useInView } from 'framer-motion';
import { Stethoscope, Calculator, MessageCircle, ArrowRight, Shield, BookOpen, Sparkles, TrendingUp, Layers, Cpu, Activity } from 'lucide-react';
import { PAGE_MAXW, widePx } from '../utils/layout';
// 3D 场景约 500KB（three.js），懒加载避免拖慢首页首屏
const LandfillScene3D = lazy(() => import('../components/LandfillScene3D'));

// 入口动画 stagger
const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08 } },
};
const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] as any } },
};

// 数字滚动动画（intersection 触发）
function CountUp({ value, suffix = '', duration = 1.4 }: { value: number; suffix?: string; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '-30px' });
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    if (!inView) return;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / (duration * 1000));
      // ease-out cubic
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round(value * eased));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [inView, value, duration]);
  return <span ref={ref}>{display}{suffix}</span>;
}

// 迷你 sparkline（纯 SVG）
function Sparkline({ data, color, fill }: { data: number[]; color: string; fill: string }) {
  const w = 120, h = 36;
  const max = Math.max(...data), min = Math.min(...data);
  const range = max - min || 1;
  const step = w / (data.length - 1);
  const points = data.map((v, i) => `${i * step},${h - ((v - min) / range) * (h - 4) - 2}`).join(' ');
  const area = `0,${h} ${points} ${w},${h}`;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible">
      <defs>
        <linearGradient id={`grad-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={fill} stopOpacity="0.45" />
          <stop offset="100%" stopColor={fill} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#grad-${color.replace('#', '')})`} />
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

interface FeatureCardProps {
  icon: React.ReactNode;
  title: string;
  desc: string;
  badge?: string;
  gradient: string;
  glowColor: string;
  onClick: () => void;
}

function FeatureCard({ icon, title, desc, badge, gradient, glowColor, onClick }: FeatureCardProps) {
  return (
    <motion.button
      variants={itemVariants}
      onClick={onClick}
      className="group relative w-full text-left rounded-2xl p-5 3xl:p-6 border overflow-hidden transition-all duration-300"
      style={{
        backgroundColor: 'var(--bg-surface)',
        borderColor: 'var(--border)',
      }}
      whileHover={{
        y: -4,
        borderColor: glowColor,
        boxShadow: `0 12px 40px ${glowColor}33, 0 4px 12px rgba(0,0,0,0.08)`,
      }}
    >
      {/* 悬浮时的光晕背景 */}
      <div
        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
        style={{ background: `radial-gradient(120% 80% at 0% 0%, ${glowColor}1a 0%, transparent 60%)` }}
      />
      {/* 图标区：渐变背景 + 悬浮放大 */}
      <div
        className="relative w-11 h-11 3xl:w-12 3xl:h-12 rounded-xl flex items-center justify-center mb-3 transition-transform duration-300 group-hover:scale-110 group-hover:rotate-3"
        style={{
          background: gradient,
          boxShadow: `0 6px 20px ${glowColor}55`,
        }}
      >
        <span style={{ color: '#ffffff' }}>{icon}</span>
      </div>
      {/* 标题行 */}
      <div className="relative flex items-center gap-2 mb-1.5">
        <h3 className="text-[15px] 3xl:text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h3>
        {badge && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold tracking-wide"
                style={{ background: gradient, color: '#fff' }}>
            {badge}
          </span>
        )}
      </div>
      <p className="relative text-xs 3xl:text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{desc}</p>
      {/* 悬浮箭头 */}
      <div className="absolute top-5 right-5 opacity-40 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all duration-200"
           style={{ color: glowColor }}>
        <ArrowRight size={14} />
      </div>
    </motion.button>
  );
}

interface StatCardProps {
  label: string;
  value: string;
  unit?: string;
  trend?: 'up' | 'down' | 'stable';
  color: string;
  sparkline?: number[];
  icon?: React.ReactNode;
}

function StatCard({ label, value, unit, color, sparkline, icon }: StatCardProps) {
  return (
    <motion.div variants={itemVariants}
      className="relative rounded-2xl p-4 border overflow-hidden group transition-all duration-300 hover:-translate-y-0.5"
      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border)' }}
    >
      {/* 顶部色条 + glow */}
      <div className="absolute top-0 left-0 right-0 h-0.5" style={{ background: `linear-gradient(90deg, ${color}, ${color}33)` }} />
      <div className="absolute -top-12 -right-12 w-24 h-24 rounded-full opacity-10 blur-2xl group-hover:opacity-20 transition-opacity"
           style={{ background: color }} />
      <div className="flex items-start justify-between mb-2">
        <p className="text-[11px] font-medium tracking-wide uppercase" style={{ color: 'var(--text-muted)' }}>{label}</p>
        {icon && (
          <div className="w-6 h-6 rounded-md flex items-center justify-center"
               style={{ backgroundColor: `${color}1a`, color }}>
            {icon}
          </div>
        )}
      </div>
      <div className="flex items-end justify-between gap-2">
        <div className="flex items-end gap-1">
          <span className="text-[26px] font-bold leading-none mono" style={{ color }}>{value}</span>
          {unit && <span className="text-[11px] mb-1" style={{ color: 'var(--text-muted)' }}>{unit}</span>}
        </div>
        {sparkline && (
          <div className="opacity-70 group-hover:opacity-100 transition-opacity">
            <Sparkline data={sparkline} color={color} fill={color} />
          </div>
        )}
      </div>
    </motion.div>
  );
}

export default function HomePage() {
  const navigate = useNavigate();

  // 一键带入对话：写 sessionStorage，ChatPage 挂载后自动发送
  const startChatWith = (question: string) => {
    sessionStorage.setItem('chat-prefill', question);
    navigate('/chat/new');
  };

  return (
    <div className="flex-1 overflow-y-auto app-bg">
      {/* ===== Hero Section ===== */}
      <section
        className="relative min-h-[600px] flex items-center overflow-hidden hero-gradient noise-bg"
      >
        {/* 浮动光斑：增加纵深 */}
        <div className="hero-blob" style={{ width: 460, height: 460, background: 'rgba(124,58,237,0.55)', top: -160, right: -100 }} />
        <div className="hero-blob" style={{ width: 380, height: 380, background: 'rgba(14,165,183,0.55)', bottom: -140, left: -70, animationDelay: '2.5s' }} />
        <div className="hero-blob" style={{ width: 280, height: 280, background: 'rgba(94,234,212,0.40)', top: '40%', right: '30%', animationDelay: '4s' }} />
        {/* 网格点阵背景（白色弱化） */}
        <div className="absolute inset-0 opacity-[0.08]" style={{ backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.6) 1px, transparent 1px)', backgroundSize: '24px 24px' }} />
        {/* 顶部高光带 */}
        <div className="absolute top-0 inset-x-0 h-px shimmer-line" />
        {/* 底部柔化过渡到浅色页面 */}
        <div className="absolute inset-x-0 bottom-0 h-40" style={{ background: 'linear-gradient(to top, var(--bg-base), transparent)' }} />

        <div className={`relative z-10 ${PAGE_MAXW} px-6 3xl:px-8 py-16 3xl:py-20 w-full grid lg:grid-cols-[1.4fr_1fr] gap-10 items-center`}>
          <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="visible"
          >
            {/* 实时状态徽章 */}
            <motion.div variants={itemVariants}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-5 text-[11px] font-semibold backdrop-blur-md"
              style={{
                backgroundColor: 'rgba(255,255,255,0.12)',
                border: '1px solid rgba(255,255,255,0.25)',
                color: '#ffffff',
              }}
            >
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ backgroundColor: '#5eead4' }}></span>
                <span className="relative inline-flex rounded-full h-2 w-2" style={{ backgroundColor: '#5eead4' }}></span>
              </span>
              <Sparkles size={11} />
              LandfillMind · 智能体 v4.4
            </motion.div>

            {/* 主标题（渐变文字 + 强对比） */}
            <motion.h1 variants={itemVariants} className="mb-3 leading-[1.05]">
              <span className="block text-5xl md:text-6xl 3xl:text-7xl font-extrabold tracking-tight gradient-text" style={{ filter: 'drop-shadow(0 4px 24px rgba(0,0,0,0.18))' }}>
                LandfillMind
              </span>
              <span
                className="block text-lg md:text-xl font-normal mt-3"
                style={{ color: 'rgba(255,255,255,0.92)' }}
              >
                守护填埋场安全的最后一公里
              </span>
            </motion.h1>

            {/* 副标题 */}
            <motion.p variants={itemVariants}
              className="text-sm 3xl:text-base leading-relaxed mb-7 max-w-xl 3xl:max-w-2xl"
              style={{ color: 'rgba(255,255,255,0.82)' }}
            >
              基于多智能体协同推理的填埋场/地下水污染场地 AI 诊断系统。
              输入监测数据，输出风险等级、规范依据与处置建议——
              让工程判断更高效，让安全底线更可靠。
            </motion.p>

            {/* CTA 按钮组 */}
            <motion.div variants={itemVariants} className="flex flex-wrap gap-3">
              <motion.button
                onClick={() => navigate('/diagnose')}
                className="btn-gradient inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold text-white transition-all duration-200"
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
              >
                <Stethoscope size={15} />
                开始 AI 快诊
                <ArrowRight size={14} />
              </motion.button>
              <motion.button
                onClick={() => navigate('/chat/new')}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-medium border transition-all duration-200 backdrop-blur-sm"
                style={{ borderColor: 'rgba(255,255,255,0.4)', color: '#ffffff', backgroundColor: 'rgba(255,255,255,0.10)' }}
                whileHover={{ backgroundColor: 'rgba(255,255,255,0.20)', borderColor: 'rgba(255,255,255,0.6)' }}
                whileTap={{ scale: 0.97 }}
              >
                <MessageCircle size={15} />
                专家问答
              </motion.button>
              <motion.button
                onClick={() => navigate('/design')}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-medium border transition-all duration-200 backdrop-blur-sm"
                style={{ borderColor: 'rgba(255,255,255,0.4)', color: '#ffffff', backgroundColor: 'rgba(255,255,255,0.10)' }}
                whileHover={{ backgroundColor: 'rgba(255,255,255,0.20)', borderColor: 'rgba(255,255,255,0.6)' }}
                whileTap={{ scale: 0.97 }}
              >
                <Calculator size={15} />
                计算中心
              </motion.button>
            </motion.div>

            {/* 信任徽章行（数据+品牌背书） */}
            <motion.div variants={itemVariants} className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px]" style={{ color: 'rgba(255,255,255,0.75)' }}>
              <span className="inline-flex items-center gap-1.5"><Shield size={11} style={{ color: '#5eead4' }}/> 30+ 国家行业规范</span>
              <span className="opacity-30">|</span>
              <span className="inline-flex items-center gap-1.5"><Cpu size={11} style={{ color: '#5eead4' }}/> 双引擎 · 工程内核 × LLM</span>
              <span className="opacity-30">|</span>
              <span className="inline-flex items-center gap-1.5"><Layers size={11} style={{ color: '#5eead4' }}/> 5 维风险评估</span>
            </motion.div>
          </motion.div>

          {/* 右侧浮动玻璃态"实时态势卡" */}
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.4, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="hidden lg:block"
          >
            <div
              className="relative rounded-2xl p-5 backdrop-blur-xl"
              style={{
                background: 'linear-gradient(135deg, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0.06) 100%)',
                border: '1px solid rgba(255,255,255,0.22)',
                boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
              }}
            >
              {/* 卡片顶部：实时指示 */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Activity size={14} style={{ color: '#5eead4' }} />
                  <span className="text-[12px] font-semibold text-white">实时态势</span>
                </div>
                <span className="text-[10px] font-mono" style={{ color: 'rgba(255,255,255,0.55)' }}>
                  LF-01 · LIVE
                </span>
              </div>

              {/* 大数字 */}
              <div className="mb-4">
                <p className="text-[10px] uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.55)' }}>综合风险等级</p>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="text-3xl font-extrabold text-white">低</span>
                  <span className="text-[11px] px-2 py-0.5 rounded-full font-bold" style={{ backgroundColor: 'rgba(94,234,212,0.25)', color: '#5eead4' }}>
                    正常监测
                  </span>
                </div>
              </div>

              {/* 迷你指标 */}
              <div className="space-y-2.5">
                {[
                  { l: '边坡稳定系数 Fs', v: '1.35', c: '#5eead4' },
                  { l: '渗滤液液位', v: '0.8 m', c: '#38bdf8' },
                  { l: 'CH₄ 浓度', v: '3.2 %', c: '#fbbf24' },
                ].map((m) => (
                  <div key={m.l} className="flex items-center justify-between">
                    <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.7)' }}>{m.l}</span>
                    <span className="text-[13px] font-mono font-bold" style={{ color: m.c }}>{m.v}</span>
                  </div>
                ))}
              </div>

              {/* 装饰条 */}
              <div className="mt-4 h-1 rounded-full overflow-hidden" style={{ backgroundColor: 'rgba(255,255,255,0.10)' }}>
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: '78%' }}
                  transition={{ delay: 0.8, duration: 1.4, ease: 'easeOut' }}
                  className="h-full rounded-full"
                  style={{ background: 'linear-gradient(90deg, #5eead4, #38bdf8, #a78bfa)' }}
                />
              </div>
              <p className="text-[10px] mt-1.5" style={{ color: 'rgba(255,255,255,0.55)' }}>系统健康度 · 78/100</p>
            </div>
          </motion.div>
        </div>

      </section>

      {/* ===== 核心数据指标 ===== */}
      <section className={`${PAGE_MAXW} px-6 3xl:px-8 pt-10 pb-8 -mt-12 relative z-20`}>
        <motion.div
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-50px' }}
        >
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <StatCard label="边坡 Fs" value="1.35" color="#10b981"
              sparkline={[1.2, 1.25, 1.28, 1.30, 1.33, 1.32, 1.35]} icon={<TrendingUp size={12} />} />
            <StatCard label="渗滤液液位" value="0.8" unit="m" color="#3b82f6"
              sparkline={[0.6, 0.7, 0.75, 0.78, 0.8, 0.82, 0.8]} icon={<Activity size={12} />} />
            <StatCard label="CH₄ 浓度" value="3.2" unit="%" color="#f59e0b"
              sparkline={[2.8, 3.0, 3.1, 3.3, 3.4, 3.2, 3.2]} icon={<Activity size={12} />} />
            <StatCard label="地下水位" value="12.5" unit="m" color="#06b6d4"
              sparkline={[12.0, 12.2, 12.3, 12.4, 12.6, 12.5, 12.5]} icon={<Activity size={12} />} />
            <StatCard label="综合风险" value="低" color="#10b981"
              sparkline={[3, 2, 2, 1, 1, 1, 1]} icon={<Shield size={12} />} />
          </div>
        </motion.div>
      </section>

      {/* ===== 大数字 Trust Bar ===== */}
      <section className={`${PAGE_MAXW} px-6 3xl:px-8 pb-10`}>
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-50px' }}
          variants={containerVariants}
          className="rounded-2xl border overflow-hidden"
          style={{
            borderColor: 'var(--border)',
            background: 'linear-gradient(135deg, var(--bg-surface) 0%, var(--bg-elevated) 100%)',
            boxShadow: '0 4px 20px rgba(0,0,0,0.04)',
          }}
        >
          <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-y md:divide-y-0" style={{ borderColor: 'var(--border)' }}>
            {[
              { v: 76, suffix: '+', l: '规范知识条目', s: '30+ 国家行业标准', c: '#0ea5b7' },
              { v: 12, suffix: '', l: '工程计算器', s: 'Fs / HELP / LandGEM / 沉降…', c: '#2563eb' },
              { v: 5, suffix: ' 维', l: '风险评估维度', s: '边坡·渗滤液·填埋气·地下水·综合', c: '#7c3aed' },
              { v: 9, suffix: ' 个', l: '智能体工具', s: 'OGS · 3D · 计算 · 诊断 · 报告', c: '#ea580c' },
            ].map((m, i) => (
              <motion.div key={i} variants={itemVariants} className="p-5 md:p-6 text-center relative group">
                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
                     style={{ background: `radial-gradient(80% 60% at 50% 0%, ${m.c}10 0%, transparent 60%)` }} />
                <div className="relative text-3xl md:text-4xl font-extrabold mono leading-none mb-2" style={{ color: m.c }}>
                  <CountUp value={m.v} suffix={m.suffix} />
                </div>
                <div className="relative text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>{m.l}</div>
                <div className="relative text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>{m.s}</div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </section>

      {/* ===== 三维场地模型 ===== */}
      <section className={`${PAGE_MAXW} px-6 3xl:px-8 pb-12`}>
        <div className="flex items-end justify-between flex-wrap gap-3 mb-5">
          <div>
            <h2 className="text-lg font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
              三维场地模型
            </h2>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              山谷型生活垃圾卫生填埋场全要素三维示意：地形、堆体、防渗、渗滤液、填埋气、截洪沟与生产辅助设施
            </p>
          </div>
          <span
            className="text-[10px] px-2.5 py-1 rounded-full font-medium"
            style={{ backgroundColor: 'var(--primary-glow)', color: 'var(--primary)' }}
          >
            交互式 · 可剖切 · 可透视
          </span>
        </div>
        <div
          className="rounded-2xl border overflow-hidden relative"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-surface)', boxShadow: '0 12px 40px rgba(8,47,73,0.08)' }}
        >
          <Suspense fallback={
            <div className="flex items-center justify-center" style={{ backgroundColor: 'var(--bg-base)', height: widePx(560, 740) }}>
              <div className="text-center">
                <div className="w-8 h-8 border-[3px] rounded-full mx-auto mb-2 animate-spin"
                     style={{ borderColor: 'var(--border)', borderTopColor: 'var(--primary)' }} />
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>三维场景加载中…</p>
              </div>
            </div>
          }>
            <LandfillScene3D height={widePx(560, 740)} />
          </Suspense>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {['防渗衬层', '渗滤液导排', '填埋气火炬', '环场截洪沟', '垃圾坝', '监测井'].map((t) => (
            <span
              key={t}
              className="text-[10px] px-2 py-1 rounded-full"
              style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
            >
              {t}
            </span>
          ))}
          <span className="text-[10px] ml-auto" style={{ color: 'var(--text-muted)' }}>
            提示：左侧面板可切换图层、开启剖切/透视，悬停构件查看说明，点击防渗层 / 覆盖查看结构详图
          </span>
        </div>
      </section>

      {/* ===== 功能入口 ===== */}
      <section className={`${PAGE_MAXW} px-6 3xl:px-8 pb-10`}>
        <motion.div
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-50px' }}
        >
          <motion.div variants={itemVariants} className="mb-5">
            <h2 className="text-lg font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
              核心功能
            </h2>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              三大模块协同，覆盖填埋场诊断、设计与咨询全流程
            </p>
          </motion.div>

          <motion.div variants={containerVariants} className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <FeatureCard
              icon={<Stethoscope size={20} />}
              title="AI 快诊"
              desc="输入场地监测数据，双引擎智能识别边坡/渗滤液/填埋气/地下水隐患，输出红橙黄蓝四级风险报告。"
              badge="核心"
              gradient="linear-gradient(135deg, #0ea5b7 0%, #06b6d4 50%, #22d3ee 100%)"
              glowColor="#0ea5b7"
              onClick={() => navigate('/diagnose')}
            />
            <FeatureCard
              icon={<Calculator size={20} />}
              title="计算中心"
              desc="12 项专业工程计算器：Fs 稳定系数、渗滤液产量 HELP、LandGEM 产气量、沉降预测、库容年限……带规范引用。"
              gradient="linear-gradient(135deg, #2563eb 0%, #3b82f6 50%, #60a5fa 100%)"
              glowColor="#3b82f6"
              onClick={() => navigate('/design')}
            />
            <FeatureCard
              icon={<MessageCircle size={20} />}
              title="专家问答"
              desc="基于 50 条规范 KB 的智能对话，知识库检索增强 + 工程计算内核全程可视化，引用规范带版本年号。"
              gradient="linear-gradient(135deg, #7c3aed 0%, #a78bfa 50%, #c4b5fd 100%)"
              glowColor="#a78bfa"
              onClick={() => navigate('/chat/new')}
            />
          </motion.div>
        </motion.div>
      </section>

      {/* ===== 规范依据 ===== */}
      <section
        className="border-t"
        style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-surface)' }}
      >
        <div className={`${PAGE_MAXW} px-6 3xl:px-8 py-8`}>
          <div className="flex items-center gap-2 mb-5">
            <BookOpen size={16} style={{ color: 'var(--primary)' }} />
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              规范依据
            </h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              'GB 16889-2008', 'CJJ 176-2012', 'HJ 25.1~25.6', 'GB 36600-2018',
              'GB/T 14848-2017', 'HJ 1106-2020', 'GB 55038-2025', 'AQ 4202-2008',
            ].map(std => (
              <span
                key={std}
                className="px-3 py-1.5 rounded-full text-xs font-mono border transition-colors duration-150"
                style={{
                  borderColor: 'var(--border)',
                  color: 'var(--text-secondary)',
                  backgroundColor: 'var(--bg-elevated)',
                }}
              >
                {std}
              </span>
            ))}
          </div>
          <p className="text-xs mt-4" style={{ color: 'var(--text-muted)' }}>
            共覆盖 30+ 本国家/行业标准，每条 KB 带规范编号、版本年号、条款摘要
          </p>
        </div>
      </section>

      {/* ===== 页脚 ===== */}
      <footer className="border-t text-center py-5" style={{ borderColor: 'var(--border)' }}>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          LandfillMind · 填埋场全周期智能体 v4.4
        </p>
      </footer>
    </div>
  );
}

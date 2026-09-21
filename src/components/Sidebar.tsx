import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Settings, Stethoscope, Calculator, MessageCircle, BrainCircuit, X, Boxes, Shield, FlaskConical } from 'lucide-react';
import logoImg from '../assets/logo/landfillmind-logo.png';
import type { Agent, Session } from '../types';

interface SidebarProps { sessions: Session[]; currentSessionId: string | null; isSettingsPage: boolean; isDiagnosePage: boolean; isDesignPage: boolean; isMultiAgentPage: boolean; isOgsSimPage: boolean; sidebarOpen: boolean; agents: Agent[]; getAgent: (id: string) => Agent | undefined; onNewChat: () => void; onSelectSession: (sessionId: string) => void; onDeleteSession: (sessionId: string) => void; onOpenSettings: () => void; onOpenDiagnose: () => void; onOpenDesign: () => void; onOpenMultiAgent: () => void; onOpenOgsSim: () => void; onOpenTool: () => void; onOpenAdmin: () => void; }
interface NavItemProps { icon: React.ReactNode; label: string; active: boolean; onClick: () => void; badge?: string; }

function NavItem({ icon, label, active, onClick, badge }: NavItemProps) {
  return (
    <button onClick={onClick} title={label} className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all duration-200 group relative" style={{ backgroundColor: active ? 'rgba(0,240,255,0.08)' : 'transparent', color: active ? 'var(--primary)' : 'var(--text-secondary)', boxShadow: active ? '0 0 12px rgba(0,240,255,0.08)' : 'none' }} onMouseEnter={e => { if (!active) { e.currentTarget.style.backgroundColor = 'rgba(0,240,255,0.04)'; e.currentTarget.style.color = 'var(--primary)'; } }} onMouseLeave={e => { if (!active) { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)'; } }}>
      {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-full" style={{ backgroundColor: 'var(--primary)', boxShadow: '0 0 8px var(--primary)' }} />}
      <span className="shrink-0 transition-transform duration-200 group-hover:scale-110">{icon}</span>
      <span className="flex-1 text-left font-medium truncate">{label}</span>
      {badge && <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: 'rgba(0,240,255,0.06)', color: 'var(--primary)', border: '1px solid rgba(0,240,255,0.15)' }}>{badge}</span>}
    </button>
  );
}

function SessionItem({ session, isActive, onSelect, onDelete }: { session: Session; isActive: boolean; onSelect: () => void; onDelete: () => void; }) {
  const [hover, setHover] = useState(false);
  return (
    <div className="group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-all duration-200" style={{ backgroundColor: isActive ? 'rgba(0,240,255,0.08)' : hover ? 'rgba(0,240,255,0.03)' : 'transparent', borderLeft: isActive ? '2px solid var(--primary)' : '2px solid transparent', boxShadow: isActive ? '0 0 8px rgba(0,240,255,0.06)' : 'none' }} onClick={onSelect} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <span className="w-1.5 h-1.5 rounded-full shrink-0 transition-all duration-200" style={{ backgroundColor: isActive ? 'var(--primary)' : 'var(--text-muted)', boxShadow: isActive ? '0 0 6px var(--primary)' : 'none' }} />
      <span className="flex-1 text-xs truncate" style={{ color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{session.title}</span>
      {hover && <button onClick={e => { e.stopPropagation(); onDelete(); }} className="p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: 'var(--text-muted)' }} onMouseEnter={e => (e.currentTarget.style.color = '#ff2d7b')} onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}><X size={12} /></button>}
    </div>
  );
}

export function Sidebar({ sessions, currentSessionId, isSettingsPage, isDiagnosePage, isDesignPage, isMultiAgentPage, isOgsSimPage, sidebarOpen, agents, onNewChat, onSelectSession, onDeleteSession, onOpenSettings, onOpenDiagnose, onOpenDesign, onOpenMultiAgent, onOpenOgsSim, onOpenTool, onOpenAdmin }: SidebarProps) {
  const [chatHover, setChatHover] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  if (!sidebarOpen) return null;

  return (
    <aside className="flex flex-col flex-shrink-0 overflow-hidden relative" style={{ width: 'var(--sidebar-width)', backgroundColor: 'rgba(13,21,37,0.9)', backdropFilter: 'blur(16px)', borderRight: '1px solid var(--border)' }}>
      <div className="absolute top-0 right-0 w-[1px] h-full overflow-hidden pointer-events-none"><div className="absolute inset-x-0 h-1/4" style={{ background: 'linear-gradient(180deg, transparent, rgba(0,240,255,0.15), transparent)', animation: 'scan-sweep 4s ease-in-out infinite' }} /></div>
      <button onClick={() => navigate('/')} className="flex items-center gap-2.5 px-4 shrink-0 cursor-pointer transition-opacity duration-200 hover:opacity-80" style={{ height: 'var(--header-height)', borderBottom: '1px solid var(--border)', background: 'transparent', border: 'none', width: '100%', textAlign: 'left' }}>
        <img src={logoImg} alt="LandfillMind" className="w-8 h-8 shrink-0 rounded-md object-contain" style={{ filter: 'drop-shadow(0 0 6px rgba(99,154,78,0.3))' }} />
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-semibold leading-tight truncate" style={{ color: 'var(--text-primary)' }}>LandfillMind</span>
          <span className="text-[10px] leading-tight font-mono" style={{ color: 'var(--primary)', opacity: 0.6 }}>Engineering Agent v5.0</span>
        </div>
      </button>
      <div className="px-2 pt-3 pb-2 shrink-0">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] px-3 mb-2" style={{ color: 'var(--text-muted)' }}>功能</p>
        <nav className="space-y-0.5">
          {/* v5：智能体对话是唯一前端入口（工具全部可对话调用） */}
          <NavItem icon={<MessageCircle size={15} />} label="智能体对话" active={false} onClick={onNewChat} />
          <NavItem icon={<BrainCircuit size={15} />} label="多智能体" active={isMultiAgentPage} onClick={onOpenMultiAgent} />
          <NavItem icon={<Stethoscope size={15} />} label="AI 快诊" active={isDiagnosePage} onClick={onOpenDiagnose} />
          {/* v5.3：原「3D 模拟（真实模型）」与「3D 建模工具」两个入口合并为一行
              —— 它们渲染的是同一份会话几何（model.obj），是重复入口而非互补功能。
              合并后的页面同时是查看器与建模分析工作台，与桌面工具同名。 */}
          <NavItem icon={<Boxes size={15} />} label="三维建模分析" active={false} onClick={onOpenTool} />
          <NavItem icon={<FlaskConical size={15} />} label="稳定化计算" active={isOgsSimPage} onClick={onOpenOgsSim} />
          {/* v5：计算中心降级为附属工具库（主链路走对话内 calculate 工具） */}
          <NavItem icon={<Calculator size={15} />} label="计算工具库" active={isDesignPage} onClick={onOpenDesign} />
        </nav>
      </div>
      <div className="mx-3 h-[1px] relative overflow-hidden" style={{ background: 'rgba(0,240,255,0.1)' }}><div className="absolute inset-y-0 w-1/2 animate-scan-sweep" style={{ background: 'linear-gradient(90deg, transparent, rgba(0,240,255,0.3), transparent)' }} /></div>
      <div className="px-2 pt-2 pb-1 shrink-0">
        <button onClick={onNewChat} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200" style={{ color: 'var(--primary)', backgroundColor: chatHover ? 'rgba(0,240,255,0.08)' : 'transparent', border: chatHover ? '1px solid rgba(0,240,255,0.2)' : '1px solid transparent' }} onMouseEnter={() => setChatHover(true)} onMouseLeave={() => setChatHover(false)}><Plus size={15} /><span>新建会话</span></button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pt-1 pb-2" ref={scrollRef}>
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] px-3 mb-2" style={{ color: 'var(--text-muted)' }}>历史会话</p>
        {sessions.length === 0 ? <p className="text-xs text-center py-4" style={{ color: 'var(--text-muted)' }}>暂无会话记录</p> : <div className="space-y-0.5">{sessions.map(s => <SessionItem key={s.id} session={s} isActive={s.id === currentSessionId} onSelect={() => onSelectSession(s.id)} onDelete={() => onDeleteSession(s.id)} />)}</div>}
      </div>
      <div className="px-2 pb-3 pt-1 shrink-0 flex flex-col gap-1" style={{ borderTop: '1px solid rgba(0,240,255,0.08)' }}>
        <NavItem icon={<Settings size={15} />} label="设置" active={isSettingsPage} onClick={onOpenSettings} />
        <NavItem
          icon={<Shield size={15} />}
          label="管理员后台"
          active={false}
          onClick={onOpenAdmin}
        />
      </div>
    </aside>
  );
}

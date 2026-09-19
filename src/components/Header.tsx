import { Moon, Sun, Menu, ChevronDown, Bot, Zap } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Agent, ModelOption } from '../types';
import type { Theme } from '../hooks/useTheme';
import type { Session } from '../types';
import logoImg from '../assets/logo/landfillmind-logo.png';

interface HeaderProps {
  isSettingsPage: boolean; sidebarOpen: boolean; theme: Theme;
  currentSession: Session | null; currentAgent?: Agent;
  models: ModelOption[]; selectedModel: string;
  onModelChange: (id: string) => void; onToggleSidebar: () => void; onToggleTheme: () => void;
}

export function Header({ sidebarOpen, theme, currentSession, currentAgent, models, selectedModel, onModelChange, onToggleSidebar, onToggleTheme }: HeaderProps) {
  const [modelOpen, setModelOpen] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (dropRef.current && !dropRef.current.contains(e.target as Node)) setModelOpen(false); };
    document.addEventListener('mousedown', handler); return () => document.removeEventListener('mousedown', handler);
  }, []);

  const currentModel = models.find(m => m.id === selectedModel);

  return (
    <header className="flex items-center gap-3 px-4 shrink-0 select-none relative" style={{ height: 'var(--header-height)', backgroundColor: 'rgba(13,21,37,0.85)', backdropFilter: 'blur(16px)', borderBottom: '1px solid var(--border)' }}>
      <div className="absolute bottom-0 left-0 right-0 h-[1px] overflow-hidden">
        <div className="absolute inset-y-0 w-1/3 animate-scan-sweep" style={{ background: 'linear-gradient(90deg, transparent, rgba(0,240,255,0.4), transparent)' }} />
      </div>
      <button onClick={onToggleSidebar} className="p-1.5 rounded-lg transition-all duration-150" style={{ color: 'var(--text-secondary)' }} onMouseEnter={e => { e.currentTarget.style.color = 'var(--primary)'; e.currentTarget.style.backgroundColor = 'rgba(0,240,255,0.08)'; }} onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.backgroundColor = 'transparent'; }} aria-label="切换侧边栏"><Menu size={18} /></button>
      <button onClick={() => navigate('/')} className="flex items-center gap-2 mr-2 cursor-pointer transition-opacity duration-200 hover:opacity-80" style={{ background: 'transparent', border: 'none', padding: 0 }}>
        <img src={logoImg} alt="LandfillMind" className="w-7 h-7 object-contain" style={{ filter: 'drop-shadow(0 0 6px rgba(99,154,78,0.3))' }} />
        <span className="font-semibold text-sm tracking-tight neon-text" style={{ color: 'var(--primary)' }}>LandfillMind</span>
      </button>
      {currentAgent && <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium" style={{ backgroundColor: 'rgba(0,240,255,0.06)', color: 'var(--primary)', border: '1px solid rgba(0,240,255,0.15)' }}><Bot size={13} /><span>{currentAgent.name}</span></div>}
      {currentSession && <span className="text-sm truncate flex-1 min-w-0" style={{ color: 'var(--text-secondary)' }}>{currentSession.title}</span>}
      <div className="flex-1" />
      <div ref={dropRef} className="relative">
        <button onClick={() => setModelOpen(o => !o)}
          className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-all duration-150"
          style={{
            color: 'var(--text-primary)',
            backgroundColor: modelOpen ? 'rgba(0,240,255,0.12)' : 'rgba(255,255,255,0.05)',
            border: '1px solid var(--border-accent)',
          }}
          onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(0,240,255,0.12)'; e.currentTarget.style.borderColor = 'rgba(0,240,255,0.4)'; }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = modelOpen ? 'rgba(0,240,255,0.12)' : 'rgba(255,255,255,0.05)'; e.currentTarget.style.borderColor = 'var(--border-accent)'; }}
        ><Zap size={12} style={{ color: 'var(--primary)' }} /><span>{currentModel?.name ?? '选择模型'}</span><ChevronDown size={12} className={`transition-transform duration-200 ${modelOpen ? 'rotate-180' : ''}`} /></button>
        {modelOpen && (
          <div className="absolute right-0 top-full mt-1 w-52 rounded-xl z-50 overflow-hidden" style={{ backgroundColor: 'rgba(13,21,37,0.95)', border: '1px solid var(--border-accent)', backdropFilter: 'blur(16px)', boxShadow: '0 8px 32px rgba(0,0,0,0.5), 0 0 20px rgba(0,240,255,0.05)' }}>
            {models.map(m => (
              <button key={m.id} onClick={() => { onModelChange(m.id); setModelOpen(false); }} className="w-full flex flex-col items-start px-3 py-2 text-left text-xs transition-all duration-100" style={{ color: selectedModel === m.id ? 'var(--primary)' : 'var(--text-secondary)', backgroundColor: selectedModel === m.id ? 'rgba(0,240,255,0.08)' : 'transparent', borderLeft: selectedModel === m.id ? '2px solid var(--primary)' : '2px solid transparent' }} onMouseEnter={e => { if (selectedModel !== m.id) e.currentTarget.style.backgroundColor = 'rgba(0,240,255,0.04)'; }} onMouseLeave={e => { if (selectedModel !== m.id) e.currentTarget.style.backgroundColor = 'transparent'; }}>
                <span className="font-medium">{m.name}</span><span className="opacity-60">{m.provider}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <button onClick={onToggleTheme} className="btn w-8 h-8 rounded-lg transition-all duration-150" style={{ color: 'var(--text-secondary)', border: '1px solid transparent' }} onMouseEnter={e => { e.currentTarget.style.color = 'var(--primary)'; e.currentTarget.style.borderColor = 'rgba(0,240,255,0.3)'; e.currentTarget.style.boxShadow = '0 0 12px rgba(0,240,255,0.15)'; }} onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.boxShadow = 'none'; }} aria-label="切换主题">{theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}</button>
    </header>
  );
}

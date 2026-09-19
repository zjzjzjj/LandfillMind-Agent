import { useState } from 'react';
import { motion } from 'framer-motion';
import { Settings, Plus, Trash2, Pencil, Moon, Sun, Key, Bot, Zap, CheckCircle2 } from 'lucide-react';
import type { Agent } from '../types';
import type { Theme } from '../hooks/useTheme';

interface SettingsPageProps {
  agents: Agent[];
  onAdd: (agent: Omit<Agent, 'id' | 'isBuiltIn'>) => void;
  onUpdate: (id: string, updates: Partial<Agent>) => void;
  onDelete: (id: string) => void;
}

function AgentCard({
  agent, onUpdate, onDelete,
}: {
  agent: Agent;
  onUpdate: (id: string, updates: Partial<Agent>) => void;
  onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(agent.name);
  const [systemPrompt, setSystemPrompt] = useState(agent.systemPrompt);
  const [showKey, setShowKey] = useState(false);

  const handleSave = () => {
    onUpdate(agent.id, { name, systemPrompt });
    setEditing(false);
  };

  return (
    <div
      className="rounded-2xl border overflow-hidden"
      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-surface)' }}
    >
      <div className="h-1" style={{ backgroundColor: agent.color }} />
      <div className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-xl">{agent.icon}</span>
            <div>
              <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{agent.name}</p>
              {agent.isBuiltIn && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full"
                      style={{ backgroundColor: 'var(--primary-glow)', color: 'var(--primary)' }}>
                  内置
                </span>
              )}
            </div>
          </div>
          {!agent.isBuiltIn && (
            <div className="flex gap-1">
              {editing ? (
                <button onClick={handleSave}
                        className="p-1.5 rounded-lg" style={{ color: 'var(--primary)' }}>
                  <CheckCircle2 size={15} />
                </button>
              ) : (
                <button onClick={() => setEditing(true)}
                        className="p-1.5 rounded-lg" style={{ color: 'var(--text-muted)' }}>
                  <Pencil size={15} />
                </button>
              )}
              <button onClick={() => onDelete(agent.id)}
                      className="p-1.5 rounded-lg" style={{ color: '#ef4444' }}>
                <Trash2 size={15} />
              </button>
            </div>
          )}
        </div>

        <p className="text-xs mb-3" style={{ color: 'var(--text-secondary)' }}>{agent.description}</p>

        {editing ? (
          <div className="space-y-2">
            <div>
              <label className="text-[11px]" style={{ color: 'var(--text-muted)' }}>名称</label>
              <input value={name} onChange={e => setName(e.target.value)}
                     className="w-full mt-1 px-3 py-1.5 rounded-lg text-sm border outline-none"
                     style={{ backgroundColor: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
            </div>
            <div>
              <label className="text-[11px]" style={{ color: 'var(--text-muted)' }}>系统提示词</label>
              <textarea value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)}
                        rows={4}
                        className="w-full mt-1 px-3 py-1.5 rounded-lg text-xs border outline-none resize-none"
                        style={{ backgroundColor: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
            </div>
          </div>
        ) : (
          <div>
            <p className="text-[10px] font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>系统提示词</p>
            <p className="text-[11px] leading-relaxed line-clamp-3"
               style={{ color: 'var(--text-secondary)' }}>
              {agent.systemPrompt}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function SettingsPage({ agents, onAdd, onUpdate, onDelete }: SettingsPageProps) {
  const [theme, setTheme] = useState<Theme>('dark');
  const [newName, setNewName] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.classList.toggle('dark', next === 'dark');
    localStorage.setItem('theme', next);
  };

  return (
    <div className="flex-1 overflow-y-auto" style={{ backgroundColor: 'var(--bg-base)' }}>
      {/* 标题 */}
      <div className="px-6 pt-5 pb-4 border-b" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-surface)' }}>
        <div className="flex items-center gap-2.5">
          <Settings size={18} style={{ color: 'var(--primary)' }} />
          <div>
            <h1 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>设置</h1>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>自定义 Agent、配置模型、管理 API Key</p>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-6 space-y-8">
        {/* 主题切换 */}
        <section>
          <h2 className="text-sm font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            {theme === 'dark' ? <Moon size={16} /> : <Sun size={16} />}
            外观
          </h2>
          <div
            className="flex items-center justify-between p-4 rounded-2xl border"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-surface)' }}
          >
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>深色主题</p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>适合夜间使用，减少眼睛疲劳</p>
            </div>
            <button
              onClick={toggleTheme}
              className="w-12 h-6 rounded-full relative transition-colors duration-200"
              style={{ backgroundColor: theme === 'dark' ? 'var(--primary)' : 'var(--bg-elevated)' }}
            >
              <span
                className="absolute top-1 w-4 h-4 rounded-full bg-white transition-all duration-200"
                style={{ left: theme === 'dark' ? '28px' : '4px' }}
              />
            </button>
          </div>
        </section>

        {/* API Key */}
        <section>
          <h2 className="text-sm font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <Key size={16} />
            API 配置
          </h2>
          <div
            className="p-4 rounded-2xl border space-y-3"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-surface)' }}
          >
            {['CODEBUDDY_API_KEY', 'DEEPSEEK_API_KEY'].map(key => (
              <div key={key}>
                <label className="text-xs font-medium mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>
                  {key}
                </label>
                <div className="flex gap-2">
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={e => setApiKey(e.target.value)}
                    placeholder="输入 API Key..."
                    className="flex-1 px-3 py-2 rounded-lg text-sm border outline-none"
                    style={{ backgroundColor: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                  />
                  <button
                    onClick={() => setShowApiKey(s => !s)}
                    className="px-3 py-2 rounded-lg text-xs border"
                    style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
                  >
                    {showApiKey ? '隐藏' : '显示'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Agent 管理 */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
              <Bot size={16} />
              Agent 管理
            </h2>
            <button
              onClick={() => setShowAddForm(a => !a)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors"
              style={{ borderColor: 'var(--border)', color: 'var(--primary)' }}
              onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--primary-glow)')}
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
            >
              <Plus size={13} />
              新建 Agent
            </button>
          </div>

          {/* 新建表单 */}
          {showAddForm && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="mb-4 p-4 rounded-2xl border"
              style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-surface)' }}
            >
              <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>新建自定义 Agent（完整表单待完善）</p>
              <input
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="Agent 名称..."
                className="w-full mb-2 px-3 py-2 rounded-lg text-sm border outline-none"
                style={{ backgroundColor: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
              />
              <button
                onClick={() => {
                  if (newName.trim()) {
                    onAdd({
                      name: newName.trim(),
                      icon: '🤖',
                      description: '自定义助手',
                      systemPrompt: '你是 LandfillMind · 填埋场全周期智能体 AI 助手。',
                      model: 'codebuddy',
                      color: '#06b6d4',
                    });
                    setNewName('');
                    setShowAddForm(false);
                  }
                }}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white"
                style={{ backgroundColor: 'var(--primary)' }}
              >
                创建
              </button>
            </motion.div>
          )}

          {/* Agent 列表 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {agents.map(agent => (
              <AgentCard key={agent.id} agent={agent} onUpdate={onUpdate} onDelete={onDelete} />
            ))}
          </div>
        </section>

        {/* 版本信息 */}
        <div className="text-center pt-4 border-t" style={{ borderColor: 'var(--border)' }}>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            LandfillMind · 填埋场全周期智能体 v4.4
          </p>
        </div>
      </div>
    </div>
  );
}

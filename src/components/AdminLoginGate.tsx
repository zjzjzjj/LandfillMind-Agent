/**
 * LandfillMind · Admin 认证前端组件（L · 生产安全）
 * 在 AdminPage 加载前要求输入 ADMIN_TOKEN（从 .env 读取或开发默认）
 *
 * 设计：
 *   1. 首次访问要求输入 token，存到 sessionStorage
 *   2. 后续访问自动读取 sessionStorage
 *   3. Token 错误时清除并重新要求输入
 */

import { useEffect, useState } from 'react';
import { Shield, KeyRound, AlertTriangle } from 'lucide-react';

const SESSION_KEY = 'landfillmind_admin_token';

export function getStoredAdminToken(): string | null {
  try {
    return sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

export function setStoredAdminToken(t: string): void {
  try {
    if (t) sessionStorage.setItem(SESSION_KEY, t);
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {}
}

/**
 * 测试 token 是否有效
 */
async function testToken(token: string): Promise<boolean> {
  try {
    const r = await fetch('/api/feedback/distill', {
      method: 'POST',
      headers: { 'X-Admin-Token': token, 'Content-Type': 'application/json' },
      body: '{}',
    });
    return r.ok;
  } catch {
    return false;
  }
}

interface Props {
  onAuthenticated: () => void;
}

export function AdminLoginGate({ onAuthenticated }: Props) {
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [authHint, setAuthHint] = useState<string>('检查认证配置...');
  const [devTokenActive, setDevTokenActive] = useState(false);
  /** P0 修复：服务端未配置 ADMIN_TOKEN 时管理端点整体禁用，前端锁定表单 */
  const [serverEnabled, setServerEnabled] = useState<boolean | null>(null);

  // 检查服务端认证状态
  useEffect(() => {
    fetch('/api/admin/auth-status')
      .then(r => r.json())
      .then(d => {
        if (d.enabled) { setAuthHint('已启用 ADMIN_TOKEN 环境变量'); setDevTokenActive(false); }
        else { setAuthHint(d.hint ?? '管理端点未启用'); setDevTokenActive(true); }
        setServerEnabled(!!d.enabled);
        })
      .catch(() => { setAuthHint('无法连接服务器'); setServerEnabled(null); });
  }, []);

  // 自动尝试用 sessionStorage 中的 token 验证
  useEffect(() => {
    const stored = getStoredAdminToken();
    if (stored) {
      setLoading(true);
      testToken(stored).then(ok => {
        setLoading(false);
        if (ok) onAuthenticated();
        else {
          setStoredAdminToken('');
          setError('已存储的 token 已失效，请重新输入');
        }
      });
    }
  }, []);

  const submit = async () => {
    if (!token.trim()) {
      setError('请输入 token');
      return;
    }
    const disabled = serverEnabled === false;
    if (disabled) {
      setError('管理端点未启用（服务器未配置 ADMIN_TOKEN），无法登录');
      return;
    }
    setLoading(true);
    setError(null);
    const ok = await testToken(token.trim());
    setLoading(false);
    if (ok) {
      setStoredAdminToken(token.trim());
      onAuthenticated();
    } else {
      setError(disabled ? '管理端点未启用，无法登录' : 'Token 无效，请检查');
    }
  };

  return (
    <div className="flex-1 flex items-center justify-center p-6" style={{ backgroundColor: 'var(--bg-base)' }}>
      <div
        className="rounded-2xl border p-8 max-w-md w-full"
        style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-surface)', boxShadow: '0 20px 60px rgba(0,0,0,0.08)' }}
      >
        <div className="flex items-center gap-3 mb-5">
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #dc2626 0%, #ea580c 100%)' }}
          >
            <Shield size={22} style={{ color: '#fff' }} />
          </div>
          <div>
            <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>管理员后台</h1>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{authHint}</p>
          </div>
        </div>

        <p className="text-xs leading-relaxed mb-5" style={{ color: 'var(--text-secondary)' }}>
          此页面包含 A/B 测试权重、用户反馈数据、自动蒸馏控制等敏感信息。
          请输入 <code style={{ background: 'var(--bg-elevated)', padding: '1px 5px', borderRadius: 3 }}>ADMIN_TOKEN</code> 进行认证。
        </p>

        <div className="flex items-center gap-2 mb-3">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
            style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--primary)' }}
          >
            <KeyRound size={15} />
          </div>
          <input
            type="password"
            value={token}
            onChange={e => { setToken(e.target.value); setError(null); }}
            onKeyDown={e => { if (e.key === 'Enter') submit(); }}
            placeholder="输入 ADMIN_TOKEN..."
            disabled={loading}
            autoFocus
            className="flex-1 px-3 py-2 rounded-lg text-sm outline-none border transition-colors"
            style={{
              backgroundColor: 'var(--bg-input)',
              borderColor: error ? '#f43f5e' : 'var(--border)',
              color: 'var(--text-primary)',
            }}
          />
        </div>

        {error && (
          <div
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs mb-3"
            style={{ backgroundColor: 'rgba(244, 63, 94, 0.10)', color: '#f43f5e' }}
          >
            <AlertTriangle size={12} />
            {error}
          </div>
        )}

        <button
          onClick={submit}
          disabled={loading || serverEnabled === false}
          className="w-full py-2.5 rounded-lg text-sm font-semibold text-white disabled:opacity-50 transition-all"
          style={{ backgroundColor: 'var(--primary)' }}
        >
          {loading ? '验证中...' : serverEnabled === false ? '管理端点未启用' : '解锁后台'}
        </button>

        <p className="text-[10px] mt-4 text-center" style={{ color: 'var(--text-muted)' }}>
          {devTokenActive
            ? <>提示：请在服务器环境变量配置 <code>ADMIN_TOKEN</code> 后启用管理端点</>
            : <>提示：请输入 Render 环境变量中配置的 <code>ADMIN_TOKEN</code>（在控制台 Environment 页可查看）</>}
        </p>
      </div>
    </div>
  );
}
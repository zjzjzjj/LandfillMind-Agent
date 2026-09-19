import { useState, useCallback, useRef, useEffect } from 'react';
import type { Session, Message } from '../types';
import { v4 as uuidv4 } from 'uuid';

/**
 * 会话管理：后端（sql.js）为唯一持久化来源，刷新页面不丢；
 * 每次增删改后即时 POST /api/sessions 同步（失败静默，保持本地可用）。
 */
export function useSessions() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [sessionModels, setSessionModels] = useState<Record<string, string>>({});
  const initialized = useRef(false);
  const sessionsRef = useRef<Session[]>([]);
  const currentIdRef = useRef<string | null>(null);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  const fetchSessions = useCallback(async () => {
    if (initialized.current) return;
    initialized.current = true;
    try {
      const res = await fetch('/api/sessions');
      if (res.ok) {
        const data = await res.json();
        const list: Session[] = (data.sessions ?? []).map((s: any) => ({
          id: String(s.id),
          title: String(s.title ?? '新会话'),
          agentId: s.agentId ?? 'default',
          model: String(s.model ?? 'codebuddy'),
          messages: Array.isArray(s.messages) ? s.messages : [],
          createdAt: Number(s.createdAt) || Date.now(),
          updatedAt: Number(s.updatedAt) || Date.now(),
        }));
        setSessions(list);
        // 仅当用户尚未创建/恢复任何会话时才自动选中第一条（避免覆盖一键带问刚建的新会话）
        if (list.length > 0 && !currentIdRef.current) {
          currentIdRef.current = list[0].id;
          setCurrentSessionId(list[0].id);
        }
      }
    } catch {
      // 服务未启动，忽略
    }
  }, []);

  /** 同步后端：messages 仅在 includeMessages 时携带（防止旧快照覆盖新消息） */
  const persist = useCallback(async (session: Session, includeMessages: boolean) => {
    try {
      const payload: Record<string, unknown> = {
        id: session.id,
        title: session.title,
        agentId: session.agentId,
        model: session.model,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      };
      if (includeMessages) payload.messages = session.messages;
      await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session: payload }),
      });
    } catch {
      // 离线/服务未启动：保持本地状态
    }
  }, []);

  const currentSession = sessions.find(s => s.id === currentSessionId) ?? null;

  const addSession = useCallback((agentId: string, model: string): Session => {
    const session: Session = {
      id: uuidv4(),
      title: '新会话',
      agentId,
      model,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setSessions(prev => [session, ...prev]);
    currentIdRef.current = session.id;
    setCurrentSessionId(session.id);
    setSessionModels(prev => ({ ...prev, [session.id]: model }));
    void persist(session, false);
    return session;
  }, [persist]);

  // 全部走函数式更新：同一事件循环内连发多个更新时，避免旧快照覆盖新会话
  const updateSession = useCallback((id: string, updates: Partial<Session>) => {
    setSessions(prev => {
      const next = prev.map(s => s.id === id ? { ...s, ...updates, updatedAt: Date.now() } : s);
      const target = next.find(s => s.id === id);
      if (target) void persist(target, false);
      return next;
    });
  }, [persist]);

  const updateSessionMessages = useCallback((id: string, messages: Message[], opts?: { skipPersist?: boolean }) => {
    setSessions(prev => {
      const base = prev.find(s => s.id === id);
      const next = prev.map(s => s.id === id ? { ...s, messages, updatedAt: Date.now() } : s);
      const target = next.find(s => s.id === id);
      // 流式生成期间只更新本地 state，跳过后端 persist（避免 60+ 次 POST/回答）
      if (!opts?.skipPersist) {
        if (target) void persist(target, true);
        else if (base) void persist({ ...base, messages }, true);
      }
      return next;
    });
  }, [persist]);

  /** 流式结束后强制刷一次后端（无论之前是否 skipPersist） */
  const flushSessionMessages = useCallback((id: string) => {
    setSessions(prev => {
      const target = prev.find(s => s.id === id);
      if (target) void persist(target, true);
      return prev;
    });
  }, [persist]);

  const updateSessionModel = useCallback((id: string, model: string) => {
    setSessionModels(prev => ({ ...prev, [id]: model }));
    setSessions(prev => {
      const base = prev.find(s => s.id === id);
      const next = prev.map(s => s.id === id ? { ...s, model, updatedAt: Date.now() } : s);
      const target = next.find(s => s.id === id);
      if (target) void persist(target, false);
      else if (base) void persist({ ...base, model }, false);
      return next;
    });
  }, [persist]);

  const deleteSession = useCallback(async (id: string): Promise<string | null> => {
    try {
      await fetch('/api/sessions/' + encodeURIComponent(id), { method: 'DELETE' });
    } catch {}
    const remaining = sessionsRef.current.filter(s => s.id !== id);
    setSessions(remaining);
    if (currentIdRef.current === id) {
      const next = remaining[0]?.id ?? null;
      currentIdRef.current = next;
      setCurrentSessionId(next);
      return next ? '/chat/' + next : '/';
    }
    return null;
  }, []);

  return {
    sessions,
    setSessions,
    currentSessionId,
    setCurrentSessionId,
    currentSession,
    sessionModels,
    fetchSessions,
    addSession,
    updateSession,
    updateSessionMessages,
    flushSessionMessages,
    updateSessionModel,
    deleteSession,
  };
}

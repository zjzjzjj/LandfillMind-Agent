import { useState, useCallback, useRef } from 'react';
import type { Agent, Session, Message, ToolCall, PermissionMode, MessageSources } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { getDetailPref } from '../utils/detailPref';
import { readableFormula } from '../utils/formula';

/** 去掉模型输出里的 Markdown 符号，保持前端纯文本显示干净 */
function cleanAssistantText(text: string): string {
  const plain = text
    .replace(/`/g, '')
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/#{1,6}\s*/g, '');
  return readableFormula(plain);
}

interface UseChatOptions {
  currentSession: Session | null;
  currentSessionId: string | null;
  selectedModel: string;
  getAgent: (id: string) => Agent | undefined;
  addSession: (agentId: string, model: string) => Session;
  updateSession: (id: string, updates: Partial<Session>) => void;
  updateSessionMessages: (id: string, messages: Message[], opts?: { skipPersist?: boolean }) => void;
  /** 流式结束后强制刷一次后端（即使之前 skipPersist） */
  flushSessionMessages: (id: string) => void;
  updateSessionModel: (id: string, model: string) => void;
  setCurrentSessionId: (id: string | null) => void;
  setSessions: React.Dispatch<React.SetStateAction<Session[]>>;
}

export function useChat(opts: UseChatOptions) {
  const {
    currentSession, currentSessionId, selectedModel,
    getAgent, addSession, updateSession,
    updateSessionMessages, flushSessionMessages,
    updateSessionModel,
    setCurrentSessionId, setSessions,
  } = opts;

  const [isLoading, setIsLoading] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [permissionRequest, setPermissionRequest] = useState<{
    tool: string; params: unknown; sessionId: string;
  } | null>(null);
  const permissionModeRef = useRef<PermissionMode>('default');

  const stopController = useRef<AbortController | null>(null);
  /** 闭包安全：每个 session 维护最新的"已展示消息"快照，避免 SSE 事件处理函数引用过期闭包 */
  const liveMessagesRef = useRef<Message[]>([]);
  /** 流式生成期间持续更新 ref，但跳过 persist；流结束再 flushSessionMessages 一次性写后端 */
  const streamingRef = useRef<boolean>(false);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isLoading) return;

    // 确保有活跃会话
    let session = currentSession;
    let sid = currentSessionId;
    if (!sid || !session) {
      const defaultAgent = getAgent('default');
      session = addSession(defaultAgent?.id ?? 'default', selectedModel);
      sid = session.id;
    }

    const userMsg: Message = {
      id: uuidv4(), role: 'user', content: text, timestamp: Date.now(),
    };

    // 用最新 session.messages 作为基线（避免同会话连发时丢上一条 AI 回复）
    const baseMessages = session.messages ?? [];
    const updatedMessages = [...baseMessages, userMsg];
    liveMessagesRef.current = updatedMessages;
    updateSessionMessages(sid, updatedMessages);
    updateSession(sid, { messages: updatedMessages });

    setInputValue('');
    setIsLoading(true);
    streamingRef.current = true;

    const assistantMsgId = uuidv4();
    let assistantContent = '';
    let assistantRaw = '';
    /**
     * 流内提示（错误/停止）单独累积。此前直接往 assistantContent 上追加，
     * 而每个 text 事件都会用 cleanAssistantText(assistantRaw) 重算正文，
     * 于是 mid-stream 的 [错误] 会被下一条 text 抹掉、最终也不落库。
     */
    let assistantNotice = '';
    const setContent = () => { assistantContent = cleanAssistantText(assistantRaw) + assistantNotice; };
    let assistantSources: MessageSources | null = null;
    const toolCallsMap = new Map<string, ToolCall>();

    const optimisticMsg: Message = {
      id: assistantMsgId, role: 'assistant', content: '',
      timestamp: Date.now(), toolCalls: [],
    };
    liveMessagesRef.current = [...updatedMessages, optimisticMsg];
    updateSessionMessages(sid, liveMessagesRef.current, { skipPersist: true });

    const controller = new AbortController();
    stopController.current = controller;

    try {
      const agent = getAgent(session.agentId);
      // v5：统一单智能体人格——不再注入"专家 persona"（追问专家跳转与 chat-prefill-expert 已移除）
      let systemPrompt = agent?.systemPrompt ?? '你是 LandfillMind · 填埋场全周期智能体 AI 助手。';

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: sid,
          messages: updatedMessages,
          model: selectedModel,
          systemPrompt,
          permissionMode: permissionModeRef.current,
          detail: getDetailPref('chat'),
        }),
        signal: controller.signal,
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (!res.body) throw new Error('No response body');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;

          try {
            const event = JSON.parse(data);
            if (event.type === 'text') {
              assistantRaw += event.text ?? '';
              setContent();
              const cur = liveMessagesRef.current;
              liveMessagesRef.current = [
                ...cur.slice(0, -1),
                { ...optimisticMsg, content: assistantContent, toolCalls: Array.from(toolCallsMap.values()), sources: assistantSources },
              ];
              updateSessionMessages(sid, liveMessagesRef.current, { skipPersist: true });
            } else if (event.type === 'sources') {
              assistantSources = { kb: Array.isArray(event.kb) ? event.kb : [], calcs: Array.isArray(event.calcs) ? event.calcs : [] };
              const cur = liveMessagesRef.current;
              liveMessagesRef.current = [
                ...cur.slice(0, -1),
                { ...optimisticMsg, content: assistantContent, toolCalls: Array.from(toolCallsMap.values()), sources: assistantSources },
              ];
              updateSessionMessages(sid, liveMessagesRef.current, { skipPersist: true });
            } else if (event.type === 'tool_call') {
              const tc: ToolCall = {
                id: event.callId ?? uuidv4(),
                name: event.name,
                // 后端回放事件会带 kind（'kb'/'calc'/'ogs'/'scene'/'kernel'/'model'/'diagnosis'/'deep'/'report'），CodeBuddy 真 function calling 路径不带
                type: (['kb', 'calc', 'ogs', 'scene', 'kernel', 'model', 'diagnosis', 'deep', 'report'] as const).includes(event.kind) ? event.kind : undefined,
                input: event.input ?? {},
                status: 'running',
              };
              toolCallsMap.set(tc.id, tc);
              const cur = liveMessagesRef.current;
              liveMessagesRef.current = [
                ...cur.slice(0, -1),
                { ...optimisticMsg, content: assistantContent, toolCalls: Array.from(toolCallsMap.values()), sources: assistantSources },
              ];
              updateSessionMessages(sid, liveMessagesRef.current, { skipPersist: true });
            } else if (event.type === 'tool_result') {
              // 归一化 callId：后端漏发时避免以 undefined 作 Map key 写入
              const callId = event.callId ?? '';
              const existing = toolCallsMap.get(callId);
              if (existing) {
                toolCallsMap.set(callId, {
                  ...existing,
                  output: event.output,
                  status: event.error ? 'error' : 'success',
                });
                const cur = liveMessagesRef.current;
                liveMessagesRef.current = [
                  ...cur.slice(0, -1),
                  { ...optimisticMsg, content: assistantContent, toolCalls: Array.from(toolCallsMap.values()), sources: assistantSources },
                ];
                updateSessionMessages(sid, liveMessagesRef.current, { skipPersist: true });
              }
            } else if (event.type === 'permission') {
              setPermissionRequest({ tool: event.tool, params: event.params, sessionId: sid });
            } else if (event.type === 'error') {
              assistantNotice += `\n[错误] ${event.message}`;
              setContent();
            } else if (event.type === 'follow_up') {
              // P0-8 修复：追问引导事件（server/followUp.ts 命中关键词后下发）
              //   不参与流式正文，仅作为独立卡片提示：建议用户补全哪些参数以解锁计算
              //   多份按时间顺序追加，最后一条覆盖展示（同一轮只展示 1 张卡片）
              const lastAssistant = liveMessagesRef.current[liveMessagesRef.current.length - 1];
              if (lastAssistant && lastAssistant.id === assistantMsgId) {
                const existing = Array.isArray((lastAssistant as any).followUps) ? (lastAssistant as any).followUps : [];
                liveMessagesRef.current = [
                  ...liveMessagesRef.current.slice(0, -1),
                  { ...lastAssistant, followUps: [...existing, { kind: event.kind ?? '', prompt: event.prompt ?? '', hint: event.hint ?? '' }] },
                ];
                updateSessionMessages(sid, liveMessagesRef.current, { skipPersist: true });
              }
            }
          } catch {}
        }
      }
    } catch (err: unknown) {
      assistantNotice += (err as Error)?.name === 'AbortError'
        ? '\n[已停止]'
        : `\n[网络错误] ${(err as Error)?.message ?? '未知错误'}`;
      setContent();
    } finally {
      streamingRef.current = false;
      setIsLoading(false);
      stopController.current = null;

      // 把最后一条助手消息定稿（content/toolCalls/sources/followUps 全部保留）
      // v5.5 修：followUps 此前没被带进 finalMsg，追问卡片在流结束的瞬间就消失
      const streaming = liveMessagesRef.current[liveMessagesRef.current.length - 1];
      const finalMsg: Message = {
        id: assistantMsgId, role: 'assistant', content: assistantContent,
        timestamp: Date.now(), toolCalls: Array.from(toolCallsMap.values()), sources: assistantSources,
        followUps: streaming?.id === assistantMsgId ? streaming.followUps : undefined,
      };
      const cur = liveMessagesRef.current;
      liveMessagesRef.current = [...cur.slice(0, -1), finalMsg];
      updateSessionMessages(sid, liveMessagesRef.current, { skipPersist: true });

      // 一次性把整段会话写后端（避免 SSE 期间 60+ 次 POST）
      flushSessionMessages(sid);

      // 更新会话标题（首条消息的前30字）
      if ((baseMessages ?? []).length === 0 && userMsg.content) {
        const title = userMsg.content.slice(0, 30) + (userMsg.content.length > 30 ? '...' : '');
        updateSession(sid, { title });
      }
    }
  }, [currentSession, currentSessionId, isLoading, selectedModel, getAgent,
      addSession, updateSession, updateSessionMessages, flushSessionMessages]);

  const handleStop = useCallback(() => {
    stopController.current?.abort();
    setIsLoading(false);
  }, []);

  // 兼容路径（GLM / 兼容通道）下不再触发真工具调用授权——权限弹窗不会出现。
  // 仅在设置 CODEBUDDY_API_KEY 走 CodeBuddy SDK 真 function calling 时，permission 事件才会触发；
  // 这里的 no-op 保留用于前端接口兼容。tool_call 事件在兼容路径下是后端 RAG / 计算结果回放，
  // 不是 LLM 主动发起调用（见 server/index.ts handleCompatChat 注释）。
  const handlePermissionAllow = useCallback((_tool: string, _params: unknown) => {
    setPermissionRequest(null);
  }, []);
  const handlePermissionDeny = useCallback((_tool: string) => {
    setPermissionRequest(null);
  }, []);

  const setPermissionMode = useCallback((mode: PermissionMode) => {
    permissionModeRef.current = mode;
  }, []);

  return {
    isLoading, inputValue, setInputValue,
    permissionRequest,
    sendMessage, handleStop,
    handlePermissionAllow, handlePermissionDeny,
    setPermissionMode,
  };
}

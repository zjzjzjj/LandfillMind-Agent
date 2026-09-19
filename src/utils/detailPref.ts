import { useEffect, useState } from 'react';
import type { DetailLevel } from '../types';

const KEYS = { chat: 'chat-detail', diagnose: 'diagnose-detail', multiagent: 'multiagent-detail' } as const;
export type DetailPrefKey = keyof typeof KEYS;

export function getDetailPref(key: DetailPrefKey): DetailLevel {
  try {
    const v = localStorage.getItem(KEYS[key]);
    if (v === 'brief' || v === 'standard' || v === 'detailed') return v;
  } catch {}
  // P1-4 修复：chat/diagnose 默认 detailed，multiagent 默认 standard（多智能体路径 prompt 较短、回答聚焦）
  return key === 'multiagent' ? 'standard' : 'detailed';
}

export function useDetailPref(key: DetailPrefKey) {
  const [detail, setDetail] = useState<DetailLevel>(() => getDetailPref(key));
  useEffect(() => {
    try { localStorage.setItem(KEYS[key], detail); } catch {}
  }, [key, detail]);
  return [detail, setDetail] as const;
}
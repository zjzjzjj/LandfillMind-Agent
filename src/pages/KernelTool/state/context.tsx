/**
 * state/context.tsx · 页面级上下文
 *
 * 只放**低频**值：内核运行层（run/log/pool/info/sid/meshKey）与布局状态。
 * 表单字段一律走 FieldStore 的 useField（见 store.ts），不进 Context ——
 * 否则左栏敲一个字符就会重渲染整棵巨型页面。
 */
import { createContext, useContext } from 'react';
import type { FieldStore } from './store';
import type { FormState, UiState } from '../spec/defaults';
import type { KernelRunApi } from './run';

export interface ToolCtxValue {
  form: FieldStore<FormState>;
  ui: FieldStore<UiState>;
  k: KernelRunApi;
}

export const ToolCtx = createContext<ToolCtxValue | null>(null);

export function useTool(): ToolCtxValue {
  const v = useContext(ToolCtx);
  if (!v) throw new Error('useTool 必须在 ToolCtx.Provider 内使用');
  return v;
}

/** 表单字段便捷读（只订阅这一个字段） */
export function useField<P = unknown>(path: string): [P, (v: P) => void] {
  return useTool().form.useField<P>(path);
}

/** 表单字段只读 */
export function useFormValue<P = unknown>(path: string): P {
  return useTool().form.useValue<P>(path);
}

/** 布局字段 */
export function useUi<P = unknown>(path: string): [P, (v: P) => void] {
  return useTool().ui.useField<P>(path);
}

export function useUiValue<P = unknown>(path: string): P {
  return useTool().ui.useValue<P>(path);
}

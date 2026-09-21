/**
 * state/store.ts · 字段级订阅的极简外部 store
 *
 * 为什么不用 Context 承载表单：全量对齐桌面后表单字段上百个（仅污染页
 * ⑥高级参数就有 33 项）。Context 一改，整棵巨型页面（9 视图条 + 结果表 +
 * 日志 + 4 个页签）全部重渲染，左栏敲一个字符就卡一次。
 *
 * 这里用 useSyncExternalStore 做**字段级订阅**：`useField('build.rectL')`
 * 只在 rectL 变化时重渲染那一个 <input>。零新依赖（项目没有 zustand）。
 *
 * 路径语法：'build.rectL' / 'poll.spec.liner' / 'exc.rows.2.gamma'
 */
import { useCallback, useSyncExternalStore } from 'react';

type Listener = () => void;

export class FieldStore<T extends Record<string, any>> {
  private state: T;
  /** 路径 → 监听者；'*' 表示订阅整棵树 */
  private listeners = new Map<string, Set<Listener>>();
  private snapshotCache = new Map<string, unknown>();

  constructor(initial: T) {
    this.state = initial;
  }

  /** 读整棵（低频用；高频请用 useField） */
  getState(): T { return this.state; }

  /** 按路径读；路径不存在返回 undefined */
  get(path: string): unknown {
    if (!path) return this.state;
    let cur: any = this.state;
    for (const seg of path.split('.')) {
      if (cur == null) return undefined;
      cur = cur[seg];
    }
    return cur;
  }

  /**
   * 按路径写（不可变更新，浅拷贝沿途对象）。
   * 通知：精确路径的订阅者 + 所有**祖先路径**的订阅者 + '*' 订阅者 ——
   * 订阅 'build' 的组件在 'build.rectL' 变化时也该醒。
   */
  set(path: string, value: unknown): void {
    if (!path) return;
    const segs = path.split('.');
    const next = { ...this.state } as any;
    let cur = next;
    for (let i = 0; i < segs.length - 1; i++) {
      const k = segs[i];
      const child = cur[k];
      cur[k] = Array.isArray(child) ? [...child] : { ...(child ?? {}) };
      cur = cur[k];
    }
    const leaf = segs[segs.length - 1];
    if (Object.is(cur[leaf], value)) return;   // 值没变就别触发渲染
    cur[leaf] = value;
    this.state = next;
    this.snapshotCache.clear();
    this.emit(path);
  }

  /** 批量写（导入工程 / 复位时用），只通知一次 */
  patch(entries: Record<string, unknown>): void {
    const keys = Object.keys(entries);
    if (!keys.length) return;
    for (const k of keys) this.setSilent(k, entries[k]);
    this.snapshotCache.clear();
    for (const k of keys) this.emit(k);
  }

  /** 整体替换（复位） */
  reset(next: T): void {
    this.state = next;
    this.snapshotCache.clear();
    this.emit('*');
  }

  private setSilent(path: string, value: unknown): void {
    const segs = path.split('.');
    const next = { ...this.state } as any;
    let cur = next;
    for (let i = 0; i < segs.length - 1; i++) {
      const k = segs[i];
      const child = cur[k];
      cur[k] = Array.isArray(child) ? [...child] : { ...(child ?? {}) };
      cur = cur[k];
    }
    cur[segs[segs.length - 1]] = value;
    this.state = next;
  }

  private emit(path: string): void {
    const segs = path.split('.');
    const hit = new Set<Listener>();
    for (let i = segs.length; i >= 1; i--) {
      this.listeners.get(segs.slice(0, i).join('.'))?.forEach((l) => hit.add(l));
    }
    this.listeners.get('*')?.forEach((l) => hit.add(l));
    hit.forEach((l) => l());
  }

  subscribe(path: string, cb: Listener): () => void {
    let s = this.listeners.get(path);
    if (!s) { s = new Set(); this.listeners.set(path, s); }
    s.add(cb);
    return () => { s!.delete(cb); if (!s!.size) this.listeners.delete(path); };
  }

  /** useSyncExternalStore 要求快照稳定：同一路径同一版本返回同一引用 */
  private snap(path: string): unknown {
    if (this.snapshotCache.has(path)) return this.snapshotCache.get(path);
    const v = this.get(path);
    // 只有原始值可以缓存（对象每次读都是新引用，缓存反而错）
    if (v === null || typeof v !== 'object') this.snapshotCache.set(path, v);
    return v;
  }

  /** 字段级 hook：只在 path 处的值变化时重渲染 */
  useField<P = unknown>(path: string): [P, (v: P) => void] {
    const sub = useCallback((cb: Listener) => this.subscribe(path, cb), [path]);
    const val = useSyncExternalStore(sub, () => this.snap(path) as P);
    const setter = useCallback((v: P) => this.set(path, v), [path]);
    return [val, setter];
  }

  /** 只读字段（不想暴露 setter 时） */
  useValue<P = unknown>(path: string): P {
    const sub = useCallback((cb: Listener) => this.subscribe(path, cb), [path]);
    return useSyncExternalStore(sub, () => this.snap(path) as P);
  }

  /** 订阅整棵（结果表/状态卡这类低频消费者用） */
  useAll(): T {
    const sub = useCallback((cb: Listener) => this.subscribe('*', cb), []);
    return useSyncExternalStore(sub, () => this.state) as T;
  }
}

/** 建一个带 hook 的 store（返回的 useField 已绑定 this） */
export function createFieldStore<T extends Record<string, any>>(initial: T) {
  const store = new FieldStore(initial);
  return store;
}

export type { FieldStore as FieldStoreType };

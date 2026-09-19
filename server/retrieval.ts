import { KB_ENTRIES, scoreKB } from './kb.js';
import type { KBEntry } from './kb.js';

let vectors: { entry: KBEntry; vec: number[] }[] | null = null;

function cosine(a: number[], b: number[]): number {
  if (!a.length || !b.length || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d > 0 ? dot / d : 0;
}

/** 启动时用智谱 embedding-2 预计算 KB 向量；失败则自动回退纯关键词检索 */
export async function initRetrieval(): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) { vectors = null; return; }
  const baseUrl = (process.env.OPENAI_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4').replace(/\/$/, '');
  try {
    const inputs = KB_ENTRIES.map(e => (e.q + ' ' + e.kw.join(' ') + ' ' + e.clause).slice(0, 400));
    // 智谱 embeddings 单次 input 数组上限 64 条 → 分批请求（199 条 = 4 批）
    const BATCH = 64;
    const vecs: number[][] = [];
    for (let i = 0; i < inputs.length; i += BATCH) {
      const resp = await fetch(baseUrl + '/embeddings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: 'embedding-2', input: inputs.slice(i, i + BATCH) }),
      });
      if (!resp.ok) throw new Error('embedding status ' + resp.status);
      const j: any = await resp.json();
      const data: any[] = Array.isArray(j?.data) ? j.data : [];
      if (data.length !== Math.min(BATCH, inputs.length - i)) throw new Error('embedding batch size mismatch');
      data.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));   // 按 index 对齐输入顺序
      for (const d of data) vecs.push(d.embedding || []);
    }
    vectors = KB_ENTRIES.map((entry, i) => ({ entry, vec: vecs[i] || [] })).filter(v => v.vec.length > 0);
    if (!vectors.length) vectors = null;
  } catch {
    vectors = null;
  }
}

async function embed(text: string): Promise<number[] | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const baseUrl = (process.env.OPENAI_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4').replace(/\/$/, '');
  try {
    const resp = await fetch(baseUrl + '/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: 'embedding-2', input: [text.slice(0, 400)] }),
    });
    if (!resp.ok) return null;
    const j: any = await resp.json();
    return j?.data?.[0]?.embedding || null;
  } catch {
    return null;
  }
}

/** 混合检索（带相关性得分）：0.6 余弦 + 0.4 关键词；embedding 不可用时回退关键词 */
export async function hybridSearchScored(query: string, topK = 3): Promise<{ entry: KBEntry; score: number }[]> {
  const kw = scoreKB(query);
  const kwMap = new Map(kw.map(x => [x.entry.key, x.score]));
  const vec = vectors ? await embed(query) : null;
  let scored: { entry: KBEntry; score: number }[];
  if (vec && vectors) {
    scored = vectors.map(v => ({
      entry: v.entry,
      score: 0.6 * cosine(vec, v.vec) + 0.4 * (kwMap.get(v.entry.key) || 0),
    }));
  } else {
    scored = kw;
  }
  return scored
    .filter(s => s.score > 0.01)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

/** 混合检索：只返回条目（兼容旧调用） */
export async function hybridSearch(query: string, topK = 3): Promise<KBEntry[]> {
  return (await hybridSearchScored(query, topK)).map(s => s.entry);
}

export default { initRetrieval, hybridSearch, hybridSearchScored };

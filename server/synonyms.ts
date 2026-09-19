/**
 * 同义词映射表 - 扩展检索覆盖面
 * 支持工友常用术语、行业简称、英文缩写
 */

export const SYNONYM_MAP: Record<string, string[]> = {
  // 渗滤液
  '渗滤液': ['垃圾汤', '黑水', '渗沥液', 'leachate', '渗出液'],
  '垃圾汤': ['渗滤液'],
  '黑水': ['渗滤液'],
  '渗沥液': ['渗滤液'],
  
  // 甲烷
  '甲烷': ['CH4', '沼气', '瓦斯', 'methane'],
  'CH4': ['甲烷'],
  '沼气': ['甲烷', '填埋气'],
  '瓦斯': ['甲烷'],
  
  // 填埋气
  '填埋气': ['沼气', 'LFG', 'landfill gas', '填埋气体'],
  'LFG': ['填埋气'],
  
  // 边坡
  '边坡': ['斜坡', '坡面', '滑坡', 'slope', '边坡稳定性'],
  '滑坡': ['边坡失稳', '山体滑坡', '坡体滑动'],
  '斜坡': ['边坡'],
  
  // 防渗
  '防渗': ['衬垫', '衬里', 'HDPE膜', '防渗层', '防渗系统'],
  'HDPE膜': ['防渗膜', '土工膜', '高密度聚乙烯膜'],
  '衬垫': ['防渗', '衬里'],
  
  // 沉降
  '沉降': ['塌陷', '下沉', 'settlement', '地面沉降'],
  '塌陷': ['沉降', '地面塌陷'],
  '下沉': ['沉降'],
  
  // 稳定性
  '稳定': ['安全系数', 'Fs', 'stability', '边坡稳定'],
  'Fs': ['安全系数', '稳定系数'],
  '安全系数': ['Fs', '稳定系数'],
  
  // 渗滤液处理
  '渗滤液处理': ['污水处理', '渗滤液净化'],
  '反渗透': ['RO', '膜处理'],
  '纳滤': ['NF', '膜处理'],
  
  // 监测
  '监测': ['检测', '监控', '巡视'],
  '检测': ['监测', '化验'],
  
  // 填埋场
  '填埋场': ['垃圾场', '填埋区', '垃圾填埋场', '卫生填埋场'],
  '垃圾场': ['填埋场'],
  
  // 飞灰
  '飞灰': ['焚烧飞灰', '炉渣飞灰', '危废飞灰'],
  
  // 地下水
  '地下水': ['井水', '潜水', 'groundwater'],
  
  // 土壤
  '土壤': ['泥土', '地层', '土层'],
};

// 反向索引（小写，用于检索扩展）
export const SYNONYM_INDEX: Record<string, string> = {};

// 构建反向索引
Object.entries(SYNONYM_MAP).forEach(([canonical, synonyms]) => {
  // 规范词本身也加入索引
  SYNONYM_INDEX[canonical.toLowerCase()] = canonical;
  
  synonyms.forEach(synonym => {
    SYNONYM_INDEX[synonym.toLowerCase()] = canonical;
  });
});

/**
 * 扩展查询词 - 将用户输入的词扩展为包含同义词的查询
 * @param query 用户原始查询
 * @returns 扩展后的查询词数组
 */
export function expandQuery(query: string): string[] {
  const words = query.split(/[\s,，、。.]+/).filter(w => w.length > 0);
  const expanded = new Set<string>();
  
  words.forEach(word => {
    const lower = word.toLowerCase();
    // 添加原词
    expanded.add(word);
    
    // 查找规范词
    const canonical = SYNONYM_INDEX[lower];
    if (canonical) {
      expanded.add(canonical);
      // 添加规范词的所有同义词
      const synonyms = SYNONYM_MAP[canonical] || [];
      synonyms.forEach(s => expanded.add(s));
    }
    
    // 直接查找同义词映射
    const directSynonyms = SYNONYM_MAP[word] || [];
    directSynonyms.forEach(s => expanded.add(s));
  });
  
  return Array.from(expanded);
}

/**
 * 获取某个词的规范形式
 */
export function getCanonical(word: string): string | null {
  return SYNONYM_INDEX[word.toLowerCase()] || null;
}

/**
 * 基于子串扫描的同义词扩展 —— 专为工友口语化无空格输入设计。
 *
 * 与 expandQuery 的差异：
 *  - expandQuery 按空格/标点切词，对"垃圾汤太多排不出去"这种无空格整句
 *    会当成 1 个 word 去 SYNONYM_INDEX 查，结果 undefined，扩展失败。
 *  - expandQueryBySubstring 以 SYNONYM_MAP 的每个"集群"（canonical + 全部
 *    synonyms）为单位做子串扫描；只要其中任一成员出现在 query 中，就把这
 *    个集群的 canonical + 全部成员加入结果。
 *
 * @param query 用户原始查询（任意形式，可含标点、大小写混用）
 * @returns 扩展词列表（包含原 query 的单字 token + 同义词集），去重保序
 */
export function expandQueryBySubstring(query: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (w: string) => {
    if (!w) return;
    const k = w.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(w);
  };

  const qLower = query.toLowerCase();

  // 1) 保留原 query 自身的 token（单字 + 英文/数字词 + 整词），与 kb.ts 的 tokenize 兼容
  const cnRegex = /[一-龥]+/g;
  let m: RegExpExecArray | null;
  while ((m = cnRegex.exec(query)) !== null) {
    for (const ch of m[0]) push(ch);
  }
  const enRegex = /[a-z0-9]+/gi;
  while ((m = enRegex.exec(query)) !== null) push(m[0].toLowerCase());
  const wholeRegex = /[A-Z]+[\w./-]*|\d+[a-zA-Z%]+|[a-z]+_\w+/g;
  while ((m = wholeRegex.exec(query)) !== null) push(m[0].toLowerCase());

  // 2) 以 SYNONYM_MAP 的每个集群为单位做子串扫描（大小写不敏感）
  for (const [canonical, synonyms] of Object.entries(SYNONYM_MAP)) {
    const members = [canonical, ...synonyms];
    // 跳过单字成员（避免"土""水"等干扰）；只把长度 >=2 的成员当作判定锚点
    const hit = members.some(mb => mb.length >= 2 && qLower.includes(mb.toLowerCase()));
    if (!hit) continue;
    // 命中：把 canonical + 全部成员加入（canonical 优先）
    push(canonical);
    for (const s of synonyms) push(s);
  }

  return out;
}

// 仅在直接执行本文件时运行自检（`npx tsx server/synonyms.ts`），被 import 时不会触发
import { fileURLToPath } from 'url';
const isMain = process.argv[1] && (
  process.argv[1] === fileURLToPath(import.meta.url) ||
  process.argv[1].endsWith('server/synonyms.ts') ||
  process.argv[1].endsWith('server\\synonyms.ts')
);
if (isMain) {
  // eslint-disable-next-line no-console
  console.log('[synonyms] self-check:');
  const cases: { q: string; mustInclude: string[] }[] = [
    { q: '垃圾汤太多排不出去', mustInclude: ['渗滤液', '垃圾汤', '黑水', '渗沥液'] },
    { q: '瓦斯超标怎么办',     mustInclude: ['甲烷', '沼气', '瓦斯'] },
    { q: '斜坡要塌了',         mustInclude: ['边坡', '斜坡', '滑坡'] },
    { q: '黑水往外冒',         mustInclude: ['渗滤液', '黑水'] },
    { q: 'CH4泄漏',            mustInclude: ['甲烷', 'CH4'] },
    { q: 'NF膜堵了',           mustInclude: ['纳滤', 'NF'] },
    { q: 'RO产水率低',         mustInclude: ['反渗透', 'RO'] },
    { q: '正常问候语',         mustInclude: [] },
  ];
  let pass = 0;
  let fail = 0;
  for (const c of cases) {
    const got = expandQueryBySubstring(c.q);
    const lower = got.map(s => s.toLowerCase());
    const missing = c.mustInclude.filter(x => !lower.includes(x.toLowerCase()));
    if (missing.length === 0) {
      pass++;
      // eslint-disable-next-line no-console
      console.log(`  PASS  "${c.q}" -> ${got.length} 词`);
    } else {
      fail++;
      // eslint-disable-next-line no-console
      console.log(`  FAIL  "${c.q}" 缺: ${missing.join(', ')}; got: ${got.join(' / ')}`);
    }
  }
  // eslint-disable-next-line no-console
  console.log(`[synonyms] self-check done: ${pass} pass, ${fail} fail`);
  process.exit(fail === 0 ? 0 : 1);
}

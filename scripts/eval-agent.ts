import 'dotenv/config';
import { initRetrieval, hybridSearch } from '../server/retrieval.js';
import { detectCalcIntent, buildChatAugmentation } from '../server/augment.js';

const kbCases: { q: string; key: string }[] = [
  { q: '填埋场选址要满足哪些条件？', key: 'siteSelect' },
  { q: '填埋场防渗衬垫怎么选？HDPE膜多厚？', key: 'linerSystem' },
  { q: '填埋场渗滤液产量怎么估算？', key: 'leachateYield' },
  { q: '注气驱水的注气压力怎么定？', key: 'gasInjectionDewatering' },
  { q: '分段式循环抽注气参数是多少？', key: 'segmentedCyclicGas' },
  { q: '什么是气体短路？', key: 'gasShortCircuit' },
  { q: '注气井距怎么定？有效影响半径', key: 'effectiveRadius' },
  { q: '注气起泡怎么办？消泡剂怎么用？', key: 'defoamerGasSynergy' },
  { q: '填埋场恶臭厂界标准是多少？', key: 'odorModeling' },
  { q: '地下水循环井 GCW 是什么？', key: 'gcwWell' },
  { q: '高液位填埋场降水多少才能稳定？', key: 'stabilityCheck' },
  { q: '垃圾的双孔隙度持水特性是什么？', key: 'dualPorosityWRC' },
  { q: '主水位和滞水位有什么区别？', key: 'perchedWaterLevel' },
  { q: '复合衬垫等效渗透系数怎么验算？', key: 'linerSystem' },
  { q: '强曝气预处理的效果怎么样？', key: 'strongAeration' },
];

const calcCases: { q: string; name: string }[] = [
  { q: '边坡稳定安全系数怎么算？', name: 'slopeFs' },
  { q: '渗滤液产量怎么估算？', name: 'leachateCalc' },
  { q: 'HDPE 膜厚度与焊缝怎么验算？', name: 'hdpeCheck' },
  { q: '库容和使用年限怎么算？', name: 'capacity' },
  { q: '填埋气甲烷产量 LandGEM 怎么算？', name: 'lfgYield' },
];

const injectCases: { q: string; terms: string[] }[] = [
  { q: '填埋场选址条件', terms: ['GB 16889'] },
  { q: '渗滤液产量怎么估算', terms: ['CJJ 176'] },
  { q: '边坡稳定安全系数', terms: ['CJJ 176'] },
  { q: '恶臭厂界标准是多少', terms: ['GB 14554'] },
  { q: '注气驱水的注气压力', terms: ['kPa'] },
];

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) { pass++; console.log('  PASS ' + name + (detail ? ' | ' + detail : '')); }
  else { fail++; console.log('  FAIL ' + name + (detail ? ' | ' + detail : '')); }
};

async function main() {
  console.log('=== 混合检索初始化 ===');
  await initRetrieval();

  console.log('\n=== KB 检索 Top1 召回（≥12/15） ===');
  let kbHit = 0;
  for (const c of kbCases) {
    const top = await hybridSearch(c.q, 1);
    const hit = top[0]?.key === c.key;
    if (hit) kbHit++;
    else console.log('  miss:', c.q, '->', top[0]?.key ?? '(none)', 'expected', c.key);
  }
  check('KB recall', kbHit >= 12, kbHit + '/15');

  console.log('\n=== 计算器意图路由（5/5） ===');
  let calcHit = 0;
  for (const c of calcCases) {
    const d = detectCalcIntent(c.q);
    const hit = d?.name === c.name;
    if (hit) calcHit++;
    else console.log('  miss:', c.q, '->', d?.name ?? 'null', 'expected', c.name);
  }
  check('Calc intent', calcHit === 5, calcHit + '/5');

  console.log('\n=== 注入上下文含关键依据（≥4/5） ===');
  let injHit = 0;
  for (const c of injectCases) {
    const aug = await buildChatAugmentation(c.q);
    const hit = c.terms.every(t => aug.contextText.includes(t));
    if (hit) injHit++;
    else console.log('  miss:', c.q, '| context:', aug.contextText.slice(0, 120).replace(/\n/g, ' '));
  }
  check('Injection terms', injHit >= 4, injHit + '/5');

  console.log('\n=== 结果 ===');
  console.log('pass=' + pass + ' fail=' + fail);
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch(e => { console.error(e); process.exit(1); });

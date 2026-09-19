/**
 * multiagent-smoke.ts — 多智能体模块确定性自检（不依赖 LLM key）
 *
 * 用法：npx tsx scripts/multiagent-smoke.ts
 *
 * 只测**确定性层**（指标提取 / 阈值评级 / 交叉研判 / 缓存键），因此无需模型密钥即可跑，
 * 断言的是本次重构要根治的那批缺陷，防止回归：
 *   1. 红、绿两级可达（旧实现二值逻辑永远出不了）
 *   2. 领域等级与总工综合等级同源（旧实现两处各写一套阈值，会漂移）
 *   3. 地下水 Cl⁻ 等级不倒挂（旧：超背景 2 倍记 blue，低于未超时的 yellow）
 *   4. 两条 Fs 口径同源（旧：同一次运行 1.64 vs 0.68）
 *   5. 缺测的监测指标不被默认值冒充（旧：DEMO 形状的兜底值当实测呈现）
 *   6. 删掉场景里的裂缝描述 → 边坡卡片必须变（旧：卡片一行不变）
 *   7. 无实测数据时不伪装成中间等级（旧：失败落 'yellow'）
 *   8. 缓存键区分详细度（旧：切"详细"命中"摘要"缓存）
 */
import { extractIndicators } from '../server/indicators.js';
import { deriveDomainResult, DOMAIN_MAP, GRADE_RANK, GRADE_LABEL } from '../server/domains.js';
import type { MAGrade } from '../server/domains.js';
import { evaluateCross, overallGrade } from '../server/cross-analysis.js';
import { buildDomainCtx, extractSceneParams, agentCacheKey } from '../server/multiagent.js';
import { evaluateHazards, severityLabel, SEVERITY_RANK } from '../server/diagnose.js';
import * as calc from '../server/calculate.js';

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = ''): void {
  if (cond) { passed++; console.log(`✅ ${name}${detail ? ' — ' + detail : ''}`); }
  else { failed++; console.log(`❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

/** 取某领域的确定性结论 */
async function domainGrade(scenario: string, domain: string, explicit?: Record<string, unknown>) {
  const ind = await extractIndicators(scenario, explicit as any);
  const ctx = buildDomainCtx(scenario, ind);
  const spec = DOMAIN_MAP[domain];
  const d = deriveDomainResult(spec, ctx);
  return { grade: d.grade as MAGrade, hazards: d.hazards, confidence: d.confidence, ind, ctx };
}

async function main() {
  console.log('== 多智能体确定性自检 ==\n');

  // ---------- 1. 红/绿两级可达 ----------
  console.log('--- 1. 等级可达性（旧实现红/绿永不可达）---');
  // 危险工况：高堆、陡坡、水位极浅 → Fs 远低于 1.0
  const danger = await domainGrade(
    '某填埋场堆体高度 55m，坡角 38°，渗滤液水位上升 1.2m，堆体表面出现 4 条裂缝（最长 25m，宽 6cm）',
    'slope',
    { slopeGamma: 12, slopeC: 8, slopePhi: 30 },
  );
  check('危险工况 → 边坡判 red', danger.grade === 'red', `实得 ${danger.grade}（${GRADE_LABEL[danger.grade]}）`);

  // 优良工况：低堆、缓坡、深水位、全部指标实测且无隐患 → green
  const safe = await domainGrade(
    '某填埋场堆体高度 8m，坡角 12°，水位埋深 28m，沉降速率 1mm/月，无裂缝，稳定安全系数 2.4',
    'slope',
    { slopeGamma: 11, slopeC: 18, slopePhi: 36, crackLength: 0.2, crackWidth: 0.2, crackCount: 0, settlementRate: 1, stabilityFactor: 2.4 },
  );
  check('优良工况 → 边坡判 green（全实测+全达标）', safe.grade === 'green',
    `实得 ${safe.grade}（${GRADE_LABEL[safe.grade]}），置信度 ${safe.confidence}`);

  // ---------- 2. 两条 Fs 口径同源 ----------
  console.log('\n--- 2. 边坡 Fs 唯一口径（旧：同一次运行两个 Fs）---');
  const H = 25, angle = 30, w = 10, gamma = 11, c = 15, phi = 35;
  const beta = Math.round(1 / Math.tan(angle * Math.PI / 180) * 100) / 100;
  const kernelFs = Math.round(calc.stabilityDetail(H, angle, w, gamma, phi, c).Fs * 100) / 100;
  const calcFs = calc.slopeFs(H, beta, gamma, c, phi, w).value as number;
  check('计算中心口径 slopeFs 与隐患内核 stabilityDetail 同值', Math.abs(calcFs - kernelFs) < 0.011,
    `slopeFs=${calcFs}，内核=${kernelFs}（坡比 1:${beta} → 坡角 ${angle}°）`);

  // ---------- 3. 地下水等级不倒挂 ----------
  console.log('\n--- 3. 地下水 Cl⁻ 等级方向（旧：超背景反而降级）---');
  const gwHigh = await domainGrade('某填埋场下游监测井氯离子浓度从 50mg/L 升至 300mg/L', 'gw');
  const gwLow = await domainGrade('某填埋场下游监测井氯离子浓度从 50mg/L 升至 60mg/L', 'gw');
  check('Cl⁻ 300mg/L（超 III 类限值 250）等级高于 Cl⁻ 60mg/L',
    GRADE_RANK[gwHigh.grade] > GRADE_RANK[gwLow.grade],
    `300→${gwHigh.grade}（${GRADE_LABEL[gwHigh.grade]}） / 60→${gwLow.grade}（${GRADE_LABEL[gwLow.grade]}）`);

  // ---------- 4. 缺测不被冒充 ----------
  console.log('\n--- 4. 缺测语义（旧：崩落 DEMO 形状的默认值当实测）---');
  const noCrack = await extractIndicators('某填埋场渗滤液水位上升 0.8m，甲烷浓度 35% LEL');
  check('未提及裂缝 → 实测集里没有裂缝指标', !noCrack.measured.some(m => m.key.startsWith('crack')),
    `实测项：${noCrack.measured.map(m => m.label).join('、') || '（无）'}`);
  check('未提及裂缝 → 出现在 missing 提示里', noCrack.missing.includes('最长裂缝长度'));
  check('未提及氯离子 → 出现在 missing 提示里', noCrack.missing.includes('Cl⁻ 实测浓度'));
  const ch4 = noCrack.measured.find(m => m.key === 'ch4');
  check('35% LEL 归一化为 1.75 %vol', Math.abs((ch4?.value ?? 0) - 1.75) < 0.001,
    `ch4=${ch4?.value} ${ch4?.unit}；口径说明：${ch4?.note ?? '（无）'}`);

  // ---------- 5. 删掉裂缝句 → 边坡卡片必须变 ----------
  console.log('\n--- 5. 场景变化必须反映到卡片（旧：改场景重跑卡片不动）---');
  // 用"稳定工况"作对照：此时 Fs 不主导评级，裂缝才是指标差异的唯一来源
  const stableBase = '某填埋场堆体高度 8m，坡角 12°，水位埋深 28m，沉降速率 1mm/月';
  const withCrack = await domainGrade(`${stableBase}，堆体表面出现 3 条裂缝（最长 12m，宽 3cm）`, 'slope');
  const withoutCrack = await domainGrade(stableBase, 'slope');
  const crackHazard = (r: Awaited<ReturnType<typeof domainGrade>>) => r.hazards.some(h => h.type === '堆体表面裂缝');
  check('含裂缝描述 → 命中「堆体表面裂缝」隐患', crackHazard(withCrack),
    withCrack.hazards.map(h => `${h.type}=${h.severity}`).join('、'));
  check('删掉裂缝描述 → 不再命中该隐患', !crackHazard(withoutCrack));
  check('删掉裂缝描述 → 边坡等级随之变化', withCrack.grade !== withoutCrack.grade,
    `含裂缝=${withCrack.grade}（${GRADE_LABEL[withCrack.grade]}） / 不含=${withoutCrack.grade}（${GRADE_LABEL[withoutCrack.grade]}）`);
  // 注：DEMO 场景（H=25m/β=30°）下 Fs 本身已判 red，删裂缝句只会改变隐患列表、不改等级 —— 属正常

  // ---------- 6. 领域等级与综合等级同源 ----------
  console.log('\n--- 6. 综合等级与领域等级一致（旧：总工用正则重算，与卡片打架）---');
  const demo = '某填埋场运营 15 年，近期监测发现渗滤液水位上升 0.8m，周边 200m 处地下水氯离子浓度从 50mg/L 升至 280mg/L，堆体表面出现 3 条裂缝（最长 12m，宽 3cm），甲烷浓度 35% LEL。';
  const dm = await extractIndicators(demo, { height: 25, slopeAngle: 30, waterLevelDepth: 10 } as any);
  const dctx = buildDomainCtx(demo, dm);
  const findings: Record<string, any> = {};
  for (const id of ['slope', 'leachate', 'lfg', 'gw']) {
    const d = deriveDomainResult(DOMAIN_MAP[id], dctx);
    findings[id] = { domain: id, name: DOMAIN_MAP[id].name, grade: d.grade, confidence: d.confidence, hazards: d.hazards, evidence: [], indicators: [], missing: [], keyFinding: '', result: '' };
  }
  const cross = evaluateCross(findings, dctx.site);
  const ov = overallGrade(findings, cross);
  const domainGrades = (['slope', 'leachate', 'lfg', 'gw'] as const).map(k => findings[k].grade as MAGrade);
  const measuredDomains = domainGrades.filter(g => g !== 'unknown');
  const worstDomain = measuredDomains.reduce((a, b) => (GRADE_RANK[a] >= GRADE_RANK[b] ? a : b), 'green' as MAGrade);
  // 综合等级要么等于领域最重者，要么由某条交叉研判规则正当地抬高（不能无中生有）
  const justifiedByCross = cross.some(c => GRADE_RANK[c.severity] >= GRADE_RANK[ov.grade]);
  check('综合等级 = 领域最重者，或由交叉研判正当抬高',
    ov.grade === worstDomain || justifiedByCross,
    `综合=${ov.grade}（${GRADE_LABEL[ov.grade]}），领域最重=${worstDomain}（${GRADE_LABEL[worstDomain]}）`);
  check('综合等级不使用 unknown 以外的兜底值', ov.grade !== ('yellow' as MAGrade) || worstDomain === 'yellow' || cross.some(c => c.severity === 'yellow'));
  console.log(`   各领域：${(['slope', 'leachate', 'lfg', 'gw'] as const).map(k => `${DOMAIN_MAP[k].name}=${findings[k].grade}`).join(' ｜ ')}`);
  console.log(`   交叉研判命中：${cross.length ? cross.map(c => `${c.title}(${c.severity})`).join('；') : '（无）'}`);

  // ---------- 7. 无数据不伪装 ----------
  console.log('\n--- 7. 数据不足不伪装成中间等级（旧：失败落 yellow）---');
  const empty = await extractIndicators('这个填埋场情况怎么样？');
  const ectx = buildDomainCtx('这个填埋场情况怎么样？', empty);
  const emptyGrades = (['slope', 'leachate', 'lfg', 'gw'] as const).map(id => deriveDomainResult(DOMAIN_MAP[id], ectx).grade);
  check('无任何实测数值 → 四个领域均为 unknown', emptyGrades.every(g => g === 'unknown'),
    `实得：${emptyGrades.join('、')}`);
  check('无实测时 evaluateHazards 不产出隐患', evaluateHazards(ectx.site).length === 0,
    `隐患数=${evaluateHazards(ectx.site).length}`);

  // ---------- 8. 缓存键区分详细度 ----------
  console.log('\n--- 8. 缓存键（旧：漏 detail，切详细命中摘要）---');
  const k1 = agentCacheKey('slope', 'scenario-A', { height: 25, slopeAngle: 30, waterLevelDepth: 10 }, 'brief');
  const k2 = agentCacheKey('slope', 'scenario-A', { height: 25, slopeAngle: 30, waterLevelDepth: 10 }, 'detailed');
  check('不同详细度 → 不同缓存键', k1 !== k2, `brief=${k1.slice(0, 40)}… / detailed=${k2.slice(0, 40)}…`);

  // ---------- 9. 阈值口径唯一 ----------
  console.log('\n--- 9. 阈值单一来源 ---');
  const gwHazards = evaluateHazards({ clConcentration: 300, clBackground: 50 });
  const gwH = gwHazards.find(h => h.type === '地下水 Cl⁻ 污染');
  check('Cl⁻ 300mg/L 判为较大风险（diagnose 口径 cl>250→orange）',
    gwH?.severity === 'orange', `实得 ${gwH?.severity}（${gwH ? severityLabel(gwH.severity) : '—'}）`);
  check('SEVERITY_RANK 顺序正确（blue<yellow<orange<red）',
    SEVERITY_RANK.blue < SEVERITY_RANK.yellow && SEVERITY_RANK.yellow < SEVERITY_RANK.orange && SEVERITY_RANK.orange < SEVERITY_RANK.red);

  // ---------- 10. extractSceneParams 契约未变 ----------
  console.log('\n--- 10. 对外契约（/api/multiagent 依赖）---');
  const p = await extractSceneParams(demo, { height: 40, slopeAngle: 25, waterLevelDepth: 6 });
  check('extractSceneParams 仍返回三个边坡参数', typeof p.height === 'number' && typeof p.slopeAngle === 'number' && typeof p.waterLevelDepth === 'number',
    `H=${p.height} β=${p.slopeAngle} 埋深=${p.waterLevelDepth}`);
  check('表单显式参数优先于场景文本', p.height === 40 && p.slopeAngle === 25 && p.waterLevelDepth === 6);

  console.log(`\n${failed === 0 ? '✅ 全部通过' : `❌ ${failed} 项失败`}（通过 ${passed} / 共 ${passed + failed}）`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error('自检异常：', e); process.exit(1); });

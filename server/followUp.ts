/**
 * 追问引导 - 检测缺失参数并引导用户提供
 */

import type { SiteData } from './diagnose.js';

interface FollowUpGuide {
  trigger: RegExp;
  requiredParams: (keyof SiteData)[];
  paramDescriptions: Record<string, string>;
  question: string;
  nextStep: string;
}

export const FOLLOW_UP_GUIDES: FollowUpGuide[] = [
  {
    trigger: /边坡|稳定|Fs|安全系数/,
    requiredParams: ['slopeAngle', 'slopeGamma', 'slopeC', 'slopePhi'],
    paramDescriptions: {
      slopeAngle: '坡角(度)',
      slopeGamma: '土体重度(kN/m3)',
      slopeC: '黏聚力(kPa)',
      slopePhi: '内摩擦角(度)',
    },
    question: '要计算边坡安全系数需要: ①坡角 ②土体重度 ③黏聚力 ④内摩擦角',
    nextStep: '收到参数后用简化 Bishop 法计算 Fs。',
  },
  {
    trigger: /渗滤液|液位|导排|涌水量/,
    requiredParams: ['leachateLevel', 'pumpRate', 'rainfall', 'landfillArea'],
    paramDescriptions: {
      leachateLevel: '渗滤液液位(m)',
      pumpRate: '抽排能力(m3/d)',
      rainfall: '年降雨量(mm)',
      landfillArea: '填埋面积(m2)',
    },
    question: '渗滤液分析需要: ①液位 ②抽排能力 ③年降雨量 ④填埋面积',
    nextStep: '用涌水量公式计算并评估调节池。',
  },
  {
    trigger: /沉降|settlement|变形/,
    requiredParams: ['settlementRate', 'landfillHeight', 'landfillAge'],
    paramDescriptions: {
      settlementRate: '沉降速率(mm/月)',
      landfillHeight: '堆体高度(m)',
      landfillAge: '填埋龄期(年)',
    },
    question: '沉降预测需要: ①沉降速率 ②堆体高度 ③填埋龄期',
    nextStep: '用双曲线法预测最终沉降。',
  },
  {
    trigger: /甲烷|CH4|沼气|气体/,
    requiredParams: ['ch4', 'wellCount', 'injectionRate'],
    paramDescriptions: {
      ch4: '甲烷浓度(%)',
      wellCount: '抽气井数量',
      injectionRate: '抽气速率(Nm3/h)',
    },
    question: '甲烷分析需要: ①浓度 ②抽气井数 ③抽气速率',
    nextStep: '评估甲烷等级和气体收集效率。',
  },
];

export function generateFollowUp(query: string, existingData: Partial<SiteData> = {}): string | null {
  for (const guide of FOLLOW_UP_GUIDES) {
    if (guide.trigger.test(query)) {
      const missingParams = guide.requiredParams.filter(
        (param) => existingData[param] === undefined || existingData[param] === null,
      );
      if (missingParams.length > 0) {
        const missingDesc = missingParams
          .map((p) => guide.paramDescriptions[p])
          .join('、');
        return guide.question + ' | 缺失参数: ' + missingDesc + ' | ' + guide.nextStep;
      }
    }
  }
  return null;
}

export function getRequiredParams(query: string): string[] {
  for (const guide of FOLLOW_UP_GUIDES) {
    if (guide.trigger.test(query)) {
      return guide.requiredParams as string[];
    }
  }
  return [];
}

/**
 * LandfillMind 知识库扩充 · 国际标准指南与英文经典批（intl5）
 * 追加 14 条 KB 条目（m6 填埋场 12 条 + m62 地下水 2 条）
 *
 * 覆盖范围：
 *   - 美国：40 CFR 258 Subpart E 地下水监测统计方法、Subpart F 封场后期 30 年、
 *     EPA 空气规则（NSPS XXX / EG Cf / NESHAP AAAA）、LandGEM/HELP/WARM 工具体系、
 *     MNA 指南链、ASTM 防渗与焊缝质检标准族、填埋模拟器与 D5526
 *   - 欧盟：1999/31/EC 填埋指令与 (EU) 2018/850 分阶段目标、WT BREF 与新 LAN BREF、
 *     EU 甲烷战略与 (EU) 2024/1787 对填埋的排除
 *   - 英国：LFTGN07 表面排放监测、SEPA/EP165 痕量组分监测
 *   - IPCC 2006 Vol.5 Ch.3 SWD 模型因子表；世行 What a Waste / UNEP GWMO 全球口径
 *   - 经典英文手册查阅导航、顶级期刊与会议导航、日韩新亚洲管理要点
 *
 * 命名约定：key 前缀 intl5-，去重由 server/kb.ts 合并逻辑保证。
 * 来源见 knowledge-base/08-references/raw/intl.json（intl5-001 ~ intl5-077）。
 */

import type { KBEntry } from '@server/kb';

export const EXPANDED_KB_INTL: KBEntry[] = [
  /* ============ m62 地下水 2 条 ============ */
  {
    key: 'intl5-us-gw-statistical',
    module: 'm62',
    kw: ['40 CFR 258', 'Subpart E', '检测监测', '评价监测', 'action level', '统计方法', '假阳性', '删失数据', '地下水'],
    q: '美国填埋场地下水监测怎么用统计学方法判定污染？EQL 是什么？',
    pro: '先纠误：地下水监测在 40 CFR Part 258 的 Subpart E（不在 Subpart D，Subpart D 是设计准则），且法规中不存在「EQL」一词，触发指标的正式术语是 action level（§258.54/258.55）。框架：①检测监测 §258.54——对 §258.51 定义的监测井至少半年取样一次（州批准可用替代频率），用统计法把每口井结果与 action level / 背景值比较；②统计方法五项强制要求：与数据分布适配、控制单井与全场地假阳性错误率、正确处理低于检出限的删失数据、考虑参数天然变异等；配套 EPA《RCRA 设施地下水数据统计分析》统一指南给出 11 步流程与五类正式检验（修正 t 检验等）＋Shapiro-Wilk 正规性检验选择树；③任一口井超标→转入 §258.55 评价监测（加密指标与频率）→确认释放后启动纠正措施并做污染物迁移表征。与中国 GB 16889 只给限值、不规定统计检验法相比，美国口径的核心是「先定统计计划再谈超标」。',
    easy: '美国看填埋场地下水有没有被污染，不是拿一个数一比了之：先规定好用哪种统计检验、允许多大的误报概率，半年测一次， statistically 判定超标后才升级成加密排查和治理。',
    cite: '40 CFR 258.51/258.54/258.55 / EPA RCRA 统计统一指南 (NEPIS P10055GQ)',
    clause: '统计方法须与数据分布适配、控制假阳性率并处理未检出数据；触发概念为 action level，无 EQL 术语。',
    related: ['kb4-gw-monitoring-freq', 'gw-monitoring-freq', 'intl5-us-postclosure', 'kb4-sentinel-wells'],
  },
  {
    key: 'intl5-us-mna-guidance',
    module: 'm62',
    kw: ['监测自然衰减', 'MNA', 'OSWER 9200.4-17P', '重金属', '无机物', '决策框架', '填埋场地下水', '美国'],
    q: '国外怎么用监测自然衰减处理填埋场地下水污染？金属类能用吗？',
    pro: '美国 MNA 依据链：①OSWER 指令 9200.4-17P（1999《超级基金、RCRA 纠正行动与地下储罐场地 MNA 使用》）确立三前提——污染源已控制、设长期监测、有可核查的修复终点；MNA 可作主修复或配合泵抽/渗透反应墙的补救措施；②EPA/600/R-12/712《MNA 场地表征框架》给出水文地质-地球化学分带与衰减过程证据设计；③对填埋场典型的氨氮、重金属羽流须按《地下水中无机污染物 MNA》三卷系列与 ITRC 金属/放射性核素决策框架（2010）：金属不被降解，只能靠吸附/共沉淀「固定」，论证重点改为还原/碱性地球化学屏障稳定性与通量监测，并预留地球化学条件反转（如 pH 下降、氧化还原抬升）的应急预案；④填埋场场地调查程序母版是 1989 年 RCRA 场地调查指南（RFI）Vol.II（土壤/地下水/包气带气）。与既有 mna 条目相比，本条补「有机物可降解、金属只能固定」的选型红线与文件号。',
    easy: '让地下水自己「自愈」在美国是有正规流程的：先断污染源、长期盯着、说清什么时候算修好。但重金属降解不了，只能靠土壤把它「锁住」，锁的条件一变就可能再跑出来，所以要额外盯酸碱度和氧化环境。',
    cite: 'OSWER 9200.4-17P (1999) / EPA-600-R-12-712 (2012) / ITRC 金属 MNA 框架 (2010)',
    clause: 'MNA 三前提：源控制、持续监测、明确终点；无机物场地按地球化学固定而非降解论证。',
    related: ['mna', 'kb4-gw-mna', 'gw-natural-attenuation', 'intl5-us-gw-statistical'],
  },
  /* ============ m6 填埋场 12 条 ============ */
  {
    key: 'intl5-us-postclosure-30y',
    module: 'm6',
    kw: ['封场', '后期管护', '30年', 'Subpart F', '最终覆盖', '258.60', '258.61', '美国', '对照'],
    q: '美国填埋场封场后要管多少年？和中国 30 年规定一样吗？',
    pro: '美国 40 CFR Part 258 Subpart F：①§258.60 封场准则——所有 MSWLF 单元须建最终覆盖系统以最小化入渗与侵蚀，覆盖层渗透率不得高于底部衬层（§258.60(a)(1) 口径），最后一点填埋垃圾进场后 30 天内必须启动封场；②§258.61 后期管护——封场后强制管护 30 年（覆盖维护、地下水检测监测、气体与水位监测、记录保存），经批准的州负责人可缩短或延长；适用对象为 1993-10-09 之后接收废物的单元；③ITRC《MSW 填埋场后期管护的评估-优化-终止》给出 30 年内提前退出论证方法（数据充分性＋残余风险）。对照 GB 16889：中国同样要求封场后维护管理期不少于 30 年，两国口径一致；差异在程序——美国把「缩短/延长」交由州批准并需统计证据，且把 30 年管护与 Subpart E 地下水纠正措施衔接成闭环。',
    easy: '中美两国都是封场后至少再管 30 年。美国多一层灵活性：州监管方可以批准提前结束或延长，但前提是要拿出监测数据证明没有风险了。',
    cite: '40 CFR 258.60/258.61 / GB 16889-2024（后管期对照） / ITRC MSW 后管护指南',
    clause: 'Post-closure care must be conducted for 30 years, except as…（§258.61 原文句头，州可批缩短或延长）；封场于末次填埋后 30 日内启动。',
    related: ['post-closure-30-years', 'closureLTM', 'ltm', 'finalCover', 'intl5-us-gw-statistical'],
  },
  {
    key: 'intl5-us-air-gccs',
    module: 'm6',
    kw: ['填埋气收集', 'GCCS', 'NSPS XXX', 'EG Cf', 'NESHAP AAAA', 'NMOC', '甲烷控制', '美国空气规则'],
    q: '美国填埋场什么条件下必须强制收集处理填埋气？控制指标是多少？',
    pro: '美国联邦空气三规则并行：①NSPS 40 CFR 60 Subpart XXX（2014 建立、2016 强化）管新建场，EG Subpart Cf（2016）管现有场，NESHAP 40 CFR 63 Subpart AAAA 管控 HAP；②适用门槛：设计容量≥2.5 百万 Mg 或 2.5 百万 m³ 的填埋场，NMOC 产生率超阈值触发强制收集与控制系统（GCCS）——2016 年修订把触发阈值由 50 Mg/yr 降到 34 Mg/yr（约 34 公吨/年非甲烷有机物）；③收集气体处置四选一：NMOC 去除 98%（重量）、排放口 NMOC≤20 ppmv（以甲烷计、含环境本底口径）、≤50 ppmv，或甲烷减排 50%（重量），或燃烧/并网利用达同等效率；④主动收集井周边须按规程监测负压/浓度防无组织逃逸。对照 GB 16889：中国以填龄+耗氧速率等设定收集时点，美国以 NMOC 产率绝对值为触发，量化口径不同但思路一致——「产气超阈值必须点火」，且美国 2024-25 年曾暂缓复审阈值，规则仍有效。',
    easy: '在美国，垃圾填埋场产气达到一定规模（每年约 34 吨非甲烷有机物）就必须装井抽气并烧掉或发电，处理效率要求把九成八以上的有机物烧干净。',
    cite: '40 CFR 60 Subpart XXX / 60 Subpart Cf (81 FR, 2016-08-29) / 63 Subpart AAAA / FR 2014-16405',
    clause: 'GCCS 触发阈值由 50 Mg/yr NMOC 降至 34 Mg/yr；收集气处理须达 98% NMOC 去除等四替代指标之一。',
    related: ['lfg-flare-operation', 'landfillGas', 'kb4-lfg-landgem', 'lfg-methane-limits', 'intl5-epa-models'],
  },
  {
    key: 'intl5-epa-models',
    module: 'm6',
    kw: ['LandGEM', 'HELP', 'WARM', 'LMOP', '排放估算', '工具选型', '一阶衰减', 'AP-42'],
    q: '美国 EPA 那套填埋场模型工具（LandGEM、HELP、WARM）各管什么？版本多少？',
    pro: 'EPA 填埋工具族按问题选型：①产气量→LandGEM（一阶衰减模型，输出总气/CH4/CO2/NMOC/热值时序；当前 v3.1，2024 发布 2025-01 更新，AP-42 清单模式下 k、L0 默认值改按 GHGRP 实测反推；文献默认常引 2005 年 v3.02；注意：网传「LandGEM 10.2」不存在，「APEEN」查无此工具）；②覆盖系统水量平衡与入渗量→HELP（估算径流/蒸腾/渗漏，封场水文设计与存量渗滤液削减论证）；③全生命周期政策比选（减量/回收/焚烧/填埋谁碳排低）→WARM（约 26 类物料，v16 已改在线模板，对焚烧 vs 填埋的口径长期有争议）；④项目开发与筛查→LMOP 工具清单与 LFG Project Screening Tool；⑤排放因子总集→AP-42 §2.4（2025-05 大更新，与 LandGEM 3.1 同源）。工程实务链：LandGEM 定规模→LFG-PDS/筛选定利用方式→HELP 核覆盖入渗→WARM/温室气体清单做碳核算。',
    easy: 'EPA 的工具各管一摊：LandGEM 算将来能产多少气，HELP 算封面会不会漏雨水进去，WARM 比较「填埋还是焚烧」哪个碳排低，LMOP 帮你判断沼气发电划不划算。',
    cite: 'epa.gov/land-research（LandGEM 3.1 / HELP） / epa.gov/waste-reduction-model（WARM v16） / epa.gov/lmop 工具清单',
    clause: 'LandGEM 为基于一阶放射性衰变方程的排放估算模型；v3.1 起默认参数与 GHGRP 实测对齐。',
    related: ['kb4-lfg-landgem', 'lfg-landgem-model', 'landfillGas', 'leachateYield', 'carbonMethane', 'intl5-us-air-gccs'],
  },
  {
    key: 'intl5-eu-landfill-targets',
    module: 'm6',
    kw: ['填埋指令', '1999/31/EC', '2018/850', '可生物降解废物', 'BMW', '2035', '10%', '欧盟', '减量目标'],
    q: '欧盟填埋指令对填埋量有什么分阶段目标？生物废物怎么处理？',
    pro: '欧盟 Council Directive 1999/31/EC 及其修正案 (EU) 2018/850 的双轨目标体系（先纠误：修订填埋指令的是 2018/850，不是任务书所记 2018/982——982 是饲料添加剂条例）：①第 5(2) 条 BMW 阶梯——以 1995 年为基准，2006/2009/2016 年可生物降解城市废物填埋量分别降至 ≤75%/50%/35%；1995 年填埋占比超 80% 的成员国每档可延最多 4 年（故末档落在 2020 年，网传「2020 年 25%」无依据，25% 是 2014 年欧委会提案未采纳值）；②2018/850 新增第 5(1)(b) 条——2035 年城市废物填埋量 ≤ 产生量的 10%（按重量），并要求成员国用填埋税等经济手段（Art.10a）；2025-01-01 起适合回收或利用的废物禁止进填埋场；③配套监测：附件 III/IV 规定废水、气体、浸出液与地下水的许可监测点与控制程序；生物废物另受《废物框架指令》家庭堆肥/分类收集条款约束。对中国参考：填埋占比 10% 红线＋可降解废物分流是欧洲路径的终点画像。',
    easy: '欧洲用近 30 年把垃圾埋掉的比例一路压下来：先压可腐烂的垃圾（2016 年起只剩 1995 年的三分之一），再规定 2035 年所有城市垃圾最多埋 10%。能回收利用的根本不许埋。',
    cite: 'Directive 1999/31/EC Art.5 / Directive (EU) 2018/850（EUR-Lex 合并版 31999L0031-20240804）',
    clause: '2035 年城市废物填埋量≤产生量 10%（重量口径）；2025 年起适宜回收利用的废物禁止填埋。',
    related: ['reg-gb-16889', 'intl5-eu-bref-methane', 'compliance-cleaner-production', 'intl5-global-baseline'],
  },
  {
    key: 'intl5-eu-bref-methane',
    module: 'm6',
    kw: ['BREF', 'BAT', 'WT BREF', 'LAN BREF', '甲烷条例', '2024/1787', 'IED', '欧盟许可', '填埋'],
    q: '欧盟对填埋场的最佳可行技术（BAT）和甲烷新规管不管填埋？',
    pro: '欧盟对填埋的两条监管线：①IED 许可线——废物处理行业 BAT 参考文件 WT BREF（2018, JRC113018）覆盖 MBT/堆肥/厌氧消化但明确不含填埋；填埋专属的 LAN BREF 由 JRC-EU-BRITE 于 2024-11-22 启动起草（方法论报告 2025-10 发布），范围含建设/运行/封场/后管、有组织和无组织排放、甲烷收集、渗滤液与恶臭，未来将以 BAT 结论形式约束成员国许可条件——目前填埋许可仍主要落在 1999/31/EC 附件与各国转化法；②甲烷线——欧盟甲烷战略（2021）落地的 Regulation (EU) 2024/1787 只管油气煤部门，填埋与污水被明确排除（任务书所记 2024/1791 不存在）；因此填埋甲烷义务仍走填埋指令（气体收集、火炬/利用）与 ETS 扩围讨论路径，研究（Prognos/CATF）指认此为最大监管缺口。另注意：UNFCCC 层面 2024 年起国家清单用统一报告格式 CRF 报废弃物部门，欧盟内部报告走治理条例 (EU) 2018/1999——任务书所称「CRF 废弃物部门报告要求」应作此解。',
    easy: '欧洲管填埋有两套：一套是许可证制度，专门针对填埋的 BAT 文件正在写（2024 年启动）；另一套是 2024 年出的甲烷法规，但它只管油气煤，填埋场的甲烷还得按老的填埋指令管——这是个公认的漏洞。',
    cite: 'WT BREF JRC113018 (2018) / Commission Decision (EU) 2018/1147 / Regulation (EU) 2024/1787 / EU-BRITE LAN BREF news 144/154',
    clause: 'Reg. 2024/1787 适用能源部门（油/气/煤），填埋与废水不在其内；LAN BREF 起草中（kickoff 2025-10）。',
    related: ['intl5-eu-landfill-targets', 'lfg-flare-operation', 'carbonCredit', 'intl5-uk-lfg-monitoring'],
  },
  {
    key: 'intl5-uk-lfg-monitoring',
    module: 'm6',
    kw: ['填埋气监测', 'LFTGN', 'EP165', '痕量组分', '表面排放', '英国', 'EA', 'SEPA', '硅氧烷'],
    q: '英国填埋气怎么监测？表面排放和痕量组分有什么专门指南？',
    pro: '英国（英格兰+苏格兰）填埋气监测指南族——先纠误：任务书所称「EA GBR 填埋许可指南」中 GBR 实为通用约束规则（General Binding Rules）的缩写，填埋气专门指南编号是 LFTGN 与 EP165 系列：①gov.uk「Manage landfill gas」许可主页规定产气潜力评估、收集设计与许可条件框架；②LFTGN07《填埋气表面排放监测》：网格化通量法测场区/边界逸散，定报警与行动阈值（另有 LFTGN05 封闭火炬监测）；③SEPA/EA《填埋气痕量组分监测指南》（EP165 系列）：针对硅氧烷、卤代烃、硫化物等设备损伤与健康关注组分给出取样分析方法，并配 EP165 Part 1 发动机气体处理技术与发动机排放监测指南；④科学基座为 Allen, Braithwaite & Hills (1997, ES&T 31(4):1054) 对 7 座英国场鉴定出 >140 种痕量有机物；经典 DoE 文件 WMP No.27《Landfill Gas》（1990s HMSO）为历史源头（Ehrig & Niswander 1993 未能独立检索到，其信息链见 Allen 1997 参考文献）。用途：沼气并网/发动机前端的净化设计（脱硅、脱 H2S、VOC）以痕量组分为控制对象，与国标按浓度限值管排放的口径互补。',
    easy: '英国管填埋气很细：不光测甲烷流量，还要在场地上铺网格测表面漏气，并专门监测上百种「痕量杂质」（硅、硫、卤代物），因为这些会损坏发动机、影响并网和气味。',
    cite: 'LFTGN07 (EA) / SEPA EP165 trace components / Allen et al. (1997) ES&T 31(4):1054–1061',
    clause: '痕量组分监测以设备保护与健康/气味显著物质为导向；表面排放按网格通量法并设行动阈值。',
    related: ['lfg-fence-line-monitoring', 'mon-methane-detector', 'lfg-upgrading-cng', 'odorControl', 'intl5-eu-bref-methane'],
  },
  {
    key: 'intl5-ipcc-swd-model',
    module: 'm6',
    kw: ['IPCC', 'SWDS', '一阶衰减', 'DOC', 'DOCf', 'MCF', '甲烷修正因子', '氧化因子', '清单'],
    q: 'IPCC 算填埋场甲烷排放要用哪些参数？各类填埋场的 MCF 取多少？',
    pro: 'IPCC 2006 指南第 5 卷第 3 章（Solid Waste Disposal Sites，2019 修订沿用并更新因子）的 FOD 方法核心参数链：CH4 排放 = MSWDC × DOC × DOCf × MCF × 16/12 − R。①MSWDC：城市固废中可降解有机碳量；②DOC：分废物流的可降解有机碳含量（Table 3.2/3.3，厨余/园林/纸类高，建筑木质素类低，C&D 默认约 3% 湿重口径）；③DOCf：可分解比例（管理深埋默认 0.5）；④MCF 甲烷修正因子（=厌氧处理份额，Table 3.1 默认值，已核）：管理型深填埋 1.0；管理型浅埋 0.4；浅Dump 0.4；深Dump 0.8；半好氧填埋 0.5；工程好氧 0.0；⑤氧化因子（Table 3.4）：无组织深 Dump 覆盖层氧化默认 0.1，管理填埋无气回收时取 0；⑥R：收集利用/焚烧销毁量。注意：MCF 默认值已有实证再校（Kim et al. 2023, Waste Management），国家清单 Tier 1 直用默认值会系统性偏差；LandGEM 的 k/L0 与本模型的 DOC/DOCf 不通用，报告口径须分标注。',
    easy: 'IPCC 算填埋甲烷是一条乘法链：埋进去多少可烂的碳 × 能烂掉多少 × 有多少是在缺氧环境下烂的（MCF）× 变成的甲烷有多少被封面土吃掉了（氧化因子），最后减去你抽走烧掉的。',
    cite: 'IPCC 2006 GL Vol.5 Ch.3 §3.2.3（Table 3.1–3.4） / 2019 Refinement / GreenCalculus 因子表',
    clause: 'MCF 默认：管理深埋 1.0/浅埋 0.4/半好氧 0.5/深dump 0.8/工程好氧 0.0；氧化因子默认 0.1（无组织 dump）。',
    related: ['landfillGas', 'carbonMethane', 'decay', 'kb4-lfg-landgem', 'intl5-global-baseline'],
  },
  {
    key: 'intl5-astm-liner-qc',
    module: 'm6',
    kw: ['ASTM', '土工膜', '焊缝质检', 'D6392', 'D7177', 'D8265', 'GRI-GM13', 'HDPE', '防渗', 'CQA'],
    q: '填埋场防渗膜的 ASTM 标准体系怎么查？焊缝现场质检用哪个标准？',
    pro: '按「产品—现场—检漏」三层查 ASTM（先纠误：D5885 是高压氧化诱导时间 HP-OIT 不是褶皱试验，褶皱无独立 ASTM 标准靠铺设 CQA 控制；D4439 是术语标准不是 GCL 产品标准）：①产品/术语层——D4439-25a 土工合成材料术语母标准；GRI-GM13 HDPE 膜产品规范（树脂、碳黑、OIT D3895/D5885、抗应力开裂 D5397 NCTL）；GCL 性能与验证方法族见 GRI-GM13 与 EPA 2011《Geosynthetic Clay Liners Used in MSW Landfills》报告（nepis P100OA89）；②焊缝现场质检——非加筋膜（HDPE/PVC/TPO 双焊缝）破坏性剪-拉试验按 D6392（给出剪切/剥离强度、伸长与破坏模式判定：粘结失效/膜撕裂/焊边断裂）；加筋膜用 D7747；PVC 双道焊缝无损空气通道检验按 D7177（全长 100% 连续性检验；HDPE 楔形焊不适用该法）；③检漏——D8265 已铺膜电法定位漏点成图（2023 版），配套 D6747 裸露膜电场法、D7909 人工漏点验证；④实验室模拟填埋降解评估另见 D5526（受控厌氧固体条件下降解塑料，即填埋模拟试验方法族）。「填埋模拟器（landfill simulator/LSR）」是文献中的试验装置概念（如 Waste Management 2026 丹麦 LSR 曝气研究），不存在名为 Landfill Simulator 的 JRC 官方导则（已纠）。',
    easy: '防渗膜验收分三步：买膜看 GRI-GM13 指标，现场焊完接口要「充气试漏＋剪切剥离拉拔」，铺完膜再通电找漏点。对应 ASTM 号查错比查不到还麻烦——D5885 是抗氧化测试，不是褶皱测试。',
    cite: 'ASTM D4439-25a / D6392-23 / D7747 / D7177 / D8265-23 / D5885 / D5526-18 / GRI-GM13',
    clause: 'D6392 规定非加筋膜焊缝剪-拉破坏检验与失效模式判定；D7177 空气通道法仅适用于 PVC 双道焊缝。',
    related: ['kb4-welding-qc', 'liner-hdpe-spec', 'material-gcl', 'practice-acceptance-test', 'hdpeThick'],
  },
  {
    key: 'intl5-handbook-nav',
    module: 'm6',
    kw: ['英文手册', 'Tchobanoglous', 'Christensen', 'Cossu', 'Vesilind', '查阅导航', '经典专著'],
    q: '填埋场工程问题该查哪本英文经典手册？',
    pro: '经典英文专著查阅导航（版本均已核）：①设计参数与全流程工程计算→Tchobanoglous, Theisen & Vigil《Integrated Solid Waste Management: Engineering Principles and Management Issues》（McGraw-Hill, 1993，填埋章节含衬层/渗滤液/气体/产量预测公式）；②手册式速查→Tchobanoglous & Kreith《Handbook of Solid Waste Management》（McGraw-Hill, 2002；「ISWM Engineering Manual 2002」系误记，2002 年 McGraw-Hill 的正确书是这本 Handbook）；③教材级系统学习→Worrell, Vesilind & Ludwig《Solid Waste Engineering: A Global Perspective》3e（Cengage, 2017；注意此书非 Tchobanoglous 著）；④单项技术分章综述（LCA、回收、生物处理、填埋各章权威）→Christensen 主编《Solid Waste Technology & Management》2 卷集（Wiley-Blackwell, 2010/2011 二刷；网传 2025 二版未获证实）；⑤填埋专题现代专著→Cossu & Stegmann《Solid Waste Landfilling》（Elsevier, 2018）；⑥屏障/沼气/渗滤液三大界面问题原始文献→Christensen, Cossu & Stegmann 编《Landfilling of Waste: Barriers/Biogas/Leachate》（E&FN Spon, 1996）；⑦生命周期评价方法→McDougall 等《ISWM: A Life Cycle Inventory》2e（2008）；⑧矿物学视角与填埋气章→Batchelder 编《Minerals in Waste Management》（Mineralogical Society, 1999，任务书所指 Robinson 出处）。',
    easy: '查设计公式翻 Tchobanoglous 1993 和 2002 Handbook；想了解每项技术现状翻 Christensen 两卷集；填埋单点深挖看 Cossu 2018。名字年份别记错，二手引用里张冠李戴的很多。',
    cite: 'Tchobanoglous et al. 1993 / Tchobanoglous & Kreith 2002 / Worrell et al. 2017 / Christensen 2010-2011 / Cossu & Stegmann 2018',
    clause: 'Solid Waste Engineering 3e (2017) 作者为 Worrell/Vesilind/Ludwig；Cossu 无名为 Integrated Solid Waste Management 的专著。',
    related: ['intl5-journal-conf-nav', 'intl5-ipcc-swd-model', 'slopeStable', 'leachateTreat'],
  },
  {
    key: 'intl5-journal-conf-nav',
    module: 'm6',
    kw: ['期刊', '会议', 'Waste Management', 'WMR', 'ES&T', 'ISWA', 'SWANA', 'GWMS', '文献导航'],
    q: '填埋/固废领域的顶级期刊和权威会议有哪些？怎么检索？',
    pro: '期刊导航（出版方已核，影响因子为 2024–2026 口径浮动值，引用前以官网为准）：①Waste Management（Elsevier, 0956-053X）——领域旗舰，填埋气/渗滤液/稳定化研究主阵地，JIF≈7.1–7.3、CiteScore 14；②Waste Management & Research（SAGE, ISWA 会刊）——政策与管理导向；③Bioresource Technology（Elsevier）——厌氧消化/堆肥/生物降解机理（JIF≈8.2）；④Environmental Science & Technology（ACS）——环境过程机理，填埋痕量有机物与羽流机理经典出处；⑤Journal of Material Cycles and Waste Management（Springer，日本 JSMCWM＋韩国 KSWM 会刊）——东亚物质循环与技术；⑥Waste Disposal & Sustainable Energy（Springer）——低碳处置与能源回收新刊。会议导航（先纠误：「IRSWA World Congress」「Dubai 2024」不成立；ISWA World Congress 2024 在开普敦、2025 布宜诺斯艾利斯、2026 伦敦；SWANA WasteCon 2025 起更名 RCon；SRR/ORTE 非会议名）：①ISWA World Congress——全球政策-行业；②SWANA Annual Conference/Landfill Symposium——北美实务与 ARF 研究报告；③GWMS（EREF/Waste360）——北美研究-行业混合，高温填埋/PFAS 议题；④Sardinia Symposium（意大利国际填埋研讨会）与 ICLRS（洲际填埋研究研讨会）——填埋学术核心圈。检索策略：机理找 WM/ES&T，政策找 WMR，生物过程找 BRT，东亚实践查 JMCWM。',
    easy: '找文献记住四本刊物：Waste Management（最全）、Bioresource Technology（生物处理）、ES&T（机理）、WMR（政策）；开会关注 ISWA 世界大会、SWANA、GWMS 和撒丁岛填埋研讨会。网上传的「IRSWA Dubai」是假的。',
    cite: 'sciencedirect.com/journals / journals.sagepub.com/home/wmr / iswa2026.org / swana.org / wastesymposium.com',
    clause: 'ISWA WC 2024 Cape Town（非 Dubai）；SWANA WasteCon 已更名 RCon（2025 首办哥伦布）。',
    related: ['intl5-handbook-nav', 'intl5-ipcc-swd-model', 'case-jiangxi-leachate'],
  },
  {
    key: 'intl5-global-baseline',
    module: 'm6',
    kw: ['What a Waste', '全球废物', '基线数据', 'UNEP', 'GWMO', '世界银行', '碳排放', '填埋占比'],
    q: '全球垃圾量和填埋占比的权威基线数据是什么？该引哪份报告？',
    pro: '全球口径三套权威数据（引用时注意口径互斥）：①World Bank What a Waste 2.0（2018）——2016 年全球 MSW 20.1 亿吨，BAU 情景 2050 年 34.0 亿吨（+70%），被引最广，适合「全球基线+国别分组」；②What a Waste 3.0（系列第三版，2024/2026 口径混见——世行官方页标注，覆盖 217 国/262 城）——修正后预测 2050 年较基准约 +50%，引用须注明版本与基线年；③UNEP–ISWA Global Waste Management Outlook 2024（UNEA-6 授权，《Beyond an Age of Waste》）——MSW 21 亿吨（2023）→2050 年 38 亿吨，直接管理成本 3610 亿美元/年（2020）→无行动 6403 亿/2050，最优情景可降至约 2702 亿；其基线在二手报道中存在 2.1/2.3 Gt 与 2020/2023 两种引用口径（统计范围不同），务必回查原报告 Chapter 2 表。用途：模型输入率（人均产生量、填埋率分收入组）、碳核算背景值、报告「国际对比」章节。另：欧盟数据走 EEA 分流指标，美国走 EPA Advancing Recycling 国别口径（未在本批核验）。',
    easy: '引用全球垃圾数据认准三份：世行 What a Waste 2.0（201 亿吨/2016）、它的新版 3.0（预测改口为 2050 年增五成）、UNEP 的 GWMO 2024（21 亿吨/2023）。数字打架是因为年份和范围不同，注明出处版本即可。',
    cite: 'Kaza et al. 2018 (World Bank) / UNEP 2024 GWMO / worldbank.org/en/publication/what-a-waste',
    clause: 'What a Waste 2.0：2.01 Gt (2016) → 3.40 Gt (2050)；GWMO 2024：2.1 Gt (2023) → 3.8 Gt (2050)。',
    related: ['capacity', 'intl5-eu-landfill-targets', 'carbonFootprint', 'siteSelect'],
  },
  {
    key: 'intl5-asia-management',
    module: 'm6',
    kw: ['日本', '最终处置场', '技术基准', '韩国', 'RPS', 'REC', '新加坡', 'Semakau', '填埋气'],
    q: '日本、韩国、新加坡的填埋管理有什么特点？',
    pro: '亚洲三样本（法规名与要点已核）：①日本——《废弃物处理与清扫法》及环境省令规定最终处置场技术基准，分安定型/管理型/遮断型三类；管理型场对渗滤液、地下水位与气体有维持管理基准，关闭采用「废止基准」制度：JSMCWM《废弃物最终处置场废止基准的调查评价方法》（2025 改订）以渗滤液量/水质与产气指标达标作为废止（销号）条件，NIES 发展多参数监测支撑关闭决策——比中国「封场后 30 年」的年限制多了「指标达标即可申请废止」的绩效出口；官方英文手册《Solid Waste Management and Recycling Technology of Japan》与 JWN《Rules and Figures 2023》可查细节；②韩国——2012 年起 RPS 配额制（500MW+ 发电义务主体），填埋气发电属可再生电力可发 REC 交易履约；2025 年启动 RPS 改革，REC 现货市场 2029-12-31 退出改合同市场——LFG 项目收益模型须按新机制重估；③新加坡——Semakau 人工离岸填埋场（1999 启用，约 350 ha 海域、7 km 海堤）仅接纳焚烧炉底渣与飞灰固化体，官方口径预计 2035 年前后填满，倒逼「零废总规划」焚烧主导路线；马来西亚无独立联邦填埋技术基准，以各州条例+DOE 指南管理（本批未深检，引用需另证）。',
    easy: '日本关场看「指标达标」而不是熬满年限；韩国烧填埋气发电能卖绿证（REC）但规则 2025 年起在改；新加坡干脆只埋烧完的灰，填到 2035 年左右就没地了。',
    cite: '日本廃掃法/环境省技术基准（env.go.jp 900453393）/ JSMCWM 废止基准 2025 / IEA: Korea RPS / NEA Semakau 页',
    clause: '韩国填埋气发电纳入 RPS-REC；日本以废止基准指标达标作为销号出口。',
    related: ['closureLTM', 'intl5-lfg-utilization', 'lfg-grid-connection', 'post-closure-solar-farm'],
  },
];

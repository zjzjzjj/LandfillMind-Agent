/**
 * spec/poll.ts · 污染页控件规格（①~⑤ 表单 + ⑥ 高级参数声明式表）
 *
 * 与桌面同源的**单一来源**策略：
 *  - ①~⑤ 的**初值**不写死，运行时从 `/api/kernel3d/info` 的
 *    `data.defaults.pollution.default_params` 取 —— 桌面也是这么干的
 *    （app.py:2659 `d = poll.default_params()`），这样内核改了默认值
 *    两边一起变。
 *  - 下拉**选项**取自 `info.data.options`（climate_zone / cover / liner /
 *    defect / ipw / quality / plume_mode / layer_order / dist_kind）。
 *  - ⑥ 高级参数表逐项镜像桌面 `_POLL_ADV_SPEC`（app.py:68-139）。
 *
 * ⚠ `info.options.inlet` 给的是 `["flux","conc"]`，但内核
 *   `pollution/transport1d.c_ratio` 只认 `flux` / `concentration`（且会
 *   raise）。桌面高级参数表用的是 `concentration`，这里跟桌面走、**不用**
 *   info 那一项，免得选一下就报错。
 */

/** 控件类型：num 数字 / sel 下拉 / chk 复选 / txt 文本 */
export type PollKind = 'num' | 'sel' | 'chk' | 'txt';

export interface PollField {
  k: string;
  label: string;
  kind: PollKind;
  /** sel 的选项来源（info.data.options 的键） */
  opts?: string;
  /** 下拉显示中文、回传英文值时用（如 plume_mode） */
  labels?: string[];
  tip?: string;
}

export interface PollGroup {
  title: string;
  fields: PollField[];
  /** 嵌套子分组（④ 的「含水层参数」） */
  nested?: { title: string; fields: PollField[] };
  /** 组内说明（桌面 Dim label） */
  note?: string;
}

/** ①~⑤ —— 标签、嵌套结构与顺序全部照抄 app.py:2665-2939 */
export const POLL_GROUPS: PollGroup[] = [
  {
    title: '① 填埋进度（产气与埋龄来源）',
    note: '埋龄由填埋材料分层顺序推得（自下而上＝行序，最下层最早填埋）；'
      + '未定义材料分层时按单一生活垃圾层处理。',
    fields: [
      { k: 'fill_start_year', label: '起填年份', kind: 'num', tip: '填埋开始年份' },
      { k: 'fill_end_year', label: '填至年份', kind: 'num', tip: '填埋结束年份，须晚于起填年份' },
      { k: 'horizon_years', label: '评估年限 a', kind: 'num', tip: '产气时程曲线的长度' },
      { k: 'ch4_fraction', label: 'CH4 体积分数 F', kind: 'num', tip: '填埋气中甲烷占比，US EPA 默认 0.5' },
      { k: 'collection_eff', label: '收集效率 0~1', kind: 'num', tip: '只影响排放量与利用量，**不改变产生量**' },
      { k: 'cover_oxidation', label: '覆盖层氧化因子', kind: 'num', tip: '封场覆盖层土壤氧化甲烷的比例，IPCC 推荐 0~0.4，常用 0.10' },
      { k: 'lag_years', label: '产甲烷滞后期 a', kind: 'num', tip: '酸化抑制期（VFA 累积、pH 偏低）内产气停滞；纯延迟，不改变总潜势' },
      { k: 'temperature_c', label: '填埋体温度 ℃', kind: 'num', tip: '经 Cardinal 温度函数折算衰减速率：最适 40℃，<10 或 >60℃ 停止产气' },
      { k: 'methane_availability', label: '产甲烷可及度', kind: 'num', tip: '文献实测同类模型普遍高估甲烷 1.5~4.7 倍；按本场地实测下调，默认 1.0 表示不做未标定修正' },
    ],
  },
  {
    title: '② 气象与覆盖条件（渗滤液驱动）',
    fields: [
      { k: 'climate_zone', label: '气候分区', kind: 'sel', opts: 'climate_zone', tip: '分区给出逐月降雨/蒸散的年内分配；正式设计请用实测序列覆盖' },
      { k: 'annual_P_mm', label: '年降雨 mm（可选）', kind: 'num', tip: '留空则取所选分区的年值' },
      { k: 'annual_PET_mm', label: '年蒸散 mm（可选）', kind: 'num', tip: '留空则取所选分区的年值' },
      { k: 'cover', label: '覆盖条件', kind: 'sel', opts: 'cover', tip: '决定降雨径流系数与蒸散折减：封场绿化耗水最多、产水最少' },
    ],
  },
  {
    title: '③ 垃圾体与衬垫',
    fields: [
      { k: 'field_capacity', label: '田间持水量 0~1', kind: 'num', tip: '体积含水率，垃圾体约 0.30~0.40' },
      { k: 'initial_moisture_fraction', label: '初始含水率占比', kind: 'num', tip: '初始含水占田间持水量的比例' },
      { k: 'k_waste_ms', label: '垃圾体渗透系数 m/s', kind: 'num', tip: '垃圾体饱和渗透系数' },
      { k: 'liner', label: '衬垫类型', kind: 'sel', opts: 'liner', tip: '决定衬垫渗透系数与缺陷渗漏路径' },
      { k: 'defect_preset', label: '缺陷密度（仅膜类）', kind: 'sel', opts: 'defect', tip: '施工质量对应的单位面积缺陷数' },
      { k: 'defect_area_m2', label: '单个缺陷面积 m²', kind: 'num', tip: '孔洞等效面积，常规取 1e-4 m²' },
      { k: 'ipw_preset', label: '降解自产水', kind: 'sel', opts: 'ipw', tip: '厨余含量决定的颗粒内水释放预设' },
    ],
  },
  {
    title: '④ 污染物与二维羽流（可选）',
    fields: [
      { k: 'do_plume', label: '计算二维地下水羽流（耗时较长）', kind: 'chk', tip: '平面或剖面二维对流—弥散—衰减求解，开销远大于其它项' },
      { k: 'plume_mode', label: '羽流模式', kind: 'sel', opts: 'plume_mode',
        labels: ['平面（含水层俯视）', '剖面（沿流向纵剖）'],
        tip: '平面＝含水层俯视；剖面＝沿流向纵剖' },
      { k: 'quality_kind', label: '污染物指标', kind: 'sel', opts: 'quality', tip: '渗滤液特征组分，决定源浓度与标准限值' },
      { k: 'source_conc', label: '源浓度 mg/L（可选）', kind: 'num', tip: '留空＝按填埋龄期经验曲线推源浓度' },
      { k: 'half_life_d', label: '半衰期 d（可选）', kind: 'num', tip: '地下水中该组分的衰减；留空＝不衰减' },
      { k: 'plume_alpha_L', label: '纵向弥散度 m', kind: 'num', tip: 'αL，典型 1~20 m' },
      { k: 'plume_years', label: '羽流模拟年限 a', kind: 'num', tip: '时间推进总年数' },
    ],
    nested: {
      title: '含水层参数',
      fields: [
        { k: 'aq_K', label: '渗透系数 K m/d', kind: 'num', tip: '含水层' },
        { k: 'aq_b', label: '含水层厚度 b m', kind: 'num', tip: '含水层' },
        { k: 'water_table_depth', label: '水位埋深 m', kind: 'num', tip: '与平面/剖面共用同一地质模型' },
        { k: 'aq_porosity', label: '孔隙度 n', kind: 'num', tip: '0~1' },
        { k: 'aq_gradient', label: '水力坡度 i', kind: 'num', tip: '区域地下水位坡度' },
        { k: 'aq_upstream_m', label: '域上游留白 m', kind: 'num', tip: '羽流计算域向源区上游外扩的距离' },
        { k: 'aq_downstream_m', label: '域下游留白 m', kind: 'num', tip: '下游留白要足够长，否则羽流前锋会被边界截断' },
        { k: 'aq_lateral_m', label: '域两翼留白 m', kind: 'num', tip: '横向留白' },
      ],
    },
  },
  {
    title: '⑤ 污染结果与风险（GB/T 14848 Ⅲ类）',
    fields: [
      { k: 'do_risk', label: '按地下水质量标准判定超标', kind: 'chk', tip: '判定判据由「相对浓度 0.1·C₀」（只描述羽流形状）换成绝对浓度限值。防渗良好的场地上两者结论可能完全相反' },
      { k: 'well_on', label: '设敏感目标（水源井）', kind: 'chk', tip: '输出该井处浓度时程与超标年限' },
      { k: 'well_distance_m', label: '距足迹下游边 m', kind: 'num', tip: '平面模式：沿流向距填埋场足迹下游边的水平距离' },
      { k: 'well_offset_m', label: '横向偏移 m（平面）', kind: 'num', tip: '平面模式：相对足迹横向中心线的偏移，0 = 正下游' },
      { k: 'well_depth_m', label: '开采深度 m（剖面）', kind: 'num', tip: '剖面模式：水井滤管所在的深度' },
    ],
  },
];

/** ⑥ 高级参数的控件种类（桌面 _POLL_ADV_SPEC 的 kind 列） */
export type PollAdvKind =
  | 'f'    // float
  | 'i'    // int
  | 'oi'   // optional int
  | 'o'    // optional float
  | 'b'    // bool
  | 's'    // select（需 choices）
  | 'L'    // 逗号数字列表（空 → None）
  | 'C'    // 恰 12 个数（逐月降雨）
  | 'B';   // 恰 4 个数（源区矩形）

export interface PollAdvField {
  k: string;
  kind: PollAdvKind;
  label: string;
  tip?: string;
  choices?: string[];
}

export interface PollAdvGroup { key: string; title: string; fields: PollAdvField[] }

/** 组标题与顺序（app.py:2948-2952） */
export const POLL_ADV_GROUPS: Array<{ key: string; title: string }> = [
  { key: 'g', title: '产气与埋龄' },
  { key: 'l', title: '渗滤液与衬垫' },
  { key: 'c', title: '一维柱' },
  { key: 'p', title: '羽流求解器' },
];

/** 逐项镜像 app.py:68-139 的 _POLL_ADV_SPEC（顺序即组内顺序） */
export const POLL_ADV: PollAdvField[] = [
  { k: 'power_efficiency', kind: 'f', label: '发电效率 0~1', tip: '收集气发电量换算效率，只影响电量数字' },
  { k: 'snapshot_years', kind: 'L', label: '快照年份表', tip: '产气时程的代表年份（结果时刻下拉），逗号分隔；留空＝自动取 6 特征年' },
  { k: 'layer_order', kind: 's', label: '埋龄层序', choices: ['bottom_up', 'top_down'], tip: 'bottom_up＝行序自下而上（最下层最早填埋，与建模惯例一致）；若分层按顶→底录入则改 top_down' },
  { k: 'ipw_coeff', kind: 'o', label: '自产水系数 m³/t', tip: '覆盖颗粒内水释放预设；仅在预设为「自定义」时有意义' },
  { k: 'ipw_tau_years', kind: 'o', label: '自产水时间常数 a', tip: '覆盖颗粒内水释放预设' },
  { k: 'active_thickness', kind: 'o', label: '活跃层厚度 m', tip: '水量平衡的蓄水层厚度；留空＝足迹内平均堆高（足迹外大片零厚度会稀释均值，故引擎在足迹内统计）' },
  { k: 'flow_length', kind: 'o', label: '渗流路径长 m', tip: '衬垫达西式的水力梯度基准长度；留空＝√面积' },
  { k: 'water_balance_years', kind: 'i', label: '水量平衡年数 a', tip: '逐月水库演算的年数（产水量口径），与羽流模拟年限相互独立' },
  { k: 'monthly_P_mm', kind: 'C', label: '逐月降雨 mm ×12', tip: '12 个实测月降雨（逗号分隔）；给出则优先于气候分区的年值+月形状分配' },
  { k: 'liner_k_ms', kind: 'o', label: '衬垫渗透系数 m/s', tip: '覆盖衬垫类型预设' },
  { k: 'liner_thickness', kind: 'o', label: '衬垫厚度 m', tip: '覆盖衬垫类型预设' },
  { k: 'defect_cq', kind: 'o', label: '缺陷 Cq 接触系数', tip: 'Giroud–Bonaparte 缺陷渗漏式系数（仅膜类衬垫）；留空＝按预设' },
  { k: 'head_cap', kind: 'o', label: '膜上水头封顶 m', tip: '缺陷渗漏的水头上限；留空＝文献惯例 0.3 m' },
  { k: 'do_column', kind: 'b', label: '计算一维柱穿透', tip: '覆盖层/包气带垂向运移（解析解，开销可忽略）' },
  { k: 'column_length', kind: 'f', label: '柱长 m', tip: '渗滤液面到地下水位的路径长度' },
  { k: 'column_porosity', kind: 'f', label: '柱孔隙度 n', tip: '0~1' },
  { k: 'column_bulk_density', kind: 'f', label: '柱干容重 t/m³', tip: '计算阻滞因子 R 用' },
  { k: 'column_kd', kind: 'f', label: '分配系数 Kd L/kg', tip: 'R = 1 + ρb·Kd/n；0＝不吸附' },
  { k: 'column_alpha_L', kind: 'f', label: '柱弥散度 m', tip: 'D = αL·v + D*' },
  { k: 'column_eval_years', kind: 'f', label: '柱评估年限 a', tip: '输出穿透剖面的时刻' },
  // ⚠ 不用 info.options.inlet（它给的是 "conc"，内核只认 "concentration"）
  { k: 'inlet', kind: 's', label: '柱入口边界', choices: ['flux', 'concentration'], tip: 'flux＝第三类（Ogata–Banks 经典，有限通量注入）；concentration＝第一类（上游恒定水源把入口浓度钉住）' },
  { k: 'plume_dt', kind: 'f', label: '羽流时间步 d', tip: '全隐式无条件稳定；步长只影响时间离散误差与耗时' },
  { k: 'plume_R', kind: 'f', label: '羽流阻滞因子 R', tip: '1＝不阻滞；含水层吸附与柱内 Kd 相互独立' },
  { k: 'plume_threshold', kind: 'f', label: '相对浓度阈值 ×C₀', tip: '羽流形态指标（0.1 等值线）判据，**不是达标判定**（达标走 GB/T 14848）' },
  { k: 'plume_nx', kind: 'oi', label: '羽流网格 nx', tip: '留空＝按弥散度自适应；给了则固定网格（会写 note）' },
  { k: 'plume_ny', kind: 'oi', label: '羽流网格 ny', tip: '留空＝自适应' },
  { k: 'plume_nz', kind: 'i', label: '剖面垂向层数', tip: '仅剖面模式' },
  { k: 'plume_dx_target', kind: 'o', label: '目标单元尺寸 m', tip: '自适应判据；留空＝max(αL/2, 5 m)' },
  { k: 'plume_cell_cap', kind: 'i', label: '网格单元数上限', tip: '超出则等比放宽并写 note（LU 因子内存 ~10-30×矩阵）' },
  { k: 'plume_Dz', kind: 'o', label: '垂向弥散系数 m²/d', tip: '仅用于「垂向混合是否充分」自证判据，不参与二维求解；留空＝0.1·Dy' },
  { k: 'plume_Lz', kind: 'o', label: '剖面总深 m', tip: '留空＝水位埋深 + 含水层厚度（与平面共用地质模型）' },
  { k: 'plume_snapshot_days', kind: 'L', label: '羽流快照时刻 d', tip: '逗号分隔天数（羽流「结果时刻」下拉；同时决定时间包络覆盖的时刻）' },
  { k: 'plume_source_box', kind: 'B', label: '源区矩形 x0,x1,y0,y1', tip: '世界坐标 4 个数，覆盖足迹源区；留空＝按足迹掩膜' },
  { k: 'plume_solve_steady', kind: 'b', label: '额外解稳态对照场', tip: '每次多解一遍 t→∞ 稳态（一次组装+spsolve）；稳态场仅对照，表/图/报告不消费' },
];

/** 高级参数键 → 所属组 */
const ADV_GROUP_OF: Record<string, string> = {
  power_efficiency: 'g', snapshot_years: 'g', layer_order: 'g',
  ipw_coeff: 'g', ipw_tau_years: 'g', active_thickness: 'g',
  flow_length: 'g', water_balance_years: 'g', monthly_P_mm: 'g',
  liner_k_ms: 'l', liner_thickness: 'l', defect_cq: 'l', head_cap: 'l',
  do_column: 'c', column_length: 'c', column_porosity: 'c',
  column_bulk_density: 'c', column_kd: 'c', column_alpha_L: 'c',
  column_eval_years: 'c', inlet: 'c',
  plume_dt: 'p', plume_R: 'p', plume_threshold: 'p', plume_nx: 'p',
  plume_ny: 'p', plume_nz: 'p', plume_dx_target: 'p', plume_cell_cap: 'p',
  plume_Dz: 'p', plume_Lz: 'p', plume_snapshot_days: 'p',
  plume_source_box: 'p', plume_solve_steady: 'p',
};

/** 按组切好（渲染直接遍历，避免运行时再分组） */
export function advByGroup(): PollAdvGroup[] {
  return POLL_ADV_GROUPS.map((g) => ({
    ...g,
    fields: POLL_ADV.filter((f) => ADV_GROUP_OF[f.k] === g.key),
  }));
}

/** `plume_mode` 中文显示 ↔ 内核值（桌面 app.py:5356-5357 同映射） */
export function plumeModeValue(display: string): string {
  return display.startsWith('平面') || display === 'plan' ? 'plan' : 'section';
}

/** 把内核 `default_params()` 的值转成控件初值文本（桌面同款格式化） */
export function toFieldText(key: string, v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? '1' : '';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(+v.toFixed(6));
  return String(v);
}

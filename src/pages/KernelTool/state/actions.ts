/**
 * state/actions.ts · 动作层
 *
 * 桌面每一个按钮背后的事都收在这里，chrome 与 panels 只负责调用 —— 免得
 * 同一段 spec 组装逻辑在工具栏、菜单栏、面板里各写一遍。
 *
 * 三件容易出错的事，集中在这一层处理：
 *  1. **spec 组装**：四条建模路线（rect/poly/cells/points）+ 分层 + 逐边坡比
 *     + 开挖，键名必须与 agent_cli._build_model_from_spec 读的完全一致。
 *  2. **空值语义**：表单里空串 = 未指定，必须**不发这个键**让内核走默认，
 *     而不是发 0 / NaN。
 *  3. **结果落池**：每次调用都要告诉 run() 落在哪个视图、子视图键是什么。
 */
import { useMemo } from 'react';
import { useTool } from './context';
import type { PoolEntry } from './run';
import {
  download, downloadTableCsv, kernelExportFigure, kernelImport, kernelRun,
} from './api';
import type { FormState, ZoneRow } from '../spec/defaults';
import { SCAN_DIRS, defaultForm } from '../spec/defaults';
import { KERNEL_3D_FIG, RENDERABLE, SUB_DEFAULT, VIEWS } from '../spec/views';
import { POLL_ADV, plumeModeValue } from '../spec/poll';
import { arcsToSparse, type ArcEdge } from '../../../components/ToeShape';

/** 空串/未填写 → undefined（**不发这个键**，让内核走默认值） */
function nu(v: unknown): number | undefined {
  if (v === '' || v === null || v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
/** 表格单元格 → 必有数字（RowsEditor 的 num 列存字符串，清空即空串） */
function nn(v: unknown, d: number): number {
  const n = nu(v);
  return n === undefined ? d : n;
}
/** 2 位小数（扫描断面端点等呈现实用精度） */
function round2(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

/** 只保留有值的键 */
function compact<T extends Record<string, unknown>>(o: T): T {
  const out = {} as Record<string, unknown>;
  for (const [k, v] of Object.entries(o)) {
    if (v !== undefined && v !== null && v !== '') out[k] = v;
  }
  return out as T;
}

export function useActions() {
  const { form, ui, k } = useTool();

  return useMemo(() => {
    const S = () => form.getState();
    const U = () => ui.getState();
    const F = form.getState.bind(form);

    // ------------------------------------------------------------------ 建模

    /** 组装 build_model 的 spec（与内核读的键逐一对应） */
    function buildSpec(): Record<string, unknown> {
      const b = S().build;
      const base: Record<string, unknown> = { grid_nx: b.gridNx };
      if (b.siteName.trim()) base.site_name = b.siteName.trim();

      if (b.mode === 'points' || b.shape === 'points') {
        base.source = 'points';
        // keepZ：测点路线必须带高程，否则 2.5m 的测点会被当成 2 维点重建，
        // 插值出来的基底/顶面全错（内核 base_points 收的是 [[x,y,z],…]）
        base.base_points = parsePoints(b.basePtsText, true);
        if (b.topPtsText.trim()) base.top_points = parsePoints(b.topPtsText, true);
        base.interp_method = b.interpMethod;
        base.idw_power = b.idwPower;
        base.idw_k = b.idwK;
        base.top_mode = b.topMode;
        if (b.topMode === 'level') base.design_level = b.designLevel;
        base.grid_ny = b.gridNx;
      } else if (b.shape === 'cells') {
        base.shape = 'cells';
        base.cells = b.cells.map((c) => {
          const poly = c.shape === 'poly' && c.poly.trim()
            ? parsePoints(c.poly) : rectPoly(nn(c.L, 300), nn(c.W, 200),
                                              nn(c.cx, 0), nn(c.cy, 0));
          // 表格里 num 列存的是**字符串**（RowsEditor 直接写 e.target.value），
          // 清空一格就是空串 —— 内核 float('') 会炸，所以数值一律先兜成数字
          const cell: Record<string, unknown> = {
            name: c.name, poly, z0: nn(c.z0, 0), height: nn(c.height, 20),
            n: nn(c.n, 4),
          };
          // 设计堆高：内核只在单元上认这个键（design_H，驱动「剩余库容」分列）
          const dh = nu(c.designH);
          if (dh !== undefined && dh > 0) cell.design_H = dh;
          // 坡脚弧定义随单元带出去；内核 toe_arcs 加密时**同时**展开该单元的
          // slopes，所以这里只发加密前的粗折线与粗坡比（都是母边口径）
          const ca = arcsOf(c.arcs, poly.length);
          if (ca) cell.arcs = ca;
          // 逐边坡比：与单块建模同一口径（长度补齐到顶点数、空位回退统一坡比），
          // 否则内核会以"个数必须等于顶点数 / 必须为有限正数"拒掉
          const es = c.slopes || [];
          if (es.length && poly.length >= 3) {
            cell.slopes = Array.from({ length: poly.length }, (_, i) => {
              const n = Number(es[i]);
              return Number.isFinite(n) && n > 0 ? n : nn(c.n, 4);
            });
          }
          return cell;
        });
      } else if (b.shape === 'poly') {
        base.shape = 'poly';
        base.polygon = parsePoints(b.polyText);
        base.z0 = b.z0; base.height = b.height; base.n = b.slopeN;
      } else {
        base.shape = 'rect';
        base.rect = { cx: b.rectCx, cy: b.rectCy, L: b.rectL, W: b.rectW };
        base.z0 = b.z0; base.height = b.height; base.n = b.slopeN;
      }
      // 逐边坡比（矩形 4 条 / 多边形按顶点数）。
      // ⚠ 两条都得处理，否则内核会拒：
      //   1) **长度**：内核要求坡比个数 == 坡顶线顶点数。用户在界面上可能只填了
      //      第 1 行，数组就只有 1 项 —— 必须补齐到边数。
      //   2) **空位**：桌面 `_edges_values()` 的口径是「空/非法回退统一坡度，
      //      返回 float 列表」，内核也要求每条边都是有限正数。留空/None 会被
      //      直接拒（"每条边的坡比必须为有限正数"），所以空位要填成统一坡比。
      const uniform = nu(b.slopeN);
      const polyVerts = b.shape === 'rect' ? 4 : parsePoints(b.polyText).length;
      const es = (b.edgeSlopes || []);
      if (es.length && uniform !== undefined && polyVerts >= 3 && b.mode !== 'points') {
        base.slopes = Array.from({ length: polyVerts }, (_, i) => {
          const n = Number(es[i]);
          return Number.isFinite(n) && n > 0 ? n : uniform;
        });
      }
      // 弧边：发**加密前**的粗折线（polygon 已是粗的）+ 弧定义，由内核唯一一次
      // 加密并同步展开上面的 slopes（两边同式，对拍见 tools/toe-vs-kernel.py）
      if (b.shape === 'poly' && b.mode !== 'points') {
        const arcs = arcsOf(b.polyArcs, polyVerts);
        if (arcs) base.arcs = arcs;
      }
      // 分层填埋：[[名称, 厚m, 容重]]
      if (b.layers?.length && b.mode !== 'points') {
        base.layers = b.layers
          .filter((l) => l.name && Number(l.h) > 0)
          .map((l) => [l.name, Number(l.h), Number(l.gamma)]);
      }
      // 开挖（分区表非空时随建模一起应用 —— 「应用开挖」就是这个）
      const ex = (S().exc.zones || []).map((z, i) => {
        const poly = parsePoints(z.poly);
        return {
          name: z.name || `开挖区${i + 1}`,
          poly,
          // ⚠ 必须是 null 而不是 undefined：undefined 会被 JSON.stringify 丢掉，
          // 内核那边 `c.get("top_z", 0.0)` 就默认成 0.0 = "坡顶在标高 0"，
          // 于是开挖实际什么都没削掉（体积一点不变）。null 才是内核认的
          // "由现有堆体顶面采样"（normalize_zone 的语义）。
          top_z: z.topZ ?? null,
          levels: parseLevels(z.levels || S().exc.levelsText),
          temp_n: nu(z.tempN) ?? null,
          order: z.order,
          // 挖到基底 (P1): 坡面形态仍由分级剖面决定, 坑底直接削到 Zb
          cut_to_base: !!z.cutToBase,
          // 画布上点边中点设的逐边临时坡比 —— 早先这个值写进分区行后
          // 从没进过 spec，于是「随下次应用开挖生效」是句空话
          ...zoneSlopes(z, poly),
        };
      }).filter((z) => z.poly.length >= 3);
      if (ex.length) base.excavation = ex;
      return base;
    }

    /** 建模（含开挖）—— 桌面的「▶ 一键生成三维模型 / 执行三维建模」 */
    async function doBuild(loadDemo?: 'plain' | 'valley') {
      const b = S().build;
      const isPoints = b.mode === 'points' || b.shape === 'points';
      const label = loadDemo ? `示例工程 · ${loadDemo === 'plain' ? '平原型' : '山谷型'}`
        : isPoints ? '执行三维建模（测点插值）' : '一键生成三维模型';
      let spec: Record<string, unknown>;
      if (loadDemo) {
        spec = { demo: loadDemo, grid_nx: b.gridNx };
      } else {
        try {
          spec = buildSpec();
        } catch (e: any) {
          k.log(`建模参数有误：${e?.message ?? e}`, 'err');
          k.setStatus(`建模失败 | ${e?.message ?? e}`);
          return null;
        }
      }
      // 轮廓优先取已建好的场地的坐标系；这里保持桌面语义：重建
      const r = await k.run(label, { action: 'model', spec, figures: [] },
        { viewKey: '3d' });
      if (!r) return null;
      k.afterBuild(r);
      ui.set('stage3d', null);   // 新模型落地, 旧的逐阶段工件立即失效（P3）
      // 示例场：桌面加载完会立刻把「分阶段库容标高」「地基压缩层」覆盖成示例值，
      // 并且 _restore_param_project 把**几何**灌回表单 —— 后者是必须的：不回填
      // 的话用户接着点「应用开挖 / 一键生成三维模型」，发的就是表单里那个默认
      // 300×200 矩形，而不是他刚看到的示例场，几何会被悄悄换掉。
      const dm = r.data?.demo as Record<string, any> | undefined;
      if (dm) {
        const patch: Record<string, unknown> = {};
        if (Array.isArray(dm.stage_levels)) {
          patch['calc.storage.stages'] = dm.stage_levels.map((x: number) => String(x)).join(',');
        }
        if (Array.isArray(dm.soil_layers)) {
          patch['calc.settle.soils'] = dm.soil_layers.map((t: any[]) => ({
            name: String(t[0]), h: Number(t[1]), Es: String(t[2]),
            e0: '', Cc: '', sigmaP: '', Cs: '',
          }));
        }
        Object.assign(patch, demoFormPatch(dm.spec as Record<string, any> | undefined, b));
        if (Object.keys(patch).length) form.patch(patch);
      }
      ui.set('view', '3d');
      form.set('display.kernelImage', false);
      return r;
    }

    /**
     * ◧ 内核图 —— 切到内核渲的 matplotlib 三维图（严格对照桌面成图时用）。
     *
     * 两件事必须一起做，少一件这个开关就是死的：
     *  1) 状态存在 **form.display.kernelImage**（ViewBar/FigureStage 都读这里），
     *     早先按在 ui 上，于是按钮永不翻面、画面永不变；
     *  2) 三维视图池子里得有 `model3d` 这张图 —— 「执行建模」按桌面语义
     *     `figures: []`（不出图），所以要在这里按当前 ⑥ 显示开关现渲一次。
     */
    async function showKernelImage(on: boolean) {
      form.set('display.kernelImage', on);
      if (!on) return;
      if (k.pool['3d']?.figs?.some((f) => f.key === KERNEL_3D_FIG)) return;
      const d = S().display;
      await k.run('渲内核三维图（matplotlib）', {
        action: 'render',
        params: compact({
          show_base: d.showBase, show_top: d.showTop, show_contour: d.showContour,
          show_slip: d.showSlip, show_danger: d.showDanger, show_exc_fs: d.showExcFs,
          show_heat: d.showHeat,
          flood_level: d.floodOn ? nu(d.floodH) : undefined,
          zexag: nu(d.zexag),
        }),
        figures: [KERNEL_3D_FIG],
      }, { viewKey: '3d' });
    }

    // ------------------------------------------------------------------ 计算

    async function doStorage() {
      const c = S().calc.storage;
      const params = compact({
        h_start: nu(c.hStart), h_end: nu(c.hEnd), step: nu(c.step),
        design_level: nu(c.designLevel),
        stage_levels: (c.stages || '').split(/[,，\s]+/).map(nu).filter((v) => v !== undefined),
      });
      const r = await k.run('计算库容曲线', {
        action: 'storage', params,
        figures: ['storage_curve'],
      }, { viewKey: 'storage', sub: 'storage_curve' });
      if (r) ui.set('view', 'storage');   // 桌面 run_storage 末尾会 switch_view("storage")
      return r;
    }

    async function doSlope() {
      const c = S().calc.slope;
      const r = await k.run('坡度/坡向分析', {
        action: 'slope',
        params: compact({ surface: c.surface, max_allow_deg: nu(c.maxDeg) }),
        figures: ['slope_map'],
      }, { viewKey: 'slope', sub: 'slope_map' });
      if (r) ui.set('view', 'slope');     // 桌面 run_slope 同款
      return r;
    }

    async function doSection(dir?: 'X' | 'Y') {
      const c = S().calc.section;
      const params: Record<string, unknown> = { n: 240 };
      if (dir) {
        params.direction = dir;   // 沿 X / Y 向中线（内核按方向兜底取中线）
      } else {
        params.A = [nu(c.Ax) ?? 0, nu(c.Ay) ?? 0];
        params.B = [nu(c.Bx) ?? 0, nu(c.By) ?? 0];
      }
      const r = await k.run(dir ? `剖面（沿 ${dir} 向中线）` : '生成剖面图', {
        action: 'section', params, figures: ['section'],
      }, { viewKey: 'section', sub: 'section' });
      if (r) ui.set('view', 'section');   // 桌面 run_section 同款
      return r;
    }

    async function doSettle() {
      const c = S().calc.settle;
      const layers = (c.soils || [])
        .filter((s) => s.name && Number(s.h) > 0)
        .map((s) => compact({
          name: s.name, thickness: Number(s.h),
          Es: nu(s.Es), e0: nu(s.e0), Cc: nu(s.Cc),
          sigma_p: nu(s.sigmaP), Cs: nu(s.Cs),
        }));
      if (!layers.length) {
        k.log('沉降需要至少一层地基压缩层（土层/厚m/Es）', 'err');
        k.setStatus('沉降失败 | 缺少地基压缩层');
        return null;
      }
      const params: Record<string, unknown> = {
        layers,
        waste_height: nu(c.hW),
        gamma_waste: nu(c.gWaste),
        gamma_soil: nu(c.gSoil),
        gamma_water: nu(c.gWater),
        water_table_depth: nu(c.waterTable),
        sublayer_height: nu(c.subH),
        plane: Boolean(c.planeOn),
      };
      const cv = nu(c.cv), hdr = nu(c.hdr);
      // 桌面要求 cv / Hdr 成对给出才做一维固结时程
      if (cv !== undefined && hdr !== undefined) {
        params.time = { cv_m2_per_year: cv, drain_path_m: hdr };
      } else if (cv !== undefined || hdr !== undefined) {
        k.log('一维固结时程需要「固结系数 cv」与「最大排水距离 Hdr」成对给出，本次跳过', 'warn');
      }
      return k.run('计算地基沉降', {
        action: 'settlement', params,
        figures: ['settlement_profile', ...(c.planeOn ? ['settlement_plane'] : [])],
      }, {
        viewKey: 'settle',
        sub: SUB_DEFAULT.settle,
      });
    }

    async function doStab() {
      const c = S().calc.stab;
      const params: Record<string, unknown> = compact({
        c: nu(c.c), phi_deg: nu(c.phi), ru: nu(c.ru), gamma: nu(c.gamma),
        threshold: nu(c.thr),
        n_grid: nu(c.nGrid), n_R: nu(c.nR),
        direction: c.scanDir, n_sections: nu(c.scanN),
        coarse_first: c.scanCoarse,
      });
      if (c.mcOn) {
        params.monte_carlo = compact({
          N: nu(c.mcN), c_sig: nu(c.mcCsig), phi_sig: nu(c.mcPhisig),
          gamma_sig: nu(c.mcGsig), dist_kind: c.mcDist,
        });
      }
      return k.run('跑稳定性分析', {
        action: 'stability', params,
        figures: ['section_scan', 'critical_arc', 'fs_grid',
          ...(c.mcOn ? ['monte_carlo'] : [])],
      }, { viewKey: 'stability', sub: SUB_DEFAULT.stability });
    }

    /** ★ 将最危险断面设为计算剖面：用内核回带的 best.A/B 直接回写剖面页 */
    async function applyScanSection() {
      // 先跑一次扫描拿到最危险断面（桌面这个按钮也是先有扫描结果才点亮）
      const r = await doStab();
      const b = r?.data?.best as Record<string, any> | undefined;
      if (!b) {
        k.log('断面扫描未定位到有效最危险断面，无法设为计算剖面', 'warn');
        return;
      }
      if (!Array.isArray(b.A) || !Array.isArray(b.B)) {
        k.log('内核未回带最危险断面的 A/B 端点（请更新内核），无法设为计算剖面', 'err');
        return;
      }
      form.patch({
        // 取 2 位小数：扫描断面的端点来自网格插值，y 分量常带 1e-14 级噪声
        // （显示成 1.4210854715202004e-14 既难看也无意义）
        'calc.section.Ax': String(round2(b.A[0])), 'calc.section.Ay': String(round2(b.A[1])),
        'calc.section.Bx': String(round2(b.B[0])), 'calc.section.By': String(round2(b.B[1])),
      });
      k.log(`已将最危险断面 #${b.index}（桩号 ${b.station_m} m，Fs=${b.Fs}）`
        + '设为计算剖面（A/B 已回写剖面页）', 'ok');
      ui.set('mainTab', '计算');
      ui.set('calcSub', '剖面');
      ui.set('view', 'section');
    }

    // ------------------------------------------------------------------ 污染

    /**
     * 污染参数是**扁平字典**（内核 summary.default_params 的键面）。
     *
     * ①~⑤ 走 spec、⑥ 走 adv，但 ⑥ 必须**按字段声明的 kind 解析**，不能靠
     * "看起来像数字就转数" —— 内核有几项收的是**数字列表**
     * （`plume_snapshot_days` / `snapshot_years` / `monthly_P_mm` /
     * `plume_source_box`）。它们在前端是逗号文本，直接发字符串的话羽流求解器
     * 会拿它做除法，报 `unsupported operand type(s) for /: 'str' and 'float'`
     * —— 只在开了羽流时才暴露，且错误很长一段时间被上层吞成「未知错误」。
     */
    function buildPollParams(): Record<string, unknown> {
      const p = S().poll;
      const out: Record<string, unknown> = {};
      // 下拉/枚举类键：值本身就是字符串，不参与数值转换
      const TEXT_KEYS = new Set([
        'cover', 'liner', 'defect_preset', 'ipw_preset', 'quality_kind',
        'climate_zone', 'layer_order', 'inlet', 'plume_mode',
      ]);
      // ①~⑤（含 ④ 的嵌套含水层参数）：空串 = 未指定 → 不发这个键
      for (const [key, v] of Object.entries(p.spec || {})) {
        if (v === '' || v === null || v === undefined) continue;
        if (TEXT_KEYS.has(key)) {
          out[key] = key === 'plume_mode' ? plumeModeValue(String(v)) : v;
          continue;
        }
        if (typeof v === 'string') {
          const n = Number(v);
          out[key] = Number.isFinite(n) ? n : v;
          continue;
        }
        out[key] = v;
      }
      // ⑥ 高级参数：逐项按 kind 解析
      const adv = p.adv || {};
      for (const f of POLL_ADV) {
        const v = adv[f.k];
        if (v === '' || v === null || v === undefined) continue;
        if (f.kind === 'b') { out[f.k] = Boolean(v); continue; }
        if (f.kind === 's') { out[f.k] = v; continue; }
        if (f.kind === 'L' || f.kind === 'C' || f.kind === 'B') {
          const arr = String(v).split(/[,，\s]+/).map(Number).filter(Number.isFinite);
          const want = f.kind === 'C' ? 12 : f.kind === 'B' ? 4 : 0;
          if (want && arr.length !== want) {
            k.log(`${f.label} 需要 ${want} 个数字（当前 ${arr.length} 个），本项已跳过`, 'warn');
            continue;
          }
          if (!arr.length) continue;
          out[f.k] = arr;
          continue;
        }
        // f / o / i / oi
        const n = Number(v);
        if (!Number.isFinite(n)) { k.log(`${f.label} 不是有效数字，本项已跳过`, 'warn'); continue; }
        out[f.k] = (f.kind === 'i' || f.kind === 'oi') ? Math.trunc(n) : n;
      }
      const cs = p.cellSchedule || {};
      if (Object.keys(cs).length) out.cell_schedule = cs;
      return out;
    }

    async function doPollution(gasYear?: number, plumeDay?: number) {
      const params = buildPollParams();
      if (gasYear !== undefined) params.gas_year = gasYear;
      if (plumeDay !== undefined) params.plume_day = plumeDay;
      const doPlume = Boolean(params.do_plume);
      const figs = ['gas_curve', 'gas_field', 'leachate', 'quality'];
      if (params.do_column) figs.push('column');
      if (doPlume) figs.push('plume_plan', 'plume_section');
      return k.run('跑污染分析', { action: 'pollution', params, figures: figs }, {
        viewKey: 'pollution',
        sub: SUB_DEFAULT.pollution,
      });
    }

    /** 从当前模型的库区列出单元（桌面「⟳ 列出单元」） */
    function listPollCells() {
      const b = S().build;
      const names = b.shape === 'cells' && b.cells.length
        ? b.cells.map((c) => c.name)
        : ['单元1'];
      const cs = S().poll.cellSchedule || {};
      const rows = names.map((n) => {
        const ov = cs[n];
        return { name: n, y0: ov?.[0] ?? '', y1: ov?.[1] ?? '', src: ov ? '已覆盖' : '自动' };
      });
      k.log(`列出当前模型库区：${names.join(' / ')}`, 'info');
      return rows;
    }

    // ------------------------------------------------------------------ 开挖

    function zoneParams(f?: FormState): Record<string, unknown> {
      const e = (f ?? S()).exc;
      return compact({
        layers: (e.layers || [])
          .filter((l) => l.name)
          .map((l) => [l.name, Number(l.zTop), Number(l.zBot),
            Number(l.gamma), Number(l.c), Number(l.phi)]),
        water_level: nu(e.waterLevel),
        gamma_w: nu(e.gWater),
        fs_threshold: nu(e.thr),
        depth_below: nu(e.depth),
        n_grid: nu(e.nGrid), n_R: nu(e.nR),
        do_scan: e.scanOn, scan_direction: e.scanDir,
        scan_n: nu(e.scanN), scan_coarse: e.scanCoarse,
      });
    }

    async function doExcCalc() {
      const p = zoneParams();
      if (!p.layers) {
        k.log('开挖稳定性需要材料分层（层名/层顶/层底/γ/c/φ）', 'err');
        k.setStatus('开挖稳定性失败 | 缺少材料分层');
        return null;
      }
      return k.run('算开挖稳定性', {
        action: 'excavation', params: p,
        figures: ['exc_arc', 'exc_levels', 'exc_fs_grid',
          ...(S().exc.scanOn ? [] : [])],
      }, { viewKey: 'excavation', sub: SUB_DEFAULT.excavation });
    }

    /** ⑦ 用的分区表：''/null 数值一律**不发键**（内核默认=沿坡顶线随形采样）。
        doPhased 与「导出报告」共用同一份口径，两处不再各写各的。 */
    function phasedZones(): Array<Record<string, unknown>> {
      const e = S().exc;
      return (e.zones || []).map((z, i) => {
        const poly = parsePoints(z.poly);
        return compact({
          name: z.name || `分区${i + 1}`,
          poly,
          // 早先 `z.topZ ?? undefined` 把 RowsEditor 清格的 '' 原样带进 JSON,
          // 内核 float('') 直接炸整个 action（表现为"未知错误"）
          top_z: nu(z.topZ),
          levels: parseLevels(z.levels || e.levelsText),
          temp_n: nu(z.tempN),
          order: z.order,
          cut_to_base: !!z.cutToBase,
          ...zoneSlopes(z, poly),
        }) as Record<string, unknown>;
      }).filter((z) => (z.poly as number[][]).length >= 3);
    }

    /** data.stages[] 与 files[] 联成阶段工件表（P3：3D/剖面切换不重跑内核） */
    function buildStageRes(r: { data?: unknown; files?: Array<{ file: string; url: string }> }):
      import('./run').StageRes[] | undefined {
      const d = r.data as { stages?: Array<Record<string, any>> } | undefined;
      if (!Array.isArray(d?.stages) || !d.stages.length) return undefined;
      const urls = new Map<string, string>();
      for (const f of r.files || []) urls.set(f.file, f.url);
      return d.stages.map((s, i) => ({
        stage: Number(s.stage ?? i),
        meshUrl: s.mesh_file ? urls.get(String(s.mesh_file)) : undefined,
        figUrl: s.section_png ? urls.get(String(s.section_png)) : undefined,
        bounds: (s.mesh_bounds as Record<string, number[]> | undefined) ?? null,
        worst: !!s.worst,
        FsArc: s.Fs_arc ?? null,
        removedM3: s.removed_m3 ?? null,
        cutVolumeM3: s.cut_volume_m3 ?? null,
      }));
    }

    /** 分区开挖逐阶段（⑦）：阶段剖面的下拉依赖这次返回的阶段数 */
    async function doPhased(stage?: string | number) {
      const zones = phasedZones();
      if (zones.length < 1) {
        k.log('分区开挖需要先划分开挖分区（画布切割线或手填顶点）', 'err');
        k.setStatus('分区开挖失败 | 无分区');
        return null;
      }
      const p: Record<string, unknown> = { ...zoneParams(), zones };
      if (stage !== undefined && stage !== 'most') p.stage = Number(stage);
      const r = await k.run('分区开挖逐阶段分析', {
        action: 'phased', params: p,
        figures: ['exc_phases', 'exc_stage'],
      }, {
        viewKey: 'excavation',
        sub: 'exc_stage',
        extra: (rr) => ({
          stageCount: Array.isArray((rr.data as any)?.stages)
            ? (rr.data as any).stages.length : undefined,
          stageRes: buildStageRes(rr as any),
        }),
      });
      if (r) {
        // 结果图必须**切到**子视图：FigureStage 读的是 ui 的 sub[view]，池子里的
        // sub 没人看 —— 旧版跑完逐阶段画面仍停在上一次 excavation 的 exc_arc
        ui.set('sub', { ...U().sub, excavation: 'exc_stage' });
      }
      return r;
    }

    /** 「查看阶段」下拉：工件齐了纯切 UI（3D+剖面），缺了才重跑内核 */
    async function onStagePick(v: string) {
      form.set('exc.stage', v);
      const entry = k.pool['excavation'];
      const res = entry?.stageRes || [];
      if (res.length) {
        const worst = res.find((s) => s.worst)?.stage;
        const target = v === 'most' || v === '' || v === 'null'
          ? (worst ?? res[res.length - 1]?.stage ?? null) : Number(v);
        ui.set('stage3d', Number.isFinite(target as number) ? target : null);
        ui.set('sub', { ...U().sub, excavation: 'exc_stage' });
        return;
      }
      await doPhased(v);
    }

    /**
     * 开挖分区计算：切割线 → 分区多边形（分区顶点由**内核算**，前端只给刀）。
     * 结果回填分区表 —— 桌面「打开发开挖分区画布」里的分区表就是这么来的。
     */
    async function refreshZones(opts?: { four?: boolean }) {
      const e = S().exc;
      const params: Record<string, unknown> = {};
      if (opts?.four) {
        params.four = true;                 // 一键切四区（内核对形心打正交两刀）
      } else {
        params.cuts = e.cuts || [];         // 内核每次都从整块轮廓按新 cuts 重切，故无需"撤销"
      }
      // P2.1: ②分级 / ①临时坡 必须随请求一起发（桌面 _exc_rebuild_zones 也是
      // "用当前 UI 值重建"）—— 早先只发 cuts, 内核用内置默认 [[6,2,3],[6,2,0]]
      // 生成后再回写, 每切一刀都把用户的分级设置悄悄冲掉
      const lv = parseLevels(e.levelsText);
      if (lv.length) params.levels = lv;
      const tn = nu(e.tempN);
      if (tn !== undefined) params.temp_n = tn;
      const prevRows = ((form.get('exc.zones') as ZoneRow[] | undefined) || [])
        .slice();
      const normPoly = (t: string) => (t || '').replace(/[\s;]/g, '');
      const r = await k.run('划分开挖分区', {
        action: 'zones', params, figures: [],
      }, { viewKey: 'excavation' });
      const zones = (r?.data?.zones) as any[] | undefined;
      // 画布底图轮廓：内核回带 outline(s) —— 多单元场地是**多块**真实堆体
      // 轮廓（P2.2），旧版只有单 outline；兼容读取
      const outlines = (r?.data?.outlines) as number[][][] | undefined;
      const outline = (r?.data?.outline) as number[][] | undefined;
      if (Array.isArray(outlines) && outlines.length > 1) {
        ui.set('excOutline', outlines);
      } else if (Array.isArray(outline) && outline.length >= 3) {
        ui.set('excOutline', outline);
      }
      if (Array.isArray(zones)) {
        // 重切后分区几何变了，逐边临时坡比**有意**不保留（旧的边与新边不是一
        // 一对应，留着会张冠李戴）；几何**没变**的行（如 4 区原地再切）则把
        // 用户逐行改过的顶标高/分级/临时坡/挖到基底原样保留。
        const sameGeom = zones.length === prevRows.length
          && zones.every((z, i) => normPoly(
            ((z.poly ?? []) as number[][]).map((p) => p.join(',')).join('\n'))
            === normPoly(prevRows[i].poly));
        form.set('exc.zones', zones.map((z, i) => {
          const prev = prevRows[i];
          return {
            name: sameGeom && prev?.name ? prev.name : String(z.name ?? `分区${i + 1}`),
            poly: ((z.poly ?? []) as number[][]).map((p) => p.join(',')).join('\n'),
            topZ: sameGeom ? (prev.topZ ?? null) : (z.top_z ?? null),
            levels: sameGeom && prev?.levels
              ? prev.levels
              : ((z.levels ?? []) as number[][]).map((l) => l.join(',')).join(';'),
            tempN: sameGeom ? prev.tempN : Number(z.temp_n ?? 2.0),
            cutToBase: sameGeom ? !!prev.cutToBase : false,
            order: Number(z.order ?? i + 1),
          };
        }));
        k.log(`已划分 ${zones.length} 个开挖分区（分区顶点由内核按切割线计算；`
          + '分级/临时坡随请求下发，不再被默认值覆盖）', 'ok');
      }
      return r;
    }

    // ------------------------------------------------------------------ 视图

    /** 模型类视图（等高线/坡度/剖面/库容曲线）按当前工程即时渲图 */
    async function ensureRendered(viewKey: string) {
      const spec = RENDERABLE[viewKey as keyof typeof RENDERABLE];
      if (!spec) return;
      if (k.pool[viewKey]?.figs?.length) return;   // 已有结果就不重算
      const params: Record<string, unknown> = { ...(spec.params || {}) };
      if (viewKey === 'section') {
        const c = S().calc.section;
        params.section = { A: [nu(c.Ax) ?? 0, nu(c.Ay) ?? 0], B: [nu(c.Bx) ?? 0, nu(c.By) ?? 0] };
      }
      if (viewKey === 'storage') {
        const d = nu(S().calc.storage.designLevel);
        params.curve_markers = d !== undefined ? [[d, '设计标高']] : undefined;
      }
      await k.run(`渲染${viewKey}`, {
        action: 'render', params: compact(params), figures: [spec.fig],
      }, { viewKey, sub: spec.fig });
    }

    /** 三维视图的叠加层指令（桌面 ⑥三维显示） */
    function overlaySpec(display?: FormState['display']): Record<string, unknown> | null {
      const d = display ?? S().display;
      const ov: Record<string, unknown> = {};
      // 桌面画三维图时，有危险滑面（X光）就不叠等高线 —— 两套线挤在一张图上
      // 谁都看不清（visualization.py:560 `if show_contour and not slip_xray`）。
      // 层级也跟桌面一致：5 层（`np.linspace(vmin, vmax, 5)`）。
      if (d.showContour && !d.showSlip) ov.contour = { n_levels: 5 };
      if (d.floodOn && nu(d.floodH) !== undefined) ov.flood = { level: nu(d.floodH) };
      if (d.showSlip) ov.slip = {};
      if (d.showDanger || d.showExcFs) ov.fs = { kind: d.showExcFs ? 'exc' : 'fill' };
      if (d.showHeat) ov.heat = {};
      return Object.keys(ov).length ? ov : null;
    }

    /** 叠加层要用的分析参数（进重导指纹；改无关字段不该触发重导） */
    function overlayParams(f?: FormState): Record<string, unknown> | null {
      const s = f ?? S();
      const d = s.display;
      const c = s.calc;
      if (!d.showSlip && !d.showDanger && !d.showExcFs && !d.showHeat) return null;
      const p: Record<string, unknown> = {};
      if (d.showSlip || d.showDanger) {
        Object.assign(p, compact({
          c: nu(c.stab.c), phi_deg: nu(c.stab.phi), gamma: nu(c.stab.gamma),
          ru: nu(c.stab.ru), threshold: nu(c.stab.thr),
          n_grid: nu(c.stab.nGrid), n_R: nu(c.stab.nR),
          n_sections: nu(c.stab.scanN), direction: c.stab.scanDir,
          section: { A: [nu(c.section.Ax) ?? 0, nu(c.section.Ay) ?? 0],
                     B: [nu(c.section.Bx) ?? 0, nu(c.section.By) ?? 0] },
        }));
      }
      if (d.showExcFs) {
        p.excavation_params = zoneParams(s);
      }
      if (d.showHeat) {
        p.settlement_params = compact({
          layers: (c.settle.soils || []).filter((s) => s.name && Number(s.h) > 0)
            .map((s) => compact({ name: s.name, thickness: Number(s.h),
              Es: nu(s.Es), e0: nu(s.e0), Cc: nu(s.Cc),
              sigma_p: nu(s.sigmaP), Cs: nu(s.Cs) })),
          waste_height: nu(c.settle.hW),
          gamma_waste: nu(c.settle.gWaste),
          gamma_soil: nu(c.settle.gSoil),
          gamma_water: nu(c.settle.gWater),
          water_table_depth: nu(c.settle.waterTable),
          sublayer_height: nu(c.settle.subH),
        });
      }
      return Object.keys(p).length ? p : null;
    }

    // ------------------------------------------------------------------ 文件

    async function doImport(file: File) {
      let proj: Record<string, unknown>;
      try {
        proj = JSON.parse(await file.text());
      } catch (e: any) {
        k.log(`工程文件不是合法 JSON：${e?.message ?? e}`, 'err');
        return;
      }
      const r = await kernelImport(proj, k.sid);
      if (!r.ok) {
        k.log(`打开工程失败：${r.error}`, 'err');
        k.setStatus(`打开工程失败 | ${r.error}`);
        return;
      }
      k.log(`已打开工程：${r.summary ?? ''}`, 'ok');
      // 回填表单（能识别的字段）
      const patch: Record<string, unknown> = {};
      const para = proj.parametric as boolean | undefined;
      const fp = proj.footprint_polygon as number[][] | undefined;
      if (proj.cells) {
        patch['build.shape'] = 'cells';
        patch['build.cells'] = (proj.cells as any[]).map((c) => ({
          name: c.name ?? '单元', shape: 'poly',
          poly: (c.poly ?? []).map((p: number[]) => p.join(',')).join('\n'),
          arcs: Array.isArray(c.arcs) ? JSON.stringify(c.arcs) : '',
          L: 300, W: 200, z0: Number(c.z0 ?? 0),
          height: Number(c.height ?? 20), n: Number(c.n ?? 4),
          designH: c.design_H != null ? String(c.design_H) : '',
          slopes: Array.isArray(c.slopes) ? c.slopes : undefined,
        }));
      } else if (para && fp) {
        // ⚠ footprint_polygon 存的是**加密后**的折线；带弧的工程必须回到
        //   poly_coarse（画布上那几条真母边）+ arcs，否则重开一次工程就变成
        //   上百个碎点，再建模时还会在碎点上二次加密。
        const c0 = Array.isArray(proj.cells) ? (proj.cells as any[])[0] : undefined;
        const coarse = Array.isArray(c0?.poly_coarse) && c0.poly_coarse.length >= 3
          ? (c0.poly_coarse as number[][]) : fp;
        patch['build.shape'] = 'poly';
        patch['build.polyText'] = coarse.map((p) => p.join(',')).join('\n');
        patch['build.polyArcs'] = Array.isArray(c0?.arcs) ? JSON.stringify(c0.arcs) : '';
        patch['build.z0'] = Number(proj.param_z0 ?? 0);
        patch['build.height'] = Number(proj.param_H ?? 20);
        patch['build.slopeN'] = Number(proj.param_n ?? 4);
      } else if (Array.isArray(proj.base_points)) {
        patch['build.mode'] = 'points';
        patch['build.basePtsText'] = (proj.base_points as number[][])
          .map((p) => p.join(',')).join('\n');
        if (Array.isArray(proj.top_points)) {
          patch['build.topPtsText'] = (proj.top_points as number[][])
            .map((p) => p.join(',')).join('\n');
        }
        patch['build.interpMethod'] = String(proj.interp_method ?? 'linear');
        patch['build.topMode'] = String(proj.top_mode ?? 'level');
        if (proj.design_level != null) patch['build.designLevel'] = Number(proj.design_level);
      }
      if (proj.site_name) patch['build.siteName'] = String(proj.site_name);
      if (Array.isArray(proj.waste_layers)) {
        patch['build.layers'] = (proj.waste_layers as any[]).map((l) => ({
          name: String(l[0]), h: Number(l[1]), gamma: Number(l[2]),
        }));
      }
      if (Object.keys(patch).length) form.patch(patch);
      k.setMeshKey((n) => n + 1);
      k.setPool({});
    }

    /** 另存工程（桌面「◉ 保存工程」的 Web 等价物 = 会话 project.json） */
    function doSaveProject() {
      download('/api/kernel3d/project/active',
        `landfill3d-project-${k.sid.slice(0, 8)}.json`);
      k.log('已下载工程存档（等价桌面「另存工程」）', 'ok');
    }

    /** 导出分析报告：内核 report.txt，或桌面同款的 Word / Excel 汇总 */
    async function doExportReport(kind: 'txt' | 'docx' | 'xlsx') {
      if (kind === 'txt') {
        // 简报是**每次分析各自**落盘的，早先用 Object.keys(pool)[0] —— 拿到的
        // 是池子插入顺序里的第一个视图（可能是三天前那次库容），与当前画面无关。
        const e = latestReportEntry();
        if (e?.reportUrl) {
          download(e.reportUrl);
          return;
        }
        k.log('先生成一次分析（勾选简报）才有 TXT 报告可下载', 'warn');
        return;
      }
      const p = buildPollParams();
      const r = await k.run(`导出 ${kind.toUpperCase()} 汇总`, {
        action: 'export',
        params: {
          format: kind,
          pollution: true, pollution_params: p,
          excavation: Boolean((S().exc.layers || []).length),
          excavation_params: zoneParams(),
          // S3.6: 内核 h_export 只在 `phased && zones && layers` 三者齐时才算
          // 阶段表 —— 早先一个都没传, Word/Excel 里从来没有逐阶段开挖结果
          zones: phasedZones(),
          phased: phasedZones().length >= 2,
          stage: (S().exc.stage && S().exc.stage !== 'most')
            ? Number(S().exc.stage) : undefined,
        },
        figures: [],
      }, { viewKey: '3d' });
      const f = (r?.files || []).find((x) => x.kind !== 'figure_export');
      if (f) download(f.url, f.file);
    }

    /** 「⤓ 导出当前图」：PNG 300dpi / PDF / SVG / 底层数据 CSV */
    async function doFigureExport(fmt: 'png' | 'pdf' | 'svg' | 'csv') {
      const u = U();
      const view = u.view;
      const entry = k.pool[view];
      if (fmt === 'csv') return doFigureCsv(view, entry?.sub);
      const figs = entry?.lastRun?.figures?.length
        ? entry.lastRun.figures
        : entry?.figs?.map((f) => f.key).slice(0, 1) || [];
      if (!figs.length) {
        k.log('当前视图还没有可导出的图 —— 先跑一次对应计算', 'warn');
        return;
      }
      // 同一份结果重复导出不再重跑内核：PoolEntry.exports 这个缓存早就声明了，
      // 只是一直没人读写它（改一次参数 → run() 把 exports 清空，缓存自然失效）
      const cacheKey = `${fmt}@300`;
      const hit = entry?.exports?.[cacheKey];
      if (hit) {
        download(hit.url, hit.file);
        k.log(`${fmt.toUpperCase()} 出版件走缓存（同一结果重复导出不重算）`, 'ok');
        return;
      }
      const action = entry?.lastRun?.action ?? 'render';
      const params = entry?.lastRun?.params ?? renderParamsFor(view);
      const r = await k.run(`导出当前图 ${fmt.toUpperCase()}`, {
        action, params, figures: figs, fig_export: { format: fmt, dpi: 300 },
      }, { viewKey: view, sub: entry?.sub });
      const f = (r?.files || []).find((x) => x.kind === 'figure_export');
      if (!f) return;
      k.setPool((p) => {
        const prev = p[view];
        if (!prev) return p;
        return { ...p, [view]: {
          ...prev,
          exports: { ...(prev.exports || {}), [cacheKey]: { url: f.url, file: f.file } },
        } };
      });
      download(f.url, f.file);
    }

    /** 「底层数据 CSV…（当前图的数据表）」—— 内核有映射才行，无映射回退结果表 */
    async function doFigureCsv(view?: string, sub?: string) {
      const u = U();
      const vk = view ?? u.view;
      const entry = k.pool[vk];
      const r = await k.run('导出当前图底层数据 CSV', {
        action: 'export',
        params: {
          format: 'csv', view: entry?.lastRun?.action ?? vk, sub: sub ?? entry?.sub,
          pollution: true, pollution_params: buildPollParams(),
          excavation: Boolean((S().exc.layers || []).length),
          excavation_params: zoneParams(),
        },
        figures: [],
      }, { viewKey: vk });
      const f = (r?.files || []).find((x) => x.kind !== 'figure_export');
      if (f) { download(f.url, f.file); return; }
      // 回退：把结果表导成 CSV（与桌面「无底层映射回退结果表」同策）
      const t = entry?.table;
      if (t?.cols?.length && t.rows?.length) {
        downloadTableCsv(t.cols, t.rows, `${vk}-结果表.csv`);
        k.log('该图无底层数据映射，已回退导出结果表', 'warn');
      } else {
        k.log('既无底层数据映射，也没有结果表可导', 'warn');
      }
    }

    /** 有简报的池子条目里挑最近一次（当前视图优先） */
    function latestReportEntry(): PoolEntry | undefined {
      const cur = k.pool[U().view];
      if (cur?.reportUrl) return cur;
      const withR = Object.values(k.pool).filter((e) => e?.reportUrl) as PoolEntry[];
      if (!withR.length) return undefined;
      return withR.reduce((a, b) => ((a.lastAt ?? 0) >= (b.lastAt ?? 0) ? a : b));
    }

    /** 库容曲线 CSV（桌面「导出库容曲线 CSV」） */
    function doCurveCsv() {
      const c = k.pool.storage?.curve;
      if (!c) { k.log('先算一次库容曲线', 'warn'); return; }
      const rows = (c.levels_m || []).map((lv, i) => [
        lv, c.volume_m3?.[i], c.area_m2?.[i]]);
      downloadTableCsv(['填埋标高(m)', '累计库容(m³)', '库盆面积(m²)'], rows, '库容曲线.csv');
    }

    function renderParamsFor(view: string): Record<string, unknown> {
      const spec = RENDERABLE[view as keyof typeof RENDERABLE];
      return { ...(spec?.params || {}) };
    }

    // ------------------------------------------------------------------ 工具

    function resetForm() {
      form.reset(defaultForm());
      k.log('已恢复全部参数为桌面默认值', 'ok');
    }

    /**
     * 取消开挖（桌面「↩ 取消开挖」）：清掉分区表后**重发完整 spec**（此时
     * buildSpec 已不含 excavation 键）= 还原开挖前模型。
     *
     * 与桌面的语义差异：桌面是还原建模时留的快照，这里是"按当前表单重建"。
     * 所以应用开挖后又改了底形尺寸再点取消，结果会与桌面不同 —— 界面上
     * 已在按钮 tooltip 里写明。
     */
    async function doUndoExc() {
      form.set('exc.zones', []);
      form.set('exc.cuts', []);
      form.set('display.showExcFs', false);
      let spec: Record<string, unknown>;
      try {
        spec = buildSpec();          // 此时 exc.zones 已空 → 不含 excavation
      } catch (e: any) {
        k.log(`取消开挖失败（重建参数有误）：${e?.message ?? e}`, 'err');
        return null;
      }
      if (spec.excavation) delete spec.excavation;
      const r = await k.run('取消开挖（还原开挖前模型）',
        { action: 'model', spec, figures: [] }, { viewKey: '3d' });
      if (r) k.afterBuild(r);
      return r;
    }

    return {
      // 建模
      buildSpec, doBuild, doUndoExc, showKernelImage,
      // 计算
      doStorage, doSlope, doSection, doSettle, doStab, applyScanSection,
      // 污染
      doPollution, listPollCells,
      // 开挖
      doExcCalc, doPhased, onStagePick, refreshZones, zoneParams,
      // 视图
      ensureRendered, overlaySpec, overlayParams,
      // 文件
      doImport, doSaveProject, doExportReport, doFigureExport, doFigureCsv,
      doCurveCsv, renderParamsFor, resetForm,
    };
  }, [form, ui, k]);
}

// ---------------------------------------------------------------- 小工具

/** "x,y" 每行一个 → [[x,y],...]。keepZ：测点路线要保留第三列高程。 */
export function parsePoints(text: string, keepZ = false): number[][] {
  return (text || '').split(/[\n;]+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/[,，\s]+/).map(Number))
    .filter((p) => p.length >= 2 && p.every((v) => Number.isFinite(v)))
    // ⚠ 只有测点路线能带第三列：多边形/分区顶点必须保持 (M,2)，
    //   内核用 matplotlib.Path 判内外，而 Path 只接受 (N,2) 顶点。
    .map((p) => (keepZ && p.length >= 3 ? [p[0], p[1], p[2]] : [p[0], p[1]]));
}

/** "6,2,3;6,2,0" 或换行分隔 → [[坡高,坡比,马道宽],...] */
export function parseLevels(text: string): number[][] {
  return (text || '').split(/[\n;]+/)
    .map((l) => l.trim()).filter(Boolean)
    .map((l) => l.split(/[,，\s]+/).map(Number))
    .filter((lv) => lv.length >= 2 && lv.every((v) => Number.isFinite(v)))
    .map((lv) => [lv[0], lv[1], lv[2] ?? 0]);
}

/**
 * 分区逐边临时坡比 → 内核 `slopes` 键。
 *
 * 内核 `excavation.normalize_zone` 的硬要求：**个数必须等于坡顶线顶点数**，
 * 且每条都是有限正数 —— 所以画布上只设了其中几条时，其余必须补成该区 temp_n，
 * 不能留 null。一条都没设时干脆不发这个键（走内核默认，行为与从前一致）。
 */
function zoneSlopes(z: ZoneRow, poly: number[][]): Record<string, unknown> {
  const es = z.slopes || [];
  if (!es.length || poly.length < 3) return {};
  const set = es.some((v) => v !== null && v !== undefined && Number(v) > 0);
  if (!set) return {};
  const t = nu(z.tempN) ?? 2.0;
  return {
    slopes: Array.from({ length: poly.length }, (_, i) => {
      const n = Number(es[i]);
      return Number.isFinite(n) && n > 0 ? n : t;
    }),
  };
}

/** 弧稀疏表 JSON → 内核/画布通用的 [[母边序号, mx, my], ...]（空则 undefined = 不发键） */
function arcsOf(json: string | undefined, m: number): number[][] | undefined {
  if (!json || !json.trim()) return undefined;
  let list: unknown;
  try { list = JSON.parse(json); } catch { return undefined; }
  if (!Array.isArray(list) || !list.length) return undefined;
  const out: number[][] = [];
  for (const e of list) {
    if (!Array.isArray(e) || e.length < 3) continue;
    const i = Number(e[0]), mx = Number(e[1]), my = Number(e[2]);
    if (Number.isFinite(i) && i >= 0 && i < m && Number.isFinite(mx) && Number.isFinite(my)) {
      out.push([i, mx, my]);
    }
  }
  return out.length ? out : undefined;
}

/**
 * 内核回带的示例场几何（`data.demo.spec`）→ 表单 patch。
 *
 * 与 `buildSpec()` 的键一一对应（cells / polygon / points 三条路线），
 * 于是「加载示例 → 改参数 → 重新建模 / 应用开挖」始终在**同一个场地**上操作
 * —— 桌面靠 `_restore_param_project` 达到同样效果。
 */
export function demoFormPatch(spec: Record<string, any> | undefined,
                              fallback: { gridNx: number }): Record<string, unknown> {
  if (!spec) return {};
  const out: Record<string, unknown> = {};
  if (spec.grid_nx) out['build.gridNx'] = Number(spec.grid_nx);
  if (spec.site_name) out['build.siteName'] = String(spec.site_name);
  if (Array.isArray(spec.layers)) {
    out['build.layers'] = spec.layers.map((l: any[]) => ({
      name: String(l[0]), h: Number(l[1]), gamma: Number(l[2]),
    }));
  }
  if (Array.isArray(spec.cells) && spec.cells.length) {
    out['build.mode'] = 'param';
    out['build.shape'] = 'cells';
    out['build.cells'] = spec.cells.map((c: any) => ({
      name: String(c.name ?? '单元'),
      shape: 'poly',
      poly: ((c.poly ?? []) as number[][]).map((p) => p.join(',')).join('\n'),
      arcs: Array.isArray(c.arcs) ? JSON.stringify(c.arcs) : '',
      L: 300, W: 200,
      z0: Number(c.z0 ?? 0), height: Number(c.height ?? 20), n: Number(c.n ?? 4),
      // 设计堆高带回去，否则重建时「剩余库容」分列的依据就丢了
      designH: c.design_H != null ? String(c.design_H) : '',
      // 逐边坡比带回去，否则重建时示例场那套 1:1.5~1:5 会退化成统一坡比
      slopes: Array.isArray(c.slopes) ? c.slopes : undefined,
    }));
  } else if (Array.isArray(spec.polygon) && spec.polygon.length >= 3) {
    out['build.mode'] = 'param';
    out['build.shape'] = 'poly';
    const coarse = Array.isArray(spec.poly_coarse) && spec.poly_coarse.length >= 3
      ? (spec.poly_coarse as number[][]) : (spec.polygon as number[][]);
    out['build.polyText'] = (coarse as number[][])
      .map((p) => `${+Number(p[0]).toFixed(2)},${+Number(p[1]).toFixed(2)}`).join('\n');
    out['build.polyArcs'] = Array.isArray(spec.arcs) ? JSON.stringify(spec.arcs) : '';
    out['build.z0'] = Number(spec.z0 ?? 0);
    out['build.height'] = Number(spec.height ?? 20);
    out['build.slopeN'] = Number(spec.n ?? 4);
  } else if (spec.source === 'points' && Array.isArray(spec.base_points)) {
    out['build.mode'] = 'points';
    out['build.basePtsText'] = (spec.base_points as number[][])
      .map((p) => p.join(',')).join('\n');
    out['build.topPtsText'] = Array.isArray(spec.top_points)
      ? (spec.top_points as number[][]).map((p) => p.join(',')).join('\n') : '';
    out['build.interpMethod'] = String(spec.interp_method ?? 'linear');
    out['build.topMode'] = String(spec.top_mode ?? 'level');
    if (spec.design_level != null) out['build.designLevel'] = Number(spec.design_level);
  }
  void fallback;
  return out;
}

/** 矩形单元 → 多边形（与内核 rect_polygon 同约定：以 (cx,cy) 为中心） */
export function rectPoly(L: number, W: number, cx = 0, cy = 0): number[][] {
  const l = L / 2, w = W / 2;
  return [[cx - l, cy - w], [cx + l, cy - w], [cx + l, cy + w], [cx - l, cy + w]];
}

export { SCAN_DIRS, VIEWS };

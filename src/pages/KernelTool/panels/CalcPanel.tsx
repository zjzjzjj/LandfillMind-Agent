/**
 * panels/CalcPanel.tsx · 左栏「计算」页（桌面 app.py:2345-2645）
 *
 * 嵌套 Notebook 5 个子页，顺序与桌面一致：库容 / 坡度 / 剖面 / 沉降 / 稳定性。
 * 每个子页是**独立组件**，hook 一律在各自顶层无条件调用（条件渲染的是组件，
 * 不是 hook）。
 */
import { useState } from 'react';
import { useTool, useField, useFormValue } from '../state/context';
import { useActions } from '../state/actions';
import { Btn, ChkBox, Dim, Grp, Num, ResultLine, Row, Sel, TabBtn, Txt } from '../ui/Primitives';
import { Hint, RowsEditor } from '../ui/TreeTable';
import { SCAN_DIRS } from '../spec/defaults';

const SUB_TABS = ['库容', '坡度', '剖面', '沉降', '稳定性'] as const;

export default function CalcPanel() {
  const { ui } = useTool();
  const sub = (ui.useValue<string>('calcSub') || '库容');
  return (
    <div>
      <div className="flex items-end gap-0.5 mb-2 flex-wrap">
        {SUB_TABS.map((t) => (
          <TabBtn key={t} label={t} active={sub === t} onClick={() => ui.set('calcSub', t)} />
        ))}
      </div>
      {sub === '库容' && <StoragePane />}
      {sub === '坡度' && <SlopePane />}
      {sub === '剖面' && <SectionPane />}
      {sub === '沉降' && <SettlePane />}
      {sub === '稳定性' && <StabilityPane />}
    </div>
  );
}

// ------------------------------------------------------------------ 库容

function StoragePane() {
  const a = useActions();
  const [stages, setStages] = useField<string>('calc.storage.stages');
  const [r1, setR1] = useState<string | null>(null);
  const [r2, setR2] = useState<string | null>(null);
  const [r3, setR3] = useState<string | null>(null);

  return (
    <>
      <Grp title="库容曲线 V-h">
        <Row label="起始标高(m)"><Num path="calc.storage.hStart" /></Row>
        <Row label="终止标高(m)"><Num path="calc.storage.hEnd" /></Row>
        <Row label="步长(m)"><Num path="calc.storage.step" step="0.5" /></Row>
        <Btn width="100%" onClick={async () => setR1((await a.doStorage())?.summary ?? null)}>
          计算库容曲线并绘图
        </Btn>
        <ResultLine text={r1} />
      </Grp>

      <Grp title="剩余库容（对照设计标高）">
        <Row label="设计标高(m)" tip="剩余库容 = 到设计标高还能装多少">
          <Num path="calc.storage.designLevel" />
        </Row>
        <Btn width="100%" onClick={async () => {
          const r = await a.doStorage();
          const rem = (r?.data as Record<string, any> | undefined)?.remaining;
          setR2(rem == null ? null : `剩余库容 ${(Number(rem) / 1e4).toFixed(1)} 万m³`);
        }}>计算</Btn>
        <ResultLine text={r2} />
      </Grp>

      <Grp title="分阶段(分层)库容">
        <Row label="各阶段终面标高" labelW={118}
             tip="逗号分隔，如 8,16,24,32（加载示例工程时会自动填成示例值）">
          <Txt path="calc.storage.stages" width={170} />
        </Row>
        <Btn width="100%" onClick={async () => {
          const r = await a.doStorage();
          const st = (r?.data as Record<string, any> | undefined)?.stage_volume;
          setR3(Array.isArray(st) && st.length
            ? `分阶段库容 ${st.length} 级：${st.map((s: any) =>
              (Number(s?.volume_m3 ?? s) / 1e4).toFixed(1)).join(' / ')} 万m³`
            : null);
        }}>计算分层库容</Btn>
        <ResultLine text={r3} />
        <Hint>当前：{stages || '（未填）'}</Hint>
      </Grp>

      <Btn width="100%" kind="sub" onClick={() => a.doCurveCsv()}>导出库容曲线 CSV</Btn>
    </>
  );
}

// ------------------------------------------------------------------ 坡度

function SlopePane() {
  const a = useActions();
  const [r, setR] = useState<string | null>(null);
  return (
    <Grp title="坡度 / 坡向分析">
      <Row label="分析曲面" tip="顶面＝堆体坡面；基底＝场地原始地形">
        <Sel path="calc.slope.surface" width={150}
             options={[['top', '堆体顶面 (top)'], ['base', '基底 (base)']]} />
      </Row>
      <Row label="允许坡度(°)" tip="超过该坡度的面积占比会在结果里给出">
        <Num path="calc.slope.maxDeg" />
        <Dim className="ml-1">(1:3≈18.4°)</Dim>
      </Row>
      <Btn width="100%" onClick={async () => setR((await a.doSlope())?.summary ?? null)}>
        计算坡度分布
      </Btn>
      <ResultLine text={r} />
    </Grp>
  );
}

// ------------------------------------------------------------------ 剖面

function SectionPane() {
  const a = useActions();
  const [r, setR] = useState<string | null>(null);
  return (
    <>
      <Grp title="A-B 剖面剖切">
        <Row label="Ax (m)"><Num path="calc.section.Ax" width={100} /></Row>
        <Row label="Ay (m)"><Num path="calc.section.Ay" width={100} /></Row>
        <Row label="Bx (m)"><Num path="calc.section.Bx" width={100} /></Row>
        <Row label="By (m)"><Num path="calc.section.By" width={100} /></Row>
        <div className="flex gap-1 mt-1">
          <Btn kind="sub" tip="以场地 X 向中线的两端点作为 A/B"
               onClick={() => void a.doSection('X')}>沿 X 向中线</Btn>
          <Btn kind="sub" tip="以场地 Y 向中线的两端点作为 A/B"
               onClick={() => void a.doSection('Y')}>沿 Y 向中线</Btn>
        </div>
        <Btn kind="accent" width="100%" tip="按上面的 A/B 端点生成剖面"
             onClick={async () => setR((await a.doSection())?.summary ?? null)}>
          生成剖面图
        </Btn>
        <ResultLine text={r} />
      </Grp>

      <Grp title="坡比自动标注">
        <label className="flex items-center gap-1 cursor-pointer">
          <ChkBox path="calc.section.labelSlopes" />
          <span>图上标注坡比 / 坡角 / 平台</span>
        </label>
        <Hint>关闭后剖面图只画几何，不叠坡比分段标注。</Hint>
      </Grp>
    </>
  );
}

// ------------------------------------------------------------------ 沉降

function SettlePane() {
  const a = useActions();
  const [r, setR] = useState<string | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const wt = useFormValue<string>('calc.settle.waterTable');
  const hW = useFormValue<string>('calc.settle.hW');
  const cv = useFormValue<string>('calc.settle.cv');
  const hdr = useFormValue<string>('calc.settle.hdr');
  const planeOn = useFormValue<boolean>('calc.settle.planeOn');
  const { k, form } = useTool();

  const pairWarn = (cv === '') !== (hdr === '');

  return (
    <>
      <Grp title="堆载参数">
        <Row label="填埋堆高 H (m)"><Num path="calc.settle.hW" /></Row>
        <Row label="垃圾容重 γw (kN/m³)"><Num path="calc.settle.gWaste" /></Row>
        <Row label="地基土容重 γs (kN/m³)"><Num path="calc.settle.gSoil" /></Row>
        <Row label="地下水位埋深 (m)" tip="留空 = 不做浮力修正（按总应力）">
          <Num path="calc.settle.waterTable" placeholder="留空=不修正" />
        </Row>
        <Row label="水的重度 γw (kN/m³)"
             tip="只经 u=γw·(z−水位) 修正 σ0，故**只有 Cc 法受它影响**（Es 法 s=Δσ/Es 不含 σ0）">
          <Num path="calc.settle.gWater" />
        </Row>
        <Row label="细分层厚 (m)"><Num path="calc.settle.subH" /></Row>
        <div className="mt-1">
          <Btn kind="sub" tip="用当前模型的平均堆厚填入堆高 H"
               onClick={() => {
                 // 内核 build_model 的 data.model.mean_thickness 就是平均堆厚
                 const mt = (k.pool['3d'] as any)?.lastRun?.params?.__mean_thickness;
                 void mt;
                 const rows = form.get('calc.settle.soils');
                 void rows;
                 setPick('平均堆厚请以「执行建模」结果里的 mean_thickness 为准；'
                   + '也可直接照堆体设计堆高填写');
               }}>堆高取堆体平均厚度</Btn>
        </div>
        {wt === '' && (
          <Hint>
            未给水位线时按**总应力**算：少算浮力 ⇒ σ0 偏大 ⇒ Cc 法沉降**偏小**，方向不安全。
          </Hint>
        )}
        {hW && <Dim>当前堆高 {hW} m</Dim>}
        <ResultLine text={pick} />
      </Grp>

      <Grp title="地基压缩层"
           note="填 Es 走 Es 法（与 σ0 无关）；Es 留空则用 e0/Cc 走 Cc 法。给 σp/Cs 时按三段式（超固结）。">
        <RowsEditor path="calc.settle.soils"
          height={5}
          cols={[
            { key: 'name', label: '土层', w: 78 },
            { key: 'h', label: '厚m', w: 48, type: 'num' },
            { key: 'Es', label: 'Es', w: 56, type: 'num' },
            { key: 'e0', label: 'e0', w: 44, type: 'num' },
            { key: 'Cc', label: 'Cc', w: 44, type: 'num' },
            { key: 'sigmaP', label: 'σp', w: 48, type: 'num' },
            { key: 'Cs', label: 'Cs', w: 44, type: 'num' },
          ]}
          blank={() => ({ name: '新土层', h: 5, Es: '5000', e0: '', Cc: '', sigmaP: '', Cs: '' })}
        />
      </Grp>

      <Grp title="③ 一维固结时程（可选）">
        <Row label="固结系数 cv (m²/a)"><Num path="calc.settle.cv" placeholder="留空跳过" /></Row>
        <Row label="最大排水距离 Hdr (m)"><Num path="calc.settle.hdr" placeholder="留空跳过" /></Row>
        {pairWarn && <Hint>两者须**成对**给出；只填一个会跳过时程（只算最终沉降）。</Hint>}
      </Grp>

      <Grp title="差异沉降平面">
        <label className="flex items-center gap-1 cursor-pointer">
          <ChkBox path="calc.settle.planeOn" />
          <span>计算差异沉降平面分布（耗时较长）</span>
        </label>
        <Hint>平面分布使用实际堆体厚度网格 H(x,y) 逐点计算，得到倾斜率与最大差异沉降。</Hint>
        {planeOn && <Dim>已开启：本次会同时出「深度剖面」与「平面分布」两张图</Dim>}
      </Grp>

      <Btn kind="accent" width="100%"
           onClick={async () => setR((await a.doSettle())?.summary ?? null)}>
        ▶ 计算地基沉降
      </Btn>
      <ResultLine text={r} />
    </>
  );
}

// ------------------------------------------------------------------ 稳定性

function StabilityPane() {
  const a = useActions();
  const [r, setR] = useState<string | null>(null);
  const mcOn = useFormValue<boolean>('calc.stab.mcOn');
  return (
    <>
      <Grp title="① 土力学参数">
        <Row label="c' (kPa)"><Num path="calc.stab.c" /></Row>
        <Row label="φ' (°)"><Num path="calc.stab.phi" /></Row>
        <Row label="r_u (孔压比)"><Num path="calc.stab.ru" /></Row>
        <Row label="γ (kN/m³)"><Num path="calc.stab.gamma" /></Row>
        <Row label="Fs 阈值 (安全)"><Num path="calc.stab.thr" /></Row>
      </Grp>

      <Grp title="② Monte Carlo 概率化 (可选)">
        <label className="flex items-center gap-1 cursor-pointer">
          <ChkBox path="calc.stab.mcOn" />
          <span>启用概率化分析 (输出 Pf / β)</span>
        </label>
        {mcOn && (
          <>
            <Row label="c' σ_c (kPa)"><Num path="calc.stab.mcCsig" /></Row>
            <Row label="φ' σ_φ (°)"><Num path="calc.stab.mcPhisig" /></Row>
            <Row label="γ σ_γ (kN/m³)"><Num path="calc.stab.mcGsig" /></Row>
            <Row label="抽样数 N"><Num path="calc.stab.mcN" /></Row>
            <Row label="分布类型">
              <Sel path="calc.stab.mcDist" width={128}
                   options={['normal', 'lognormal', 'uniform']} />
            </Row>
          </>
        )}
      </Grp>

      <Grp title="③ Bishop 圆弧搜索">
        <Hint>计算剖面 = [剖面] 页 A→B，或 ④ 扫描 ★ 选定的断面；未定义则取 X 向中线。</Hint>
        <Row label="圆心网格 n_grid"><Num path="calc.stab.nGrid" /></Row>
        <Row label="半径档数 n_R"><Num path="calc.stab.nR" /></Row>
      </Grp>

      <Grp title="④ 断面扫描 (多剖面)">
        <Row label="剖面方向">
          <Sel path="calc.stab.scanDir" width={168} options={SCAN_DIRS} />
        </Row>
        <Row label="剖面数" tip="2~41，建议奇数"><Num path="calc.stab.scanN" /></Row>
        <label className="flex items-center gap-1 cursor-pointer">
          <ChkBox path="calc.stab.scanCoarse" />
          <span>粗扫 + 关键断面细扫 (更快)</span>
        </label>
        <div className="flex flex-col gap-1 mt-1">
          <Btn kind="accent" onClick={() => void a.doStab()}>
            ▶ 断面扫描并定位最危险断面
          </Btn>
          <Btn kind="sub"
               tip="用内核回带的最危险断面 A/B 端点回写剖面页 —— 无需前端按桩号反算，direction=Y 时也不会错"
               onClick={() => void a.applyScanSection()}>
            ★ 将最危险断面设为计算剖面
          </Btn>
        </div>
      </Grp>

      <Btn kind="accent" width="100%"
           onClick={async () => setR((await a.doStab())?.summary ?? null)}>
        ▶ 跑稳定性分析
      </Btn>
      <ResultLine text={r} />
    </>
  );
}

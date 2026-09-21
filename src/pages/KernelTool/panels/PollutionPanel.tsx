/**
 * panels/PollutionPanel.tsx · 左栏「污染」页（桌面 app.py:2648-2996）
 *
 * ①~⑤ 的表单结构由 spec/poll.ts 的 POLL_GROUPS 驱动；
 * **初值来自内核 `info.data.defaults.pollution.default_params`** —— 与桌面
 * 同源（app.py:2659 的 `d = poll.default_params()`），不在这里硬编码。
 * ⑥ 高级参数逐项镜像桌面的 `_POLL_ADV_SPEC`。
 */
import { useEffect, useState } from 'react';
import { useTool, useField, useFormValue } from '../state/context';
import { useActions } from '../state/actions';
import { Btn, ChkBox, Dim, Grp, ResultLine, Row, Sel, Txt } from '../ui/Primitives';
import { Hint, Tree } from '../ui/TreeTable';
import { POLL_GROUPS, POLL_ADV_GROUPS, advByGroup, plumeModeValue,
         type PollField, type PollAdvField } from '../spec/poll';
import { fetchKernelInfo } from '../state/api';

const POLL_PLANE_LABELS = ['平面（含水层俯视）', '剖面（沿流向纵剖）'];

export default function PollutionPanel() {
  const { k, form } = useTool();
  const a = useActions();
  const [r, setR] = useState<string | null>(null);
  const [cellRows, setCellRows] = useState<Array<Record<string, unknown>>>([]);
  const [selCell, setSelCell] = useState<number | null>(null);
  const [ovY0, setOvY0] = useState('');
  const [ovY1, setOvY1] = useState('');
  const cells = useFormValue<unknown[]>('build.cells');
  const shape = useFormValue<string>('build.shape');
  const isMultiCell = shape === 'cells' && (cells?.length || 0) > 1;

  /** 初值：把内核 default_params 灌进 poll.spec / poll.adv（只做一次） */
  useEffect(() => {
    let alive = true;
    void (async () => {
      const info = k.info ?? await fetchKernelInfo();
      if (!alive || !info) return;
      if (!k.info) k.setKernelInfo(info);
      const d = (info.defaults?.pollution?.default_params || {}) as Record<string, unknown>;
      if (!Object.keys(d).length) return;
      const opts = info.options || {};
      // 三个下拉的内核默认是 None（内核留白由调用方选），桌面是**从选项表里取**
      // 的固定项 —— 不补的话下拉框会是空白（值为 ''，与任何选项都不匹配）。
      // 取法与桌面 app.py:2744/2796/2806 一致，defect 取第 2 项不是第 1 项。
      const FALLBACK: Record<string, string> = {
        climate_zone: (opts.climate_zone || [])[0] || '',
        liner: (opts.liner || [])[0] || '',
        defect_preset: (opts.defect || [])[1] || (opts.defect || [])[0] || '',
      };
      const patch: Record<string, unknown> = {};
      const allFields = [
        ...POLL_GROUPS.flatMap((g) => [...g.fields, ...(g.nested?.fields || [])]),
      ];
      for (const f of allFields) {
        if (f.kind === 'chk') { patch[`poll.spec.${f.k}`] = Boolean(d[f.k]); continue; }
        const raw = (d[f.k] === null || d[f.k] === undefined)
          ? (FALLBACK[f.k] ?? '') : d[f.k];
        patch[`poll.spec.${f.k}`] = fmt(raw);
      }
      for (const f of advFields()) {
        patch[`poll.adv.${f.k}`] = f.kind === 'b' ? Boolean(d[f.k]) : fmtAdv(f.kind, d[f.k]);
      }
      form.patch(patch);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const opts = k.info?.options || {};

  function optList(f: PollField): Array<string | [string, string]> {
    if (f.k === 'plume_mode') {
      const vals = opts.plume_mode || ['plan', 'section'];
      return vals.map((v, i) => [v, POLL_PLANE_LABELS[i] ?? v]);
    }
    return opts[f.opts || ''] || [];
  }

  return (
    <div>
      {POLL_GROUPS.map((g, gi) => (
        <Grp key={g.title} title={g.title} note={g.note}>
          {g.fields.map((f) => (
            <PollFieldRow key={f.k} f={f} base="poll.spec" options={optList(f)} />
          ))}
          {/* ① 之后插单元填埋年表（桌面把它嵌在 ① 里） */}
          {gi === 0 && (
            <fieldset className="mt-2 rounded"
                      style={{ border: '1px solid var(--border)', padding: '6px 8px 8px' }}>
              <legend style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                单元填埋年表（多单元场地可选覆盖）
              </legend>
              {!isMultiCell && (
                <Hint>当前不是多单元工程 —— 单元年表只在 shape=cells 且单元数 &gt;1 时可用。</Hint>
              )}
              <Tree cols={['单元', '起填', '填至', '来源']}
                    rows={cellRows.map((c) => [c.name, c.y0 || '—', c.y1 || '—', c.src])}
                    empty={isMultiCell ? '点「⟳ 列出单元」读入当前模型的库区' : '（不可用）'}
                    onRowClick={(i) => setSelCell(i)}
                    selected={selCell} />
              <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                <span>年</span>
                <input className="lf-input" style={{ width: 52 }} value={ovY0}
                       onChange={(e) => setOvY0(e.target.value)} />
                <span>至 年</span>
                <input className="lf-input" style={{ width: 52 }} value={ovY1}
                       onChange={(e) => setOvY1(e.target.value)} />
                <Btn kind="sub" disabled={selCell === null} onClick={() => {
                  if (selCell === null) return;
                  const nm = String(cellRows[selCell]?.name ?? '');
                  const y0 = Number(ovY0), y1 = Number(ovY1);
                  if (!nm || !Number.isFinite(y0) || !Number.isFinite(y1)) return;
                  const cs = { ...(form.get('poll.cellSchedule') as Record<string, [number, number]> || {}) };
                  cs[nm] = [y0, y1];
                  form.set('poll.cellSchedule', cs);
                  setCellRows((rs) => rs.map((c, i) => i === selCell
                    ? { ...c, y0, y1, src: '已覆盖' } : c));
                  k.log(`已将单元「${nm}」的填埋年表覆盖为 ${y0}–${y1} 年`, 'ok');
                }}>覆盖选中行</Btn>
                <Btn kind="sub" disabled={selCell === null} onClick={() => {
                  if (selCell === null) return;
                  const nm = String(cellRows[selCell]?.name ?? '');
                  const cs = { ...(form.get('poll.cellSchedule') as Record<string, [number, number]> || {}) };
                  delete cs[nm];
                  form.set('poll.cellSchedule', cs);
                  setCellRows((rs) => rs.map((c, i) => i === selCell
                    ? { ...c, y0: '', y1: '', src: '自动' } : c));
                }}>恢复自动</Btn>
                <Btn kind="sub" onClick={() => {
                  if (!isMultiCell) { k.log('单元年表只在多单元工程可用', 'warn'); return; }
                  setCellRows(a.listPollCells() as Array<Record<string, unknown>>);
                }}>⟳ 列出单元</Btn>
              </div>
              <Hint>
                先点「⟳ 列出单元」读入当前模型的库区；选中一行填起止年份后「覆盖选中行」。
                可只覆盖部分单元，其余仍按体积占比自动推断；改动在下次「跑污染分析」时生效。
              </Hint>
            </fieldset>
          )}
          {g.nested && (
            <fieldset className="mt-2 rounded"
                      style={{ border: '1px solid var(--border)', padding: '6px 8px 8px' }}>
              <legend style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{g.nested.title}</legend>
              {g.nested.fields.map((f) => (
                <PollFieldRow key={f.k} f={f} base="poll.spec" options={optList(f)} />
              ))}
            </fieldset>
          )}
        </Grp>
      ))}

      {/* ⑥ 高级参数 */}
      <Grp title="⑥ 高级参数（可选，默认值已按典型场地取好）">
        {advByGroup().map((g) => (
          <fieldset key={g.key} className="mt-1.5 rounded"
                    style={{ border: '1px solid var(--border)', padding: '6px 8px 8px' }}>
            <legend style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{g.title}</legend>
            {g.fields.map((f) => <AdvFieldRow key={f.k} f={f} />)}
          </fieldset>
        ))}
        <Hint>
          「柱入口边界」用 flux / concentration —— 内核 transport1d 只认这两个值
          （info.options.inlet 给的 "conc" 会被内核拒绝，故此处不用它）。
        </Hint>
      </Grp>

      <Btn kind="accent" width="100%" disabled={Boolean(k.busy)}
           onClick={async () => setR((await a.doPollution())?.summary ?? null)}>
        ▶ 跑污染分析
      </Btn>
      <ResultLine text={r} />
    </div>
  );
}

// ---------------------------------------------------------------- 行

function PollFieldRow({ f, base, options }: {
  f: PollField; base: string; options: Array<string | [string, string]>;
}) {
  const path = `${base}.${f.k}`;
  if (f.kind === 'chk') {
    return (
      <label className="flex items-center gap-1 cursor-pointer py-[3px]" title={f.tip}>
        <ChkBox path={path} />
        <span>{f.label}</span>
      </label>
    );
  }
  return (
    <Row label={f.label} tip={f.tip} labelW={126}>
      {f.kind === 'sel' ? (
        <Sel path={path} options={options} width={170} />
      ) : (
        <Txt path={path} width={110} />
      )}
    </Row>
  );
}

function AdvFieldRow({ f }: { f: PollAdvField }) {
  const path = `poll.adv.${f.k}`;
  if (f.kind === 'b') {
    return (
      <label className="flex items-center gap-1 cursor-pointer py-[3px]" title={f.tip}>
        <ChkBox path={path} />
        <span>{f.label}</span>
      </label>
    );
  }
  return (
    <Row label={f.label} tip={f.tip} labelW={126}>
      {f.kind === 's' ? (
        <Sel path={path} options={f.choices || []} width={140} />
      ) : (
        <Txt path={path} width={110}
             placeholder={f.kind === 'L' || f.kind === 'C' || f.kind === 'B'
               ? '逗号分隔，留空=默认' : '留空=默认'} />
      )}
    </Row>
  );
}

// ---------------------------------------------------------------- 工具

/** ⑥ 高级参数的全部字段（按组顺序展平） */
function advFields(): PollAdvField[] {
  return advByGroup().flatMap((g) => g.fields);
}

/** 普通字段初值 → 控件文本（空值语义：None → '' = 未指定） */
function fmt(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? '1' : '';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(+v.toFixed(6));
  return String(v);
}

/** 高级参数字段初值 → 控件文本（L/C/B 是逗号列表，o/oi 留空） */
function fmtAdv(kind: string, v: unknown): string {
  if (v === null || v === undefined) return '';
  if (kind === 'L' || kind === 'C' || kind === 'B') {
    return (Array.isArray(v) ? v : [v]).map((x) => Number(x)).join(',');
  }
  if (kind === 'i' || kind === 'oi') return String(Math.trunc(Number(v)));
  if (kind === 'f' || kind === 'o') return String(+Number(v).toFixed(6));
  return String(v);
}

export { plumeModeValue, Dim };

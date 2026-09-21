/**
 * chrome/BrandBar.tsx · 品牌条（桌面 app.py:639-689，h=60）
 *
 * 左：标题 + 副标题（版本号从内核 info 取，**不硬编码**）
 * 右：4 个 chip —— 模型 / 网格 / 插值 / 单元
 * 另加一个「← 返回智能体」：桌面靠关窗口退出，Web 全屏接管后需要显式出口。
 */
import { useNavigate } from 'react-router-dom';
import { useTool } from '../state/context';
import { useFormValue } from '../state/context';
import { useActions } from '../state/actions';

function Chip({ text }: { text: string }) {
  return (
    <span className="px-2 py-[3px] text-[11px] rounded"
          style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            color: 'var(--text-secondary)',
            whiteSpace: 'nowrap',
          }}>
      {text}
    </span>
  );
}

export default function BrandBar() {
  const nav = useNavigate();
  const { k } = useTool();
  const a = useActions();
  const ver = k.info?.landfill3d?.version;
  const physics = k.info?.landfill3d?.physics;

  // chips 的数据源：当前表单 + 上一次建模结果
  const siteName = useFormValue<string>('build.siteName');
  const gridNx = useFormValue<number>('build.gridNx');
  const interp = useFormValue<string>('build.interpMethod');
  const mode = useFormValue<string>('build.mode');
  const shape = useFormValue<string>('build.shape');
  const cells = useFormValue<unknown[]>('build.cells');

  const modelText = siteName?.trim()
    ? `模型：${siteName.trim()}`
    : (k.pool['3d'] ? '模型：已建模' : '模型：未就绪');
  const interpText = mode === 'points'
    ? `插值：${interp || '—'}`
    : `插值：${shape === 'cells' ? '多单元' : shape === 'poly' ? '多边形' : '矩形'}`;
  const cellText = shape === 'cells' && cells?.length ? `单元 ${cells.length} 块`
    : (shape === 'points' ? '测点插值' : '单块');

  return (
    <div className="flex items-center gap-3 px-3 shrink-0"
         style={{
           height: 60,
           background: 'var(--bg-base)',
           borderBottom: '1px solid var(--border)',
         }}>
      <button type="button" className="lf-btn shrink-0" style={{ padding: '3px 10px' }}
              onClick={() => nav('/chat/new')}
              title="回到智能体对话（桌面此处为关窗口退出）">
        ← 返回智能体
      </button>
      <div className="min-w-0">
        <h1 className="lf-brand-title leading-tight truncate" style={{ color: 'var(--text-primary)' }}>
          填埋场三维建模分析工具
        </h1>
        <p className="text-[11px] leading-tight" style={{ color: 'var(--text-muted)' }}>
          Landfill 3D Modeler &amp; Analyzer{ver ? `   v${ver}` : ''}
          {physics ? ` · 口径 ${physics}` : ''}
        </p>
      </div>
      <div className="flex-1" />
      <div className="flex items-center gap-2 flex-wrap justify-end">
        <Chip text={modelText} />
        <Chip text={`网格 ${gridNx || '—'}×${gridNx || '—'}`} />
        <Chip text={interpText} />
        <Chip text={cellText} />
        <button type="button" className="lf-btn" title="恢复全部参数为桌面默认值"
                onClick={() => a.resetForm()}>
          ↺ 复位参数
        </button>
      </div>
    </div>
  );
}

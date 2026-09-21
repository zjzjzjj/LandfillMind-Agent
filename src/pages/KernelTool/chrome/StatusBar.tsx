/**
 * chrome/StatusBar.tsx · 状态栏（桌面 app.py:4262-4275，h=32）
 *
 * 左：var_status（ACCENT 字色），随每个动作更新
 * 右：固定文案。桌面原文末段是「sv-ttk 暗色」——**那是陈旧文案**（v1.2 后
 *     界面已转亮色，见 app.py:376-377 的启动日志）。1:1 要求原样复制，
 *     故这里照抄不改字，只在代码里留这条注释说明。
 */
import { useTool } from '../state/context';

export default function StatusBar() {
  const { k } = useTool();
  return (
    <div className="lf-bar flex items-center px-3 shrink-0"
         style={{ height: 32, borderTop: '1px solid var(--border)', borderBottom: 'none' }}>
      <span className="lf-status flex-1 truncate text-[12px]">{k.status}</span>
      <span className="w-px h-4 mx-2" style={{ background: 'var(--border)' }} />
      <span className="lf-dim whitespace-nowrap">
        柱体法 · IDW/TIN · 分层总和 · sv-ttk 暗色
      </span>
    </div>
  );
}

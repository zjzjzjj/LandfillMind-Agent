import { useState, useCallback } from 'react';
import type { Agent } from '../types';

const DEFAULT_AGENTS: Agent[] = [
  {
    id: 'default',
    name: 'LandfillMind 助手',
    icon: '🏗️',
    description: '通用助手，覆盖填埋场全生命周期问题解答',
    systemPrompt: `你是「LandfillMind · 填埋场全周期智能体」AI 助手，专注于填埋场工程与环境岩土领域。
用户可能在询问：选址条件、勘察要点、设计参数、施工要点、运营管理、封场标准、渗滤液处理、填埋气监测、地下水保护等任何填埋场相关问题。

重要规则：
- 涉及规范条文编号，必须调用 kb_lookup 工具，禁止凭空捏造
- 涉及数值计算，必须调用对应计算器，禁止估算
- 优先用专业表述（给工程师看），适当用平易表述（给工友看）
- 回答要引用规范名称、编号和版本年号
- 输出纯文本：用「一、二、三」或「1. 2. 3.」分层，禁止使用 Markdown 符号（###、**、反引号、* 列表）

当前知识库覆盖：GB 16889、CJJ 176、HJ 25 系列、GB 36600、GB/T 14848、GB 55038、AQ 4202、GB 14554 等 30+ 本规范。

注气驱水与填埋场修复专题（可直接作答；需查细则时再调用 kb_lookup）：
- 注气驱水：向堆体注气把孔隙水"顶"出，质量含水率从 50~65% 降至 ≤30% 才适合开挖筛分；注气压力 2~8kPa（下限克服毛细阻力、上限防隆起）。
- 分段式循环抽注气：每 2m 一段、自上而下、≤4kPa、每段 3~4 天、井距 10~15m；注抽比 1:1.1~1:1.5；每 0.5~1h 反转气流方向防短路。
- 双孔隙度：垃圾有裂隙域+基质域两套孔隙，持水曲线双峰，是深层滞水难驱的底层原因。
- 气体短路：全段式注气沿浅层优势通道逸散（4.5m 含水率降、8.5m 无变化），必须分段封堵。
- 有效影响半径：梅花形井距 D=√3·R_eff，注气压力是影响半径最敏感因素。
- 消泡-注气协同：注泡沫排水量较纯注气 +16%，消泡剂存在最优浓度窗口（约 50~200ppm）。
- 间歇曝气：每天 2~4h 比连续曝气 VOC 减排 63%、能耗省 80%。
- 强曝气除臭：CH₄ 削减>95%、H₂S 最高抑制 91%；NH₃ 会短期反升，需抽气端化学洗涤/生物除臭。
- 臭气达标：厂界 H₂S≤0.06mg/m³、NH₃≤1.5mg/m³、臭气浓度≤20（GB 14554-1993）；CH₄ 5%~15% 为燃爆区间。
- 主/滞水位与稳定性：主水位与滞水位需分开布孔监测；高液位需降水+反压校核堆体稳定。
- 引用注气驱水数据时写资料来源（如"深圳方案""G250711 现场试验""Zhang et al. 2026"），禁止虚构规范条文号。`,
    model: 'codebuddy',
    color: '#06b6d4',
    isBuiltIn: true,
  },
  // v5：收敛为单一工程智能体 —— "工程科研助手"第二人格已移除。
  //   所有能力（OGS/3D/计算/多智能体/知识库）统一由"智能体对话"这一入口承载，不再切换专家 persona。
];

export function useAgents() {
  const [agents, setAgents] = useState<Agent[]>(() => {
    try {
      const saved = localStorage.getItem('agents');
      if (saved) {
        const list = JSON.parse(saved);
        if (Array.isArray(list)) return list.map((a: Agent) => a.name === '海之子智能助手' ? { ...a, name: 'LandfillMind 助手' } : a);
      }
      return DEFAULT_AGENTS;
    } catch {
      return DEFAULT_AGENTS;
    }
  });

  const save = useCallback((newAgents: Agent[]) => {
    setAgents(newAgents);
    localStorage.setItem('agents', JSON.stringify(newAgents));
  }, []);

  const addAgent = useCallback((agent: Omit<Agent, 'id' | 'isBuiltIn'>) => {
    const newAgent: Agent = {
      ...agent,
      id: `custom-${Date.now()}`,
      isBuiltIn: false,
    };
    save([...agents, newAgent]);
  }, [agents, save]);

  const updateAgent = useCallback((id: string, updates: Partial<Agent>) => {
    save(agents.map(a => a.id === id ? { ...a, ...updates } : a));
  }, [agents, save]);

  const deleteAgent = useCallback((id: string) => {
    save(agents.filter(a => a.id !== id));
  }, [agents, save]);

  const getAgent = useCallback((id: string): Agent | undefined => {
    return agents.find(a => a.id === id) ?? agents.find(a => a.id === 'default');
  }, [agents]);

  return { agents, addAgent, updateAgent, deleteAgent, getAgent };
}

# 部署到 Render（免费层）分步操作清单

> 目标：私有 GitHub 仓库 + Render 免费 Web Service（新加坡区）+ UptimeRobot 保活。
> 预计总耗时：15 分钟（不含首次构建等待）。

## 0. 前置准备
- GitHub 账号（当前已登录 zjzjzjj）
- Render 账号：render.com，直接用 GitHub 登录即可
- UptimeRobot 账号：uptimerobot.com
- 两个 API Key 备用（只在 Render 控制台粘贴，绝不写进代码/仓库）：
  - OpenRouter Key（主通道）
  - 智谱 GLM Key（备通道）

## 1. 创建私有 GitHub 仓库并推送（约 2 分钟）
1. 打开 https://github.com/new
2. Repository name 填 `landfillmind`；选 **Private**；**不要**勾选 README/.gitignore → Create repository
3. 在 PowerShell 执行：
   ```
   cd "E:\Son of  the SEA\260811\landfillmind"
   git remote set-url origin https://github.com/zjzjzjj/landfillmind.git
   git add -A
   git commit -m "v4.2 交付版：双通道 LLM + 多智能体参数化 + Render 部署"
   git push -u origin main
   ```
4. 推送后到仓库页面核对：
   - 能看到 `server/index.ts`、`render.yaml`、`Dockerfile`
   - **看不到 `.env`**（已被 .gitignore 排除，密钥不会泄漏）

## 2. Render 部署（约 10 分钟）
1. 打开 https://render.com → **Sign in with GitHub** → 授权读取仓库（选择 Only select repositories → 勾选 landfillmind）
2. Dashboard → **New +** → **Blueprint**
3. 选择 `zjzjzjj/landfillmind` → Connect
4. Render 自动读取 `render.yaml`，核对：Region=Singapore、Plan=Free、Runtime=Docker
5. 点 **Apply**，等待首次构建（约 5-10 分钟，期间不要重复点）
6. 构建完成后进入服务 → **Environment**，添加两个密钥（blueprint 里是 sync:false 占位，必须手动补）：
   | 变量名 | 值 |
   |---|---|
   | `OPENROUTER_API_KEY` | 你的 OpenRouter Key |
   | `OPENAI_API_KEY` | 你的智谱 GLM Key |
   其余变量（模型名、限流阈值、DB_PATH 等）`render.yaml` 已带默认值，不用动。
7. 环境变量保存后会自动重新部署；等状态变 Live
8. 打开 `https://landfillmind.onrender.com`（名字被占用会在控制台显示实际域名）验证：
   - 首页正常打开（含 3D 模型）
   - `/api/health` 返回 ok、kbCount=66、calcCount=12
   - 发一句对话出稿；跑一次多智能体出综合报告

## 3. UptimeRobot 保活（约 2 分钟）
1. 打开 https://uptimerobot.com 注册
2. **+ New monitor**：
   - Monitor type：**HTTP(s)**
   - Friendly name：LandfillMind-health
   - URL：`https://landfillmind.onrender.com/api/health`
   - Monitoring interval：**5 minutes**
3. Create monitor。原理：Render 免费层 15 分钟无流量会休眠（冷启动约 1 分钟），每 5 分钟探活一次可让实例始终在线，评委访问无感。

## 4. 上线后自检清单（评委视角走一遍）
- [ ] 首页「为工友谋幸福」卡片 → 点击一键带入对话 → 助手出稿
- [ ] 多智能体：参数面板填 H=20、β=35 → 思维链显示新参数；同参数再跑显示「命中结果缓存」
- [ ] 会话：新建对话 → 刷新页面 → 消息还在
- [ ] 快速连续请求 /api/chat 超过阈值 → 返回 429（防刷生效），/api/health 仍 200
- [ ] 手机浏览器访问一次，确认响应式不崩

## 5. 安全与成本控制
- OpenRouter 后台设置消费上限（建议 5-10 美元/月），防止公网 Key 被刷
- 演示/交付结束后：删除 Render 服务 + 轮换两个 Key（Key 曾出现在聊天记录中）
- 免费层无持久磁盘：重启/重新部署后历史会话清空，属预期行为

## 6. 常见问题
| 现象 | 处理 |
|---|---|
| Blueprint 应用失败 | 确认仓库为私有且 Render 已授权；或改用 New → Web Service → Docker 手动创建，环境变量照抄 render.yaml |
| 首次构建失败 | 打开 Logs 看原因；网络类错误直接 Retry deploy |
| 对话报 429 | 环境变量 RATE_LIMIT_* 过严，或 Key 额度/余额不足 |
| 首页打不开但 /api/health 正常 | Ctrl+F5 强刷；静态资源刚发布有缓存 |
| 实例睡了访问慢 | 等 1 分钟冷启动；检查 UptimeRobot 监控是否停用 |

---

## v4.2 升级部署说明（评审前冲刺 · 2026-08-18）

> 本节为 v4.1.1 → v4.2 的部署补充说明，仅追加，不覆盖前述章节。
> v4.2 的主要改动集中在前端增强（计算中心三栏、回答详细度、视觉风格），部署侧零变更。

### 关键点（一句话总结）
- v4.2 **没有新增 npm 依赖**（`package.json` 不动）
- v4.2 **没有新增部署环境变量**（`render.yaml` 不动）
- v4.2 **没有修改 Dockerfile**（构建流程保持）
- 部署流程与 v4.1.1 **完全一致**：`git push` 后 Render 自动重新部署，UptimeRobot 监控自动续命
- 唯一注意：评审当天不要忘了 UptimeRobot monitor 仍处启用状态（5 min 探活）

### 评审现场新增端点（应急与演示用）

| 端点 | 方法 | 用途 |
|---|---|---|
| `/api/agent-cache/clear` | GET | 清空多智能体 LRU 缓存。应对 LLM 通道 5xx/429 导致错误态永久落缓存的场景 |
| `/api/agent-cache/status` | GET | 查询 LRU 缓存大小 / 键列表，便于现场演示 LRU 工程亮点 |
| `/api/health` | GET | 返回 KB 76 条 / Calc 12 项 / 模型 GLM-4-Flash，可作为冷启动保活信号 |

### 演示前冒烟测试（4 条 curl，约 30 秒）

```bash
# 1. 健康检查
curl -s https://landfillmind.onrender.com/api/health
# 期望：200 + { ok:true, kbCount:76, calcCount:12, model:"glm-4-flash-250414" }

# 2. 清空 LRU 缓存（确保首跑命中真实链路）
curl -s https://landfillmind.onrender.com/api/agent-cache/clear
# 期望：200 + { ok:true }

# 3. 单条诊断（端到端，不走多智能体）
curl -s -X POST https://landfillmind.onrender.com/api/diagnose \
  -H "Content-Type: application/json" \
  -d '{"params":{"H":20,"beta":35},"contaminants":[{"name":"氨氮","value":2.5}]}'
# 期望：200 + overallRisk 非空

# 4. 多智能体 SSE 流（验证四个事件名）
curl -N -s -X POST https://landfillmind.onrender.com/api/multiagent \
  -H "Content-Type: application/json" \
  -d '{"params":{"H":20,"beta":35}}'
# 期望：SSE 流依次包含 agent_start / agent_step / agent_result / [DONE]
```

### 演示日注意事项
- ⏱️ **冷启动**：Render 免费层冷启动 ~30-60s，UptimeRobot 每 5 分钟探活可避免；首推屏请提前 2 分钟发请求预热
- 🚦 **限流**：GLM-4-Flash 免费档限流——单 IP 40/min / 5000/day / global 1000/day（v4.1.1 已放宽到 render.yaml 的 RATE_LIMIT_* 默认值）
- 🛟 **5xx 应急**：若遭遇 5xx/429 错误，先调 `/api/agent-cache/clear` 清缓存，再重试；问题持续就检查 Render Logs 与智谱控制台额度
- 📱 **弱网兜底**：提前在 4G/5G 下打开过两次首页，让 CDN 边缘节点缓存首屏静态资源
- 🧊 **缓存体感**：多智能体同参数二次请求会显示「命中结果缓存」，是预期行为，演示时可以主动改 β 参数触发真实链路

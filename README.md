# 研面官 · 预推免物语

> 用 galgame 的方式攻略面试官，用追问树的方式复盘每一次翻车。

一个把「保研预推免面试」做成叙事游戏的 AI 面试训练器：你面对的不是打分表，而是一位会深挖、会追问、会给你看「翻车回放」的资深面试官。

---

## 它是什么

- **表层是游戏**：面试官有「好感度」曲线，每一轮回答都在改写结局（口头 Offer / 待定 / 淘汰）。
- **底层是训练**：好感度只是皮，真正的分数是四维信号——**信任度 / 认可度 / 匹配度 / 危险值**。危险值只增不减，逼你正视每一次翻车。
- **复盘是核心**：结束后给你一张**追问树**（每一问的追问链条 + 你当时怎么答的 + 扣分点）、一份**危险点清单**（原话引用 + 为什么踩雷）、一组**策略卡**（STAR、用数据说话、承认边界…），还能**原地重答**，让 AI 重新评分做对比。

它不是「讨好面试官」的套路大全，而是让你**学到变强**的陪练。

---

## 核心机制

| 维度 | 含义 | 取值 | 变化 |
|---|---|---|---|
| 信任度 trust | 回答是否可信、前后一致 | 50 起 | 可增可减 |
| 认可度 recognition | 专业深度与逻辑 | 50 起 | 可增可减 |
| 匹配度 fit | 是否契合读研做科研 | 50 起 | 可增可减 |
| 危险值 danger | 踩雷信号（矛盾/编造/背稿/回避/偏题） | 0 起 | **只增不减** |

- **评分稳定**：规则层（短答、回避词等硬信号）兜底 + LLM-as-judge（温度 0、强制 JSON）软判断，delta 做钳制，危险值单调不减。
- **追问铁律**：面试官每轮都必须基于你的真实回答追一个 why / how / so-what，逼出真实水平。
- **不提示之嫌**：自由作答优先，不先给选项卡片，避免「念答案」。

面试共 **6 阶段 9 轮**：开场 → 简历深挖(2) → 科研项目追问(2) → 专业抽查(2) → 压力点 → 收尾。

---

## 特色能力

- **简历软肋预判**：开场前 AI 从面试官视角扫出 3 个最可能被撕的点（软肋 + 为什么可疑 + 怎么追问），面试官全程优先攻击这些软肋。
- **面试官画像**：粘贴导师主页链接 → 爬取 + LLM 画像（研究方向/风格/近期论文），再用 OpenAlex 补全真实论文，追问往 TA 的研究方向靠。
- **犹豫计时**：回答时实时计时，复盘里标注「犹豫 N 秒」，暴露临场卡顿，逼你正视「想太久」。
- **PDF 简历识别**：拖入 PDF 简历自动提取文本（pdf.js 同源），不用手打。

## 技术栈

- **前端**：Next.js 16（App Router）+ React 19 + TypeScript + Tailwind CSS v4
- **后端**：Next.js Route Handlers（`/api/interview`）+ 内存会话存储
- **AI**：Anthropic 兼容 Messages API（本地代理 → deepseek 后端），`thinking` 已禁用以保证稳定输出
- **可视化**：手写 SVG 四维曲线 + 追问树，四序列色板通过色觉无障碍校验
- **数据**：OpenAlex 公开学术 API（论文补全，免 key）；pdf.js（PDF 简历识别，同源加载）

## 目录结构

```
web/
  src/app/
    page.tsx              # 三阶段 SPA：设置 → 面试 → 复盘
    api/interview/route.ts # API：start / message / end / reanswer / resume / modelAnswer / scanResume / analyzeInterviewer
    layout.tsx / globals.css
  src/lib/
    interview/engine.ts   # 面试状态机 + 阶段推进
    interview/judge.ts    # 评分引擎（规则 + LLM）
    interview/prompts.ts  # 面试官 & 评分官 prompt
    llm.ts                # LLM 客户端
    interviewer.ts        # 面试官主页爬取 + OpenAlex 论文补全（服务端）
    pdf.ts                # 浏览器端 PDF 简历识别（pdf.js，同源）
    seed/data.ts          # 题库 / 示例简历 / 策略卡
    sessionStore.ts       # 内存会话
    types.ts              # 共享类型
产品设计规划.md             # 完整设计文档（11 项锁死决策 + MVP 边界）
```

---

## 本地运行

```bash
cd web
npm install

# 配置 LLM 端点（Anthropic 兼容）
export ANTHROPIC_BASE_URL=http://127.0.0.1:15721   # 本地代理
export ANTHROPIC_AUTH_TOKEN=你的token
# 可选：覆盖模型名
export ANTHROPIC_DEFAULT_SONNET_MODEL=claude-sonnet-4-6[1M]

npm run dev        # http://localhost:3000
```

> LLM 是本地代理（`127.0.0.1:15721`），服务端无状态无法直接触达，因此采用「本地运行 + 内网穿透」部署（见下）。

## 部署（获取公网 URL）

1. 本地起服务：`npm run build && npm run start`（或 `npm run dev`）
2. 内网穿透，例如 cloudflared：
   ```bash
   cloudflared tunnel --url http://localhost:3000
   ```
   或 ngrok：`ngrok http 3000`
3. 将得到的公网 URL 用于演示视频与提交。

---

## 提交物对照（16 小时项目挑战）

- ✅ 3 分钟演示视频（已录制，随邮件提交）
- ✅ 公开可访问的 URL（内网穿透，见 `docs/部署说明.md`）
- ✅ 1-2 页 Product Memo（`docs/Product-Memo.md`，含用户调研）
- ✅ 公开 GitHub 仓库，含清晰提交历史（本仓库）

---

_为 PKU 米理「AI 模拟面试官 · 16 小时项目挑战」而作。_

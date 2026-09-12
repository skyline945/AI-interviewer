// 种子数据：题库 / 示例简历 / 策略卡
import type { Direction, StrategyCard } from "../types";

export const DIRECTION_NAMES: Record<Direction, string> = {
  intelligence: "智能科学与技术",
  computer: "计算机技术",
};

// —— 专业抽查题库（按方向）——
export const PROFESSIONAL_QUESTIONS: Record<Direction, string[]> = {
  intelligence: [
    "讲一下梯度消失和梯度爆炸是怎么发生的，常见的缓解手段有哪些？",
    "L1 和 L2 正则化分别起什么作用？为什么 L1 更容易得到稀疏解？",
    "什么是过拟合？你在自己的项目里是怎么判断和缓解过拟合的？",
    "Transformer 的自注意力里为什么要除以 sqrt(d_k)？不除会怎样？",
    "BatchNorm 和 LayerNorm 的区别是什么，分别适合什么场景？",
    "交叉熵损失为什么常和 softmax 一起使用？",
    "评估一个二分类模型你会看哪些指标？precision/recall/F1/AUC 分别说明什么？",
    "解释一下 Bias-Variance 分解，以及它和模型复杂度的关系。",
  ],
  computer: [
    "进程和线程的区别是什么？协程又解决了什么问题？",
    "讲讲 TCP 三次握手和四次挥手，为什么挥手需要四次？",
    "一个进程的内存布局大致分哪几段？栈和堆有什么区别？",
    "数据库索引为什么常用 B+ 树，而不是哈希表或红黑树？",
    "什么是死锁？死锁的四个必要条件是什么？",
    "挑一种你熟悉的排序算法，讲讲它的时间复杂度和稳定性。",
    "HTTP 和 HTTPS 的区别是什么？TLS 握手大概是什么流程？",
    "进程间通信有哪些常见方式？各自的适用场景是什么？",
  ],
};

// —— 开场 / 收尾种子题 ——
export const OPENING_QUESTION = "同学你好，我是这次预推免的面试老师。先请你用一分钟左右，介绍一下你自己，以及你为什么想读研、想做什么方向。";

export const CLOSING_QUESTION = "我们的考察差不多到这里。最后，你有什么问题想问我吗？（可以问课题组方向、培养方式、或者你对读研的顾虑）";

// —— 示例简历（脱敏，可一键载入）——
export const SAMPLE_RESUMES: { id: string; label: string; direction: Direction; text: string }[] = [
  {
    id: "sample-ai",
    label: "示例一 · 智能科学与技术（AI 方向）",
    direction: "intelligence",
    text: `【教育背景】某 211 高校 智能科学与技术专业，本科 GPA 3.7/4.0，专业排名前 8%。
【科研经历】
- 参与"基于对比学习的病理切片分类"项目：负责数据预处理与数据增强，用 PyTorch 复现 SimCLR，在自采小样本数据集上 top-1 准确率从 82% 提升到 89%。
- 课程项目"轻量化图像分类"：用 MobileNetV3 做剪枝和量化，模型参数减少 60%，准确率下降不到 2%。
【竞赛】数学建模国赛省二等奖（负责建模与代码）。
【技能】Python、PyTorch、Linux、Git；了解 Transformer、CNN。`,
  },
  {
    id: "sample-sys",
    label: "示例二 · 计算机技术（系统方向）",
    direction: "computer",
    text: `【教育背景】某 985 高校 计算机技术专业，本科 GPA 3.5/4.0。
【项目经历】
- 团队项目"高并发抢购系统"：负责订单模块，用 Redis 做库存预扣减 + 消息队列削峰，压测 QPS 从 200 提升到 1500，超卖率降到 0。
- 课程项目"简易数据库"：实现了一个支持 B+ 树索引和基本事务的存储引擎。
【实习】某互联网公司后端开发实习（3 个月）：负责日志采集模块，用 Kafka + Flink 做实时统计。
【技能】Java、Go、MySQL、Redis、Kafka、Docker。`,
  },
];

// —— 策略卡（复盘教学用）——
export const STRATEGY_CARDS: StrategyCard[] = [
  {
    id: "star",
    name: "STAR 结构",
    when: "讲项目 / 科研 / 竞赛经历时",
    how: "情境(Situation)→任务(Task)→行动(Action)→结果(Result)，重点落在「你做了什么、为什么这么做」。",
    example: "「当时数据集只有 2000 张标注图，我负责把准确率提上去。我先分析了错分样本……最后 top-1 从 82% 提到 89%。」",
  },
  {
    id: "data",
    name: "用数据说话",
    when: "任何想说「我做得不错」的时候",
    how: "把形容词换成具体数字：提升多少、误差多少、耗时多少、排名多少。",
    example: "把「大幅提升」改成「准确率 +7%，QPS 从 200 到 1500」。",
  },
  {
    id: "boundary",
    name: "承认边界 + 补亮点",
    when: "被问到不会的、没做过的问题",
    how: "坦诚说「这块我没深入做过」，立刻接一个相关的、你会的东西，展示学习能力。",
    example: "「这部分我没实际调过，但我了解它和 XX 的区别，如果让我做，我会先……」",
  },
  {
    id: "consistency",
    name: "一致性自查",
    when: "每次开口前",
    how: "核对这句话和简历、和之前说过的是否一致；数字、时间、角色要前后对得上。",
    example: "「我负责 XX」和简历写「参与 XX」要统一，避免面试官觉得你在夸大。",
  },
  {
    id: "clarify",
    name: "先复述再回答",
    when: "没听懂、问题太大、不确定问什么",
    how: "用自己的话复述一遍问题确认，再回答，避免答非所问。",
    example: "「您是想问这个模型为什么用残差连接，对吗？那我的理解是……」",
  },
  {
    id: "think-aloud",
    name: "暴露思考过程",
    when: "遇到开放题、没标准答案的题",
    how: "讲「我怎么想」，而不是背一个标准结论；面试官要的是思路。",
    example: "「我先把它拆成两个子问题：先看 X，再看 Y……」",
  },
  {
    id: "concise",
    name: "结论先行",
    when: "所有回答",
    how: "先给结论，再展开 2-3 句；一个点 30-60 秒，不绕圈子。",
    example: "「我认为关键在于缓存一致性。原因是……」",
  },
  {
    id: "pressure",
    name: "压力面不慌",
    when: "被质疑、被追问、被挑刺时",
    how: "先接住（不辩解、不沉默），再解释，最后给出可验证的依据。",
    example: "「您说得对，这一点我当时确实没考虑到。后来我是这样补救的……」",
  },
];

// 危险信号 → 推荐策略卡
export const TRIGGER_TO_CARDS: Record<string, string[]> = {
  contradiction: ["consistency"],
  fabrication: ["consistency"],
  template: ["think-aloud", "concise"],
  evasion: ["boundary"],
  vague: ["star", "data"],
  offtopic: ["clarify", "concise"],
};

export function cardsForTriggers(types: string[]): StrategyCard[] {
  const ids = new Set<string>(["star", "data"]); // 默认总给两张基础卡
  for (const t of types) {
    for (const id of TRIGGER_TO_CARDS[t] || []) ids.add(id);
  }
  return STRATEGY_CARDS.filter((c) => ids.has(c.id));
}

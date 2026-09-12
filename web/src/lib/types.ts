// 全局共享类型

export type Direction = "intelligence" | "computer"; // 智能科学与技术 / 计算机技术

export type StageKey =
  | "opening"
  | "resumeDeep"
  | "project"
  | "professional"
  | "pressure"
  | "closing";

export interface DangerTrigger {
  type: string; // contradiction | template | evasion | offtopic | fabrication | vague
  evidence: string; // 原话引用
  explain: string; // 为什么扣分
}

export interface Scores {
  trust: number; // 信任度 0-100
  recognition: number; // 认可度 0-100
  fit: number; // 匹配度 0-100
  danger: number; // 危险值 0-100（只增不减）
}

export interface ScoreEvent {
  turn: number;
  stage: StageKey;
  question: string;
  answer: string;
  trustDelta: number;
  recognitionDelta: number;
  fitDelta: number;
  dangerDelta: number;
  triggers: DangerTrigger[];
  note: string;
}

export interface Round {
  id: string;
  question: string;
  answer: string;
  scoreEvent?: ScoreEvent;
  danger: boolean;
}

export interface StageNode {
  stage: StageKey;
  label: string;
  rounds: Round[];
}

export interface CurvePoint {
  turn: number;
  stage: StageKey;
  trust: number;
  recognition: number;
  fit: number;
  danger: number;
}

export type Verdict = "offer" | "waitlist" | "reject";

export interface Report {
  sessionId: string;
  direction: Direction;
  verdict: Verdict;
  verdictReason: string;
  comment: string; // 面试官最终评语（人格化一句话）
  scores: Scores;
  curve: CurvePoint[];
  dangerEvents: (DangerTrigger & { stage: StageKey; question: string })[];
  stages: StageNode[];
  strategyCards: StrategyCard[];
  highlights: string[];
}

export interface StrategyCard {
  id: string;
  name: string;
  when: string; // 什么时候用
  how: string; // 怎么用
  example: string; // 范例
}

export interface Session {
  id: string;
  direction: Direction;
  resume: string;
  stage: StageKey;
  stageRound: number; // 当前 stage 内已进行的问答轮数
  turn: number; // 全局轮数
  scores: Scores;
  messages: { role: "interviewer" | "student"; content: string; stage: StageKey }[];
  scoreEvents: ScoreEvent[];
  curve: CurvePoint[];
  stages: StageNode[];
  currentRound: Round | null; // 当前 stage 的追问链
  ended: boolean;
}

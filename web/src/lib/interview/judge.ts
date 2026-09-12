// 评分引擎：规则层硬约束 + LLM 软判断
import { chatJSON, MODELS } from "../llm";
import type { DangerTrigger, Direction, ScoreEvent, Session, StageKey } from "../types";
import { judgeSystem, type JudgeResult } from "./prompts";
import { newId } from "../sessionStore";

// —— 规则层：可枚举的硬信号（确定性，不依赖 LLM）——
const EVASION_WORDS = [
  "不清楚",
  "不太清楚",
  "不知道",
  "不了解",
  "不会",
  "没做过",
  "没接触过",
  "忘了",
  "记不清",
  "还没想",
];

function ruleChecks(answer: string): DangerTrigger[] {
  const triggers: DangerTrigger[] = [];
  const text = answer.trim();
  if (text.length < 8) {
    triggers.push({
      type: "vague",
      evidence: text || "（空）",
      explain: "回答过短，缺少任何实质信息",
    });
  } else {
    const evasive = EVASION_WORDS.some((w) => text.includes(w));
    if (evasive && text.length < 40) {
      triggers.push({
        type: "evasion",
        evidence: text.slice(0, 40),
        explain: "疑似回避问题，未做任何展开",
      });
    }
  }
  return triggers;
}

// 硬信号兜底：危险值保底、信任度封顶，保证"必涨/必降"
function applyHardFloor(
  result: JudgeResult,
  hard: DangerTrigger[]
): JudgeResult {
  if (hard.length === 0) return result;
  const minDanger = hard.length * 4;
  const maxTrust = -hard.length * 3;
  const merged: JudgeResult = { ...result };
  merged.danger_delta = Math.max(result.danger_delta, minDanger);
  merged.trust_delta = Math.min(result.trust_delta, maxTrust);
  const existing = new Set(result.triggers.map((t) => t.type));
  for (const t of hard) {
    if (!existing.has(t.type)) {
      merged.triggers.push(t);
      existing.add(t.type);
    }
  }
  return merged;
}

function clamp(v: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, v));
}

export async function judgeAnswer(
  session: Session,
  question: string,
  answer: string,
  stage: StageKey
): Promise<ScoreEvent> {
  const hard = ruleChecks(answer);
  const hardFlagText = hard.map((t) => t.type).join("、");

  const recent = session.messages
    .slice(-6)
    .map((m) => `${m.role === "interviewer" ? "面试官" : "学生"}：${m.content}`)
    .join("\n");

  const result = await chatJSON<JudgeResult>({
    model: MODELS.sonnet,
    system: judgeSystem(session.direction, session.resume, question, answer, recent, hardFlagText),
    messages: [{ role: "user", content: "请评分。" }],
    maxTokens: 800,
  });

  const merged = applyHardFloor(result, hard);

  const trustDelta = clamp(merged.trust_delta, -10, 10);
  const recognitionDelta = clamp(merged.recognition_delta, -10, 10);
  const fitDelta = clamp(merged.fit_delta, -10, 10);
  const dangerDelta = clamp(merged.danger_delta, 0, 15);

  // 更新分数（危险值只增不减）
  session.scores.trust = clamp(session.scores.trust + trustDelta);
  session.scores.recognition = clamp(session.scores.recognition + recognitionDelta);
  session.scores.fit = clamp(session.scores.fit + fitDelta);
  session.scores.danger = clamp(
    Math.max(session.scores.danger, session.scores.danger + dangerDelta)
  );

  const event: ScoreEvent = {
    turn: session.turn,
    stage,
    question,
    answer,
    trustDelta,
    recognitionDelta,
    fitDelta,
    dangerDelta,
    triggers: merged.triggers.map((t) => ({
      type: t.type,
      evidence: t.evidence,
      explain: t.explain,
    })),
    note: merged.note,
  };

  session.scoreEvents.push(event);
  session.curve.push({
    turn: session.turn,
    stage,
    trust: session.scores.trust,
    recognition: session.scores.recognition,
    fit: session.scores.fit,
    danger: session.scores.danger,
  });

  return event;
}

// 无状态评分：不依赖内存会话，供「收藏库读档重答」使用
export async function judgeStandalone(
  direction: Direction,
  resume: string,
  question: string,
  answer: string,
  stage: StageKey
): Promise<ScoreEvent> {
  const session: Session = {
    id: newId(),
    direction,
    resume,
    stage,
    stageRound: 0,
    turn: 1,
    scores: { trust: 50, recognition: 50, fit: 50, danger: 0 },
    messages: [],
    scoreEvents: [],
    curve: [],
    stages: [],
    currentRound: null,
    ended: false,
  };
  return judgeAnswer(session, question, answer, stage);
}

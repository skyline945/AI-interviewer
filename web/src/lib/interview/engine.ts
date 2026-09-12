// 面试状态机：追问骨架 + 半脚本追问 + 阶段推进
import { chat, MODELS, type LLMMessage } from "../llm";
import type {
  Direction,
  Report,
  Round,
  Session,
  StageKey,
  Verdict,
} from "../types";
import { newId, setSession } from "../sessionStore";
import { interviewerSystem, FOLLOWUP_INSTRUCTION } from "./prompts";
import { judgeAnswer } from "./judge";
import {
  CLOSING_QUESTION,
  DIRECTION_NAMES,
  OPENING_QUESTION,
  PROFESSIONAL_QUESTIONS,
  cardsForTriggers,
} from "../seed/data";

export const STAGE_CONFIG: { key: StageKey; label: string; rounds: number }[] = [
  { key: "opening", label: "开场", rounds: 1 },
  { key: "resumeDeep", label: "简历深挖", rounds: 2 },
  { key: "project", label: "科研项目追问", rounds: 2 },
  { key: "professional", label: "专业抽查", rounds: 2 },
  { key: "pressure", label: "压力点", rounds: 1 },
  { key: "closing", label: "收尾", rounds: 1 },
];

function stageInstruction(stage: StageKey): string {
  switch (stage) {
    case "opening":
      return "做一个简短的开场，然后请学生用一分钟左右介绍自己，并说明为什么想读研、想做什么方向。";
    case "resumeDeep":
      return "基于学生简历，挑一段最值得深挖的经历，问一个具体问题，验证简历的真实性与学生的参与深度。";
    case "project":
      return "挑学生简历里的一个科研/项目经历，追问技术细节：为什么这么做、你本人的具体贡献、遇到什么难点、结果如何量化。";
    case "professional":
      return "抽查一道专业基础题，考察基本功是否扎实。";
    case "pressure":
      return "进入压力面：针对学生之前暴露的薄弱点或回答中的漏洞，问一个尖锐的追问（短板、失败经历，或质疑其结论）。";
    case "closing":
      return "进入收尾：请学生向你提问（课题组方向、培养方式等），然后简单收尾告别。";
  }
}

function toLLMMessages(session: Session): LLMMessage[] {
  return session.messages.map((m) => ({
    role: m.role === "interviewer" ? "assistant" : "user",
    content: m.content,
  }));
}

function cfgOf(stage: StageKey) {
  return STAGE_CONFIG.find((s) => s.key === stage)!;
}

function createSession(direction: Direction, resume: string): Session {
  return {
    id: newId(),
    direction,
    resume,
    stage: "opening",
    stageRound: 0,
    turn: 0,
    scores: { trust: 50, recognition: 50, fit: 50, danger: 0 },
    messages: [],
    scoreEvents: [],
    curve: [],
    stages: [],
    currentRound: null,
    ended: false,
  };
}

async function nextQuestion(session: Session): Promise<string> {
  const stage = session.stage;
  const round = session.stageRound;

  if (stage === "opening") return OPENING_QUESTION;
  if (stage === "closing") return CLOSING_QUESTION;
  if (stage === "professional") {
    const qs = PROFESSIONAL_QUESTIONS[session.direction];
    return qs[round % qs.length];
  }

  let instruction = stageInstruction(stage);
  if (round > 0) instruction += "\n" + FOLLOWUP_INSTRUCTION;

  const sys = interviewerSystem(session.direction, session.resume, cfgOf(stage).label, instruction);
  return await chat({
    model: MODELS.sonnet,
    system: sys,
    messages: toLLMMessages(session),
    temperature: 0.6,
    maxTokens: 300,
  });
}

export async function startInterview(
  direction: Direction,
  resume: string
): Promise<{ sessionId: string; message: string; scores: Session["scores"]; stage: StageKey }> {
  const session = createSession(direction, resume);
  const q = await nextQuestion(session);
  session.messages.push({ role: "interviewer", content: q, stage: "opening" });
  session.currentRound = { id: newId(), question: q, answer: "", danger: false };
  setSession(session.id, session);
  return { sessionId: session.id, message: q, scores: session.scores, stage: "opening" };
}

export async function handleMessage(
  session: Session,
  content: string
): Promise<{
  message: string | null;
  scores: Session["scores"];
  scoreEvent: Session["scoreEvents"][number];
  stage: StageKey;
  done: boolean;
}> {
  const stage = session.stage;
  const question = session.currentRound!.question;

  session.messages.push({ role: "student", content, stage });
  session.turn += 1;

  const event = await judgeAnswer(session, question, content, stage);

  const round: Round = {
    id: session.currentRound!.id,
    question,
    answer: content,
    scoreEvent: event,
    danger: event.dangerDelta > 0 || event.triggers.length > 0,
  };
  const node = session.stages.find((s) => s.stage === stage);
  if (node) node.rounds.push(round);
  else session.stages.push({ stage, label: cfgOf(stage).label, rounds: [round] });

  session.stageRound += 1;
  let done = false;
  if (session.stageRound >= cfgOf(stage).rounds) {
    const idx = STAGE_CONFIG.findIndex((s) => s.key === stage);
    if (idx === STAGE_CONFIG.length - 1) {
      done = true;
      session.ended = true;
    } else {
      session.stage = STAGE_CONFIG[idx + 1].key;
      session.stageRound = 0;
    }
  }

  let message: string | null = null;
  if (!done) {
    message = await nextQuestion(session);
    session.messages.push({ role: "interviewer", content: message, stage: session.stage });
    session.currentRound = { id: newId(), question: message, answer: "", danger: false };
  } else {
    session.currentRound = null;
  }
  setSession(session.id, session);

  return { message, scores: session.scores, scoreEvent: event, stage: session.stage, done };
}

export function buildReport(session: Session): Report {
  const { scores } = session;
  const core = (scores.recognition + scores.fit) / 2;

  let verdict: Verdict;
  if (core >= 62) verdict = "offer";
  else if (core >= 48) verdict = "waitlist";
  else verdict = "reject";

  if (scores.danger >= 40 || scores.trust < 35) {
    if (verdict === "offer") verdict = "waitlist";
    else if (verdict === "waitlist") verdict = "reject";
  }

  const dangerEvents = session.scoreEvents.flatMap((e) =>
    e.triggers.map((t) => ({ ...t, stage: e.stage, question: e.question }))
  );

  const allTriggerTypes = Array.from(
    new Set(session.scoreEvents.flatMap((e) => e.triggers.map((t) => t.type)))
  );

  const verdictReason = `认可度 ${scores.recognition} / 匹配度 ${scores.fit}，危险值 ${scores.danger}${
    dangerEvents.length > 0 ? `（命中 ${dangerEvents.length} 个危险点）` : ""
  }。`;

  const highlights: string[] = [];
  const worst = [...session.scoreEvents].sort((a, b) => b.dangerDelta - a.dangerDelta)[0];
  if (worst && worst.dangerDelta > 0) {
    highlights.push(`最危险的回答出现在「${cfgOf(worst.stage).label}」阶段：${worst.note}`);
  }
  const best = [...session.scoreEvents].sort(
    (a, b) => b.recognitionDelta + b.fitDelta - (a.recognitionDelta + a.fitDelta)
  )[0];
  if (best && best.recognitionDelta + best.fitDelta > 0) {
    highlights.push(`最出彩的回答：${best.note}`);
  }
  if (highlights.length === 0) {
    highlights.push("本场回答整体中规中矩，建议对照下方策略卡逐题打磨。");
  }

  return {
    sessionId: session.id,
    direction: session.direction,
    verdict,
    verdictReason,
    scores,
    curve: session.curve,
    dangerEvents,
    stages: session.stages,
    strategyCards: cardsForTriggers(allTriggerTypes),
    highlights,
  };
}

export const DIRECTION_NAME = DIRECTION_NAMES;

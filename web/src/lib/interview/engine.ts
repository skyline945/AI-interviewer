// 面试状态机：追问骨架 + 半脚本追问 + 阶段推进
import { chat, chatJSON, MODELS, type LLMMessage } from "../llm";
import type {
  Direction,
  InterviewerProfile,
  Report,
  ResumeWeakSpot,
  Round,
  ScoreEvent,
  Session,
  StageKey,
  StageNode,
  Verdict,
} from "../types";
import { newId } from "../sessionStore";
import { interviewerSystem, FOLLOWUP_INSTRUCTION, modelAnswerSystem, verdictCommentSystem, resumeWeaknessSystem } from "./prompts";
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

// 专业抽查：有导师画像时，把题目锚到 TA 的研究方向与近期论文上
function professionalProfileInstruction(profile: InterviewerProfile): string {
  const focus = profile.researchFocus.join("、");
  const papers = (profile.papers ?? [])
    .slice(0, 3)
    .map((p) => p.title)
    .join("；");
  return `出题铁律：这道专业题必须落在 TA 的研究方向「${focus}」上${
    papers ? `，并尽量围绕 TA 的近期论文（${papers}）出` : ""
  }——挑一个与该方向交叉、又能考察学生专业基本功的具体问题；同时结合学生的报考方向与简历，不要脱离学生背景硬套。`;
}

function createSession(
  direction: Direction,
  resume: string,
  interviewer?: InterviewerProfile | null,
  weakSpots?: ResumeWeakSpot[]
): Session {
  return {
    id: newId(),
    direction,
    resume,
    interviewer: interviewer ?? null,
    weakSpots: weakSpots ?? [],
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

  // 专业抽查：有导师画像时走 LLM 并贴合其研究方向；无画像时才用固定题库兜底
  if (stage === "professional" && !session.interviewer) {
    const qs = PROFESSIONAL_QUESTIONS[session.direction];
    return qs[round % qs.length];
  }

  let instruction = stageInstruction(stage);
  if (stage === "professional" && session.interviewer) {
    instruction += "\n" + professionalProfileInstruction(session.interviewer);
  }
  if (round > 0) instruction += "\n" + FOLLOWUP_INSTRUCTION;

  const sys = interviewerSystem(session.direction, session.resume, cfgOf(stage).label, instruction, session.interviewer, session.weakSpots);
  return await chat({
    model: MODELS.sonnet,
    system: sys,
    messages: toLLMMessages(session),
    temperature: 0.6,
    maxTokens: 300,
  });
}

// 简历软肋扫描：面试官视角，找出最可能被戳穿的 3 个点
export async function scanResumeWeaknesses(
  direction: Direction,
  resume: string
): Promise<ResumeWeakSpot[]> {
  const data = await chatJSON<{ weakSpots?: ResumeWeakSpot[] }>({
    model: MODELS.sonnet,
    system: resumeWeaknessSystem(direction, resume),
    messages: [{ role: "user", content: "请扫描。" }],
  });
  const spots = Array.isArray(data.weakSpots) ? data.weakSpots : [];
  return spots
    .filter((w) => w && w.point && String(w.point).trim())
    .slice(0, 3)
    .map((w) => ({
      point: String(w.point).trim(),
      reason: String(w.reason ?? "").trim(),
      probe: String(w.probe ?? "").trim(),
    }));
}

export async function startInterview(
  direction: Direction,
  resume: string,
  interviewer?: InterviewerProfile | null,
  weakSpots?: ResumeWeakSpot[]
): Promise<{ session: Session; sessionId: string; message: string; scores: Session["scores"]; stage: StageKey }> {
  const session = createSession(direction, resume, interviewer, weakSpots);
  const q = await nextQuestion(session);
  session.messages.push({ role: "interviewer", content: q, stage: "opening" });
  session.currentRound = { id: newId(), question: q, answer: "", danger: false };
  return { session, sessionId: session.id, message: q, scores: session.scores, stage: "opening" };
}

export async function handleMessage(
  session: Session,
  content: string
): Promise<{
  session: Session;
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
  return { session, message, scores: session.scores, scoreEvent: event, stage: session.stage, done };
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
    comment: "",
    scores,
    curve: session.curve,
    dangerEvents,
    stages: session.stages,
    strategyCards: cardsForTriggers(allTriggerTypes),
    highlights,
    interviewer: session.interviewer ?? null,
    weakSpots: session.weakSpots ?? [],
  };
}

export const DIRECTION_NAME = DIRECTION_NAMES;

const VERDICT_LABEL: Record<Verdict, string> = {
  offer: "口头 Offer",
  waitlist: "待定",
  reject: "淘汰",
};

// 生成某道题的「最佳回答」示范（基于学生自己的简历）
export async function generateModelAnswer(
  direction: Direction,
  resume: string,
  question: string,
  stage: StageKey
): Promise<string> {
  const sys = modelAnswerSystem(direction, resume, question, cfgOf(stage).label);
  return chat({
    model: MODELS.sonnet,
    system: sys,
    messages: [{ role: "user", content: "请示范。" }],
    temperature: 0.6,
    maxTokens: 400,
  });
}

// 生成面试官最终评语（一句人格化的话，用于结局卡）
export async function buildVerdictComment(session: Session, report: Report): Promise<string> {
  const worst = [...session.scoreEvents].sort((a, b) => b.dangerDelta - a.dangerDelta)[0];
  const best = [...session.scoreEvents].sort(
    (a, b) => b.recognitionDelta + b.fitDelta - (a.recognitionDelta + a.fitDelta)
  )[0];
  const worstLine = worst && worst.dangerDelta > 0
    ? `「${worst.answer.slice(0, 80)}」（危险 +${worst.dangerDelta}）`
    : "";
  const bestLine = best && best.recognitionDelta + best.fitDelta > 0
    ? `「${best.answer.slice(0, 80)}」`
    : "";

  const sys = verdictCommentSystem(
    session.direction,
    session.resume,
    session.scores,
    VERDICT_LABEL[report.verdict],
    worstLine,
    bestLine
  );
  return chat({
    model: MODELS.sonnet,
    system: sys,
    messages: [{ role: "user", content: "请给评语。" }],
    temperature: 0.7,
    maxTokens: 120,
  });
}

function clamp(v: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, v));
}

// 读档续档：从结局报告重建会话，把「这道题」替换为新回答后，从下一题继续。
// 不依赖内存会话——收藏的结局卡也能随时回来接着面。
export async function resumeInterview(params: {
  direction: Direction;
  resume: string;
  stages: StageNode[]; // 报告里的有序阶段与追问
  targetStage: StageKey;
  targetRoundId: string; // 续档点：这道题之后
  replacementAnswer?: string; // 读档重答的新回答（可选）
  replacementEvent?: ScoreEvent; // 读档重答的评分结果（可选）
  interviewer?: InterviewerProfile | null; // 面试官画像（从收藏卡续档时带入）
  weakSpots?: ResumeWeakSpot[]; // 简历软肋（从收藏卡续档时带入）
}): Promise<{
  session: Session;
  sessionId: string;
  message: string;
  scores: Session["scores"];
  stage: StageKey;
  history: Session["messages"];
}> {
  const { direction, resume, stages, targetStage, targetRoundId } = params;
  const session = createSession(direction, resume, params.interviewer, params.weakSpots);

  // 展平为有序问答列表，找到续档的那道题
  const flat: { stage: StageKey; round: Round }[] = [];
  for (const node of stages) {
    for (const r of node.rounds) flat.push({ stage: node.stage, round: r });
  }
  const targetIndex = flat.findIndex(
    (f) => f.stage === targetStage && f.round.id === targetRoundId
  );
  if (targetIndex < 0) throw new Error("找不到要续档的那道题");

  // 逐题重放到目标题（含），目标题用新回答替换
  for (let i = 0; i <= targetIndex; i++) {
    const { stage, round } = flat[i];
    const isTarget = i === targetIndex;
    const answer =
      isTarget && params.replacementAnswer ? params.replacementAnswer : round.answer;
    const event =
      isTarget && params.replacementEvent ? params.replacementEvent : round.scoreEvent;

    session.messages.push({ role: "interviewer", content: round.question, stage });
    session.messages.push({ role: "student", content: answer, stage });
    session.turn += 1;

    if (event) {
      session.scores.trust = clamp(session.scores.trust + event.trustDelta);
      session.scores.recognition = clamp(session.scores.recognition + event.recognitionDelta);
      session.scores.fit = clamp(session.scores.fit + event.fitDelta);
      session.scores.danger = clamp(
        Math.max(session.scores.danger, session.scores.danger + event.dangerDelta)
      );
      const ev: ScoreEvent = {
        ...event,
        turn: session.turn,
        stage,
        question: round.question,
        answer,
      };
      session.scoreEvents.push(ev);
      session.curve.push({
        turn: session.turn,
        stage,
        trust: session.scores.trust,
        recognition: session.scores.recognition,
        fit: session.scores.fit,
        danger: session.scores.danger,
      });
    }

    const rr: Round = {
      id: round.id,
      question: round.question,
      answer,
      scoreEvent: event
        ? { ...event, turn: session.turn, stage, question: round.question, answer }
        : undefined,
      danger: event ? event.dangerDelta > 0 || event.triggers.length > 0 : round.danger,
    };
    const node = session.stages.find((s) => s.stage === stage);
    if (node) node.rounds.push(rr);
    else session.stages.push({ stage, label: cfgOf(stage).label, rounds: [rr] });

    session.stageRound += 1;
    if (session.stageRound >= cfgOf(stage).rounds) {
      const idx = STAGE_CONFIG.findIndex((s) => s.key === stage);
      if (idx < STAGE_CONFIG.length - 1) {
        session.stage = STAGE_CONFIG[idx + 1].key;
        session.stageRound = 0;
      }
    }
  }

  // 最后一道题没有「下一题」，拒绝续档
  if (session.stage === "closing" && session.stageRound >= cfgOf("closing").rounds) {
    throw new Error("这道题已经是最后一道，无法续档");
  }

  const q = await nextQuestion(session);
  session.messages.push({ role: "interviewer", content: q, stage: session.stage });
  session.currentRound = { id: newId(), question: q, answer: "", danger: false };

  const history = session.messages.slice(0, -1); // 去掉新追问，交回给前端补齐
  return {
    session,
    sessionId: session.id,
    message: q,
    scores: session.scores,
    stage: session.stage,
    history,
  };
}

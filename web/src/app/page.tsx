"use client";

import { useEffect, useRef, useState } from "react";
import type {
  Direction,
  Report,
  ScoreEvent,
  Scores,
  StageKey,
} from "@/lib/types";
import { DIRECTION_NAMES, SAMPLE_RESUMES } from "@/lib/seed/data";

const STAGE_LABELS: Record<StageKey, string> = {
  opening: "开场",
  resumeDeep: "简历深挖",
  project: "科研项目追问",
  professional: "专业抽查",
  pressure: "压力点",
  closing: "收尾",
};

const STAGE_ORDER: StageKey[] = [
  "opening",
  "resumeDeep",
  "project",
  "professional",
  "pressure",
  "closing",
];

interface ChatMsg {
  role: "interviewer" | "student";
  content: string;
  stage: StageKey;
}

const INIT_SCORES: Scores = { trust: 50, recognition: 50, fit: 50, danger: 0 };

export default function Home() {
  const [phase, setPhase] = useState<"setup" | "interview" | "review">("setup");
  const [direction, setDirection] = useState<Direction>("intelligence");
  const [resume, setResume] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [scores, setScores] = useState<Scores>(INIT_SCORES);
  const [stage, setStage] = useState<StageKey>("opening");
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function api(body: unknown) {
    const r = await fetch("/api/interview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "请求失败");
    return data;
  }

  async function handleStart() {
    if (resume.trim().length < 10) {
      setError("请先粘贴简历，或点右侧示例简历一键载入。");
      return;
    }
    setPending(true);
    setError("");
    try {
      const data = await api({ action: "start", direction, resume });
      setSessionId(data.sessionId);
      setScores(data.scores);
      setStage(data.stage);
      setMessages([{ role: "interviewer", content: data.message, stage: data.stage }]);
      setPhase("interview");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }

  async function handleSend() {
    const content = input.trim();
    if (!content || pending || done) return;
    setInput("");
    setMessages((m) => [...m, { role: "student", content, stage }]);
    setPending(true);
    setError("");
    try {
      const data = await api({ action: "message", sessionId, content });
      setScores(data.scores);
      setStage(data.stage);
      if (data.done) {
        setDone(true);
      } else {
        setMessages((m) => [
          ...m,
          { role: "interviewer", content: data.message, stage: data.stage },
        ]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }

  async function handleEnd() {
    setPending(true);
    setError("");
    try {
      const data = await api({ action: "end", sessionId });
      setReport(data);
      setPhase("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }

  function handleRestart() {
    setPhase("setup");
    setResume("");
    setMessages([]);
    setScores(INIT_SCORES);
    setStage("opening");
    setDone(false);
    setReport(null);
    setError("");
    setInput("");
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-4">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight">研面官 · 预推免物语</h1>
        {phase !== "setup" && (
          <button
            onClick={handleRestart}
            className="rounded-md border border-black/10 px-3 py-1 text-sm text-neutral-500 hover:bg-black/5"
          >
            重新开始
          </button>
        )}
      </header>

      {error && (
        <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {phase === "setup" && (
        <Setup
          direction={direction}
          setDirection={setDirection}
          resume={resume}
          setResume={setResume}
          onStart={handleStart}
          pending={pending}
        />
      )}

      {phase === "interview" && (
        <Interview
          messages={messages}
          scores={scores}
          stage={stage}
          input={input}
          setInput={setInput}
          onSend={handleSend}
          onEnd={handleEnd}
          done={done}
          pending={pending}
          bottomRef={bottomRef}
        />
      )}

      {phase === "review" && report && (
        <Review report={report} sessionId={sessionId} onRestart={handleRestart} />
      )}
    </div>
  );
}

/* ---------------- Setup ---------------- */

function Setup(props: {
  direction: Direction;
  setDirection: (d: Direction) => void;
  resume: string;
  setResume: (s: string) => void;
  onStart: () => void;
  pending: boolean;
}) {
  return (
    <div className="grid flex-1 gap-6 md:grid-cols-2">
      <section className="rounded-xl border border-black/10 bg-white p-5">
        <h2 className="mb-3 text-lg font-semibold">① 选择你的方向</h2>
        <div className="flex flex-col gap-2">
          {(Object.keys(DIRECTION_NAMES) as Direction[]).map((d) => (
            <button
              key={d}
              onClick={() => props.setDirection(d)}
              className={`rounded-lg border px-4 py-3 text-left transition ${
                props.direction === d
                  ? "border-blue-500 bg-blue-50"
                  : "border-black/10 hover:border-black/30"
              }`}
            >
              <div className="font-medium">{DIRECTION_NAMES[d]}</div>
              <div className="text-sm text-neutral-500">
                {d === "intelligence"
                  ? "机器学习 / 深度学习 / 计算机视觉"
                  : "操作系统 / 网络 / 数据库 / 后端"}
              </div>
            </button>
          ))}
        </div>

        <h2 className="mb-2 mt-6 text-lg font-semibold">② 粘贴简历（脱敏）</h2>
        <textarea
          value={props.resume}
          onChange={(e) => props.setResume(e.target.value)}
          placeholder={"粘贴你的简历，例如：\n【教育背景】…\n【科研经历】…\n【项目经历】…\n【技能】…"}
          rows={10}
          className="w-full rounded-lg border border-black/10 bg-neutral-50 p-3 text-sm leading-relaxed outline-none focus:border-blue-500"
        />
        <div className="mt-3 flex flex-wrap gap-2">
          {SAMPLE_RESUMES.map((s) => (
            <button
              key={s.id}
              onClick={() => {
                props.setDirection(s.direction);
                props.setResume(s.text);
              }}
              className="rounded-md border border-black/10 px-3 py-1 text-xs text-neutral-600 hover:bg-neutral-100"
            >
              载入：{s.label}
            </button>
          ))}
        </div>
      </section>

      <section className="flex flex-col justify-between rounded-xl border border-black/10 bg-white p-5">
        <div>
          <h2 className="mb-3 text-lg font-semibold">你会得到什么</h2>
          <ul className="space-y-2 text-sm text-neutral-600">
            <li>👨‍🏫 一位会深挖、会追问的资深面试官</li>
            <li>📈 信任 / 认可 / 匹配 / 危险 四维实时评分</li>
            <li>🌳 复盘追问树：看清每一次翻车</li>
            <li>🃏 针对性策略卡 + 原地重答</li>
          </ul>
          <p className="mt-4 rounded-lg bg-amber-50 p-3 text-xs text-amber-700">
            全程文字对话，约 6 个阶段、9 轮追问。你的回答会被 AI 评分，
            危险值只增不减——诚实作答，才是真正的训练。
          </p>
        </div>
        <button
          onClick={props.onStart}
          disabled={props.pending}
          className="mt-4 w-full rounded-lg bg-blue-600 py-3 font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
        >
          {props.pending ? "面试官入场中…" : "开始面试"}
        </button>
      </section>
    </div>
  );
}

/* ---------------- Interview ---------------- */

function Interview(props: {
  messages: ChatMsg[];
  scores: Scores;
  stage: StageKey;
  input: string;
  setInput: (s: string) => void;
  onSend: () => void;
  onEnd: () => void;
  done: boolean;
  pending: boolean;
  bottomRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="grid flex-1 gap-4 lg:grid-cols-[1fr_260px]">
      <section className="flex flex-col rounded-xl border border-black/10 bg-white">
        <div className="flex items-center justify-between border-b border-black/10 px-4 py-2 text-sm">
          <span className="font-medium text-neutral-700">
            阶段：<span className="text-blue-600">{STAGE_LABELS[props.stage]}</span>
          </span>
          <button
            onClick={props.onEnd}
            disabled={props.pending}
            className="rounded-md border border-black/10 px-2 py-0.5 text-xs text-neutral-500 hover:bg-neutral-100"
          >
            提前结束并复盘
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4" style={{ maxHeight: "62vh" }}>
          {props.messages.map((m, i) =>
            m.role === "interviewer" ? (
              <div key={i} className="flex gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-lg">
                  👨‍🏫
                </div>
                <div className="max-w-[80%] rounded-2xl rounded-tl-sm bg-neutral-100 px-4 py-2.5 text-sm leading-relaxed">
                  {m.content}
                </div>
              </div>
            ) : (
              <div key={i} className="flex flex-row-reverse gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-lg">
                  🎓
                </div>
                <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-blue-600 px-4 py-2.5 text-sm leading-relaxed text-white">
                  {m.content}
                </div>
              </div>
            )
          )}
          {props.pending && (
            <div className="flex gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-lg">
                👨‍🏫
              </div>
              <div className="rounded-2xl rounded-tl-sm bg-neutral-100 px-4 py-2.5 text-sm text-neutral-400">
                面试官正在追问…
              </div>
            </div>
          )}
          <div ref={props.bottomRef} />
        </div>

        <div className="border-t border-black/10 p-3">
          {props.done ? (
            <button
              onClick={props.onEnd}
              className="w-full rounded-lg bg-green-600 py-3 font-medium text-white transition hover:bg-green-700"
            >
              面试结束 · 查看复盘报告 →
            </button>
          ) : (
            <div className="flex gap-2">
              <textarea
                value={props.input}
                onChange={(e) => props.setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    props.onSend();
                  }
                }}
                placeholder="输入你的回答…（Enter 发送，Shift+Enter 换行）"
                rows={2}
                className="flex-1 resize-none rounded-lg border border-black/10 bg-neutral-50 p-3 text-sm outline-none focus:border-blue-500"
              />
              <button
                onClick={props.onSend}
                disabled={props.pending || !props.input.trim()}
                className="rounded-lg bg-blue-600 px-6 font-medium text-white transition hover:bg-blue-700 disabled:opacity-40"
              >
                发送
              </button>
            </div>
          )}
        </div>
      </section>

      <ScoreHUD scores={props.scores} />
    </div>
  );
}

/* ---------------- Score HUD ---------------- */

function ScoreHUD({ scores }: { scores: Scores }) {
  const items: { key: keyof Scores; label: string; color: string }[] = [
    { key: "trust", label: "信任度", color: "var(--c-trust)" },
    { key: "recognition", label: "认可度", color: "var(--c-recognition)" },
    { key: "fit", label: "匹配度", color: "var(--c-fit)" },
    { key: "danger", label: "危险值", color: "var(--c-danger)" },
  ];
  return (
    <aside className="rounded-xl border border-black/10 bg-white p-4">
      <h3 className="mb-3 text-sm font-semibold text-neutral-700">本场评分</h3>
      <div className="space-y-4">
        {items.map((it) => (
          <div key={it.key}>
            <div className="mb-1 flex items-center justify-between text-sm">
              <span className="text-neutral-600">
                {it.key === "danger" ? "⚠️ " : ""}
                {it.label}
              </span>
              <span
                className="font-semibold tabular-nums"
                style={{ color: it.color }}
              >
                {scores[it.key]}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-100">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${scores[it.key]}%`,
                  backgroundColor: it.color,
                }}
              />
            </div>
          </div>
        ))}
      </div>
      <p className="mt-4 text-xs leading-relaxed text-neutral-400">
        信任/认可/匹配从 50 起，随回答增减；危险值从 0 起，只增不减。
        高危险值会触发面试官更尖锐的追问。
      </p>
    </aside>
  );
}

/* ---------------- Review ---------------- */

const VERDICT_LABEL: Record<Report["verdict"], string> = {
  offer: "口头 Offer",
  waitlist: "待定",
  reject: "淘汰",
};

const VERDICT_COLOR: Record<Report["verdict"], string> = {
  offer: "text-green-600",
  waitlist: "text-amber-600",
  reject: "text-red-600",
};

function Review({
  report,
  sessionId,
  onRestart,
}: {
  report: Report;
  sessionId: string;
  onRestart: () => void;
}) {
  return (
    <div className="flex-1 space-y-6">
      <section className="rounded-xl border border-black/10 bg-white p-5">
        <div className="flex items-center gap-3">
          <span className="text-3xl">{report.verdict === "offer" ? "🎉" : report.verdict === "waitlist" ? "🤔" : "💥"}</span>
          <div>
            <h2 className={`text-2xl font-bold ${VERDICT_COLOR[report.verdict]}`}>
              {VERDICT_LABEL[report.verdict]}
            </h2>
            <p className="text-sm text-neutral-500">{report.verdictReason}</p>
          </div>
        </div>
        {report.highlights.length > 0 && (
          <ul className="mt-3 space-y-1 border-t border-black/5 pt-3 text-sm text-neutral-600">
            {report.highlights.map((h, i) => (
              <li key={i}>· {h}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-black/10 bg-white p-5">
        <h3 className="mb-3 font-semibold">四维曲线</h3>
        <CurveChart curve={report.curve} />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-black/10 bg-white p-5">
          <h3 className="mb-3 font-semibold">追问树复盘</h3>
          <QuestionTree stages={report.stages} />
        </section>

        <div className="space-y-6">
          <section className="rounded-xl border border-black/10 bg-white p-5">
            <h3 className="mb-3 font-semibold">
              危险点清单
              {report.dangerEvents.length > 0 && (
                <span className="ml-2 text-sm text-red-600">
                  {report.dangerEvents.length} 处
                </span>
              )}
            </h3>
            {report.dangerEvents.length === 0 ? (
              <p className="text-sm text-neutral-400">本场没有踩到危险信号，继续保持。</p>
            ) : (
              <ul className="space-y-3">
                {report.dangerEvents.map((d, i) => (
                  <li key={i} className="rounded-lg border border-red-100 bg-red-50 p-3 text-sm">
                    <div className="mb-1 flex items-center gap-2">
                      <span className="rounded bg-red-600 px-1.5 py-0.5 text-xs text-white">
                        {d.type}
                      </span>
                      <span className="text-xs text-neutral-500">{STAGE_LABELS[d.stage]}</span>
                    </div>
                    <p className="mb-1 text-neutral-700">
                      <span className="text-neutral-400">原话：</span>「{d.evidence}」
                    </p>
                    <p className="text-neutral-600">
                      <span className="text-neutral-400">为什么：</span>
                      {d.explain}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-xl border border-black/10 bg-white p-5">
            <h3 className="mb-3 font-semibold">策略卡（针对性）</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {report.strategyCards.map((c) => (
                <div key={c.id} className="rounded-lg border border-black/10 p-3">
                  <div className="mb-1 font-medium text-blue-700">{c.name}</div>
                  <div className="mb-1 text-xs text-neutral-500">何时用：{c.when}</div>
                  <div className="mb-1 text-sm text-neutral-600">{c.how}</div>
                  <div className="rounded bg-neutral-50 p-2 text-xs text-neutral-500">
                    {c.example}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>

      <section className="rounded-xl border border-black/10 bg-white p-5">
        <h3 className="mb-3 font-semibold">原地重答（读档）</h3>
        <p className="mb-3 text-sm text-neutral-500">
          挑一题重新回答，AI 会重新评分做对比——重答不覆盖原始成绩。
        </p>
        <ReanswerList report={report} sessionId={sessionId} />
      </section>

      <div className="flex justify-center pb-4">
        <button
          onClick={onRestart}
          className="rounded-lg bg-blue-600 px-6 py-2.5 font-medium text-white hover:bg-blue-700"
        >
          再来一场
        </button>
      </div>
    </div>
  );
}

function QuestionTree({ stages }: { stages: Report["stages"] }) {
  return (
    <div className="space-y-4">
      {STAGE_ORDER.map((key) => {
        const node = stages.find((s) => s.stage === key);
        if (!node) return null;
        return (
          <div key={key} className="relative border-l-2 border-neutral-200 pl-4">
            <div className="mb-2 text-sm font-semibold text-neutral-700">
              {node.label}
            </div>
            <div className="space-y-3">
              {node.rounds.map((r) => (
                <div
                  key={r.id}
                  className={`relative rounded-lg border p-3 ${
                    r.danger ? "border-red-200 bg-red-50" : "border-black/10 bg-neutral-50"
                  }`}
                >
                  {r.danger && (
                    <span className="absolute -left-4 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-500 px-1 text-xs text-white">
                      ⚠
                    </span>
                  )}
                  <p className="text-sm text-neutral-600">
                    <span className="font-medium text-neutral-800">问：</span>
                    {r.question}
                  </p>
                  <p className="mt-1 text-sm text-neutral-600">
                    <span className="font-medium text-neutral-800">答：</span>
                    {r.answer}
                  </p>
                  {r.scoreEvent && (
                    <div className="mt-1.5 flex flex-wrap gap-2 text-xs">
                      <Delta label="信任" v={r.scoreEvent.trustDelta} />
                      <Delta label="认可" v={r.scoreEvent.recognitionDelta} />
                      <Delta label="匹配" v={r.scoreEvent.fitDelta} />
                      {r.scoreEvent.dangerDelta > 0 && (
                        <span className="rounded bg-red-100 px-1.5 py-0.5 text-red-700">
                          危险 +{r.scoreEvent.dangerDelta}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Delta({ label, v }: { label: string; v: number }) {
  const cls = v > 0 ? "text-green-600" : v < 0 ? "text-red-600" : "text-neutral-400";
  return (
    <span className={`rounded bg-neutral-100 px-1.5 py-0.5 ${cls}`}>
      {label} {v > 0 ? "+" : ""}
      {v}
    </span>
  );
}

function ReanswerList({ report, sessionId }: { report: Report; sessionId: string }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ScoreEvent | null>(null);
  const [target, setTarget] = useState<{ question: string; stage: StageKey } | null>(null);

  const rounds = report.stages.flatMap((s) =>
    s.rounds.map((r) => ({ ...r, stage: s.stage }))
  );

  async function submit() {
    if (!text.trim() || !target) return;
    setLoading(true);
    setResult(null);
    try {
      const r = await fetch("/api/interview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "reanswer",
          sessionId,
          question: target.question,
          answer: text.trim(),
          stage: target.stage,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "评分失败");
      setResult(data.scoreEvent);
    } catch (e) {
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      {rounds.map((r) => (
        <div key={r.id} className="rounded-lg border border-black/10 p-3">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm text-neutral-700">
              <span className="text-neutral-400">[{STAGE_LABELS[r.stage]}]</span> {r.question}
            </p>
            <button
              onClick={() => {
                setOpenId(openId === r.id ? null : r.id);
                setResult(null);
                setText("");
                setTarget({ question: r.question, stage: r.stage });
              }}
              className="shrink-0 rounded-md border border-black/10 px-2 py-0.5 text-xs text-neutral-500 hover:bg-neutral-100"
            >
              {openId === r.id ? "收起" : "重答"}
            </button>
          </div>

          {openId === r.id && (
            <div className="mt-3 space-y-3">
              <div className="flex gap-2">
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="重新组织你的回答…"
                  rows={3}
                  className="flex-1 resize-none rounded-lg border border-black/10 bg-neutral-50 p-2 text-sm outline-none focus:border-blue-500"
                />
                <button
                  onClick={submit}
                  disabled={loading || !text.trim()}
                  className="rounded-lg bg-blue-600 px-4 text-sm font-medium text-white disabled:opacity-40"
                >
                  {loading ? "评分中…" : "提交"}
                </button>
              </div>
              {result && (
                <div className="rounded-lg bg-green-50 p-3 text-sm">
                  <div className="mb-1 flex flex-wrap gap-2 text-xs">
                    <Delta label="信任" v={result.trustDelta} />
                    <Delta label="认可" v={result.recognitionDelta} />
                    <Delta label="匹配" v={result.fitDelta} />
                    {result.dangerDelta > 0 && (
                      <span className="rounded bg-red-100 px-1.5 py-0.5 text-red-700">
                        危险 +{result.dangerDelta}
                      </span>
                    )}
                  </div>
                  <p className="text-neutral-600">{result.note}</p>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ---------------- Curve Chart ---------------- */

function CurveChart({ curve }: { curve: Report["curve"] }) {
  const W = 640;
  const H = 300;
  const L = 40;
  const R = 92;
  const T = 16;
  const B = 28;

  const series: { key: keyof Scores; label: string; color: string }[] = [
    { key: "trust", label: "信任", color: "var(--c-trust)" },
    { key: "recognition", label: "认可", color: "var(--c-recognition)" },
    { key: "fit", label: "匹配", color: "var(--c-fit)" },
    { key: "danger", label: "危险", color: "var(--c-danger)" },
  ];

  const n = curve.length;
  const x = (i: number) =>
    n === 1 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (n - 1);
  const y = (v: number) => T + (H - T - B) * (1 - v / 100);

  // 末点标签防重叠：按 y 排序，不足 16px 就下移
  const labels = series
    .map((s) => {
      const last = curve[n - 1];
      return { ...s, value: last ? last[s.key] : 0, y: y(last ? last[s.key] : 0) };
    })
    .sort((a, b) => a.y - b.y);
  let prev = -Infinity;
  for (const lb of labels) {
    if (lb.y - prev < 16) lb.y = prev + 16;
    prev = lb.y;
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-600">
        {series.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="四维评分曲线">
        {[0, 25, 50, 75, 100].map((g) => (
          <g key={g}>
            <line x1={L} y1={y(g)} x2={W - R} y2={y(g)} stroke="#e1e0d9" strokeWidth="1" />
            <text x={L - 8} y={y(g) + 4} textAnchor="end" fontSize="10" fill="#898781">
              {g}
            </text>
          </g>
        ))}

        {series.map((s) => {
          const pts = curve.map((p, i) => `${x(i)},${y(p[s.key])}`).join(" ");
          return (
            <g key={s.key}>
              <polyline
                points={pts}
                fill="none"
                stroke={s.color}
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {curve.map((p, i) => (
                <circle key={i} cx={x(i)} cy={y(p[s.key])} r="3" fill={s.color} />
              ))}
            </g>
          );
        })}

        {labels.map((lb) => (
          <text
            key={lb.key}
            x={W - R + 8}
            y={lb.y + 4}
            fontSize="11"
            fontWeight="600"
            fill={lb.color}
          >
            {lb.label} {lb.value}
          </text>
        ))}
      </svg>
    </div>
  );
}

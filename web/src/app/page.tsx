"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type {
  Direction,
  InterviewerProfile,
  Report,
  ResumeWeakSpot,
  Round,
  ScoreEvent,
  Scores,
  Session,
  StageKey,
} from "@/lib/types";
import { DIRECTION_NAMES, SAMPLE_RESUMES } from "@/lib/seed/data";
import {
  isCollected,
  loadCollection,
  removeFromCollection,
  saveToCollection,
  type SavedCard,
} from "@/lib/collection";
import { extractResumeText } from "@/lib/pdf";

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

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

interface ChatMsg {
  role: "interviewer" | "student";
  content: string;
  stage: StageKey;
  hesitate?: number; // 该学生回答前的犹豫秒数
}

interface ResumeArgs {
  targetStage: StageKey;
  targetRoundId: string;
  replacementAnswer: string;
  replacementEvent: ScoreEvent;
}

const INIT_SCORES: Scores = { trust: 50, recognition: 50, fit: 50, danger: 0 };

type Phase = "setup" | "interview" | "review" | "collection";

export default function Home() {
  const [phase, setPhase] = useState<Phase>("setup");
  const [direction, setDirection] = useState<Direction>("intelligence");
  const [resume, setResume] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [scores, setScores] = useState<Scores>(INIT_SCORES);
  const [stage, setStage] = useState<StageKey>("opening");
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [collection, setCollection] = useState<SavedCard[]>([]);
  const [saved, setSaved] = useState(false);
  const [fromCollection, setFromCollection] = useState(false);
  const [hideScores, setHideScores] = useState(false);
  const [interviewerProfile, setInterviewerProfile] = useState<InterviewerProfile | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [weakSpots, setWeakSpots] = useState<ResumeWeakSpot[]>([]);
  const [scanning, setScanning] = useState(false);
  const [thinkingSec, setThinkingSec] = useState(0);
  const qAskedAtRef = useRef(0);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // 答题计时：从面试官抛出问题起，累计学生的犹豫秒数（面试官追问时不走表）
  useEffect(() => {
    if (phase !== "interview" || pending || done) return;
    const tick = () =>
      setThinkingSec(Math.max(0, Math.floor((Date.now() - qAskedAtRef.current) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [phase, pending, done]);

  useEffect(() => {
    setCollection(loadCollection());
  }, []);

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
      const data = await api({ action: "start", direction, resume, interviewer: interviewerProfile, weakSpots });
      setSession(data.session);
      setScores(data.scores);
      setStage(data.stage);
      setMessages([{ role: "interviewer", content: data.message, stage: data.stage }]);
      setPhase("interview");
      qAskedAtRef.current = Date.now();
      setThinkingSec(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }

  async function handleSend() {
    const content = input.trim();
    if (!content || pending || done || !session) return;
    const took = Math.max(0, Math.round((Date.now() - qAskedAtRef.current) / 1000));
    setInput("");
    setMessages((m) => [...m, { role: "student", content, stage, hesitate: took }]);
    setPending(true);
    setError("");
    try {
      const data = await api({ action: "message", session, content });
      setSession(data.session);
      setScores(data.scores);
      setStage(data.stage);
      if (data.done) {
        setDone(true);
      } else {
        setMessages((m) => [
          ...m,
          { role: "interviewer", content: data.message, stage: data.stage },
        ]);
        qAskedAtRef.current = Date.now();
        setThinkingSec(0);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }

  async function handleEnd() {
    if (!session) return;
    setPending(true);
    setError("");
    try {
      const data = await api({ action: "end", session });
      setReport(data);
      setSaved(isCollected(data.sessionId));
      setFromCollection(false);
      setPhase("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }

  function handleRestart() {
    setPhase("setup");
    setSession(null);
    setResume("");
    setMessages([]);
    setScores(INIT_SCORES);
    setStage("opening");
    setDone(false);
    setReport(null);
    setError("");
    setInput("");
    setSaved(false);
    setFromCollection(false);
    setHideScores(false);
    setInterviewerProfile(null);
    setWeakSpots([]);
  }

  async function handleResume(args: ResumeArgs) {
    if (!report) return;
    setPending(true);
    setError("");
    try {
      const data = await api({
        action: "resume",
        direction,
        resume,
        stages: report.stages,
        targetStage: args.targetStage,
        targetRoundId: args.targetRoundId,
        replacementAnswer: args.replacementAnswer,
        replacementEvent: args.replacementEvent,
        interviewer: report.interviewer ?? null,
        weakSpots: report.weakSpots ?? [],
      });
      setSession(data.session);
      setScores(data.scores);
      setStage(data.stage);
      setMessages([
        ...data.history,
        { role: "interviewer", content: data.message, stage: data.stage },
      ]);
      setDone(false);
      setReport(null);
      setFromCollection(false);
      setInterviewerProfile(report.interviewer ?? null);
      setPhase("interview");
      qAskedAtRef.current = Date.now();
      setThinkingSec(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }

  async function handleAnalyze(url: string) {
    const u = url.trim();
    if (!u) return;
    setAnalyzing(true);
    setError("");
    try {
      const data = await api({ action: "analyzeInterviewer", url: u });
      setInterviewerProfile(data.profile);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleScan() {
    if (resume.trim().length < 10) {
      setError("请先粘贴简历，或点右侧示例简历一键载入。");
      return;
    }
    setScanning(true);
    setError("");
    try {
      const data = await api({ action: "scanResume", direction, resume });
      setWeakSpots(data.weakSpots ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  }

  function handleSave() {
    if (!report) return;
    const next = saveToCollection({
      id: report.sessionId,
      direction,
      resume,
      report,
      savedAt: Date.now(),
    });
    setCollection(next);
    setSaved(true);
  }

  function openCollection() {
    setCollection(loadCollection());
    setPhase("collection");
  }

  function openCard(card: SavedCard) {
    setDirection(card.direction);
    setResume(card.resume);
    setReport(card.report);
    setSaved(true);
    setFromCollection(true);
    setPhase("review");
  }

  function deleteCard(id: string) {
    setCollection(removeFromCollection(id));
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-4">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight">研面官 · 预推免物语</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={openCollection}
            className="rounded-md border border-black/10 px-3 py-1 text-sm text-neutral-600 hover:bg-black/5"
          >
            🎴 结局收藏{collection.length > 0 ? ` (${collection.length})` : ""}
          </button>
          {phase !== "setup" && phase !== "collection" && (
            <button
              onClick={handleRestart}
              className="rounded-md border border-black/10 px-3 py-1 text-sm text-neutral-500 hover:bg-black/5"
            >
              重新开始
            </button>
          )}
        </div>
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
          onCollection={openCollection}
          collectionCount={collection.length}
          hideScores={hideScores}
          setHideScores={setHideScores}
          interviewerProfile={interviewerProfile}
          setInterviewerProfile={setInterviewerProfile}
          onAnalyze={handleAnalyze}
          analyzing={analyzing}
          weakSpots={weakSpots}
          onScan={handleScan}
          scanning={scanning}
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
          hideScores={hideScores}
          setHideScores={setHideScores}
          interviewer={interviewerProfile}
          thinkingSec={thinkingSec}
        />
      )}

      {phase === "review" && report && (
        <Review
          report={report}
          direction={direction}
          resume={resume}
          onRestart={handleRestart}
          onSave={handleSave}
          saved={saved}
          fromCollection={fromCollection}
          onBack={openCollection}
          onResume={handleResume}
        />
      )}

      {phase === "collection" && (
        <CollectionGallery
          cards={collection}
          onOpen={openCard}
          onDelete={deleteCard}
          onClose={handleRestart}
        />
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
  onCollection: () => void;
  collectionCount: number;
  hideScores: boolean;
  setHideScores: (v: boolean) => void;
  interviewerProfile: InterviewerProfile | null;
  setInterviewerProfile: (p: InterviewerProfile | null) => void;
  onAnalyze: (url: string) => void;
  analyzing: boolean;
  weakSpots: ResumeWeakSpot[];
  onScan: () => void;
  scanning: boolean;
}) {
  const [url, setUrl] = useState("");
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

        <h2 className="mb-2 mt-6 text-lg font-semibold">② 简历（粘贴，或拖入 PDF 自动识别）</h2>
        <ResumeDropzone onText={props.setResume} />
        <textarea
          value={props.resume}
          onChange={(e) => props.setResume(e.target.value)}
          placeholder={"粘贴你的简历，或把 PDF 简历拖进上方区域自动识别。例如：\n【教育背景】…\n【科研经历】…\n【项目经历】…\n【技能】…"}
          rows={10}
          className="mt-2 w-full rounded-lg border border-black/10 bg-neutral-50 p-3 text-sm leading-relaxed outline-none focus:border-blue-500"
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

        <div className="mt-3">
          <button
            onClick={props.onScan}
            disabled={props.scanning || props.resume.trim().length < 10}
            className="rounded-lg border border-amber-400 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-700 transition hover:bg-amber-100 disabled:opacity-40"
          >
            {props.scanning ? "🔍 面试官正在挑刺…" : "🔍 扫描简历软肋（面试官会从哪撕你）"}
          </button>
          {props.weakSpots.length > 0 && (
            <div className="mt-2 space-y-2">
              {props.weakSpots.map((w, i) => (
                <div key={i} className="rounded-lg border border-rose-200 bg-rose-50 p-3">
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 shrink-0 rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                      软肋 {i + 1}
                    </span>
                    <span className="text-sm font-medium text-rose-800">{w.point}</span>
                  </div>
                  {w.reason && <div className="mt-1 text-xs text-rose-600/80">为什么可疑：{w.reason}</div>}
                  {w.probe && <div className="mt-1 text-xs text-rose-700">面试官会追问：{w.probe}</div>}
                </div>
              ))}
            </div>
          )}
        </div>

        <h2 className="mb-2 mt-6 text-lg font-semibold">③ 面试官（可选，模拟真实面试）</h2>
        <p className="mb-2 text-xs text-neutral-500">
          如果知道面试你的导师，粘贴 TA 的个人主页链接，我们会抓取并分析其研究重点、近期论文与面试风格。
        </p>
        <div className="flex gap-2">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") props.onAnalyze(url);
            }}
            placeholder="https://…（导师/老师个人主页）"
            className="flex-1 rounded-lg border border-black/10 bg-neutral-50 px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
          <button
            onClick={() => props.onAnalyze(url)}
            disabled={props.analyzing || !url.trim()}
            className="rounded-lg bg-indigo-600 px-4 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:opacity-40"
          >
            {props.analyzing ? "分析中…" : "分析面试官"}
          </button>
        </div>
        {props.interviewerProfile ? (
          <InterviewerCard
            profile={props.interviewerProfile}
            onClear={() => props.setInterviewerProfile(null)}
          />
        ) : (
          props.analyzing && (
            <div className="mt-2 text-xs text-neutral-500">
              正在抓取主页并分析画像…（约 10 秒）
            </div>
          )
        )}
      </section>

      <section className="flex flex-col justify-between rounded-xl border border-black/10 bg-white p-5">
        <div>
          <h2 className="mb-3 text-lg font-semibold">你会得到什么</h2>
          <ul className="space-y-2 text-sm text-neutral-600">
            <li>👨‍🏫 一位会深挖、会追问的资深面试官</li>
            <li>📈 信任 / 认可 / 匹配 / 危险 四维实时评分</li>
            <li>🌳 复盘追问树：看清每一次翻车，还能读档重来</li>
            <li>💡 每道题的最佳回答示范 + 针对性策略卡</li>
            <li>🎴 收藏每一次的结局卡，攒你的面试结局画廊</li>
          </ul>
          <p className="mt-4 rounded-lg bg-amber-50 p-3 text-xs text-amber-700">
            全程文字对话，约 6 个阶段、9 轮追问。你的回答会被 AI 评分，
            危险值只增不减——诚实作答，才是真正的训练。
          </p>
          <label className="mt-4 flex cursor-pointer items-center gap-2 rounded-lg border border-black/10 bg-neutral-50 p-3 text-sm text-neutral-700">
            <input
              type="checkbox"
              checked={props.hideScores}
              onChange={(e) => props.setHideScores(e.target.checked)}
              className="h-4 w-4 accent-blue-600"
            />
            <span>隐藏本场评分（模拟真实面试，结束后再揭晓）</span>
          </label>
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

function ResumeDropzone({ onText }: { onText: (t: string) => void }) {
  const [dragging, setDragging] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setMsg(null);
    setParsing(true);
    try {
      const text = await extractResumeText(file);
      if (text.trim().length < 10) {
        setMsg({ ok: false, text: "没识别出文字，可能是扫描版 PDF，请手动粘贴。" });
        return;
      }
      onText(text);
      setMsg({ ok: true, text: `✓ 已识别 ${text.length} 字，可在下方继续编辑。` });
    } catch (e) {
      setMsg({
        ok: false,
        text: e instanceof Error ? e.message : "识别失败，请手动粘贴。",
      });
    } finally {
      setParsing(false);
    }
  }

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files?.[0];
          if (f) handleFile(f);
        }}
        onClick={() => inputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-4 text-center transition ${
          dragging
            ? "border-blue-500 bg-blue-50"
            : "border-black/15 bg-neutral-50 hover:border-blue-300"
        }`}
      >
        <div className="text-2xl">📄</div>
        <div className="mt-1 text-sm font-medium text-neutral-700">
          {parsing ? "正在识别 PDF 文字…" : "拖入 PDF 简历，自动识别"}
        </div>
        <div className="text-xs text-neutral-500">或点击选择文件（PDF / TXT）</div>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.txt,.md"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = "";
          }}
        />
      </div>
      {msg && (
        <div className={`mt-2 text-xs ${msg.ok ? "text-emerald-600" : "text-red-600"}`}>
          {msg.text}
        </div>
      )}
    </div>
  );
}

function InterviewerCard({
  profile,
  onClear,
}: {
  profile: InterviewerProfile;
  onClear: () => void;
}) {
  return (
    <div className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50/60 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-medium text-neutral-800">
            👤 {profile.name}
            {profile.title && (
              <span className="ml-2 text-xs text-neutral-500">{profile.title}</span>
            )}
          </div>
          {profile.institution && (
            <div className="text-xs text-neutral-500">{profile.institution}</div>
          )}
        </div>
        <button
          onClick={onClear}
          className="shrink-0 rounded px-1.5 py-0.5 text-xs text-neutral-400 hover:bg-black/5"
        >
          清除
        </button>
      </div>
      {profile.researchFocus.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {profile.researchFocus.map((f, i) => (
            <span key={i} className="rounded bg-white px-1.5 py-0.5 text-xs text-indigo-700">
              {f}
            </span>
          ))}
        </div>
      )}
      {profile.papers && profile.papers.length > 0 ? (
        <div className="mt-2 text-xs text-neutral-600">
          <div className="mb-1 text-neutral-500">近期论文（DBLP 补全）：</div>
          <ul className="space-y-1">
            {profile.papers.map((p, i) => (
              <li key={i} className="leading-snug">
                {p.title}
                {p.venue || p.year ? (
                  <span className="text-neutral-400">
                    {" · "}
                    {[p.venue, p.year].filter(Boolean).join(" ")}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        profile.recentPapers.length > 0 && (
          <div className="mt-2 text-xs text-neutral-600">
            <span className="text-neutral-500">近期论文：</span>
            {profile.recentPapers.join("；")}
          </div>
        )
      )}
      <p className="mt-2 text-xs leading-relaxed text-neutral-600">{profile.persona}</p>
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
  bottomRef: RefObject<HTMLDivElement | null>;
  hideScores: boolean;
  setHideScores: (v: boolean) => void;
  interviewer: InterviewerProfile | null;
  thinkingSec: number;
}) {
  return (
    <div className="grid flex-1 gap-4 lg:grid-cols-[1fr_260px]">
      <section className="flex flex-col rounded-xl border border-black/10 bg-white">
        <div className="flex items-center justify-between border-b border-black/10 px-4 py-2 text-sm">
          <span className="font-medium text-neutral-700">
            阶段：<span className="text-blue-600">{STAGE_LABELS[props.stage]}</span>
            {props.interviewer && (
              <span className="ml-2 text-neutral-400">面试官：{props.interviewer.name}</span>
            )}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => props.setHideScores(!props.hideScores)}
              className="rounded-md border border-black/10 px-2 py-0.5 text-xs text-neutral-500 hover:bg-neutral-100"
            >
              {props.hideScores ? "👁 显示评分" : "🙈 隐藏评分"}
            </button>
            <button
              onClick={props.onEnd}
              disabled={props.pending}
              className="rounded-md border border-black/10 px-2 py-0.5 text-xs text-neutral-500 hover:bg-neutral-100"
            >
              提前结束并复盘
            </button>
          </div>
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
                  {m.hesitate != null && (
                    <div className="mt-1 text-right text-[11px] text-white/60">
                      ⏱ 犹豫 {fmtTime(m.hesitate)}
                    </div>
                  )}
                </div>
              </div>
            )
          )}
          {props.pending && (
            <div className="flex gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-lg">
                👨‍🏫
              </div>
              <div className="rounded-2xl rounded-tl-sm bg-neutral-100 px-4 py-2.5 text-sm text-neutral-500">
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
            <div>
              <div className="mb-2 flex items-center justify-between text-xs">
                <span className="text-neutral-400">正在思考你的回答…</span>
                <span
                  className={`font-medium tabular-nums ${
                    props.thinkingSec >= 60
                      ? "text-rose-500"
                      : props.thinkingSec >= 20
                        ? "text-amber-500"
                        : "text-neutral-500"
                  }`}
                >
                  ⏱ 已犹豫 {fmtTime(props.thinkingSec)}
                </span>
              </div>
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
            </div>
          )}
        </div>
      </section>

      {props.hideScores ? (
        <HiddenScoreHint onReveal={() => props.setHideScores(false)} />
      ) : (
        <ScoreHUD scores={props.scores} />
      )}
    </div>
  );
}

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
              <span className="font-semibold tabular-nums" style={{ color: it.color }}>
                {scores[it.key]}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-100">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${scores[it.key]}%`, backgroundColor: it.color }}
              />
            </div>
          </div>
        ))}
      </div>
      <p className="mt-4 text-xs leading-relaxed text-neutral-500">
        信任/认可/匹配从 50 起，随回答增减；危险值从 0 起，只增不减。
        高危险值会触发面试官更尖锐的追问。
      </p>
    </aside>
  );
}

function HiddenScoreHint({ onReveal }: { onReveal: () => void }) {
  return (
    <aside className="flex flex-col items-center justify-center rounded-xl border border-dashed border-black/15 bg-white p-4 text-center">
      <div className="text-3xl">🙈</div>
      <p className="mt-2 text-sm font-medium text-neutral-700">本场评分已隐藏</p>
      <p className="mt-1 text-xs leading-relaxed text-neutral-500">
        真实面试里你同样看不到打分，专心答题，结束后一起揭晓。
      </p>
      <button
        onClick={onReveal}
        className="mt-3 rounded-md border border-black/10 px-3 py-1 text-xs text-neutral-500 hover:bg-black/5"
      >
        临时看一眼
      </button>
    </aside>
  );
}

/* ---------------- Review ---------------- */

const VERDICT_LABEL: Record<Report["verdict"], string> = {
  offer: "口头 Offer",
  waitlist: "待定",
  reject: "淘汰",
};

const VERDICT_EMOJI: Record<Report["verdict"], string> = {
  offer: "🎉",
  waitlist: "🤔",
  reject: "💥",
};

const VERDICT_GRADIENT: Record<Report["verdict"], string> = {
  offer: "from-emerald-500 via-emerald-600 to-teal-800",
  waitlist: "from-amber-400 via-orange-500 to-orange-700",
  reject: "from-rose-600 via-rose-700 to-slate-900",
};

function worstCrash(report: Report): { answer: string; stage: StageKey } | null {
  let worst: { answer: string; stage: StageKey } | null = null;
  let maxD = 0;
  for (const s of report.stages) {
    for (const r of s.rounds) {
      const d = r.scoreEvent?.dangerDelta ?? 0;
      if (d > maxD) {
        maxD = d;
        worst = { answer: r.answer, stage: s.stage };
      }
    }
  }
  return worst;
}

function Review(props: {
  report: Report;
  direction: Direction;
  resume: string;
  onRestart: () => void;
  onSave: () => void;
  saved: boolean;
  fromCollection: boolean;
  onBack: () => void;
  onResume: (args: ResumeArgs) => void;
}) {
  const { report } = props;
  return (
    <div className="flex-1 space-y-6">
      <VerdictCard
        report={report}
        onSave={props.onSave}
        saved={props.saved}
        onRestart={props.onRestart}
        fromCollection={props.fromCollection}
        onBack={props.onBack}
      />

      <section className="rounded-xl border border-black/10 bg-white p-5">
        <h3 className="mb-3 font-semibold">四维曲线</h3>
        <CurveChart curve={report.curve} />
      </section>

      <section className="rounded-xl border border-black/10 bg-white p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold">追问树复盘</h3>
          <span className="text-xs text-neutral-500">
            点开每道题 → 看最佳答案 / 读档重答
          </span>
        </div>
        <QuestionTree
          report={report}
          direction={props.direction}
          resume={props.resume}
          onResume={props.onResume}
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-black/10 bg-white p-5">
          <h3 className="mb-3 font-semibold">
            危险点清单
            {report.dangerEvents.length > 0 && (
              <span className="ml-2 text-sm text-red-600">{report.dangerEvents.length} 处</span>
            )}
          </h3>
          {report.dangerEvents.length === 0 ? (
            <p className="text-sm text-neutral-600">本场没有踩到危险信号，继续保持。</p>
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
                    <span className="text-neutral-500">原话：</span>「{d.evidence}」
                  </p>
                  <p className="text-neutral-600">
                    <span className="text-neutral-500">为什么：</span>
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

      <div className="flex justify-center pb-4">
        <button
          onClick={props.onRestart}
          className="rounded-lg bg-blue-600 px-6 py-2.5 font-medium text-white hover:bg-blue-700"
        >
          再来一场
        </button>
      </div>
    </div>
  );
}

function VerdictCard(props: {
  report: Report;
  onSave: () => void;
  saved: boolean;
  onRestart: () => void;
  fromCollection: boolean;
  onBack: () => void;
}) {
  const { report } = props;
  const crash = worstCrash(report);
  const dims: { key: keyof Scores; label: string; color: string }[] = [
    { key: "trust", label: "信任", color: "var(--c-trust)" },
    { key: "recognition", label: "认可", color: "var(--c-recognition)" },
    { key: "fit", label: "匹配", color: "var(--c-fit)" },
    { key: "danger", label: "危险", color: "var(--c-danger)" },
  ];

  return (
    <section
      className={`overflow-hidden rounded-2xl bg-gradient-to-br ${VERDICT_GRADIENT[report.verdict]} p-6 text-white shadow-lg`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-1 text-sm text-white/70">本场结局</div>
          <div className="flex items-center gap-3">
            <span className="text-4xl">{VERDICT_EMOJI[report.verdict]}</span>
            <span className="text-3xl font-bold tracking-tight">
              {VERDICT_LABEL[report.verdict]}
            </span>
          </div>
        </div>
        <div className="text-right">
          <div className="mb-1 text-xs text-white/70">面试官评语</div>
          <p className="max-w-xs text-sm italic leading-relaxed text-white/95">
            「{report.comment}」
          </p>
          <div className="mt-1 text-xs text-white/60">—— 面试官合上简历，说</div>
        </div>
      </div>

      {crash && (
        <div className="mt-5 rounded-xl bg-black/20 p-4">
          <div className="mb-1 text-xs font-medium text-red-200">
            🔥 全场最翻车的一句话
          </div>
          <p className="text-sm leading-relaxed text-white/95">「{crash.answer}」</p>
          <div className="mt-1 text-xs text-white/60">{STAGE_LABELS[crash.stage]}阶段</div>
        </div>
      )}

      <div className="mt-5 grid grid-cols-4 gap-3">
        {dims.map((d) => (
          <div key={d.key}>
            <div className="mb-1 flex justify-between text-xs text-white/80">
              <span>{d.label}</span>
              <span className="font-semibold tabular-nums">{report.scores[d.key]}</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/20">
              <div
                className="h-full rounded-full"
                style={{ width: `${report.scores[d.key]}%`, background: d.color }}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {props.fromCollection ? (
          <button
            onClick={props.onBack}
            className="rounded-lg bg-white/15 px-4 py-2 text-sm font-medium text-white hover:bg-white/25"
          >
            ← 返回收藏
          </button>
        ) : (
          <button
            onClick={props.onSave}
            disabled={props.saved}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
              props.saved
                ? "bg-white/25 text-white/80"
                : "bg-white text-slate-900 hover:bg-white/90"
            }`}
          >
            {props.saved ? "✓ 已收藏" : "🎴 收藏这张结局卡"}
          </button>
        )}
        <button
          onClick={props.onRestart}
          className="rounded-lg bg-white/15 px-4 py-2 text-sm font-medium text-white hover:bg-white/25"
        >
          再来一场
        </button>
      </div>
    </section>
  );
}

/* ---------------- 交互式追问树 ---------------- */

function QuestionTree({
  report,
  direction,
  resume,
  onResume,
}: {
  report: Report;
  direction: Direction;
  resume: string;
  onResume: (args: ResumeArgs) => void;
}) {
  const flat = STAGE_ORDER.flatMap((key) => {
    const node = report.stages.find((s) => s.stage === key);
    return node ? node.rounds.map((r) => r.id) : [];
  });
  const lastId = flat.length ? flat[flat.length - 1] : "";

  return (
    <div className="space-y-4">
      {STAGE_ORDER.map((key) => {
        const node = report.stages.find((s) => s.stage === key);
        if (!node) return null;
        return (
          <div key={key} className="relative border-l-2 border-neutral-200 pl-4">
            <div className="mb-2 text-sm font-semibold text-neutral-700">{node.label}</div>
            <div className="space-y-2">
              {node.rounds.map((r) => (
                <TreeNode
                  key={r.id}
                  round={r}
                  stage={key}
                  direction={direction}
                  resume={resume}
                  onResume={onResume}
                  isLast={r.id === lastId}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TreeNode({
  round,
  stage,
  direction,
  resume,
  onResume,
  isLast,
}: {
  round: Round;
  stage: StageKey;
  direction: Direction;
  resume: string;
  onResume: (args: ResumeArgs) => void;
  isLast: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [model, setModel] = useState<string | null>(null);
  const [modelLoading, setModelLoading] = useState(false);
  const [reOpen, setReOpen] = useState(false);
  const [reText, setReText] = useState("");
  const [reLoading, setReLoading] = useState(false);
  const [reResult, setReResult] = useState<ScoreEvent | null>(null);

  async function fetchModel() {
    if (modelOpen) {
      setModelOpen(false);
      return;
    }
    setModelOpen(true);
    if (model) return;
    setModelLoading(true);
    try {
      const r = await fetch("/api/interview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "modelAnswer",
          direction,
          resume,
          question: round.question,
          stage,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "生成失败");
      setModel(d.answer);
    } catch {
      setModel("（最佳答案生成失败，请稍后重试）");
    } finally {
      setModelLoading(false);
    }
  }

  async function submitRe() {
    if (!reText.trim()) return;
    setReLoading(true);
    setReResult(null);
    try {
      const r = await fetch("/api/interview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "reanswer",
          direction,
          resume,
          question: round.question,
          answer: reText.trim(),
          stage,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "评分失败");
      setReResult(d.scoreEvent);
    } catch {
      setReResult(null);
    } finally {
      setReLoading(false);
    }
  }

  return (
    <div
      className={`rounded-lg border ${
        round.danger ? "border-red-200 bg-red-50/60" : "border-black/10 bg-neutral-50"
      }`}
    >
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-start gap-2 px-3 py-2.5 text-left"
      >
        {round.danger && (
          <span className="mt-0.5 shrink-0 rounded bg-red-500 px-1 text-xs leading-4 text-white">
            ⚠
          </span>
        )}
        <span className="flex-1 text-sm text-neutral-700">
          <span className="font-medium text-neutral-800">问：</span>
          {round.question}
        </span>
        <span className="shrink-0 text-xs text-neutral-500">{open ? "收起 ▲" : "展开 ▼"}</span>
      </button>

      {open && (
        <div className="space-y-3 border-t border-black/5 px-3 py-3">
          <p className="text-sm text-neutral-600">
            <span className="font-medium text-neutral-800">你的回答：</span>
            {round.answer}
          </p>

          {round.scoreEvent && (
            <div className="flex flex-wrap gap-2 text-xs">
              <Delta label="信任" v={round.scoreEvent.trustDelta} />
              <Delta label="认可" v={round.scoreEvent.recognitionDelta} />
              <Delta label="匹配" v={round.scoreEvent.fitDelta} />
              {round.scoreEvent.dangerDelta > 0 && (
                <span className="rounded bg-red-100 px-1.5 py-0.5 text-red-700">
                  危险 +{round.scoreEvent.dangerDelta}
                </span>
              )}
              {round.scoreEvent.note && (
                <span className="text-neutral-500">{round.scoreEvent.note}</span>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              onClick={fetchModel}
              className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
            >
              💡 看最佳答案
            </button>
            <button
              onClick={() => {
                setReOpen(!reOpen);
                setReResult(null);
                setReText("");
              }}
              className="rounded-md border border-blue-300 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
            >
              🔁 读档重答
            </button>
          </div>

          {modelOpen && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
              <div className="mb-1 text-xs font-medium text-emerald-700">最佳回答示范</div>
              {modelLoading ? (
                <div className="text-sm text-neutral-500">正在生成示范…</div>
              ) : (
                <p className="text-sm leading-relaxed text-neutral-700">{model}</p>
              )}
            </div>
          )}

          {reOpen && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <textarea
                  value={reText}
                  onChange={(e) => setReText(e.target.value)}
                  placeholder="重新组织你的回答…"
                  rows={3}
                  className="flex-1 resize-none rounded-lg border border-black/10 bg-white p-2 text-sm outline-none focus:border-blue-500"
                />
                <button
                  onClick={submitRe}
                  disabled={reLoading || !reText.trim()}
                  className="rounded-lg bg-blue-600 px-4 text-sm font-medium text-white disabled:opacity-40"
                >
                  {reLoading ? "评分中…" : "提交"}
                </button>
              </div>

              {reResult && (
                <div className="rounded-lg border border-black/10 bg-white p-3">
                  <div className="mb-2 text-xs font-semibold text-neutral-700">
                    读档结果对比（左：原回答 · 右：新回答）
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="rounded bg-neutral-50 p-2">
                      <div className="mb-1 text-neutral-500">原回答</div>
                      <DeltaRow ev={round.scoreEvent} />
                    </div>
                    <div className="rounded bg-green-50 p-2">
                      <div className="mb-1 text-neutral-500">新回答</div>
                      <DeltaRow ev={reResult} />
                    </div>
                  </div>
                  <p className="mt-2 text-sm text-neutral-600">{reResult.note}</p>
                  {!isLast && (
                    <button
                      onClick={() =>
                        onResume({
                          targetStage: stage,
                          targetRoundId: round.id,
                          replacementAnswer: reText.trim(),
                          replacementEvent: reResult,
                        })
                      }
                      className="mt-3 w-full rounded-lg bg-indigo-600 py-2 text-sm font-medium text-white transition hover:bg-indigo-700"
                    >
                      ▶ 带着新回答，从这道题接着往后面
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DeltaRow({ ev }: { ev?: ScoreEvent }) {
  if (!ev) return <span className="text-neutral-500">—</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      <Delta label="信任" v={ev.trustDelta} />
      <Delta label="认可" v={ev.recognitionDelta} />
      <Delta label="匹配" v={ev.fitDelta} />
      {ev.dangerDelta > 0 ? (
        <span className="rounded bg-red-100 px-1.5 py-0.5 text-red-700">危险 +{ev.dangerDelta}</span>
      ) : (
        <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-700">未踩雷</span>
      )}
    </div>
  );
}

function Delta({ label, v }: { label: string; v: number }) {
  const cls = v > 0 ? "text-green-600" : v < 0 ? "text-red-600" : "text-neutral-500";
  return (
    <span className={`rounded bg-neutral-100 px-1.5 py-0.5 ${cls}`}>
      {label} {v > 0 ? "+" : ""}
      {v}
    </span>
  );
}

/* ---------------- 结局收藏画廊 ---------------- */

function CollectionGallery({
  cards,
  onOpen,
  onDelete,
  onClose,
}: {
  cards: SavedCard[];
  onOpen: (c: SavedCard) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="flex-1">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">🎴 我的结局收藏</h2>
        <button
          onClick={onClose}
          className="rounded-md border border-black/10 px-3 py-1 text-sm text-neutral-500 hover:bg-black/5"
        >
          ← 返回
        </button>
      </div>

      {cards.length === 0 ? (
        <div className="rounded-xl border border-dashed border-black/15 bg-white p-12 text-center">
          <div className="text-4xl">🗂️</div>
          <p className="mt-3 text-neutral-600">还没有收藏任何结局。</p>
          <p className="text-sm text-neutral-500">
            完成一场面试后，在结局卡上点「收藏这张结局卡」就能攒进来。
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((c) => (
            <div
              key={c.id}
              className={`group relative overflow-hidden rounded-xl bg-gradient-to-br ${VERDICT_GRADIENT[c.report.verdict]} p-4 text-white shadow`}
            >
              <button
                onClick={() => onOpen(c)}
                className="block w-full text-left"
                aria-label="打开结局"
              >
                <div className="flex items-center gap-2">
                  <span className="text-2xl">{VERDICT_EMOJI[c.report.verdict]}</span>
                  <span className="font-bold">{VERDICT_LABEL[c.report.verdict]}</span>
                </div>
                <p className="mt-2 line-clamp-2 text-sm text-white/90">
                  「{c.report.comment}」
                </p>
                <div className="mt-3 text-xs text-white/60">
                  {DIRECTION_NAMES[c.direction]} ·{" "}
                  {new Date(c.savedAt).toLocaleString("zh-CN", {
                    month: "numeric",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(c.id);
                }}
                className="absolute right-2 top-2 rounded-md bg-black/20 px-1.5 py-0.5 text-xs text-white/70 opacity-0 transition group-hover:opacity-100 hover:bg-black/40"
                aria-label="删除"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- 四维曲线 ---------------- */

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
            <text x={L - 8} y={y(g) + 4} textAnchor="end" fontSize="10" fill="#6b6a66">
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

import {
  startInterview,
  handleMessage,
  buildReport,
  generateModelAnswer,
  buildVerdictComment,
  resumeInterview,
  scanResumeWeaknesses,
} from "@/lib/interview/engine";
import { judgeStandalone } from "@/lib/interview/judge";
import { analyzeInterviewer } from "@/lib/interviewer";
import type {
  Direction,
  InterviewerProfile,
  ResumeWeakSpot,
  ScoreEvent,
  Session,
  StageKey,
  StageNode,
} from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Action =
  | { action: "start"; direction: Direction; resume: string; interviewer?: InterviewerProfile | null; weakSpots?: ResumeWeakSpot[] }
  | { action: "message"; session: Session; content: string }
  | { action: "end"; session: Session }
  | {
      action: "reanswer";
      direction: Direction;
      resume: string;
      question: string;
      answer: string;
      stage: StageKey;
    }
  | {
      action: "modelAnswer";
      direction: Direction;
      resume: string;
      question: string;
      stage: StageKey;
    }
  | {
      action: "resume";
      direction: Direction;
      resume: string;
      stages: StageNode[];
      targetStage: StageKey;
      targetRoundId: string;
      replacementAnswer?: string;
      replacementEvent?: ScoreEvent;
      interviewer?: InterviewerProfile | null;
      weakSpots?: ResumeWeakSpot[];
    }
  | { action: "scanResume"; direction: Direction; resume: string }
  | { action: "analyzeInterviewer"; url: string };

export async function POST(request: Request) {
  let body: Action;
  try {
    body = (await request.json()) as Action;
  } catch {
    return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  try {
    switch (body.action) {
      case "start": {
        const { direction, resume } = body;
        if (!resume || resume.trim().length < 10) {
          return Response.json({ error: "简历太短，请粘贴完整简历" }, { status: 400 });
        }
        const r = await startInterview(direction, resume.trim(), body.interviewer ?? null, body.weakSpots ?? []);
        return Response.json(r);
      }

      case "message": {
        const session = body.session;
        if (!session) {
          return Response.json({ error: "缺少会话状态，请重新开始" }, { status: 400 });
        }
        if (!body.content || body.content.trim().length === 0) {
          return Response.json({ error: "回答不能为空" }, { status: 400 });
        }
        const r = await handleMessage(session, body.content.trim());
        return Response.json(r);
      }

      case "end": {
        const session = body.session;
        if (!session) {
          return Response.json({ error: "缺少会话状态，请重新开始" }, { status: 400 });
        }
        const report = buildReport(session);
        try {
          report.comment = await buildVerdictComment(session, report);
        } catch {
          report.comment =
            report.verdict === "offer"
              ? "底子不错，继续保持你的研究热情。"
              : report.verdict === "waitlist"
                ? "有潜力，但关键细节还讲不扎实。"
                : "先把你简历里每个数字的来龙去脉搞清楚，再来。";
        }
        return Response.json(report);
      }

      case "reanswer": {
        // 无状态评分，供读档重答（不依赖内存会话，收藏的卡也能用）
        const event = await judgeStandalone(
          body.direction,
          body.resume,
          body.question,
          body.answer,
          body.stage
        );
        return Response.json({ scoreEvent: event });
      }

      case "modelAnswer": {
        const answer = await generateModelAnswer(
          body.direction,
          body.resume,
          body.question,
          body.stage
        );
        return Response.json({ answer });
      }

      case "resume": {
        if (!body.resume || body.resume.trim().length < 10) {
          return Response.json({ error: "简历太短，无法续档" }, { status: 400 });
        }
        if (!Array.isArray(body.stages) || body.stages.length === 0) {
          return Response.json({ error: "缺少面试记录，无法续档" }, { status: 400 });
        }
        const r = await resumeInterview({
          direction: body.direction,
          resume: body.resume,
          stages: body.stages,
          targetStage: body.targetStage,
          targetRoundId: body.targetRoundId,
          replacementAnswer: body.replacementAnswer,
          replacementEvent: body.replacementEvent,
          interviewer: body.interviewer ?? null,
          weakSpots: body.weakSpots ?? [],
        });
        return Response.json(r);
      }

      case "scanResume": {
        if (!body.resume || body.resume.trim().length < 10) {
          return Response.json({ error: "简历太短，无法扫描软肋" }, { status: 400 });
        }
        const weakSpots = await scanResumeWeaknesses(body.direction, body.resume.trim());
        return Response.json({ weakSpots });
      }

      case "analyzeInterviewer": {
        if (!body.url || !/^https?:\/\//i.test(body.url)) {
          return Response.json({ error: "请输入 http/https 主页链接" }, { status: 400 });
        }
        const profile = await analyzeInterviewer(body.url);
        return Response.json({ profile });
      }

      default:
        return Response.json({ error: "未知 action" }, { status: 400 });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}

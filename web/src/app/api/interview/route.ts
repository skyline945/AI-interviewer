import { getSession } from "@/lib/sessionStore";
import {
  startInterview,
  handleMessage,
  buildReport,
  generateModelAnswer,
  buildVerdictComment,
} from "@/lib/interview/engine";
import { judgeStandalone } from "@/lib/interview/judge";
import type { Direction, StageKey } from "@/lib/types";

export const dynamic = "force-dynamic";

type Action =
  | { action: "start"; direction: Direction; resume: string }
  | { action: "message"; sessionId: string; content: string }
  | { action: "end"; sessionId: string }
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
    };

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
        const r = await startInterview(direction, resume.trim());
        return Response.json(r);
      }

      case "message": {
        const session = getSession(body.sessionId);
        if (!session) {
          return Response.json({ error: "会话不存在或已过期" }, { status: 404 });
        }
        if (!body.content || body.content.trim().length === 0) {
          return Response.json({ error: "回答不能为空" }, { status: 400 });
        }
        const r = await handleMessage(session, body.content.trim());
        return Response.json(r);
      }

      case "end": {
        const session = getSession(body.sessionId);
        if (!session) {
          return Response.json({ error: "会话不存在或已过期" }, { status: 404 });
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

      default:
        return Response.json({ error: "未知 action" }, { status: 400 });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}

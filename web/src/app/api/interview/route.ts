import { getSession } from "@/lib/sessionStore";
import {
  startInterview,
  handleMessage,
  buildReport,
} from "@/lib/interview/engine";
import { judgeAnswer } from "@/lib/interview/judge";
import type { Direction, Session } from "@/lib/types";

export const dynamic = "force-dynamic";

type Action =
  | { action: "start"; direction: Direction; resume: string }
  | { action: "message"; sessionId: string; content: string }
  | { action: "end"; sessionId: string }
  | {
      action: "reanswer";
      sessionId: string;
      question: string;
      answer: string;
      stage: Session["stage"];
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
        return Response.json(buildReport(session));
      }

      case "reanswer": {
        const session = getSession(body.sessionId);
        if (!session) {
          return Response.json({ error: "会话不存在或已过期" }, { status: 404 });
        }
        // 用副本评分，不污染原始会话
        const copy: Session = {
          ...session,
          scores: { trust: 50, recognition: 50, fit: 50, danger: 0 },
          scoreEvents: [],
          curve: [],
          messages: [],
        };
        const event = await judgeAnswer(copy, body.question, body.answer, body.stage);
        return Response.json({ scoreEvent: event, scores: copy.scores });
      }

      default:
        return Response.json({ error: "未知 action" }, { status: 400 });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}

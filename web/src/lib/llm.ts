// Anthropic 兼容端点客户端：本地代理（127.0.0.1:15721）或 DeepSeek 公网 Anthropic 端点（https://api.deepseek.com/anthropic）
// 响应 content 为数组，需过滤 type === "text"

const BASE = process.env.ANTHROPIC_BASE_URL || "http://127.0.0.1:15721";
const TOKEN = process.env.ANTHROPIC_AUTH_TOKEN || "";

export const MODELS = {
  opus: process.env.ANTHROPIC_DEFAULT_OPUS_MODEL || "claude-opus-4-8[1M]",
  sonnet: process.env.ANTHROPIC_DEFAULT_SONNET_MODEL || "claude-sonnet-4-6[1M]",
  haiku: process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL || "claude-haiku-4-5",
};

export interface LLMMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  model?: string;
  system?: string;
  messages: LLMMessage[];
  temperature?: number;
  maxTokens?: number;
}

export async function chat(opts: ChatOptions): Promise<string> {
  const {
    model = MODELS.sonnet,
    system,
    messages,
    temperature = 0,
    maxTokens = 1024,
  } = opts;

  const res = await fetch(`${BASE}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": TOKEN,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      system,
      messages,
      temperature,
      max_tokens: maxTokens,
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM 请求失败 ${res.status}: ${text.slice(0, 500)}`);
  }

  const data = await res.json();
  const blocks = Array.isArray(data.content) ? data.content : [];
  const text = blocks
    .filter((b: { type: string }) => b.type === "text")
    .map((b: { text?: string }) => b.text || "")
    .join("");
  return text;
}

// 从文本中提取第一个平衡的 JSON 对象（容忍字符串内括号、尾随文字）
function extractJSONObject(raw: string): string {
  const start = raw.indexOf("{");
  if (start === -1) throw new Error("未找到 JSON 起始 '{'");
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < raw.length; i++) {
    const c = raw[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else {
      if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) return raw.slice(start, i + 1);
      }
    }
  }
  throw new Error("JSON 对象未闭合");
}

// 让模型返回 JSON，并做健壮解析
export async function chatJSON<T>(opts: ChatOptions): Promise<T> {
  const raw = await chat({ ...opts, temperature: 0, maxTokens: 4000 });
  const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  const jsonStr = extractJSONObject(cleaned);
  try {
    return JSON.parse(jsonStr) as T;
  } catch (e) {
    throw new Error("JSON 解析失败: " + jsonStr.slice(0, 400));
  }
}

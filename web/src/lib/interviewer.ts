// 面试官主页爬取 + 画像分析（仅服务端使用，只抓取公开页面）
import { chatJSON, MODELS } from "./llm";
import { interviewerProfileSystem } from "./interview/prompts";
import type { InterviewerProfile, PaperInfo } from "./types";

function pickCharset(contentType: string | null, head: string): string {
  const m = /charset\s*=\s*"?([\w-]+)"?/i.exec(contentType || "");
  if (m) return m[1];
  const meta = /charset\s*=\s*"?([\w-]+)"?/i.exec(head.slice(0, 4000));
  if (meta) return meta[1];
  return "utf-8";
}

function htmlToText(html: string): string {
  let s = html;
  s = s.replace(/<script[\s\S]*?<\/script>/gi, " ");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, " ");
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  s = s.replace(/<\/(p|div|li|h[1-6]|tr|br|section|article|ul|ol)>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  const entities: Record<string, string> = {
    "&nbsp;": " ",
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&apos;": "'",
    "&mdash;": "—",
    "&ndash;": "–",
  };
  s = s.replace(/&[a-z#0-9]+;/gi, (e) => entities[e.toLowerCase()] ?? " ");
  s = s.replace(/\n{3,}/g, "\n\n");
  s = s.replace(/[ \t]{2,}/g, " ");
  return s.trim();
}

export async function fetchPageText(
  url: string
): Promise<{ title: string; text: string }> {
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("请输入 http:// 或 https:// 开头的链接");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  let res: Response;
  try {
    res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml",
      },
    });
  } catch {
    clearTimeout(timer);
    throw new Error("无法访问该主页（超时或网络错误）");
  }
  clearTimeout(timer);
  if (!res.ok) throw new Error(`主页返回 ${res.status}，无法访问`);

  const contentType = res.headers.get("content-type");
  const buf = await res.arrayBuffer();
  if (buf.byteLength > 2_000_000) throw new Error("页面过大，超出分析范围");

  const bytes = new Uint8Array(buf);
  const head = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, 4000));
  const charset = pickCharset(contentType, head);
  let html = "";
  try {
    html = new TextDecoder(charset).decode(bytes);
  } catch {
    html = new TextDecoder("utf-8").decode(bytes);
  }

  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch ? titleMatch[1].replace(/\s+/g, " ").trim() : url;
  const text = htmlToText(html);
  return { title, text };
}

// —— 论文检索补全：OpenAlex（完全开放的学术 API，无需 key）。
// DBLP / Google Scholar 均有人机验证（Anubis / CAPTCHA）反爬，服务端无法稳定请求，故改用 OpenAlex。 ——
const OPENALEX = "https://api.openalex.org";

function normTitle(t: string): string {
  return t
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toArray(x: unknown): unknown[] {
  if (x == null) return [];
  return Array.isArray(x) ? x : [x];
}

// 通用 OpenAlex JSON 请求（带超时与容错，任何失败都返回 null）
async function openalexJSON(path: string): Promise<any> {
  const url = `${OPENALEX}/${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  let res: Response;
  try {
    res = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json", "user-agent": "yanmian-guan/1.0" },
    });
  } catch {
    clearTimeout(timer);
    return null;
  }
  clearTimeout(timer);
  if (!res.ok) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

interface PaperSource {
  title: string;
  venue: string;
  year: string;
  authors: string[];
  url: string;
}

// 把 OpenAlex works 结果转成结构化论文
function worksFromData(data: any): PaperSource[] {
  const results = data?.results;
  if (!Array.isArray(results)) return [];
  return results
    .map((w: any) => ({
      title: String(w?.display_name ?? w?.title ?? "").trim(),
      venue: String(w?.primary_location?.source?.display_name ?? "").trim(),
      year: String(w?.publication_year ?? "").trim(),
      authors: toArray(w?.authorships)
        .map((a: any) => a?.author?.display_name ?? "")
        .filter((s: unknown) => typeof s === "string" && s.length > 0),
      url: w?.doi
        ? (String(w.doi).startsWith("http") ? String(w.doi) : `https://doi.org/${w.doi}`)
        : String(w?.id ?? "").trim(),
    }))
    .filter((p) => p.title.length > 0);
}

// 按标题检索：返回最相关的若干篇
async function titleSearch(t: string): Promise<PaperSource[]> {
  const data = await openalexJSON(`works?filter=title.search:${encodeURIComponent(t)}&per-page=3`);
  return data ? worksFromData(data) : [];
}

// 按作者检索：先定位作者实体，再拉 TA 的近期论文（按发表年份倒序）
async function authorSearch(nameEn: string): Promise<PaperSource[]> {
  const adata = await openalexJSON(`authors?search=${encodeURIComponent(nameEn)}&per-page=5`);
  const results = adata?.results;
  if (!Array.isArray(results) || results.length === 0) return [];
  // 优先选作品数最多的作者实体（更可能是本人，而非同名/合并噪音）
  const author = [...results].sort(
    (a: any, b: any) => (b?.works_count ?? 0) - (a?.works_count ?? 0)
  )[0];
  if (!author?.id) return [];
  const id = String(author.id).replace("https://openalex.org/", "");
  const wdata = await openalexJSON(`works?filter=author.id:${id}&sort=publication_year:desc&per-page=25`);
  return wdata ? worksFromData(wdata) : [];
}

// 标题相似度：完全一致 / 包含 / 词级重叠，避免串到别人的论文
function titleMatches(query: string, hit: string): boolean {
  const q = normTitle(query);
  const h = normTitle(hit);
  if (!q || !h) return false;
  if (q === h) return true;
  if (q.length >= 8 && (h.includes(q) || q.includes(h))) return true;
  const qt = new Set(q.match(/[a-z0-9一-鿿]{3,}/g) ?? []);
  const ht = new Set(h.match(/[a-z0-9一-鿿]{3,}/g) ?? []);
  if (qt.size === 0 || ht.size === 0) return false;
  let overlap = 0;
  for (const t of qt) if (ht.has(t)) overlap++;
  return overlap / Math.min(qt.size, ht.size) >= 0.5;
}

async function enrichPapers(titles: string[], nameEn?: string): Promise<PaperInfo[]> {
  const cleanTitles = (titles ?? []).map((t) => t.trim()).filter((t) => t.length >= 6);
  const titleTasks = cleanTitles.map(async (t) => {
    const hits = await titleSearch(t);
    return hits.find((h) => titleMatches(t, h.title)) ?? null;
  });
  const authorTask = nameEn
    ? authorSearch(nameEn)
    : Promise.resolve([] as PaperSource[]);

  const [titleHits, authorHits] = await Promise.all([
    Promise.all(titleTasks).then((arr) => arr.filter((x): x is PaperSource => x != null)),
    authorTask,
  ]);

  const seen = new Set<string>();
  const merged: PaperInfo[] = [];
  for (const p of [...authorHits, ...titleHits]) {
    const key = normTitle(p.title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push({ title: p.title, venue: p.venue, year: p.year, authors: p.authors, url: p.url });
  }
  merged.sort((a, b) => b.year.localeCompare(a.year));
  return merged.slice(0, 8);
}

export async function analyzeInterviewer(url: string): Promise<InterviewerProfile> {
  const { title, text } = await fetchPageText(url);
  if (text.length < 60) {
    throw new Error("页面文字太少（可能是 JS 渲染或图片页），请换一个纯文本主页链接");
  }
  const profile = await chatJSON<InterviewerProfile>({
    model: MODELS.sonnet,
    system: interviewerProfileSystem(url, title, text.slice(0, 18000)),
    messages: [{ role: "user", content: "请分析。" }],
  });
  profile.name = profile.name?.trim() || "未知面试官";
  profile.nameEn = profile.nameEn?.trim() || undefined;
  profile.title = profile.title?.trim() || "";
  profile.institution = profile.institution?.trim() || "";
  profile.researchFocus = Array.isArray(profile.researchFocus)
    ? profile.researchFocus.filter(Boolean)
    : [];
  profile.recentPapers = Array.isArray(profile.recentPapers)
    ? profile.recentPapers.filter(Boolean).slice(0, 5)
    : [];
  profile.style = profile.style?.trim() || "温和严谨";
  profile.persona = profile.persona?.trim() || profile.style;
  profile.sourceUrl = url;
  try {
    profile.papers = await enrichPapers(profile.recentPapers, profile.nameEn);
  } catch {
    profile.papers = [];
  }
  return profile;
}

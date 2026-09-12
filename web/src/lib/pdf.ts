"use client";

// 浏览器端 PDF 文本提取（pdf.js），拖入简历 PDF 自动识别
// worker / cmaps / standard_fonts 已拷贝到 public/，同源加载，无需外网

export async function extractPdfText(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

  const buf = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({
    data: buf,
    cMapUrl: "/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/standard_fonts/",
  }).promise;

  let out = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    for (const item of content.items) {
      if ("str" in item) {
        out += item.str;
        if (item.hasEOL) out += "\n";
      }
    }
    out += "\n";
  }

  // 清理：压掉 3 个以上的连续换行、去首尾空白
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

// 支持的文件类型与对应的文本读取方式
export async function extractResumeText(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) {
    return extractPdfText(file);
  }
  if (name.endsWith(".txt") || name.endsWith(".md")) {
    return file.text();
  }
  throw new Error("只支持 PDF / TXT / Markdown 简历文件");
}

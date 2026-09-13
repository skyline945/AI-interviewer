// 会话 ID 生成。
// 说明：会话本身由前端持有并随每个请求回传（无状态部署），服务端不再存储会话。
// 原因：Vercel serverless 多实例无状态，内存 Map 会丢；改为「前端持有会话」后任意实例都能处理。

export function newId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    Math.random().toString(36).slice(2) + Date.now().toString(36)
  );
}

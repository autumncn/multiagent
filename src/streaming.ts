// SSE streaming callback registry
// Allows LangGraph nodes to emit token events via SSE

import { Response } from "express";
import { streamModel, invokeModel } from "./models.js";
import { BaseMessageLike } from "@langchain/core/messages";

// ============================================================
// SSE Writer Registry (keyed by threadId)
// ============================================================
interface SSEWriter {
  write: (event: string, data: any) => void;
  end: () => void;
  closed: boolean;
}

const writers = new Map<string, SSEWriter>();

export function registerWriter(threadId: string, writer: SSEWriter): void {
  writers.set(threadId, writer);
}

export function unregisterWriter(threadId: string): void {
  writers.delete(threadId);
}

export function getWriter(threadId: string): SSEWriter | undefined {
  return writers.get(threadId);
}

// ============================================================
// Create SSE Writer from Express Response
// ============================================================
export function createSSEWriter(res: Response): SSEWriter {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();

  let closed = false;
  res.on("close", () => { closed = true; });

  return {
    write(event: string, data: any) {
      if (closed) return;
      try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch {
        closed = true;
      }
    },
    end() {
      if (!closed) {
        try { res.end(); } catch {}
      }
      closed = true;
    },
    get closed() { return closed; },
  };
}

// ============================================================
// Streaming model call via callback (used by LangGraph nodes)
// ============================================================
export async function streamWithCallback(
  alias: string,
  messages: BaseMessageLike[],
  callback: (token: string) => void
): Promise<string> {
  return streamModel(alias, messages, callback);
}

// Re-export invokeModel for router (non-streaming JSON)
export { invokeModel } from "./models.js";

// ============================================================
// SSE event helpers
// ============================================================
export function emitNodeStart(threadId: string, node: string, extra?: any) {
  const w = getWriter(threadId);
  w?.write("node_start", { threadId, node, ...extra });
}

export function emitToken(threadId: string, node: string, token: string, extra?: any) {
  const w = getWriter(threadId);
  if (w && !w.closed) {
    w.write("token", { threadId, node, token, ...extra });
  }
}

export function emitNodeDone(threadId: string, node: string, extra?: any) {
  const w = getWriter(threadId);
  w?.write("node_done", { threadId, node, ...extra });
}

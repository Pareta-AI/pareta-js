/**
 * SSE parsing over a `fetch` `ReadableStream` — port of the Python
 * `_iter_sse_json` (data-only) and `_iter_sse_typed` (named-event) parsers.
 *
 * Two modes behind one `events` flag, NEVER one parser for both:
 *  - data-only (chat completions): strip `data:`, skip `:`-comments/blanks,
 *    stop on `[DONE]`, JSON-parse, skip unparseable lines.
 *  - named-event (endpoint deploy): track the `event:` line (reset to "message"
 *    on a blank line) and yield `{event, data}` per event.
 *
 * CRITICAL: the deploy stream (sse-starlette) emits CRLF line endings. A naive
 * `split("\n")` would silently drop every deploy event. `iterLines` normalizes
 * `\r\n` and bare `\r` → `\n` before framing (the frontend was bitten by this
 * at commit 862fab6 — `normalizeSSEBuffer`). We parse incrementally (yield as
 * bytes arrive), improving on the Python async client which buffered all lines.
 */

function normalize(s: string): string {
  return s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/** Decode a byte stream and yield complete `\n`-terminated lines (CRLF-normalized). */
export async function* iterLines(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer = normalize(buffer + decoder.decode(value, { stream: true }));
    let idx: number;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      yield buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
    }
  }
  // Flush any trailing text the stream ended without a final newline.
  buffer = normalize(buffer + decoder.decode());
  if (buffer.length > 0) {
    for (const line of buffer.split("\n")) yield line;
  }
}

/** Data-only SSE: yield each `data:` JSON object (vLLM chat stream). */
export async function* parseDataOnly(lines: AsyncIterable<string>): AsyncGenerator<unknown> {
  for await (const rawLine of lines) {
    let line = rawLine.trim();
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("data:")) line = line.slice("data:".length).trim();
    if (!line || line === "[DONE]") {
      if (line === "[DONE]") return;
      continue;
    }
    try {
      yield JSON.parse(line);
    } catch {
      continue;
    }
  }
}

/** One named SSE event: the event type + its parsed (or raw-string) data. */
export interface SSEEvent {
  event: string;
  data: unknown;
}

/** Named-event SSE: track `event:` lines, yield `{event, data}` (deploy stream). */
export async function* parseNamedEvent(lines: AsyncIterable<string>): AsyncGenerator<SSEEvent> {
  let event = "message";
  for await (const rawLine of lines) {
    const line = rawLine.replace(/\n+$/, "");
    if (!line) {
      event = "message"; // blank line terminates one event
      continue;
    }
    if (line.startsWith(":")) continue;
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      const raw = line.slice("data:".length).trim();
      if (raw === "[DONE]") return;
      let data: unknown;
      try {
        data = JSON.parse(raw);
      } catch {
        data = raw;
      }
      yield { event, data };
    }
  }
}

/**
 * Parse an SSE response body. `events=false` → data-only objects; `events=true`
 * → `{event, data}` named events.
 */
export function parseSSE(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  opts: { events: true },
): AsyncGenerator<SSEEvent>;
export function parseSSE(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  opts?: { events?: false },
): AsyncGenerator<unknown>;
export function parseSSE(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  opts?: { events?: boolean },
): AsyncGenerator<unknown> {
  const lines = iterLines(reader);
  return opts?.events ? parseNamedEvent(lines) : parseDataOnly(lines);
}

/**
 * Pareta — TypeScript/JavaScript client.
 *
 * One model id — "auto" — and Pareta plans each request, routes it to
 * benchmark-proven open specialists, verifies, and falls back to a frontier
 * model when that's the right call. One request, one bill.
 *
 *   import { Pareta } from "pareta";
 *   const pa = Pareta.fromEnv();                 // PARETA_API_KEY
 *   const res = await pa.chat.completions.create({
 *     model: "auto",
 *     messages: [{ role: "user", content: "hi" }],
 *   });
 *
 * Inference is OpenAI-compatible, so you can equally point the `openai` SDK at
 * `baseURL` + your `pareta_sk_` key with model "auto". The SDK's unique value
 * is everything around that call: evals on your own data (benchmark "auto"
 * against frontier models), auto metrics, and `tasks.match` for discovering
 * what Pareta can do.
 */

export { Pareta } from "./client.js";
export type { ParetaOptions, FilePart, Transport, SSEEvent } from "./client.js";
export { VERSION } from "./version.js";

// errors
export {
  ParetaError,
  APIConnectionError,
  APITimeoutError,
  APIStatusError,
  BadRequestError,
  AuthenticationError,
  PermissionDeniedError,
  NotFoundError,
  ConflictError,
  InsufficientCreditsError,
  RateLimitError,
  EndpointNotReadyError,
} from "./errors.js";
export type { ErrorDetail, ValidationErrorItem } from "./errors.js";

// response models
export {
  BaseModel,
  Usage,
  Message,
  Choice,
  ChatCompletion,
  ChatCompletionChunk,
  Model,
  ModelList,
  Task,
  TaskMatch,
  TaskMatchCandidate,
  EvalSet,
  EvalRun,
  EvalResult,
  EvalItemResult,
  FrontierModel,
} from "./models.js";

// request param types + resource helpers
export type { ChatMessage, ChatCompletionCreateParams } from "./resources/chat.js";
export type { EvalRunCreateParams, FrontierSpec, FileInput } from "./resources/evals.js";
export { EvalSets, EvalRuns } from "./resources/evals.js";

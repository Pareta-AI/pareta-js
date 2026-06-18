/**
 * Pareta — TypeScript/JavaScript client.
 *
 * Deploy open-weights endpoints, run metered inference, browse the benchmark
 * catalog, and eval models on your own data.
 *
 *   import { Pareta } from "pareta";
 *   const pa = Pareta.fromEnv();                 // PARETA_API_KEY
 *   const res = await pa.chat.completions.create({
 *     model: "ep_…",
 *     messages: [{ role: "user", content: "hi" }],
 *   });
 *
 * Inference is OpenAI-compatible, so you can equally point the `openai` SDK at
 * `baseURL` + your `pareta_sk_` key. The SDK's unique value is the control plane
 * (deploy / eval / discovery).
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
  Endpoint,
  Task,
  TaskMatch,
  TaskMatchCandidate,
  EvalSet,
  EvalRun,
  EvalResult,
  Leaderboard,
  LeaderboardEntry,
  FrontierModel,
} from "./models.js";

// request param types + resource helpers
export type { ChatMessage, ChatCompletionCreateParams } from "./resources/chat.js";
export type { DeployParams } from "./resources/endpoints.js";
export { EndpointMetrics } from "./resources/endpoints.js";
export type { EvalRunCreateParams, FrontierSpec, FileInput } from "./resources/evals.js";
export { EvalSets, EvalRuns } from "./resources/evals.js";

---
"@michthemaker/futures": minor
---

DOM-Specific Leaf Futures

Two new futures ship under `@michthemaker/futures/dom` — a dedicated browser entrypoint built with no Node.js dependencies.

**Browser — `@michthemaker/futures/dom`**

- `FetchFuture<T>` — full HTTP client built on `XMLHttpRequest`. No `fetch`, no Promises, no Node.js.
  - Same API surface as the Node version — drop-in familiar if you've used `@michthemaker/futures/node`.
  - Supports `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`.
  - Query params appended automatically via `query` option.
  - Objects in `body` are `JSON.stringify`'d automatically with `Content-Type: application/json`.
  - Configurable timeout via `xhr.timeout` (default 30s).
  - Error taxonomy via `Result.Err`: `http`, `network`, `timeout`, `parse`, `aborted`, `invalid_url`.
  - `network` absorbs everything the browser won't tell you about — DNS failures, SSL errors, CORS blocks all come back as `network` since XHR gives no further detail.
  - Response headers parsed from `getAllResponseHeaders()` into `Record<string, string>`, keys lowercased.
  - `cancel()` calls `xhr.abort()` — resolves with `Result.Err({ kind: "aborted" })`, safe to call at any point.

- `AnimationFrameFuture` — wraps `requestAnimationFrame` as a lazy future. Resolves with the frame timestamp on the next animation frame. `cancel()` calls `cancelAnimationFrame` and prevents resolution.

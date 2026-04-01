# @michthemaker/futures

## 0.2.0

### Minor Changes

- cc33aa9: DOM-Specific Leaf Futures

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

## 0.1.0

### Minor Changes

- f5fac94: Poll-based async runtime for TypeScript — first real release

  Here's everything that shipped:

  **Core**

  - `Future<T>` — abstract base class, the whole runtime contract lives in `poll(waker)`. Nothing runs until you say so.
  - `Future.run(future, onComplete)` — the one and only way to execute a future. Marks the instance
    as consumed so you can't accidentally run it twice.
  - Single-use enforcement — run a future twice and it throws. Intentional. Create a new instance.

  **Primitives**

  - `Ready<T>` — resolves immediately with a known value. Great for kicking off chains or wrapping sync values in a future context.
  - `TimerFuture` — lazy `setTimeout` wrapper. The timer doesn't start until the future is polled. Supports `cancel()` to clear it early.
  - `YieldNow` — yields one event loop tick via `setTimeout(fn, 0)` then resolves. Handy when you need to let other work breathe in a tight chain.

  **Combinators**

  - `andThen(fn)` — sequences two futures. The second doesn't start until the first resolves. Short-circuits the chain if the upstream resolves with a `Result.Err` — your callback is skipped and the error passes through as-is.
  - `Future.all([...])` — runs futures concurrently, resolves when every one of them is done. Results come back as a
    tuple in the original order, fully typed.
  - `Future.race([...])` — resolves with the first future to finish and immediately cancels the rest. All futures must share the same value type.

  **Cancellation**

  - Every `Future` has a `cancel()` method. Base is a no-op, leaf futures override it to clean up their resources.
  - Cancellation propagates through `andThen`, `all`, and `race` chains — cancel the top and everything underneath gets cancelled too.

  **Result type**

  - `Result.Ok(value)` / `Result.Err(error)` — errors as values, no try/catch anywhere.
  - `Result.isResult(value)` — symbol-tagged runtime check so plain `{ ok: true }` objects don't accidentally match.

  **Node.js — `@michthemaker/futures/node`**

  - `FetchFuture<T>` — full HTTP client on top of `node:http` / `node:https`. No `fetch`, no Promises.
  - Supports `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`.
  - Query params appended automatically. Objects in `body` are `JSON.stringify`'d with the right `Content-Type`.
  - Configurable timeout (default 30s).
  - Full error taxonomy via `Result.Err`: `http`, `network`, `dns`, `timeout`, `parse`, `ssl`, `aborted`, `invalid_url`.
  - `cancel()` destroys the underlying socket — safe to call at any point.

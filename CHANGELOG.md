# @michthemaker/futures

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

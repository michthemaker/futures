# Futures

[![GitHub license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE) [![npm version](https://img.shields.io/npm/v/@michthemaker/futures.svg?style=flat)](https://www.npmjs.com/package/@michthemaker/futures) [![bundle size](https://img.shields.io/bundlephobia/minzip/@michthemaker/futures)](https://bundlephobia.com/package/@michthemaker/futures) [![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](./CONTRIBUTING.md)

A poll-based async runtime for TypeScript inspired by Rust's `Future` trait. Zero Promises under the hood. Zero `async/await` required. Fully lazy — nothing executes until `Future.run()` is called.

---

## Why not Promises?

Promises are **push-based**. The moment you construct one, it starts executing and pushes its result to whoever is listening.

```ts
// This starts immediately — you have no say in the matter
const p = new Promise((resolve) => {
  console.log("already running"); // fires right now
  setTimeout(resolve, 1000);
});
```

Futures are **pull-based**. A `Future` is an inert description of a computation. Nothing happens until the runtime explicitly drives it by calling `poll`.

```ts
// This does nothing — yet
const f = new TimerFuture(1000);

// Now it starts
Future.run(f, () => console.log("1 second passed"));
```

That difference — lazy vs eager — is what makes futures composable, cancellable, and safe to pass around as values before you decide to execute them.

---

## Installation

```sh
npm install @michthemaker/futures
# or
pnpm add @michthemaker/futures
```

For Node.js HTTP utilities:

```ts
import { FetchFuture } from "@michthemaker/futures/node";
```

---

## Core concepts

### `poll(waker)`

Every `Future` has a single method: `poll(waker)`. The runtime calls it to ask "are you done?".

- If ready: return `{ ready: true, value }`.
- If not ready: store the `waker`, return `{ ready: false, value: undefined }`, and call `waker()` later when progress is possible. The runtime re-polls on every `waker()` invocation.

`setTimeout` and I/O callbacks are the only places wakers are ever called — all async boundaries live inside leaf futures.

### Single-use

Futures are single-use. Once driven by `Future.run()`, the instance is consumed. Running it again throws immediately. Create a new instance, or wrap construction in a factory function.

```ts
const future = new Ready(42);
Future.run(future, () => {}); // fine
Future.run(future, () => {}); // throws — already consumed
```

---

## Basic usage

### Lazy execution

```ts
import { Future, TimerFuture } from "@michthemaker/futures";

const timer = new TimerFuture(500);

// Nothing has happened yet. The timer hasn't started.

Future.run(timer, () => {
  console.log("500ms elapsed");
});

// Timer starts NOW.
```

### `Ready` — synchronous value in a Future context

```ts
import { Future, Ready } from "@michthemaker/futures";

Future.run(new Ready(42), (value) => {
  console.log(value); // 42
});
```

---

## Chaining with `andThen`

`.andThen(fn)` sequences futures. The callback receives the resolved value of the current future and must return the next `Future`. The second future doesn't start until the first completes.

```ts
import { Future, TimerFuture, Ready } from "@michthemaker/futures";

const pipeline = new TimerFuture(300)
  .andThen(() => new Ready("step one done"))
  .andThen((msg) => {
    console.log(msg); // "step one done"
    return new TimerFuture(200);
  })
  .andThen(() => new Ready("all done"));

Future.run(pipeline, (value) => {
  console.log(value); // "all done"
});
```

Chains are as long as you need. Each step is lazy — no future in the chain starts until the previous one resolves.

---

## Concurrency with `Future.all`

`Future.all` runs futures concurrently and resolves when every one of them has completed. Results are returned as a tuple in the original order, regardless of which future finished first.

```ts
import { Future, TimerFuture, Ready } from "@michthemaker/futures";

const a = new TimerFuture(100).andThen(() => new Ready(1));
const b = new TimerFuture(300).andThen(() => new Ready("hello"));
const c = new Ready(true);

Future.run(Future.all([a, b, c]), ([n, s, flag]) => {
  console.log(n, s, flag); // 1, "hello", true — after ~300ms
});
```

TypeScript infers the tuple type from the input, so `[n, s, flag]` is fully typed as `[number, string, boolean]`.

---

## Racing with `Future.race`

`Future.race` resolves with the first future to complete. All remaining futures are immediately cancelled.

```ts
import { Future, TimerFuture } from "@michthemaker/futures";

const slow = new TimerFuture(2000);
const fast = new TimerFuture(100);

Future.run(Future.race([slow, fast]), () => {
  console.log("fastest won"); // fires after ~100ms
  // `slow` has been cancelled — its timer is cleared
});
```

All futures passed to `race` must share the same value type.

---

## Error handling with `Result`

There are no try/catch blocks in this library. Errors are values, via `Result<T, E>`.

```ts
import { Result } from "@michthemaker/futures";

const ok = Result.Ok(42);
const err = Result.Err("something went wrong");

console.log(ok.ok); // true
console.log(ok.value); // 42

console.log(err.ok); // false
console.log(err.error); // "something went wrong"
```

Use `Result.isResult(value)` to discriminate at runtime. It uses an internal unforgeable symbol tag — plain objects with an `ok` property will never accidentally match.

```ts
if (Result.isResult(value) && !value.ok) {
  console.error(value.error);
}
```

### Short-circuit on `Err`

If a future in an `andThen` chain resolves with a `Result.Err`, the chain is short-circuited. The callback is skipped and the error is passed through as-is to the final `onComplete`.

```ts
import { Future, Ready, Result } from "@michthemaker/futures";

const pipeline = new Ready(Result.Err("bad input")).andThen(
  (v) => new Ready(Result.Ok("this never runs"))
);

Future.run(pipeline, (value) => {
  console.log(value); // { ok: false, error: "bad input" }
});
```

---

## Cancellation

Every `Future` has a `cancel()` method. The base implementation is a no-op — leaf futures like `TimerFuture` and `FetchFuture` override it to clean up their resources.

Cancellation propagates through combinator chains.

```ts
import { Future, TimerFuture } from "@michthemaker/futures";

const chain = new TimerFuture(5000).andThen(() => new TimerFuture(5000));

Future.run(chain, () => console.log("done"));

// Some time later — cancel everything
chain.cancel(); // clears the active timer and any downstream future
```

`Future.all` and `Future.race` also propagate `cancel()` to all their constituent futures.

---

## `YieldNow` — cooperative scheduling

`YieldNow` resolves after one event loop tick (`setTimeout(fn, 0)`). Use it to let other pending work run before continuing a chain.

```ts
import { Future, Ready, YieldNow } from "@michthemaker/futures";

const pipeline = new Ready("start")
  .andThen(() => new YieldNow())
  .andThen(() => new Ready("resumed after yield"));

Future.run(pipeline, (value) => {
  console.log(value); // "resumed after yield"
});
```

---

## Node.js — `FetchFuture`

`FetchFuture` is a full HTTP client built on `node:http` and `node:https`. No `fetch` API, no Promises — just a `Future` that resolves to `Result<FetchResponse<T>, FetchError>`.

```ts
import { Future, FetchFuture, Result } from "@michthemaker/futures/node";

type Todo = { id: number; title: string; completed: boolean };

Future.run(
  new FetchFuture<Todo>("https://jsonplaceholder.typicode.com/todos/1"),
  (result) => {
    if (!result.ok) {
      console.error(result.error.kind, result.error.message);
      return;
    }
    console.log(result.value.data); // Todo
    console.log(result.value.status); // 200
  }
);
```

### Options

```ts
new FetchFuture("https://api.example.com/items", {
  method: "POST",
  headers: { Authorization: "Bearer token" },
  body: { name: "widget", qty: 3 }, // auto JSON.stringify + Content-Type
  query: { page: 1, limit: 20 }, // appended to URL
  timeout: 5_000, // ms, default 30_000
  parseResponse: true, // JSON.parse response body, default true
});
```

### Supported methods

`GET` · `POST` · `PUT` · `PATCH` · `DELETE` · `HEAD` · `OPTIONS`

### Error taxonomy

| `kind`        | When it occurs                                   |
| ------------- | ------------------------------------------------ |
| `http`        | Response status >= 400 — includes `status` field |
| `network`     | `ECONNREFUSED`, `ECONNRESET`                     |
| `dns`         | `ENOTFOUND` — domain doesn't exist               |
| `timeout`     | Request exceeded `timeout` ms                    |
| `parse`       | Response body failed `JSON.parse`                |
| `ssl`         | Certificate errors                               |
| `aborted`     | Request was aborted mid-flight                   |
| `invalid_url` | URL failed to parse                              |

### Chaining with `andThen`

```ts
import {
  Future,
  FetchFuture,
  TimerFuture,
  Result,
} from "@michthemaker/futures/node";

type User = { id: number; name: string };
type Posts = { userId: number; title: string }[];

const pipeline = new FetchFuture<User>(
  "https://api.example.com/users/1"
).andThen((result) => {
  if (!result.ok) return new Ready(result); // propagate error
  const userId = result.value.data.id;
  return new FetchFuture<Posts>(
    `https://api.example.com/posts?userId=${userId}`
  );
});

Future.run(pipeline, (result) => {
  if (!result.ok) {
    console.error(result.error);
    return;
  }
  console.log(result.value.data); // Posts[]
});
```

---

## Implementing a custom Future

Extend `Future<T>` and implement `poll`. The entire async contract lives there.

```ts
import { Future } from "@michthemaker/futures";

class DelayedValue<T> extends Future<T> {
  private value: T;
  private ms: number;
  private timerId: ReturnType<typeof setTimeout> | null = null;

  constructor(value: T, ms: number) {
    super();
    this.value = value;
    this.ms = ms;
  }

  poll(waker: () => void) {
    if (this.done) return { ready: true, value: this.value };

    if (!this.timerId) {
      this.timerId = setTimeout(() => {
        this.done = true;
        waker();
      }, this.ms);
    }

    return { ready: false, value: undefined };
  }

  cancel() {
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }
}

Future.run(new DelayedValue("hello", 500), (v) => {
  console.log(v); // "hello" after 500ms
});
```

Rules:

- Call `waker()` exactly once when the future is ready to be re-polled.
- Never call `poll` directly — always use `Future.run()`.
- Override `cancel()` if you hold any resources that need cleanup.
- Guard with `if (this.done)` at the top of `poll` — the runtime may re-poll after resolution.

---

## Reusability via factories

Because futures are single-use, the idiomatic pattern for reuse is a factory function:

```ts
const getTodo = (id: number) =>
  new FetchFuture<Todo>(`https://jsonplaceholder.typicode.com/todos/${id}`);

Future.run(getTodo(1), handler);
Future.run(getTodo(2), handler); // fresh instance, no shared state
```

---

## API reference

### `Future<T>` — abstract base

| Member                           | Description                                             |
| -------------------------------- | ------------------------------------------------------- |
| `abstract poll(waker)`           | Implement this. Returns `{ ready, value }`.             |
| `static run(future, onComplete)` | The only way to execute a future.                       |
| `static all(futures)`            | Resolves when all futures complete. Tuple-typed.        |
| `static race(futures)`           | Resolves with the first to complete. Cancels the rest.  |
| `.andThen(fn)`                   | Sequences this future into the next. Returns `AndThen`. |
| `.cancel()`                      | Stops pending work. No-op in base class.                |

### Primitives

| Class         | Resolves to | Notes                      |
| ------------- | ----------- | -------------------------- |
| `Ready<T>`    | `T`         | Immediately on first poll. |
| `TimerFuture` | `undefined` | After `ms` milliseconds.   |
| `YieldNow`    | `undefined` | After one event loop tick. |

### Combinators

| Class           | Resolves to | Notes                                          |
| --------------- | ----------- | ---------------------------------------------- |
| `AndThen<T, U>` | `U`         | Second future; short-circuits on `Result.Err`. |
| `All<T[]>`      | `T[]`       | All results, original order.                   |
| `Race<T>`       | `T`         | First to resolve; cancels losers.              |

### `Result`

| Member                   | Description                                       |
| ------------------------ | ------------------------------------------------- |
| `Result.Ok(value)`       | Wraps a success value. `.ok === true`, `.value`.  |
| `Result.Err(error)`      | Wraps a failure value. `.ok === false`, `.error`. |
| `Result.isResult(value)` | Symbol-tagged runtime check.                      |

---

## License

MIT

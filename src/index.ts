type FuncWithArg<T, R = void> = (arg: T) => R;

type VoidFunction = () => void;

type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

const RESULT_TAG = Symbol("Result");

/**
 * A lightweight discriminated union type inspired by Rust's `Result<T, E>`.
 *
 * Use `Result.Ok` to wrap a successful value and `Result.Err` to wrap an error.
 * Use `Result.isResult` to safely check if a value is a `Result` — this is
 * the only reliable way to discriminate, as it uses an internal unforgeable symbol tag.
 *
 * @example
 * ```ts
 * const good = Result.Ok(42);
 * const bad = Result.Err("something went wrong");
 *
 * if (Result.isResult(bad) && !bad.ok) {
 *   console.error(bad.error); // "something went wrong"
 * }
 * ```
 */
const Result = {
  /**
   * Wraps a successful value.
   *
   * @param value - The success value to wrap.
   *
   * @example
   * ```ts
   * const result = Result.Ok("hello");
   * console.log(result.ok);    // true
   * console.log(result.value); // "hello"
   * ```
   */
  Ok<T>(value: T) {
    return { ok: true, value, [RESULT_TAG]: true } as const;
  },

  /**
   * Wraps a failure value.
   *
   * @param error - The error value to wrap.
   *
   * @example
   * ```ts
   * const result = Result.Err(new Error("oops"));
   * console.log(result.ok);    // false
   * console.log(result.error); // Error: oops
   * ```
   */
  Err<T>(error: T) {
    return { ok: false, error, [RESULT_TAG]: true } as const;
  },

  /**
   * Checks whether an unknown value is a `Result` (i.e. produced by `Result.Ok` or `Result.Err`).
   *
   * This uses an internal unforgeable symbol tag, so plain objects with an `ok` property
   * will never accidentally match.
   *
   * @param value - Any value to test.
   *
   * @example
   * ```ts
   * Result.isResult(Result.Ok(1));   // true
   * Result.isResult({ ok: true });   // false — plain object, not a Result
   * Result.isResult("hello");        // false
   * ```
   */
  isResult(
    value: unknown
  ): value is { ok: boolean; error?: unknown; [RESULT_TAG]: true } {
    return (
      typeof value === "object" &&
      value !== null &&
      (value as any)[RESULT_TAG] === true
    );
  },
};

/**
 * The base class for all asynchronous computations.
 *
 * A `Future<T>` represents a value that will be available at some point in the future.
 * It is inspired by Rust's `std::future::Future` trait and uses a poll-based execution model:
 * instead of scheduling work immediately, a Future does nothing until it is explicitly driven
 * by a runner via `Future.run()`.
 *
 * ## How it works
 * - `poll(waker)` is called by the runtime to check if the future is done.
 * - If not ready, the future holds onto the `waker` and calls it later when progress can be made.
 * - The runtime re-polls on each `waker()` call until `ready: true` is returned.
 *
 * ## Single-use
 * Futures are **single-use**. Once run, they cannot be run again. Create a new instance instead.
 *
 * ## Implementing a custom Future
 * Extend this class and implement `poll`. Do not call `poll` directly — use `Future.run()`.
 *
 * @example
 * ```ts
 * class MyFuture extends Future<string> {
 *   poll(waker: VoidFunction) {
 *     setTimeout(() => waker(), 1000);
 *     return { ready: false, value: undefined };
 *   }
 * }
 *
 * Future.run(new MyFuture(), (value) => console.log(value));
 * ```
 *
 * @template T - The type of the value this future resolves to.
 */
abstract class Future<T> {
  protected done = false;
  protected _consumed = false;

  get [Symbol.toStringTag]() {
    return `Future`;
  }

  /**
   * The core method every Future must implement.
   *
   * Called by the runtime (via `Future.run`) to check whether the future has a value ready.
   * If it does, return `{ ready: true, value }`. If not, store the `waker` and call it
   * once the future can make progress — the runtime will re-poll at that point.
   *
   * **Do not call this method directly.** Use `Future.run()` instead.
   *
   * @param waker - A callback to invoke when the future is ready to be re-polled.
   * @returns `{ ready: true, value }` when resolved, or `{ ready: false, value: undefined }` when pending.
   */
  abstract poll(waker: VoidFunction): { ready: boolean; value: T | undefined };

  /**
   * Drives a future to completion, calling `onComplete` with the resolved value.
   *
   * This is the entry point for running any future. It sets up the poll loop
   * and ensures the future is only run once.
   *
   * @param future - The future instance to run.
   * @param onComplete - Called with the resolved value when the future finishes.
   * @throws If the future has already been run.
   *
   * @example
   * ```ts
   * const timer = new TimerFuture(500);
   *
   * Future.run(timer, () => {
   *   console.log("500ms have passed!");
   * });
   * ```
   */
  static run<T>(future: Future<T>, onComplete: FuncWithArg<T>) {
    if (future._consumed)
      throw new Error(
        `This ${future.constructor.name} { } instance has already been run. Futures are single-use - create a new instance`
      );
    future._consumed = true;
    function waker() {
      const result = future.poll(waker);
      if (result.ready) onComplete(result.value!);
    }

    waker();
  }

  /**
   * Creates a future that resolves when **all** provided futures have resolved,
   * preserving the order of results regardless of completion order.
   *
   * Prefer this static method over constructing `All` directly.
   *
   * @param futures - A tuple of futures to run concurrently.
   * @returns An `All` future that resolves with a tuple of all results.
   *
   * @example
   * ```ts
   * const a = new Ready(1);
   * const b = new TimerFuture(300);
   * const c = new Ready("done");
   *
   * Future.run(Future.all([a, b, c]), ([n, _, s]) => {
   *   console.log(n, s); // 1, "done"
   * });
   * ```
   */
  static all<const T extends Future<any>[]>(
    futures: [...T]
  ): All<{
    [K in keyof T]: T[K] extends Future<infer U> ? U : never;
  }> {
    return new All(futures);
  }

  /**
   * Creates a future that resolves as soon as **any one** of the provided futures resolves.
   * All other futures are immediately cancelled.
   *
   * Prefer this static method over constructing `Race` directly.
   *
   * @param futures - An array of futures to race against each other.
   * @returns A `Race` future that resolves with the first completed value.
   *
   * @example
   * ```ts
   * const slow = new TimerFuture(1000);
   * const fast = new TimerFuture(100);
   *
   * Future.run(Future.race([slow, fast]), () => {
   *   console.log("fastest won!"); // fires after ~100ms
   * });
   * ```
   */
  static race<T>(futures: Future<T>[]): Race<T> {
    return new Race(futures);
  }

  /**
   * Chains another future after this one completes, using the resolved value as input.
   *
   * The callback `fn` receives the resolved value of this future and must return a new `Future<U>`.
   * If this future resolves with a `Result.Err`, the chain is short-circuited — `fn` is skipped
   * and the error is passed through as-is.
   *
   * @param fn - A function that takes the resolved value and returns the next future.
   * @returns An `AndThen` future representing the chained computation.
   *
   * @example
   * ```ts
   * // Chain a timer into a ready value
   * const chained = new TimerFuture(200).andThen(() => new Ready("done waiting"));
   *
   * Future.run(chained, (value) => {
   *   console.log(value); // "done waiting"
   * });
   * ```
   *
   * @example
   * ```ts
   * // Result.Err short-circuits the chain
   * const failing = new Ready(Result.Err("bad input"));
   *
   * Future.run(
   *   failing.andThen((v) => new Ready(Result.Ok("should not reach"))),
   *   (value) => {
   *     console.log(value); // { ok: false, error: "bad input" }
   *   }
   * );
   * ```
   */
  andThen<U>(fn: FuncWithArg<T, Future<U>>) {
    return new AndThen(this, fn);
  }

  /**
   * Cancels the future, stopping any pending async work.
   *
   * The base implementation is a no-op. Subclasses like `TimerFuture` override
   * this to clean up resources (e.g. clearing timers).
   */
  cancel(): void {}
}

/**
 * A future that resolves immediately with a known value.
 *
 * Useful as a starting point for chains or as a stand-in for synchronous values
 * in a future-based pipeline.
 *
 * @template T - The type of the resolved value.
 *
 * @example
 * ```ts
 * Future.run(new Ready(42), (value) => {
 *   console.log(value); // 42
 * });
 * ```
 */
class Ready<T> extends Future<T> {
  value: T;

  /**
   * @param value - The value this future will immediately resolve with.
   */
  constructor(value: T) {
    super();
    this.value = value;
  }

  poll(_waker: VoidFunction) {
    return { ready: true, value: this.value };
  }
}

/**
 * A future that resolves after a given number of milliseconds.
 *
 * The timer is **lazy** — it only starts when the future is first polled (i.e. when
 * `Future.run()` is called). Calling `cancel()` clears the timer and prevents resolution.
 *
 * @example
 * ```ts
 * Future.run(new TimerFuture(1000), () => {
 *   console.log("1 second has passed");
 * });
 * ```
 */
class TimerFuture extends Future<undefined> {
  protected ms: number;
  protected done: boolean = false;
  private started: boolean = false;
  private timerId: ReturnType<typeof setTimeout> | null = null;

  /**
   * @param ms - The number of milliseconds to wait before resolving.
   */
  constructor(ms: number) {
    super();
    this.ms = ms;
  }

  poll(waker: VoidFunction) {
    if (this.done) {
      return { ready: true, value: undefined };
    }

    if (!this.started) {
      this.started = true;
      this.timerId = setTimeout(() => {
        this.done = true;
        waker();
      }, this.ms);
    }
    return { ready: false, value: undefined };
  }

  /**
   * Cancels the timer, preventing the future from ever resolving.
   *
   * Safe to call even if the timer has not started yet.
   */
  cancel(): void {
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }
}

/**
 * A future that yields control back to the event loop for one tick, then resolves.
 *
 * Useful when you want to avoid blocking the event loop in a tight poll chain,
 * or when you need to let other pending callbacks run before continuing.
 *
 * Internally uses `setTimeout(fn, 0)` to defer resolution by one tick.
 *
 * @example
 * ```ts
 * // Let the event loop breathe between two operations
 * const pipeline = new Ready("start")
 *   .andThen(() => new YieldNow())
 *   .andThen(() => new Ready("continued after yield"));
 *
 * Future.run(pipeline, (value) => {
 *   console.log(value); // "continued after yield"
 * });
 * ```
 */
class YieldNow extends Future<undefined> {
  constructor() {
    super();
  }

  poll(waker: VoidFunction) {
    if (this.done) return { ready: true, value: undefined };

    setTimeout(() => {
      this.done = true;
      waker();
    }, 0);

    return { ready: false, value: undefined };
  }
}

/**
 * A future that sequences two futures, passing the result of the first into a function
 * that returns the second.
 *
 * You will rarely construct this directly — use the `.andThen()` method on any `Future` instead.
 *
 * If the upstream future resolves with a `Result.Err`, the chain is short-circuited:
 * the callback `fn` is skipped and the error is passed through as the resolved value.
 *
 * @template T - The output type of the upstream future.
 * @template U - The output type of the downstream future.
 *
 * @example
 * ```ts
 * const future = new TimerFuture(100).andThen(() => new Ready("done"));
 *
 * Future.run(future, (value) => {
 *   console.log(value); // "done"
 * });
 * ```
 */
class AndThen<T, U> extends Future<U> {
  protected future: Future<T>;
  protected fn: FuncWithArg<T, Future<U>>;
  protected next: Future<U> | null;

  /**
   * @param future - The upstream future to wait on.
   * @param fn - Called with the upstream result to produce the next future.
   */
  constructor(future: Future<T>, fn: FuncWithArg<T, Future<U>>) {
    super();
    this.future = future;
    this.fn = fn;
    this.next = null;
  }

  poll(waker: VoidFunction) {
    if (!this.next) {
      const result = this.future.poll(waker);
      if (!result.ready) return { ready: false, value: undefined };
      // short-circuit: if upstream resolved with a Result.Err, pass it through as-is
      if (Result.isResult(result.value) && !result.value.ok)
        return { ready: true, value: result.value as unknown as U };
      this.next = this.fn(result.value!);
    }
    return this.next.poll(waker);
  }

  cancel(): void {
    this.future.cancel();
    this.next?.cancel();
  }
}

/**
 * A future that resolves when **all** futures in the provided array have resolved,
 * collecting their results into a tuple in the original order.
 *
 * All futures are polled on every waker invocation. If any future is still pending,
 * the `All` future remains pending. Results are stored as each future completes.
 *
 * You will rarely construct this directly — use `Future.all()` instead.
 *
 * @template T - A tuple type representing the resolved values of each future.
 *
 * @example
 * ```ts
 * Future.run(Future.all([new Ready(1), new Ready("two"), new Ready(true)]), ([n, s, b]) => {
 *   console.log(n, s, b); // 1, "two", true
 * });
 * ```
 */
class All<T extends any[]> extends Future<T> {
  protected futures: Future<any>[];
  protected results: T;
  protected completed: boolean[];

  /**
   * @param futures - The array of futures to wait on.
   */
  constructor(futures: Future<T>[]) {
    super();
    this.futures = futures;
    this.results = new Array(futures.length).fill(undefined) as any;
    this.completed = new Array(futures.length).fill(false);
  }

  poll(waker: VoidFunction) {
    this.futures.forEach((future, i) => {
      if (this.completed[i]) return;
      const result = future.poll(waker);
      if (result.ready) {
        this.completed[i] = true;
        this.results[i] = result.value!;
      }
    });

    if (this.completed.every(Boolean)) {
      return { ready: true, value: this.results };
    }

    return { ready: false, value: undefined };
  }

  /**
   * Cancels all futures in the group.
   */
  cancel(): void {
    this.futures.forEach((f) => f.cancel());
  }
}

/**
 * A future that resolves as soon as **any one** of the provided futures resolves.
 * The first future to complete wins, and all remaining futures are immediately cancelled.
 *
 * You will rarely construct this directly — use `Future.race()` instead.
 *
 * @template T - The value type shared by all futures in the race.
 *
 * @example
 * ```ts
 * Future.run(
 *   Future.race([new TimerFuture(1000), new TimerFuture(50)]),
 *   () => console.log("winner!") // fires after ~50ms
 * );
 * ```
 */
class Race<T> extends Future<T> {
  protected futures: Future<T>[];
  protected result: T;
  protected ended: boolean;

  /**
   * @param futures - The futures to race. All will be polled until one resolves.
   */
  constructor(futures: Future<T>[]) {
    super();
    this.futures = futures;
    this.result = undefined as any;
    this.done = false;
    this.ended = false;
  }

  poll(waker: VoidFunction) {
    if (this.done) return { ready: true, value: this.result };

    for (const future of this.futures) {
      const result = future.poll(waker);
      if (result.ready) {
        this.done = true;
        this.result = result.value!;
        for (const loser of this.futures) {
          if (loser !== future) loser.cancel();
        }
        return { ready: true, value: this.result };
      }
    }

    return { ready: false, value: undefined };
  }

  /**
   * Cancels all futures in the race.
   */
  cancel(): void {
    this.futures.forEach((f) => f.cancel());
  }
}

export { Result, Future, Ready, YieldNow, TimerFuture, AndThen, All, Race };

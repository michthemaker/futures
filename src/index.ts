type FuncWithArg<T, R = void> = (arg: T) => R;

type VoidFunction = () => void;

const RESULT_TAG = Symbol('Result');

const Result = {
	Ok<T>(value: T) {
		return { ok: true, value, [RESULT_TAG]: true }
	},
	Err<T>(error: T) {
		return { ok: false, error, [RESULT_TAG]: true }
	}
}

function isResult(value: unknown): value is { ok: boolean; error?: unknown; [RESULT_TAG]: true } {
  return typeof value === 'object' && value !== null && (value as any)[RESULT_TAG] === true;
}

abstract class Future<T> {
  protected done = false;
  protected _consumed = false;
  get [Symbol.toStringTag]() {
    return `Future`;
  }
  /**
   * Method for implementing custom Futures.
   * Do not call directly - use Future.run()
   */
  abstract poll(waker: VoidFunction): { ready: boolean; value: T | undefined };
  static run<T>(future: Future<T>, onComplete: FuncWithArg<T>) {
    if (future._consumed)
      throw new Error(
        `This ${future.constructor.name} { } instance has already been run. Futures are single-use - create  a new instance`
      );
    future._consumed = true;
    function waker() {
      const result = future.poll(waker);
      if (result.ready) onComplete(result.value!);
    }

    waker();
  }
  static all<const T extends Future<any>[]>(
    futures: [...T]
  ): All<{
    [K in keyof T]: T[K] extends Future<infer U> ? U : never;
  }> {
    return new All(futures);
  }
  static race<T>(futures: Future<T>[]): Race<T> {
    return new Race(futures);
  }
  andThen<U>(fn: FuncWithArg<T, Future<U>>) {
    return new AndThen(this, fn);
  }
  cancel(): void {}
}

class Ready<T> extends Future<T> {
  value: T;
  constructor(value: T) {
    super();
    this.value = value;
  }

  poll(_waker: VoidFunction) {
    return { ready: true, value: this.value };
  }
}

class TimerFuture extends Future<undefined> {
  protected ms: number;
  protected done: boolean = false;
  private started: boolean = false;
  private timerId: ReturnType<typeof setTimeout> | null = null;
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

  cancel(): void {
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }
}

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

class AndThen<T, U> extends Future<U> {
  protected future: Future<T>;
  protected fn: FuncWithArg<T, Future<U>>;
  protected next: Future<U> | null;
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
      if (isResult(result.value) && !result.value.ok)
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

class All<T extends any[]> extends Future<T> {
  protected futures: Future<any>[];
  protected results: T;
  protected completed: boolean[];
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

  cancel(): void {
    this.futures.forEach((f) => f.cancel());
  }
}

class Race<T> extends Future<T> {
  protected futures: Future<T>[];
  protected result: T;
  protected ended: boolean;
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

  cancel(): void {
    this.futures.forEach((f) => f.cancel());
  }
}

export { Result, Future, Ready, YieldNow, TimerFuture, AndThen, All, Race };

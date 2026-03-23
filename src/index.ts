type FuncWithArg<T, R = void> = (arg: T) => R;

abstract class Future<T> {
	protected done = false;
	get [Symbol.toStringTag]() {
		return `Future`
  }
  /**
   * Method for implementing custom Futures.
   * Do not call directly - use Future.run()
   */
  abstract poll(waker: VoidFunction): { ready: boolean; value: T | undefined };
  static run<T>(future: Future<T>, onComplete: FuncWithArg<T>) {
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
    return new Race(futures);
  }
  static race<const T extends Future<any>[]>(
    futures: [...T]
  ): All<{
    [K in keyof T]: T[K] extends Future<infer U> ? U : never;
  }> {
    return new All(futures);
  }
  andThen<U>(fn: FuncWithArg<T, Future<U>>) {
    return new AndThen(this, fn);
	}

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
  constructor(ms: number) {
    super();
    this.ms = ms;
  }

  poll(waker: VoidFunction) {
    console.log("we polled");
    if (this.done) {
      return { ready: true, value: undefined };
    }

    if (!this.started) {
      console.log("we have started");
      this.started = true;
      setTimeout(() => {
        this.done = true;
        waker();
      }, this.ms);
    }
    return { ready: false, value: undefined };
  }
}

/// test this soon
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
      this.next = this.fn(result.value!);
    }
    return this.next.poll(waker);
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
}

class Race<T extends any[]> extends Future<T> {
  protected futures: Future<any>[];
  protected results: T;
  constructor(futures: Future<T>[]) {
    super();
    this.futures = futures;
    this.results = new Array(futures.length).fill(undefined) as any;
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
}

const timerFuture = new TimerFuture(3000)
  .andThen(() => {
    return new Ready(4000);
  })

// Future.run(timerFuture, (v) => {
//   console.log(v, "and me");
//   console.log("============== ==============");
// });

const timeout = new TimerFuture(5000);
const allFutures = Future.all([new TimerFuture(3000), new Ready(3000)]);

Future.run(timeout, () => {
  Future.run(allFutures, (values) => {
    console.log(values);
  });
});

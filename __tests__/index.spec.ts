import { Future, Ready, TimerFuture } from "../src/index";

beforeEach(() => {
  vi.useFakeTimers();
});

describe("Future", () => {
  it("throws multiple use of Future instance", () => {
    const future = new Ready("40");

    Future.run(future, () => {});
    expect(() => Future.run(future, () => {})).toThrow();
  });
});

describe("Ready", () => {
  it("resolves immediately with given value", () => {
    let result: unknown;

    Future.run(new Ready(42), (value) => {
      result = value;
    });

    expect(result).toBe(42);
  });
});

describe("TimerFuture", () => {
  it("does not resolve before time passes", () => {
    let result: unknown;

    Future.run(new TimerFuture(3000), () => {
      result = "resolved";
    });

    vi.advanceTimersByTime(2000); // jump 2 seconds

    expect(result).toBe(undefined);
  });
  it("resolves after time passes", () => {
    let result: unknown;

    Future.run(new TimerFuture(3000), () => {
      result = "resolved";
    });
    vi.advanceTimersByTime(3000); // jump 2 seconds

    expect(result).toBe("resolved");
  });
  it("does not spin up multiple timers on re-poll", () => {
    const setTimeoutSpy = vi.spyOn(global, "setTimeout");

    const future = new TimerFuture(3000);
    const waker = vi.fn();

    // poll multiple times before it resolves
    future.poll(waker);
    future.poll(waker);
    future.poll(waker);
    future.poll(waker);

    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
    setTimeoutSpy.mockRestore();
  });
  it("cancel stops it from resolving", () => {
    let result: unknown;
    const future = new TimerFuture(3000);

    Future.run(future, () => {
      result = "resolved";
    });

    vi.advanceTimersByTime(2000);
    future.cancel();
    vi.advanceTimersByTime(2000);

    expect(result).toBe(undefined);
  });
});

describe("AndThen", () => {
  it("does not run second future until first resolves", () => {
    let result: unknown;

    const firstFuture = new TimerFuture(3000),
      secondFuture = new Ready("resolved second");
    Future.run(
      firstFuture.andThen(() => secondFuture),
      (value) => {
        result = value;
      }
    );

    vi.advanceTimersByTime(2000); // jump 2 seconds

    expect(result).toBe(undefined);
    vi.advanceTimersByTime(1001); // jump 1.0001 (just slightly over 3 seconds)
    expect(result).toBe("resolved second"); // both is done
  });

  it("passes the first futures value to the factory function", () => {
    let firstValue: unknown, secondValue: unknown;

    const firstFuture = new Ready("resolved first"),
      secondFuture = new Ready("resolved second"),
      thirdFuture = new TimerFuture(3000);
    Future.run(
      firstFuture
        .andThen((value) => {
          firstValue = value;
          return secondFuture;
        })
        .andThen((value) => {
          secondValue = value;
          return thirdFuture;
        }),
      () => {}
    );

    expect(firstValue).toBe("resolved first");
    expect(secondValue).toBe("resolved second");
  });

  it("resolves with second future's value", () => {
    let secondValue: unknown;

    const firstFuture = new Ready("resolved first"),
      secondFuture = new Ready("resolved second");
    Future.run(
      firstFuture.andThen(() => secondFuture),
      (value) => {
        secondValue = value;
      }
    );

    expect(secondValue).toBe("resolved second");
  });

  it("cancel propagates to both futures", () => {
    let result: unknown;

    const timerFuture = new TimerFuture(3000).andThen(
      () => new TimerFuture(2000)
    );

    Future.run(timerFuture, () => {
      result = "finally resolved";
    });
    vi.advanceTimersByTime(2000); // jump 2 seconds
    timerFuture.cancel();

    vi.advanceTimersByTime(4000); // jump 4 seconds (6s over 5s initial)
    expect(result).toBe(undefined);
  });
  it("cancel before run is a misuse - future still resolves", () => {
    let result: unknown;

    const timerFuture = new TimerFuture(3000).andThen(
      () => new TimerFuture(2000)
    );

    vi.advanceTimersByTime(2000); // jump 2 seconds
    timerFuture.cancel();
    Future.run(timerFuture, () => {
      result = "still resolved";
    });

    vi.advanceTimersByTime(8000); // jump 8 seconds (8s over 5s initial)
    expect(result).toBe("still resolved");
  });
});

describe("All", () => {
  it("resolves when all futures resolve", () => {
    let result: unknown;

    const firstFuture = new TimerFuture(3000),
      secondFuture = new TimerFuture(4000);
    Future.run(Future.all([firstFuture, secondFuture]), () => {
      result = "fully resolved";
    });

    vi.advanceTimersByTime(3001); // jump 3.001 seconds
    expect(result).toBeUndefined();

    vi.advanceTimersByTime(1000); // now in 4.001 seconds
    expect(result).toBe("fully resolved");
  });
  it("resolves with correct tuple in correct order", () => {
    let result: unknown;

    const tupleInOrder = [3000, 4000, 6000] as const;
    const futuresTuple = tupleInOrder.map((n) =>
      new TimerFuture(n).andThen(() => new Ready(n))
    );

    Future.run(Future.all(futuresTuple), (v) => {
      result = v;
    });

    vi.advanceTimersByTime(6001); // jump 6 seconds
    expect(result).toEqual([3000, 4000, 6000]);
  });
  it("does not resolve if any future is still pending", () => {
    let result: unknown;

    const firstFuture = new TimerFuture(3000),
      secondFuture = new TimerFuture(4000);
    Future.run(Future.all([firstFuture, secondFuture]), () => {
      result = "fully resolved";
    });

    vi.advanceTimersByTime(3001); // jump 3.001 seconds
    expect(result).toBeUndefined();
  });
});

describe("Race", () => {
  it("resolves with the fastest future's value", () => {
    let result: unknown;

    const tupleInOrder = [4000, 6000, 3000] as const;
    const futuresTuple = tupleInOrder.map((n) =>
      new TimerFuture(n).andThen(() => new Ready(n))
    );

    Future.run(Future.race(futuresTuple), (v) => {
      result = v;
    });

    vi.advanceTimersByTime(3001); // jump 3.001 seconds
    expect(result).toBe(3000);
  });
  it("cancels all losing futures", () => {
    vi.useFakeTimers();

    const tupleInOrder = [4000, 6000, 3000] as const;
    const futuresTuple = tupleInOrder.map((n) =>
      new TimerFuture(n).andThen(() => new Ready(n))
    );

    // spy on cancel of each future
    const cancelSpies = futuresTuple.map((f) => vi.spyOn(f, "cancel"));

    Future.run(Future.race(futuresTuple), (v) => {});

    vi.advanceTimersByTime(3001); // jump 3.001 seconds

    // losers are index 0 and 1
    expect(cancelSpies[0]).toHaveBeenCalledTimes(1);
    expect(cancelSpies[1]).toHaveBeenCalledTimes(1);
    // winner is index 2 (3000ms)
    expect(cancelSpies[2]).not.toHaveBeenCalled();
  });
  it("only resolves once if multiple futures finish close together", () => {
    // create an object so we can use spy on it
    let obj = {
      onComplete: (_: any) => {},
    };

    const tupleInOrder = [3001, 3000, 4000] as const;
    const futuresTuple = tupleInOrder.map((n) =>
      new TimerFuture(n).andThen(() => new Ready(n))
    );
    const onCompleteSpy = vi.spyOn(obj, "onComplete");

    Future.run(Future.race(futuresTuple), onCompleteSpy);

    vi.advanceTimersByTime(3001); // jump 3.001 seconds

    expect(onCompleteSpy).toHaveBeenCalledTimes(1);
  });
});

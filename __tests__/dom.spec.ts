// @vitest-environment jsdom
import { expect, test } from "vitest";
import { FetchFuture, Future } from "../src/dom";

function future<T>(gen: () => Generator<Future<any>, T, any>): Promise<T> {
  return new Promise((resolve, reject) => {
    const iterator = gen();

    function step(value?: any) {
      const next = iterator.next(value);

      if (next.done) {
        resolve(next.value);
        return;
      }

      Future.run(next.value, (result) => {
        step(result);
      });
    }

    try {
      step();
    } catch (e) {
      reject(e);
    }
  });
}

function* cast<T>(future: Future<T>): Generator<Future<T>, T, T> {
  return yield future;
}

type Todo = { id: number; title: string; completed: boolean };

describe("FetchFuture", () => {
  test("resolves with correct data", () =>
    future(function* () {
      const result = yield* cast(
        new FetchFuture<Todo>("https://jsonplaceholder.typicode.com/todos/3")
      );

      expect(result.ok).toBe(true);

      if (!result.ok) return;

      expect(result.value.status).toBe(200);
      expect(result.value.data.id).toBe(3);
      expect(typeof result.value.data.title).toBe("string");
      expect(typeof result.value.data.completed).toBe("boolean");
    }));

  test("returns http error on status >= 400", () =>
    future(function* () {
      const result = yield* cast(
        new FetchFuture<Todo>(
          "https://jsonplaceholder.typicode.com/todos/99999"
        )
      );

      expect(result.ok).toBe(false);

      if (result.ok) return;

      expect(result.error.kind).toBe("http");
    }));

  test("returns network error on bad url", () =>
    future(function* () {
      const result = yield* cast(
        new FetchFuture<Todo>("https://this.domain.does.not.exist.xyz/todos/1")
      );

      expect(result.ok).toBe(false);

      if (result.ok) return;

      expect(result.error.kind).toBe("network");
    }));

  test("returns invalid_url error on malformed url", () =>
    future(function* () {
      const result = yield* cast(new FetchFuture<Todo>("not a url at all"));

      expect(result.ok).toBe(false);

      if (result.ok) return;

      expect(result.error.kind).toBe("invalid_url");
    }));
});

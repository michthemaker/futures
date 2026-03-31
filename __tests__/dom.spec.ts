// @vitest-environment jsdom
import { expect, test } from "vitest";
import { FetchFuture, Future, Result, type Response } from "../src/dom";

test("FetchFuture", async () => {
  const promise = await new Promise<Response<Todo>>((res) => {
    Future.run(
      new FetchFuture<Todo>("https://jsonplaceholder.typicode.com/todos/3"),
      (result) => {
        if (!result.ok) {
          console.error(result.error.kind, result.error.message);
          return res(result);
        }
        console.log(result.value.data); // Todo
        console.log(result.value.status); // 200
        res(result);
      }
    );
  });
  expect(promise.ok).toBe(true);
  if (promise.ok) {
    expect(promise.value.status).toBe(200);
    expect(promise.value.data.id).toBe(3);
  }
});

type Todo = { id: number; title: string; completed: boolean };

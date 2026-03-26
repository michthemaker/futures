import { EventEmitter } from "node:events";

// mock before imports that use it
vi.mock("node:http", () => ({
  default: {
    request: vi.fn(),
  },
}));
vi.mock("node:https", () => ({
  default: {
    request: vi.fn(),
  },
}));

import http from "node:http";
import {
  FetchFuture,
  Future,
  Result,
  type FetchError,
  type FetchResponse,
} from "../src/node";

// helper — builds a fake request/response pair
function mockHttpRequest(
  statusCode: number,
  body: string,
  errorCode?: string,
  delay: number = 0 // 👈
) {
  const fakeRes = new EventEmitter() as any;
  fakeRes.statusCode = statusCode;
  fakeRes.statusMessage = "OK";
  fakeRes.headers = {};

  const fakeReq = new EventEmitter() as any;
  fakeReq.setTimeout = vi.fn();
  fakeReq.write = vi.fn();
  fakeReq.end = vi.fn(() => {
    setTimeout(() => {
      // 👈 wrap in setTimeout
      if (errorCode) {
        const err = Object.assign(new Error(errorCode), { code: errorCode });
        fakeReq.emit("error", err);
      } else {
        fakeRes.emit("data", body);
        fakeRes.emit("end");
      }
    }, delay);
  });

  vi.mocked(http.request).mockImplementation((_url, _options, callback) => {
    callback?.(fakeRes);
    return fakeReq;
  });

  return { fakeReq, fakeRes };
}

describe("FetchFuture", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  type Data = { id: number; title: string; completed: boolean };
  it("returns Result.Ok with parsed body", () => {
    vi.useFakeTimers();
    const todo: Data = { id: 1, title: "test", completed: false };
    mockHttpRequest(200, JSON.stringify(todo), undefined, 500);
    let result: Result<FetchResponse<Data>, FetchError> | undefined;
    Future.run(new FetchFuture<Data>("http://example.com/todos/1"), (v) => {
      result = v;
    });

    expect(result).toBeUndefined();

    vi.advanceTimersByTime(501); // jump 501ms

    expect(result).toBeDefined();

    if (!result) return;
    expect(result.ok).toBe(true);

    if (!result.ok) return;

    expect(result.value.data).toEqual(todo);
    expect(result.value.status).toBe(200);

    vi.useRealTimers();
  });

  it("returns http error on status >= 400 ", () => {
    vi.useFakeTimers();
    mockHttpRequest(404, "Not found", undefined, 5000);
    let result: Result<FetchResponse<Data>, FetchError> | undefined;
    Future.run(new FetchFuture<Data>("http://notfound.xyz"), (v) => {
      result = v;
    });

    expect(result).toBeUndefined();

    vi.advanceTimersByTime(5001);

    if (!result) return;
    expect(result.ok).toBe(false);

    if (result.ok) return;
    expect(result.error.kind).toBe("http");

    if (result.error.kind === "http") expect(result.error.status).toBe(404);
    vi.useRealTimers();
  });

  it("returns network error on ECONNREFUSED", () => {
    vi.useFakeTimers();
    mockHttpRequest(0, "", "ECONNREFUSED", 500);
    let result: Result<FetchResponse<Data>, FetchError> | undefined;
    Future.run(new FetchFuture<Data>("http://example.com"), (v) => {
      result = v;
    });

    expect(result).toBeUndefined();

    vi.advanceTimersByTime(501);

    if (!result) return;
    expect(result.ok).toBe(false);

    if (result.ok) return;
    expect(result.error.kind).toBe("network");
    expect(result.error.code).toBe("ECONNREFUSED");
    vi.useRealTimers();
  });

  it("returns dns error on ENOTFOUND", () => {
    vi.useFakeTimers();
    mockHttpRequest(0, "", "ENOTFOUND", 3000);

    let result: Result<FetchResponse<Data>, FetchError> | undefined;
    Future.run(new FetchFuture<Data>("http://doesnotexist.xyz"), (v) => {
      result = v;
    });
    expect(result).toBeUndefined();

    vi.advanceTimersByTime(3001); // jump 3.001 seconds

    if (!result) return;
    expect(result.ok).toBe(false);

    if (result.ok) return;
    expect(result.error.kind).toBe("dns");
    vi.useRealTimers();
  });

  it("returns parse error on invalid JSON", () => {
    vi.useFakeTimers();
    mockHttpRequest(200, "this is not json", "", 5000);

    let result: Result<FetchResponse<Data>, FetchError> | undefined;
    Future.run(new FetchFuture<Data>("http://example.com"), (v) => {
      result = v;
    });

    expect(result).toBeUndefined();

    vi.advanceTimersByTime(3001); // jump 3.001 seconds

    if (!result) return;

    expect(result.ok).toBe(false);

    if (result.ok) return;
    expect(result.error.kind).toBe("parse");
    vi.useRealTimers();
  });
});

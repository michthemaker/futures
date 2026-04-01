import { Future, Result } from "../index";
import type {
  FetchError,
  FetchOptions,
  FetchResponse,
  HttpHeaders,
} from "./fetch-types";

const DEFAULT_FETCH_OPTIONS: Required<FetchOptions> = {
  method: "GET",
  headers: {},
  body: null,
  query: {},
  timeout: 30_000,
  parseResponse: true,
};

/**
 * Parses the raw `getAllResponseHeaders()` string into a `Record<string, string>`.
 *
 * Each line is in the form `header-name: value\r\n`. Header names are lowercased
 * to match the behaviour of the node version (which uses `res.headers`).
 */
function parseResponseHeaders(raw: string): HttpHeaders {
  const headers: HttpHeaders = {};
  for (const line of raw.trim().split("\r\n")) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    headers[key] = value;
  }
  return headers;
}

/**
 * A future that performs an HTTP or HTTPS request and resolves with the response.
 *
 * Built on `XMLHttpRequest` — no `fetch` API, no Promises. The request is
 * **lazy**: nothing is sent until the future is driven by `Future.run()`.
 *
 * Always resolves to `Result<FetchResponse<T>, FetchError>` — network failures, HTTP errors,
 * parse failures, and timeouts are all represented as `Result.Err` values, never thrown.
 *
 * ## Supported methods
 * `GET` · `POST` · `PUT` · `PATCH` · `DELETE` · `HEAD` · `OPTIONS`
 *
 * ## Error kinds
 * - `http` — response status >= 400, includes `status` and `statusText`
 * - `network` — any transport-level failure (includes DNS, SSL, CORS — browser gives no detail)
 * - `timeout` — request exceeded the configured `timeout` ms
 * - `parse` — response body failed `JSON.parse`
 * - `aborted` — request was cancelled mid-flight via `cancel()`
 * - `invalid_url` — the provided URL string could not be parsed
 *
 * @template T - The expected shape of the parsed response body.
 *
 * @example
 * ```ts
 * type Todo = { id: number; title: string; completed: boolean };
 *
 * Future.run(
 *   new FetchFuture<Todo>("https://jsonplaceholder.typicode.com/todos/1"),
 *   (result) => {
 *     if (!result.ok) {
 *       console.error(result.error.kind, result.error.message);
 *       return;
 *     }
 *     console.log(result.value.data);   // Todo
 *     console.log(result.value.status); // 200
 *   }
 * );
 * ```
 *
 * @example
 * ```ts
 * // POST with a JSON body and custom headers
 * Future.run(
 *   new FetchFuture("https://api.example.com/items", {
 *     method: "POST",
 *     headers: { Authorization: "Bearer token" },
 *     body: { name: "widget", qty: 3 },
 *     timeout: 5_000,
 *   }),
 *   (result) => {
 *     if (result.ok) console.log(result.value.data);
 *   }
 * );
 * ```
 */
class FetchFuture<T> extends Future<Result<FetchResponse<T>, FetchError>> {
  protected url: string;
  protected options: FetchOptions;
  protected started: boolean = false;
  protected value: Result<FetchResponse<T>, FetchError> | undefined;
  private xhr: XMLHttpRequest | null = null;

  /**
   * @param url - The full URL to request, including protocol (`http://` or `https://`).
   * @param options - Optional request configuration. All fields have sensible defaults:
   *   - `method` defaults to `"GET"`
   *   - `timeout` defaults to `30_000` ms
   *   - `parseResponse` defaults to `true` (auto `JSON.parse` the response body)
   *   - `body` objects are automatically `JSON.stringify`'d with `Content-Type: application/json`
   *   - `query` entries are appended to the URL as search parameters
   */
  constructor(url: string, options?: FetchOptions) {
    super();
    this.url = url;
    this.options = {
      ...DEFAULT_FETCH_OPTIONS,
      ...options,
      headers: {
        ...DEFAULT_FETCH_OPTIONS.headers,
        ...options?.headers, // user headers win
      },
    };
  }

  /**
   * Polls the future for completion.
   *
   * On the first call, the XHR request is constructed and sent. Subsequent calls
   * (before the response arrives) return immediately with `{ ready: false }` — the
   * request is already in flight and only one is ever created.
   *
   * Once the response completes (or an error occurs), `waker` is called, the result
   * is stored, and all further calls return `{ ready: true, value }`.
   *
   * Possible outcomes stored as `Result`:
   * - `Result.Ok` — successful response with `data`, `status`, `statusText`, and `headers`
   * - `Result.Err({ kind: "http" })` — response status >= 400
   * - `Result.Err({ kind: "parse" })` — response body could not be `JSON.parse`'d
   * - `Result.Err({ kind: "timeout" })` — request exceeded the configured timeout
   * - `Result.Err({ kind: "network" })` — transport-level failure (DNS, SSL, CORS, etc.)
   * - `Result.Err({ kind: "aborted" })` — request was cancelled via `cancel()`
   * - `Result.Err({ kind: "invalid_url" })` — the URL string failed to parse
   *
   * **Do not call this method directly.** Use `Future.run()` instead.
   *
   * @param waker - Called once when the request has settled (success or error), signalling
   *   the runtime to re-poll and collect the result.
   * @returns `{ ready: true, value }` once settled, `{ ready: false, value: undefined }` while pending.
   */
  poll(waker: () => void): {
    ready: boolean;
    value: Result<FetchResponse<T>, FetchError> | undefined;
  } {
    if (this.done) return { ready: true, value: this.value! };
    if (this.started) return { ready: false, value: undefined };

    this.started = true;

    // parse and build URL with query params
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(this.url);
      Object.entries(this.options.query || {}).forEach(([key, val]) => {
        if (val !== undefined) parsedUrl.searchParams.set(key, String(val));
      });
    } catch {
      this.done = true;
      this.value = Result.Err({
        kind: "invalid_url",
        message: `Invalid URL: ${this.url}`,
      });
      waker();
      return { ready: false, value: undefined };
    }

    // build body
    let body: string | undefined;
    let contentType: string | undefined;

    if (this.options.body !== null) {
      if (typeof this.options.body === "object") {
        body = JSON.stringify(this.options.body);
        contentType = "application/json";
      } else {
        body = this.options.body as string;
      }
    }

    const xhr = new XMLHttpRequest();
    this.xhr = xhr;

    xhr.open(this.options.method ?? "GET", parsedUrl.toString());

    // apply timeout — XHR has a native timeout property
    xhr.timeout = this.options.timeout ?? 30_000;

    // set request headers
    if (contentType) {
      xhr.setRequestHeader("Content-Type", contentType);
    }
    Object.entries(this.options.headers ?? {}).forEach(([key, val]) => {
      xhr.setRequestHeader(key, val);
    });

    // successful load — covers all status codes
    xhr.onload = () => {
      // http error — status >= 400
      if (xhr.status >= 400) {
        this.done = true;
        this.value = Result.Err({
          kind: "http",
          message: `HTTP ${xhr.status}`,
          status: xhr.status,
          statusText: xhr.statusText,
        });
        waker();
        return;
      }

      // parse response
      let data: T;
      if (this.options.parseResponse) {
        try {
          data = JSON.parse(xhr.responseText);
        } catch {
          this.done = true;
          this.value = Result.Err({
            kind: "parse",
            message: "Failed to parse response as JSON",
            cause: xhr.responseText,
          });
          waker();
          return;
        }
      } else {
        data = xhr.responseText as unknown as T;
      }

      this.done = true;
      this.value = Result.Ok({
        data,
        status: xhr.status,
        statusText: xhr.statusText,
        headers: parseResponseHeaders(xhr.getAllResponseHeaders()),
      });
      waker();
    };

    // network-level failure (DNS, SSL, CORS, etc.) — browser gives no further detail
    xhr.onerror = (event) => {
      this.done = true;
      this.value = Result.Err({
        kind: "network",
        message: "Network request failed",
        cause: event,
      });
      waker();
    };

    // request timed out
    xhr.ontimeout = (event) => {
      this.done = true;
      this.value = Result.Err({
        kind: "timeout",
        message: `Request timed out after ${this.options.timeout}ms`,
        cause: event,
      });
      waker();
    };

    // request was aborted via cancel()
    xhr.onabort = (event) => {
      this.done = true;
      this.value = Result.Err({
        kind: "aborted",
        message: "Request was aborted",
        cause: event,
      });
      waker();
    };

    xhr.send(body ?? null);

    return { ready: false, value: undefined };
  }

  /**
   * Cancels the in-flight XHR request by calling `xhr.abort()`.
   *
   * Safe to call at any point — before the request starts, while it is in flight,
   * or after it has already settled (in which case this is a no-op). Once cancelled,
   * the future resolves with `Result.Err({ kind: "aborted" })`.
   *
   * @example
   * ```ts
   * const req = new FetchFuture("https://api.example.com/slow-endpoint");
   *
   * Future.run(req, (result) => {
   *   console.log(result); // { ok: false, error: { kind: "aborted", ... } }
   * });
   *
   * // Abort the request before it completes
   * setTimeout(() => req.cancel(), 500);
   * ```
   */
  cancel() {
    this.xhr?.abort();
    this.xhr = null;
  }
}

class AnimationFrameFuture extends Future<number> {
  protected done: boolean = false;
  private frameId: number | null = null;
  private started: boolean = false;
  private value: number = 0;
  constructor() {
    super();
  }
  poll(waker: VoidFunction): { ready: boolean; value: number | undefined } {
    if (this.done) return { ready: true, value: this.value };
    if (this.started) return { ready: false, value: undefined };

    this.started = true;

    this.frameId = requestAnimationFrame((timestamp) => {
      this.done = true;
      this.value = timestamp;
      this.frameId = null;
      waker();
    });

    return { ready: false, value: undefined };
  }
  cancel() {
    if (this.frameId !== null)
      (cancelAnimationFrame(this.frameId), (this.frameId = null));
  }
}

export { FetchFuture, AnimationFrameFuture };
export * from "../index";
export * from "./fetch-types";

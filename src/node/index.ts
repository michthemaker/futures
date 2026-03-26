import { Future, Result } from "../index";
import type {
  FetchError,
  FetchErrorKind,
  FetchOptions,
  FetchResponse,
  HttpHeaders,
} from "./fetch-types";
import http from "node:http";
import https from "node:https";
import { URL } from "node:url";

const DEFAULT_FETCH_OPTIONS: Required<FetchOptions> = {
  method: "GET",
  headers: {},
  body: null,
  query: {},
  timeout: 30_000,
  parseResponse: true,
};

/**
 * A future that performs an HTTP or HTTPS request and resolves with the response.
 *
 * Built on `node:http` and `node:https` — no `fetch` API, no Promises. The request is
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
 * - `network` — `ECONNREFUSED`, `ECONNRESET`
 * - `dns` — `ENOTFOUND`, domain does not exist
 * - `timeout` — request exceeded the configured `timeout` ms
 * - `parse` — response body failed `JSON.parse`
 * - `ssl` — certificate or SSL handshake error
 * - `aborted` — request was destroyed mid-flight
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
  private req: http.ClientRequest | null = null;

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
   * On the first call, the HTTP request is constructed and sent. Subsequent calls
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
   * - `Result.Err({ kind: "network" | "dns" | "ssl" | "aborted" })` — transport-level error
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

    // pick http or https
    const transport = parsedUrl.protocol === "https:" ? https : http;

    // build body
    let body: string | undefined;
    let contentType: string | undefined;

    if (this.options.body !== null) {
      if (
        typeof this.options.body === "object" &&
        !Buffer.isBuffer(this.options.body)
      ) {
        body = JSON.stringify(this.options.body);
        contentType = "application/json";
      } else {
        body = this.options.body as string;
      }
    }

    const requestOptions = {
      method: this.options.method,
      headers: {
        ...(contentType ? { "Content-Type": contentType } : {}),
        ...(body ? { "Content-Length": Buffer.byteLength(body) } : {}),
        ...this.options.headers,
      },
    };

    const req = transport.request(parsedUrl, requestOptions, (res) => {
      let raw = "";

      res.on("data", (chunk) => {
        raw += chunk.toString();
      });

      res.on("end", () => {
        // http error — status >= 400
        if (res.statusCode && res.statusCode >= 400) {
          this.done = true;
          this.value = Result.Err({
            kind: "http",
            message: `HTTP ${res.statusCode}`,
            status: res.statusCode,
            statusText: res.statusMessage ?? "",
          });
          waker();
          return;
        }

        // parse response
        let data: T;
        if (this.options.parseResponse) {
          try {
            data = JSON.parse(raw);
          } catch {
            this.done = true;
            this.value = Result.Err({
              kind: "parse",
              message: "Failed to parse response as JSON",
              cause: raw,
            });
            waker();
            return;
          }
        } else {
          data = raw as unknown as T;
        }

        this.done = true;
        this.value = Result.Ok({
          data,
          status: res.statusCode!,
          statusText: res.statusMessage ?? "",
          headers: res.headers as HttpHeaders,
        });
        waker();
      });
    });

    // store req so we can cancel it later
    if (!this.req) this.req = req;

    // timeout
    req.setTimeout(this.options.timeout || 30_000, () => {
      req.destroy();
      this.done = true;
      this.value = Result.Err({
        kind: "timeout",
        message: `Request timed out after ${this.options.timeout}ms`,
      });
      waker();
    });

    // network errors
    req.on("error", (err: NodeJS.ErrnoException) => {
      const kind: FetchErrorKind =
        err.code === "ENOTFOUND"
          ? "dns"
          : err.code === "ECONNREFUSED"
            ? "network"
            : err.code === "ETIMEDOUT"
              ? "timeout"
              : err.code === "ECONNRESET"
                ? "network"
                : err.code === "ECONNABORTED"
                  ? "aborted"
                  : err.code?.startsWith("SSL")
                    ? "ssl"
                    : "network";

      this.done = true;
      this.value = Result.Err({
        kind,
        message: err.message,
        code: err.code,
        cause: err,
      });
      waker();
    });

    // send body if present
    if (body) req.write(body);
    req.end();

    return { ready: false, value: undefined };
  }

  /**
   * Cancels the in-flight HTTP request by destroying the underlying socket.
   *
   * Safe to call at any point — before the request starts, while it is in flight,
   * or after it has already settled (in which case this is a no-op). Once cancelled,
   * the future will never call `waker` again and will never resolve.
   *
   * @example
   * ```ts
   * const req = new FetchFuture("https://api.example.com/slow-endpoint");
   *
   * Future.run(req, (result) => {
   *   console.log(result);
   * });
   *
   * // Abort the request before it completes
   * setTimeout(() => req.cancel(), 500);
   * ```
   */
  cancel() {
    this.req?.destroy();
    this.req = null;
  }
}

export { FetchFuture };
export * from "../index";
export * from "./fetch-types";

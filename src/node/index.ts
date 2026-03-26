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

class FetchFuture<T> extends Future<Result<FetchResponse<T>, FetchError>> {
  protected url: string;
  protected options: FetchOptions;
  protected started: boolean = false;
  protected value: Result<FetchResponse<T>, FetchError> | undefined;
  private req: http.ClientRequest | null = null;
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

  cancel() {
    this.req?.destroy();
    this.req = null;
  }
}

export { FetchFuture };
export * from "../index";
export * from "./fetch-types";

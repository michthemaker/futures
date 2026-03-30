export type FetchErrorKind =
  | "network" // generic network failure (includes dns, ssl, cors — browser gives no detail)
  | "timeout" // request exceeded the configured timeout
  | "http" // status >= 400
  | "parse" // JSON.parse failed
  | "invalid_url" // URL parsing failed
  | "aborted"; // request was aborted mid-flight

export type FetchError = (
  | {
      kind: Exclude<FetchErrorKind, "http" | "network" | "timeout" | "aborted">;
    }
  | {
      kind: "http";
      status: number;
      statusText: string;
    }
  | {
      kind: "network" | "timeout" | "aborted";
      cause: ProgressEvent<EventTarget>;
    }
) & {
  message: string;
  cause?: unknown; // original xhr event or error, if available
};

export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS";

export type HttpHeaders = Record<string, string>;

export type HttpBody =
  | string
  | Record<string, unknown> // will be JSON.stringify'd
  | null;

export type QueryParams = Record<string, string | number | boolean | undefined>;

export type TimeoutMs = number;

export type FetchOptions = {
  method?: HttpMethod; // default GET
  headers?: HttpHeaders;
  body?: HttpBody; // auto JSON.stringify if object
  query?: QueryParams; // appended to URL automatically
  timeout?: TimeoutMs; // default 30_000
  parseResponse?: boolean; // default true — auto JSON.parse
};

export type FetchResponse<T> = {
  data: T;
  status: number;
  statusText: string;
  headers: HttpHeaders;
};

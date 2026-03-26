export type FetchErrorKind =
  | "network" // ECONNREFUSED, ECONNRESET
  | "timeout" // ETIMEDOUT, ESOCKETTIMEDOUT
  | "http" // status >= 400
  | "parse" // JSON.parse failed
  | "invalid_url" // URL parsing failed
  | "dns" // ENOTFOUND — domain doesn't exist
  | "ssl" // certificate errors, UNABLE_TO_VERIFY_LEAF_SIGNATURE
  | "aborted"; // request aborted mid-flight

export type FetchError = (
  | {
      kind: Exclude<FetchErrorKind, "http">;
    }
  | {
      kind: "http";
      status: number;
      statusText: string;
    }
) & {
  message: string;
  code?: string; // node error code e.g. 'ECONNREFUSED'
  cause?: unknown; // original node error
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
  | Buffer
  | Record<string, unknown> // will be JSON.stringify'd
  | null;

export type QueryParams = Record<string, string | number | boolean | undefined>;

export type TimeoutMs = number;

export type FetchOptions = {
  method?: HttpMethod; // default GET
  headers?: HttpHeaders;
  body?: HttpBody; // auto JSON.stringify if object
  query?: QueryParams; // appended to URL automatically
  timeout?: TimeoutMs; // default maybe 30_000
  parseResponse?: boolean; // default true — auto JSON.parse
};

export type FetchResponse<T> = {
  data: T;
  status: number;
  statusText: string;
  headers: HttpHeaders;
};

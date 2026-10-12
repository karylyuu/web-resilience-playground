import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { Scope } from "./types";

let currentScope: Partial<Scope> = {};
export function setObservationScope(scope: Scope) {
  currentScope = {
    runId: scope.runId,
    segment: scope.segment,
    phase: scope.phase,
    faults: [...scope.faults],
  };
}

let lostBrowserEvents = 0;
const deliveryListeners = new Set<() => void>();
export function useLostBrowserEvents() {
  return useSyncExternalStore(
    (listener) => {
      deliveryListeners.add(listener);
      return () => {
        deliveryListeners.delete(listener);
      };
    },
    () => lostBrowserEvents,
  );
}

export function recordBrowser(
  kind: string,
  route: string,
  detail: string,
  durationMs: number | null = null,
  requestId: string | null = null,
  scope = currentScope,
) {
  void fetch("/api/lab/browser", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...scope,
      kind,
      route,
      detail,
      durationMs,
      requestId,
    }),
  })
    .then((response) => {
      if (!response.ok) throw new Error("관찰 전송 실패");
    })
    .catch(() => {
      // Keep delivery failures local; recursively reporting them would amplify an outage.
      lostBrowserEvents += 1;
      deliveryListeners.forEach((listener) => listener());
    });
}

export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const controlled = !path.startsWith("/api/lab");
  const scope = { ...currentScope };
  const id = crypto.randomUUID();
  const start = performance.now();
  let status: number | undefined;
  try {
    const response = await fetch(path, {
      ...options,
      signal: options.signal ?? AbortSignal.timeout(controlled ? 20000 : 10000),
      headers: {
        "Content-Type": "application/json",
        "X-Client-Request-Id": id,
        ...options.headers,
      },
    });
    status = response.status;
    if (response.status === 204) {
      if (controlled)
        recordBrowser(
          "data-received",
          path,
          "HTTP 204 · 요청 완료",
          performance.now() - start,
          id,
          scope,
        );
      return undefined as T;
    }
    let data: T & { message?: string };
    try {
      data = await response.json();
    } catch {
      throw new Error(
        `HTTP ${status} 응답 본문을 JSON으로 해석하지 못했습니다.`,
      );
    }
    if (!response.ok)
      throw new Error(data.message ?? `HTTP ${response.status}`);
    if (controlled)
      recordBrowser(
        "data-received",
        path,
        `HTTP ${status} · JSON 해석 완료`,
        performance.now() - start,
        id,
        scope,
      );
    return data;
  } catch (error) {
    const message = error instanceof Error ? error.message : "요청 실패";
    if (controlled)
      recordBrowser(
        "request-error",
        path,
        status ? message : `응답을 수신하지 못함: ${message}`,
        performance.now() - start,
        id,
        scope,
      );
    throw error;
  }
}

export function useLive<T>(path: string, interval: number, enabled = true) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [receivedAt, setReceivedAt] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    if (!enabled) return;
    const version = ++generation.current;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController;
    const load = async () => {
      controller = new AbortController();
      setLoading(true);
      const timeout = setTimeout(
        () =>
          controller.abort(
            new DOMException("20초 클라이언트 제한 초과", "TimeoutError"),
          ),
        20000,
      );
      try {
        const result = await api<T>(path, { signal: controller.signal });
        if (!stopped && generation.current === version) {
          setData(result);
          setError("");
          setReceivedAt(new Date().toISOString());
        }
      } catch (failure) {
        if (!stopped)
          setError(
            failure instanceof Error ? failure.message : "데이터 요청 실패",
          );
      } finally {
        clearTimeout(timeout);
        if (!stopped) {
          setLoading(false);
          if (interval > 0) timer = setTimeout(load, interval);
        }
      }
    };
    void load();
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller?.abort();
    };
  }, [path, interval, enabled, revision]);

  return { data, error, loading, receivedAt, refresh };
}

export function time(value: string | null | undefined) {
  return value
    ? new Date(value).toLocaleTimeString("ko-KR", { hour12: false })
    : "아직 수신 없음";
}

export function number(value: number | null | undefined, digits = 1) {
  return value === null || value === undefined
    ? "—"
    : value.toLocaleString("ko-KR", { maximumFractionDigits: digits });
}

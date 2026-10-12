import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { RequestHandler } from "express";

export type Phase = "baseline" | "active" | "recovery" | "mixed";
export type Context = {
  runId: string;
  segment: number;
  phase: Phase;
  faults: string[];
};
export type RequestSample = Context & {
  id: string;
  route: string;
  method: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  status: number | null;
  outcome: "completed" | "disconnected";
  concurrent: number;
  startSegment: number;
  endSegment: number;
};
export type ResourceSample = Context & {
  at: string;
  cpuPercent: number;
  rssMiB: number;
  heapMiB: number;
  eventLoopDelayMs: number;
  inFlight: number;
};
export type BrowserSample = Context & {
  at: string;
  requestId: string | null;
  route: string;
  kind: string;
  durationMs: number | null;
  detail: string;
};
export type Transition = Context & { at: string; reason: string };

const LIMIT = 12000;
const requests: RequestSample[] = [];
const resources: ResourceSample[] = [];
const browserEvents: BrowserSample[] = [];
const transitions: Transition[] = [];
let dropped = 0;
let context: Context = {
  runId: randomUUID(),
  segment: 0,
  phase: "baseline",
  faults: [],
};
let inFlight = 0;
let cpuPrevious = process.cpuUsage();
let samplePrevious = performance.now();

function retain<T>(list: T[], value: T) {
  list.push(value);
  if (list.length > LIMIT) {
    list.shift();
    dropped += 1;
  }
}

export function currentContext(): Context {
  return { ...context, faults: [...context.faults] };
}

export function transition(faults: string[], reason: string) {
  context = {
    ...context,
    segment: context.segment + 1,
    faults,
    phase: faults.length ? "active" : "recovery",
  };
  retain(transitions, {
    ...currentContext(),
    at: new Date().toISOString(),
    reason,
  });
}

export function newRun() {
  context = {
    runId: randomUUID(),
    segment: context.segment + 1,
    phase: "baseline",
    faults: [],
  };
  retain(transitions, {
    ...currentContext(),
    at: new Date().toISOString(),
    reason: "새 관찰 시작 (기존 세션 기록 보존)",
  });
  return context.runId;
}

export const observeRequest: RequestHandler = (request, response, next) => {
  const start = currentContext();
  const startTime = performance.now();
  const startedAt = new Date().toISOString();
  const clientId = request.headers["x-client-request-id"] ?? request.query.rid;
  const id =
    typeof clientId === "string" && /^[a-f0-9-]{36}$/.test(clientId)
      ? clientId
      : randomUUID();
  const concurrent = ++inFlight;
  let recorded = false;
  response.setHeader("X-Request-Id", id);
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Experiment-Run", start.runId);
  response.setHeader("X-Experiment-Segment", start.segment);
  response.setHeader("X-Experiment-Phase", start.phase);
  const record = (outcome: RequestSample["outcome"]) => {
    if (recorded) return;
    recorded = true;
    inFlight--;
    const end = currentContext();
    retain(requests, {
      ...start,
      phase: start.segment === end.segment ? start.phase : "mixed",
      id,
      route: request.path,
      method: request.method,
      startedAt,
      endedAt: new Date().toISOString(),
      durationMs: performance.now() - startTime,
      status: outcome === "completed" ? response.statusCode : null,
      outcome,
      concurrent,
      startSegment: start.segment,
      endSegment: end.segment,
    });
  };
  response.once("finish", () => record("completed"));
  response.once("close", () =>
    record(response.writableFinished ? "completed" : "disconnected"),
  );
  next();
};

// CPU is process CPU time / elapsed wall time. 100% means one logical core.
// A delayed sampling callback is measured, never filled with an invented value.
let resourceContext = currentContext();
const resourceTimer = setInterval(() => {
  const now = performance.now();
  const cpu = process.cpuUsage();
  const memory = process.memoryUsage();
  const elapsed = now - samplePrevious;
  const end = currentContext();
  retain(resources, {
    ...resourceContext,
    phase:
      resourceContext.segment === end.segment ? resourceContext.phase : "mixed",
    at: new Date().toISOString(),
    cpuPercent:
      ((cpu.user - cpuPrevious.user + cpu.system - cpuPrevious.system) /
        1000 /
        elapsed) *
      100,
    rssMiB: memory.rss / 1024 / 1024,
    heapMiB: memory.heapUsed / 1024 / 1024,
    eventLoopDelayMs: Math.max(0, elapsed - 1000),
    inFlight,
  });
  resourceContext = end;
  samplePrevious = now;
  cpuPrevious = cpu;
}, 1000);
resourceTimer.unref();

export function addBrowserEvent(input: Partial<BrowserSample>) {
  const linked = requests.find((item) => item.id === input.requestId);
  const valid = transitions.find(
    (item) => item.runId === input.runId && item.segment === input.segment,
  );
  const scope = linked ?? valid ?? currentContext();
  retain(browserEvents, {
    runId: scope.runId,
    segment: scope.segment,
    phase: scope.phase,
    faults: scope.faults,
    at: new Date().toISOString(),
    requestId:
      typeof input.requestId === "string" ? input.requestId.slice(0, 80) : null,
    route: String(input.route ?? "")
      .split("?")[0]
      .slice(0, 120),
    kind: String(input.kind ?? "unknown").slice(0, 40),
    durationMs:
      typeof input.durationMs === "number" &&
      Number.isFinite(input.durationMs) &&
      input.durationMs >= 0
        ? input.durationMs
        : null,
    detail: String(input.detail ?? "").slice(0, 300),
  });
}

function aggregate(items: RequestSample[]) {
  const total = items.length;
  return {
    count: total,
    meanMs: total
      ? items.reduce((sum, item) => sum + item.durationMs, 0) / total
      : null,
    failurePercent: total
      ? (100 *
          items.filter((item) => item.status === null || item.status >= 400)
            .length) /
        total
      : null,
  };
}

export function snapshot(allRuns = false, forScreen = false) {
  const select = <T extends { runId: string }>(items: T[]) =>
    allRuns ? [...items] : items.filter((item) => item.runId === context.runId);
  const selected = select(requests);
  const routes = [
    ...new Set(
      selected.map((item) => `${item.runId}|${item.method} ${item.route}`),
    ),
  ];
  const comparisons = routes.map((key) => {
    const [runId, route] = key.split("|");
    const routeItems = selected.filter(
      (item) =>
        item.runId === runId && `${item.method} ${item.route}` === route,
    );
    return {
      runId,
      route,
      baseline: aggregate(
        routeItems.filter((item) => item.phase === "baseline"),
      ),
      active: aggregate(routeItems.filter((item) => item.phase === "active")),
      recovery: aggregate(
        routeItems.filter((item) => item.phase === "recovery"),
      ),
      mixed: aggregate(routeItems.filter((item) => item.phase === "mixed")),
    };
  });
  const groups = new Map<string, RequestSample[]>();
  for (const item of selected) {
    const key = `${item.runId}|${item.segment}|${item.phase}|${item.method} ${item.route}`;
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  const segments = [...groups.values()].map((group) => ({
    runId: group[0].runId,
    segment: group[0].segment,
    phase: group[0].phase,
    faults: group[0].faults,
    route: `${group[0].method} ${group[0].route}`,
    ...aggregate(group),
  }));
  const selectedResources = select(resources);
  const resourceComparisons = (["baseline", "active", "recovery"] as const).map(
    (phase) => {
      const samples = selectedResources.filter((item) => item.phase === phase);
      const mean = (field: "cpuPercent" | "rssMiB" | "eventLoopDelayMs") =>
        samples.length
          ? samples.reduce((sum, item) => sum + item[field], 0) / samples.length
          : null;
      return {
        phase,
        count: samples.length,
        cpuPercent: mean("cpuPercent"),
        rssMiB: mean("rssMiB"),
        eventLoopDelayMs: mean("eventLoopDelayMs"),
      };
    },
  );
  return {
    ...currentContext(),
    capturedAt: new Date().toISOString(),
    inFlight,
    dropped,
    retentionLimit: LIMIT,
    requestCount: selected.length,
    requests: forScreen ? selected.slice(-600) : selected,
    resources: forScreen ? select(resources).slice(-180) : select(resources),
    browserEvents: forScreen
      ? select(browserEvents).slice(-100)
      : select(browserEvents),
    transitions: select(transitions),
    comparisons,
    segments,
    resourceComparisons,
  };
}

retain(transitions, {
  ...currentContext(),
  at: new Date().toISOString(),
  reason: "서버 관찰 시작",
});

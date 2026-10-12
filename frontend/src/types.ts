export type Phase = "baseline" | "active" | "recovery" | "mixed";
export type Scope = {
  runId: string;
  phase: Phase;
  segment: number;
  faults: string[];
};
export type RequestSample = Scope & {
  id: string;
  route: string;
  method: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  status: number | null;
  concurrent: number;
  outcome: string;
};
export type ResourceSample = Scope & {
  at: string;
  cpuPercent: number;
  rssMiB: number;
  heapMiB: number;
  eventLoopDelayMs: number;
  inFlight: number;
};
export type Aggregate = {
  count: number;
  meanMs: number | null;
  failurePercent: number | null;
};
export type Comparison = { route: string } & Record<Phase, Aggregate>;
export type Diagnostic = Scope & {
  capturedAt: string;
  inFlight: number;
  requestCount: number;
  dropped: number;
  allocatedMiB: number;
  catalog: {
    key: string;
    label: string;
    mechanism: string;
    scope: string;
    enabled: boolean;
    expiresAt: number | null;
    delayMs: number | null;
  }[];
  requests: RequestSample[];
  resources: ResourceSample[];
  resourceComparisons: {
    phase: Phase;
    count: number;
    cpuPercent: number | null;
    rssMiB: number | null;
    eventLoopDelayMs: number | null;
  }[];
  comparisons: Comparison[];
  segments: (Scope & Aggregate & { route: string })[];
  browserEvents: (Scope & {
    at: string;
    requestId: string | null;
    route: string;
    kind: string;
    durationMs: number | null;
    detail: string;
  })[];
  transitions: (Scope & { at: string; reason: string })[];
};
export type Story = {
  id: string;
  title: string;
  url: string;
  source: string;
  category: string;
  publishedAt: string | null;
};
export type Feed = {
  items: Story[];
  providers: {
    name: string;
    source: string;
    receivedAt: string | null;
    stale: boolean;
    error: string | null;
  }[];
};
export type Provider<T> = {
  data: T;
  receivedAt: string;
  source: string;
  stale: boolean;
  error: string | null;
};
export type MarketData = {
  coins: Provider<
    { symbol: string; price: number; changePercent: number; at: string }[]
  > | null;
  fx: Provider<{ symbol: string; price: number; date: string }[]> | null;
  errors: string[];
};
export type Profile = { name: string; session: string };
export type Post = {
  id: string;
  author: string;
  text: string;
  at: string;
  likes: number;
  comments: { text: string; author: string; at: string }[];
};

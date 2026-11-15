import { number, time } from "./api";
import type { Diagnostic } from "./types";

const OK = "#92bcb0";
const FAIL = "#ff6975";
const CPU = "#a4a5ef";
const BAND = "#f6a174";

const browserFailures = new Set(["request-error", "image-error", "style-error"]);

/** "GET /api/pulse" → "/api/pulse"; "all" stays "all". */
const pathOf = (route: string) =>
  route === "all" ? "all" : route.split(" ").slice(1).join(" ");

function formatMs(value: number) {
  if (value >= 1000) return `${number(value / 1000, 1)}초`;
  if (value >= 1) return `${number(value, 0)} ms`;
  return `${number(value, 2)} ms`;
}

/**
 * Live timeline: one shared time axis, three lanes.
 *  1. response time of every finished request (log scale, failures in red)
 *  2. server process CPU
 *  3. what the browser actually got (loaded / failed)
 * Periods with an active fault are shaded so cause and effect line up.
 */
export function Timeline({
  data,
  route = "all",
  windowSeconds = 120,
  compact = false,
}: {
  data: Diagnostic | null;
  route?: string;
  windowSeconds?: number;
  compact?: boolean;
}) {
  if (!data) return <div className="chart-empty">서버에 연결하는 중…</div>;

  const end = Date.parse(data.capturedAt);
  const start = end - windowSeconds * 1000;
  // Canvas width roughly matches the space it is shown in, so text stays readable.
  const width = compact ? 360 : 820;
  const left = 48;
  const right = 10;
  const plotWidth = width - left - right;
  const responseTop = 36;
  const responseHeight = compact ? 104 : 150;
  const cpuTop = responseTop + responseHeight + 30;
  const cpuHeight = compact ? 34 : 54;
  const browserTop = cpuTop + cpuHeight + 28;
  const browserHeight = 16;
  const axisY = browserTop + browserHeight + 18;
  const height = axisY + 8;
  const x = (at: number) => left + ((at - start) / (end - start)) * plotWidth;
  const inWindow = (at: number) => at >= start && at <= end;
  const label = (key: string) =>
    data.catalog.find((item) => item.key === key)?.label ?? key;

  // Fault periods, from the change log.
  const changes = [...data.transitions].sort(
    (a, b) => Date.parse(a.at) - Date.parse(b.at),
  );
  const bands = changes
    .map((item, index) => ({
      from: Date.parse(item.at),
      to: changes[index + 1] ? Date.parse(changes[index + 1].at) : end,
      faults: item.faults,
    }))
    .filter((band) => band.faults.length && band.to > start && band.from < end)
    .map((band) => ({
      ...band,
      from: Math.max(band.from, start),
      to: Math.min(band.to, end),
    }));

  const path = pathOf(route);
  const requests = data.requests.filter(
    (item) =>
      (route === "all" || `${item.method} ${item.route}` === route) &&
      inWindow(Date.parse(item.endedAt)),
  );
  const resources = data.resources.filter((item) =>
    inWindow(Date.parse(item.at)),
  );
  const events = data.browserEvents.filter(
    (item) =>
      (path === "all" || item.route === path) && inWindow(Date.parse(item.at)),
  );

  // Response lane uses a log scale so 0.3 ms and 1,200 ms both stay readable.
  const durations = requests.map((item) => Math.max(item.durationMs, 0.01));
  const lowDecade = Math.max(
    -2,
    Math.floor(Math.log10(Math.min(1, ...durations))),
  );
  const highDecade = Math.max(
    lowDecade + 2,
    Math.ceil(Math.log10(Math.max(10, ...durations))),
  );
  const yResponse = (ms: number) =>
    responseTop +
    responseHeight -
    ((Math.log10(Math.max(ms, 0.01)) - lowDecade) / (highDecade - lowDecade)) *
      responseHeight;
  const decades = Array.from(
    { length: highDecade - lowDecade + 1 },
    (_, index) => 10 ** (lowDecade + index),
  );

  const cpuMax = Math.max(100, ...resources.map((item) => item.cpuPercent));
  const yCpu = (value: number) =>
    cpuTop + cpuHeight - (value / cpuMax) * cpuHeight;
  const cpuLine = resources
    .map((item) => `${x(Date.parse(item.at))},${yCpu(item.cpuPercent)}`)
    .join(" ");

  const tickEvery = windowSeconds <= 60 ? 15 : 30;
  const ticks = Array.from(
    { length: Math.floor(windowSeconds / tickEvery) + 1 },
    (_, index) => index * tickEvery,
  );
  const failures = requests.filter(
    (item) => item.status === null || item.status >= 400,
  );

  return (
    <figure className="timeline">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`최근 ${windowSeconds}초 타임라인. 요청 ${requests.length}건, 실패 ${failures.length}건, 장애 구간 ${bands.length}개.`}
      >
        {bands.map((band, index) => (
          <g key={index}>
            <rect
              x={x(band.from)}
              y={responseTop - 22}
              width={Math.max(2, x(band.to) - x(band.from))}
              height={browserTop + browserHeight - responseTop + 22}
              fill={BAND}
              opacity="0.13"
            />
            <line
              x1={x(band.from)}
              x2={x(band.from)}
              y1={responseTop - 22}
              y2={browserTop + browserHeight}
              stroke={BAND}
              strokeWidth="1"
              opacity="0.7"
            />
            <text x={x(band.from) + 4} y={12} className="band-label">
              {band.faults.map(label).join(" + ")}
            </text>
          </g>
        ))}

        {/* Lane 1: response time */}
        <text x={left} y={responseTop - 8} className="lane-title">
          응답 시간
        </text>
        {decades.map((value) => (
          <g key={value}>
            <line
              x1={left}
              x2={width - right}
              y1={yResponse(value)}
              y2={yResponse(value)}
              className="gridline"
            />
            <text
              x={left - 6}
              y={yResponse(value) + 3}
              textAnchor="end"
              className="axis"
            >
              {formatMs(value)}
            </text>
          </g>
        ))}
        {requests.map((item) => {
          const cx = x(Date.parse(item.endedAt));
          const cy = yResponse(item.durationMs);
          const failed = item.status === null || item.status >= 400;
          const title = `${time(item.endedAt)} · ${item.method} ${item.route} · ${formatMs(item.durationMs)} · ${item.status ?? "연결 끊김"}`;
          return failed ? (
            <g key={item.id} stroke={FAIL} strokeWidth="2">
              <line x1={cx - 4} y1={cy - 4} x2={cx + 4} y2={cy + 4} />
              <line x1={cx - 4} y1={cy + 4} x2={cx + 4} y2={cy - 4} />
              <title>{title}</title>
            </g>
          ) : (
            <circle key={item.id} cx={cx} cy={cy} r="3" fill={OK}>
              <title>{title}</title>
            </circle>
          );
        })}

        {/* Lane 2: server CPU */}
        <text x={left} y={cpuTop - 7} className="lane-title">
          서버 CPU
        </text>
        <line
          x1={left}
          x2={width - right}
          y1={cpuTop + cpuHeight}
          y2={cpuTop + cpuHeight}
          className="gridline"
        />
        <text x={left - 6} y={cpuTop + 8} textAnchor="end" className="axis">
          {number(cpuMax, 0)}%
        </text>
        {resources.length > 1 && (
          <polyline
            points={cpuLine}
            fill="none"
            stroke={CPU}
            strokeWidth="1.6"
          />
        )}

        {/* Lane 3: browser outcome */}
        <text x={left} y={browserTop - 6} className="lane-title">
          브라우저 결과
        </text>
        {events.map((item, index) => {
          const failed = browserFailures.has(item.kind);
          return (
            <rect
              key={index}
              x={x(Date.parse(item.at)) - 1.5}
              y={browserTop}
              width="3"
              height={browserHeight}
              fill={failed ? FAIL : OK}
              opacity={failed ? 1 : 0.6}
            >
              <title>{`${time(item.at)} · ${item.route} · ${item.detail}`}</title>
            </rect>
          );
        })}

        {ticks.map((seconds) => (
          <text
            key={seconds}
            x={x(end - seconds * 1000)}
            y={axisY}
            textAnchor={seconds === 0 ? "end" : "middle"}
            className="axis"
          >
            {seconds === 0 ? "지금" : `${seconds}초 전`}
          </text>
        ))}
      </svg>
      <figcaption>
        <span>
          <i style={{ background: OK }} /> 성공
        </span>
        <span>
          <i style={{ background: FAIL }} /> 실패
        </span>
        <span>
          <i style={{ background: CPU }} /> CPU
        </span>
        <span>
          <i style={{ background: BAND, opacity: 0.6 }} /> 장애가 켜진 구간
        </span>
        {data.inFlight > 0 && (
          <span className="pending">응답 기다리는 중 {data.inFlight}건</span>
        )}
      </figcaption>
    </figure>
  );
}

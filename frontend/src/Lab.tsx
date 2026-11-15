import { useState } from "react";
import { api, number, time, useLostBrowserEvents } from "./api";
import { Timeline } from "./Charts";
import { browserKindName, phaseColors, phaseLabels, routeName } from "./phases";
import type { Aggregate, Diagnostic } from "./types";

const formatMs = (value: number | null | undefined) =>
  value === null || value === undefined
    ? "—"
    : value >= 1000
      ? `${number(value / 1000, 2)}초`
      : `${number(value, value < 1 ? 2 : 0)} ms`;
const formatPercent = (value: number | null | undefined) =>
  value === null || value === undefined ? "—" : `${number(value, 0)}%`;

export function Lab({
  data,
  error,
  refresh,
}: {
  data: Diagnostic | null;
  error: string;
  refresh: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const lostBrowserEvents = useLostBrowserEvents();
  const [message, setMessage] = useState("");
  const [reportOpen, setReportOpen] = useState(false);
  const [route, setRoute] = useState("GET /api/pulse");
  const [reportRoute, setReportRoute] = useState("all");
  const [delay, setDelay] = useState("");
  const [tab, setTab] = useState<"faults" | "compare">("faults");
  const action = async (path: string, body = {}) => {
    setBusy(true);
    setMessage("");
    try {
      await api(path, { method: "POST", body: JSON.stringify(body) });
      refresh();
    } catch (failure) {
      setMessage(failure instanceof Error ? failure.message : "요청에 실패했어요.");
    } finally {
      setBusy(false);
    }
  };
  const exportReport = async (scope: string) => {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/lab/export?scope=${scope}`, {
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) throw new Error("엑셀 파일을 만들지 못했어요.");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `resilience-${new Date().toISOString().replace(/[:.]/g, "-")}.xlsx`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) {
      setMessage(failure instanceof Error ? failure.message : "저장에 실패했어요.");
    } finally {
      setBusy(false);
    }
  };
  const active = data?.catalog.filter((fault) => fault.enabled) ?? [];
  const latest = data?.resources.at(-1);
  const routes = [
    "GET /api/pulse",
    ...(data?.comparisons
      .map((item) => item.route)
      .filter((item) => item !== "GET /api/pulse") ?? []),
  ];

  return (
    <aside className="lab">
      <div className="lab-heading">
        <div>
          <span className="eyebrow">실험 패널</span>
          <h2>장애를 켜고 지켜보기</h2>
        </div>
        <span
          className={error ? "status-dot offline" : "status-dot"}
          title={error || "서버와 실시간으로 연결됨"}
        />
      </div>
      <div className="lab-status">
        <span>{data ? phaseLabels[data.phase] : "연결 중"}</span>
        <span>
          응답 대기 <b>{data?.inFlight ?? "—"}</b>
        </span>
        <button
          disabled={busy || !active.length}
          onClick={() => action("/api/lab/release")}
        >
          모두 끄기
        </button>
      </div>
      {(error || message) && (
        <p className="alert" role="alert">
          {error
            ? `${error} (마지막 수신 ${time(data?.capturedAt)})`
            : message}
        </p>
      )}
      {lostBrowserEvents > 0 && (
        <p className="alert" role="status">
          이 탭의 기록 {lostBrowserEvents}건을 서버에 보내지 못했어요.
        </p>
      )}
      <div className="lab-tabs">
        <button
          className={tab === "faults" ? "active" : ""}
          onClick={() => setTab("faults")}
        >
          장애 <small>{active.length}</small>
        </button>
        <button
          className={tab === "compare" ? "active" : ""}
          onClick={() => setTab("compare")}
        >
          비교
        </button>
      </div>
      {tab === "faults" ? (
        <>
          <p className="lab-intro">
            켜는 즉시 왼쪽 서비스에 반영돼요. 아래 그래프에서 변화를 확인하세요.
          </p>
          <div className="fault-grid">
            {data?.catalog.map((fault, index) => (
              <div
                className={`fault ${fault.enabled ? "enabled" : ""}`}
                key={fault.key}
              >
                <div className="fault-title">
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <button
                    role="switch"
                    aria-checked={fault.enabled}
                    aria-label={fault.label}
                    disabled={busy || Boolean(error)}
                    onClick={() =>
                      action(`/api/lab/faults/${fault.key}`, {
                        enabled: !fault.enabled,
                        delayMs:
                          fault.key === "api-hold" && delay !== ""
                            ? Number(delay)
                            : null,
                      })
                    }
                  >
                    <i />
                  </button>
                </div>
                <h3>{fault.label}</h3>
                <details>
                  <summary>어떻게 동작하나요?</summary>
                  <p>{fault.mechanism}</p>
                  <small>{fault.scope}</small>
                  {fault.key === "api-hold" && (
                    <label className="delay-setting">
                      지연 시간 (ms)
                      <input
                        aria-label="지연 시간 밀리초"
                        type="number"
                        min="1"
                        max="10000"
                        placeholder="비우면 끌 때까지 멈춤"
                        value={delay}
                        disabled={fault.enabled}
                        onChange={(event) => setDelay(event.target.value)}
                      />
                      <small>1 ~ 10,000 ms</small>
                    </label>
                  )}
                </details>
                {fault.enabled && (
                  <small className="expiry">
                    {time(new Date(fault.expiresAt!).toISOString())}에 자동으로
                    꺼짐
                    {fault.key === "api-hold" &&
                      (fault.delayMs === null
                        ? " · 끌 때까지 멈춤"
                        : ` · ${number(fault.delayMs, 0)} ms 지연`)}
                  </small>
                )}
              </div>
            ))}
          </div>
          <p className="scope-note">
            모든 장애는 60초가 지나면 자동으로 꺼져요.
          </p>
        </>
      ) : (
        <>
          <div className="route-picker">
            <label>
              어떤 요청을 볼까요?
              <select
                value={route}
                onChange={(event) => setRoute(event.target.value)}
              >
                {routes.map((item) => (
                  <option key={item} value={item}>
                    {routeName(item)} · {item}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <ComparisonView data={data} route={route} />
        </>
      )}
      <div className="mini-metrics">
        <div>
          <span title="실험 서버 프로그램 하나가 쓰는 CPU예요. 100% = 코어 1개">
            서버 CPU
          </span>
          <strong>
            {number(latest?.cpuPercent, 0)}
            <small>%</small>
          </strong>
        </div>
        <div>
          <span title="실험 서버 프로그램이 쓰는 메모리">서버 메모리</span>
          <strong>
            {number(latest?.rssMiB, 0)}
            <small> MiB</small>
          </strong>
        </div>
        <div>
          <span>기록된 요청</span>
          <strong>
            {number(data?.requestCount ?? data?.requests.length, 0)}
            <small>건</small>
          </strong>
        </div>
      </div>
      <div className="lab-chart">
        <Timeline data={data} windowSeconds={90} compact />
      </div>
      <div className="lab-footer">
        <button
          onClick={() => action("/api/lab/runs")}
          disabled={busy || !!active.length}
          title="지금까지 기록은 남겨 두고, 새 기록을 시작해요"
        >
          새 기록 시작
        </button>
        <button
          onClick={() => exportReport("current")}
          disabled={busy || !data}
        >
          엑셀 저장 ↓
        </button>
        <button onClick={() => setReportOpen(true)}>자세히 보기 ↗</button>
      </div>
      <p className="scope-note">
        서버를 다시 켜면 기록이 사라지니, 필요하면 먼저 저장하세요.
      </p>
      {reportOpen && (
        <div
          className="modal-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) setReportOpen(false);
          }}
        >
          <section
            className="report dialog"
            role="dialog"
            aria-modal="true"
            aria-label="자세히 보기"
            onKeyDown={(event) => {
              if (event.key === "Escape") setReportOpen(false);
            }}
          >
            <div className="report-heading">
              <div>
                <h2>자세히 보기</h2>
                <p className="muted">
                  실시간으로 갱신돼요 · 마지막 갱신 {time(data?.capturedAt)}
                  {data?.dropped
                    ? ` · 오래된 기록 ${number(data.dropped, 0)}건은 정리됨`
                    : ""}
                </p>
              </div>
              <button
                autoFocus
                aria-label="닫기"
                onClick={() => setReportOpen(false)}
              >
                닫기 ×
              </button>
            </div>
            <label className="route-picker">
              요청
              <select
                value={reportRoute}
                onChange={(event) => setReportRoute(event.target.value)}
              >
                <option value="all">모든 요청</option>
                {routes.map((item) => (
                  <option key={item} value={item}>
                    {routeName(item)} · {item}
                  </option>
                ))}
              </select>
            </label>

            <h3>최근 3분</h3>
            <Timeline data={data} route={reportRoute} windowSeconds={180} />

            <h3>장애 전 · 중 · 후 비교</h3>
            {reportRoute === "all" ? (
              <OverviewTable data={data} />
            ) : (
              <ComparisonView data={data} route={reportRoute} />
            )}

            <div className="report-columns">
              <RequestPairs data={data} route={reportRoute} />
              <section>
                <h3>장애를 켜고 끈 기록</h3>
                <div className="event-list">
                  {data?.transitions
                    .slice(-30)
                    .reverse()
                    .map((item, index) => (
                      <article key={index}>
                        <small>
                          {time(item.at)} · {item.reason.split(":")[0]}
                        </small>
                        <p>
                          {item.faults.length
                            ? `켜짐: ${item.faults
                                .map(
                                  (key) =>
                                    data.catalog.find(
                                      (fault) => fault.key === key,
                                    )?.label ?? key,
                                )
                                .join(", ")}`
                            : "모든 장애 꺼짐"}
                        </p>
                      </article>
                    ))}
                </div>
              </section>
            </div>
            <div className="report-actions">
              <button disabled={busy} onClick={() => exportReport("current")}>
                이번 기록 엑셀로 저장
              </button>
              <button disabled={busy} onClick={() => exportReport("session")}>
                서버의 전체 기록 저장
              </button>
            </div>
          </section>
        </div>
      )}
    </aside>
  );
}

/** One route: before / during / after, plus a one-line takeaway. */
function ComparisonView({
  data,
  route,
}: {
  data: Diagnostic | null;
  route: string;
}) {
  const comparison = data?.comparisons.find((item) => item.route === route);
  const before = comparison?.baseline;
  const during = comparison?.active;
  const after = comparison?.recovery;
  const has = (value?: Aggregate) => Boolean(value?.count);

  let summary: string;
  if (!has(before)) summary = "먼저 장애 없이 이 기능을 몇 번 사용해 보세요.";
  else if (!has(during))
    summary = "이제 장애를 하나 켜고 같은 기능을 사용해 보세요.";
  else if (!has(after))
    summary = `장애 중 평균 응답이 ${formatMs(before!.meanMs)} → ${formatMs(during!.meanMs)}, 실패율이 ${formatPercent(before!.failurePercent)} → ${formatPercent(during!.failurePercent)}로 바뀌었어요. 장애를 끄고 다시 사용해 보세요.`;
  else
    summary = `해제 후 평균 응답 ${formatMs(after!.meanMs)}, 실패율 ${formatPercent(after!.failurePercent)}. 장애 전(${formatMs(before!.meanMs)}, ${formatPercent(before!.failurePercent)})과 비교해 보세요.`;

  return (
    <section className="comparison">
      <ol className="steps">
        <li className={has(before) ? "done" : ""}>평소대로 사용</li>
        <li className={has(during) ? "done" : ""}>장애 켜고 사용</li>
        <li className={has(after) ? "done" : ""}>끄고 다시 사용</li>
      </ol>
      <p className="finding">{summary}</p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th></th>
              <th>요청 수</th>
              <th>평균 응답</th>
              <th>실패율</th>
            </tr>
          </thead>
          <tbody>
            {(["baseline", "active", "recovery"] as const).map((phase) => (
              <tr key={phase}>
                <th>
                  <i style={{ background: phaseColors[phase] }} />
                  {phaseLabels[phase]}
                </th>
                <td>{comparison?.[phase].count ?? 0}</td>
                <td>{formatMs(comparison?.[phase].meanMs)}</td>
                <td>{formatPercent(comparison?.[phase].failurePercent)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {Boolean(comparison?.mixed.count) && (
        <small className="muted">
          장애를 켜고 끄는 순간에 걸친 요청 {comparison!.mixed.count}건은
          비교에서 뺐어요.
        </small>
      )}
    </section>
  );
}

/** Every route at a glance. */
function OverviewTable({ data }: { data: Diagnostic | null }) {
  const cell = (value?: Aggregate) =>
    value?.count
      ? `${formatMs(value.meanMs)} · 실패 ${formatPercent(value.failurePercent)}`
      : "—";
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>요청</th>
            <th>장애 전</th>
            <th>장애 중</th>
            <th>해제 후</th>
          </tr>
        </thead>
        <tbody>
          {data?.comparisons.map((item) => (
            <tr key={item.route}>
              <th>{routeName(item.route)}</th>
              <td>{cell(item.baseline)}</td>
              <td>{cell(item.active)}</td>
              <td>{cell(item.recovery)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Server record and browser outcome of the same request, side by side. */
function RequestPairs({
  data,
  route,
}: {
  data: Diagnostic | null;
  route: string;
}) {
  const requests = (data?.requests ?? [])
    .filter(
      (item) => route === "all" || `${item.method} ${item.route}` === route,
    )
    .slice(-15)
    .reverse();
  return (
    <section>
      <h3>요청 하나씩 보기</h3>
      <p className="muted">같은 요청을 서버와 브라우저에서 각각 어떻게 봤는지예요.</p>
      <div className="table-scroll pairs">
        <table>
          <thead>
            <tr>
              <th>시각</th>
              <th>요청</th>
              <th>서버</th>
              <th>브라우저</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((item) => {
              const event = data?.browserEvents.find(
                (candidate) => candidate.requestId === item.id,
              );
              const serverFailed = item.status === null || item.status >= 400;
              const browserFailed =
                event && /error/.test(event.kind) ? true : false;
              return (
                <tr key={item.id}>
                  <td>{time(item.endedAt)}</td>
                  <td>{routeName(item.route)}</td>
                  <td className={serverFailed ? "bad" : ""}>
                    {item.status ?? "연결 끊김"} · {formatMs(item.durationMs)}
                  </td>
                  <td className={browserFailed ? "bad" : ""}>
                    {event ? browserKindName(event.kind) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

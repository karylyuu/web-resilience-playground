import { useState } from "react";
import { api, number, time, useLostBrowserEvents } from "./api";
import { Plot } from "./Charts";
import { phaseColors, phaseLabels } from "./phases";
import type { Diagnostic, Phase } from "./types";

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
  const [delay, setDelay] = useState("");
  const [tab, setTab] = useState<"faults" | "evidence">("faults");
  const action = async (path: string, body = {}) => {
    setBusy(true);
    setMessage("");
    try {
      await api(path, { method: "POST", body: JSON.stringify(body) });
      refresh();
    } catch (failure) {
      setMessage(failure instanceof Error ? failure.message : "제어 요청 실패");
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
      if (!response.ok) throw new Error("엑셀 파일을 만들지 못했습니다.");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `resilience-${new Date().toISOString().replace(/[:.]/g, "-")}.xlsx`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) {
      setMessage(failure instanceof Error ? failure.message : "내보내기 실패");
    } finally {
      setBusy(false);
    }
  };
  const active = data?.catalog.filter((fault) => fault.enabled) ?? [];
  const latest = data?.resources.at(-1);
  const selected =
    data?.requests.filter((item) => `${item.method} ${item.route}` === route) ??
    [];
  const responseChart = (
    <Plot
      title="요청에 실제로 걸린 시간"
      yLabel="ms"
      transitions={data?.transitions}
      points={selected.slice(-80).map((item) => ({
        x: Date.parse(item.endedAt),
        y: item.durationMs,
        phase: item.phase,
        failure: item.status === null || item.status >= 400,
        label: `${time(item.endedAt)} · ${number(item.durationMs)} ms · ${item.status ?? "연결 끊김"} · ${phaseLabels[item.phase]}`,
      }))}
    />
  );

  return (
    <aside className="lab">
      <div className="lab-heading">
        <div>
          <span className="eyebrow">OBSERVATION DESK</span>
          <h2>장애와 그 이후</h2>
        </div>
        <span
          className={error ? "status-dot offline" : "status-dot"}
          title={error || "관측 서버 연결됨"}
        />
      </div>
      <div className="lab-status">
        <span>{data ? phaseLabels[data.phase] : "연결 중"}</span>
        <span>
          진행 요청 <b>{data?.inFlight ?? "—"}</b>
        </span>
        <button
          disabled={busy || !active.length}
          onClick={() => action("/api/lab/release")}
        >
          전체 해제 ↗
        </button>
      </div>
      {(error || message) && (
        <p className="alert" role="alert">
          {error
            ? `관측 연결 실패 · 마지막 수신 ${time(data?.capturedAt)}. ${error}`
            : message}
        </p>
      )}
      {lostBrowserEvents > 0 && (
        <p className="alert" role="status">
          이 탭의 브라우저 관찰 {lostBrowserEvents}건을 서버에 전달하지
          못했습니다. 관찰 기록이 완전하지 않습니다.
        </p>
      )}
      <div className="lab-tabs">
        <button
          className={tab === "faults" ? "active" : ""}
          onClick={() => setTab("faults")}
        >
          장애 주입 <small>{active.length}</small>
        </button>
        <button
          className={tab === "evidence" ? "active" : ""}
          onClick={() => setTab("evidence")}
        >
          관측·비교
        </button>
      </div>
      {tab === "faults" ? (
        <>
          <p className="lab-intro">
            장애를 켜고 왼쪽 서비스를 사용하세요.
            <br />
            화면 변화는 실제 요청 결과에 따라 나타납니다.
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
                  <summary>작동 원리</summary>
                  <p>{fault.mechanism}</p>
                  <small>{fault.scope}</small>
                  {fault.key === "api-hold" && (
                    <label className="delay-setting">
                      주입 지연 (ms)
                      <input
                        aria-label="주입 지연 밀리초"
                        type="number"
                        min="1"
                        max="10000"
                        placeholder="비우면 해제까지 대기"
                        value={delay}
                        disabled={fault.enabled}
                        onChange={(event) => setDelay(event.target.value)}
                      />
                      <small>
                        직접 입력 · 안전 상한 10,000 ms · 판정 기준 아님
                      </small>
                    </label>
                  )}
                </details>
                {fault.enabled && (
                  <small className="expiry">
                    {time(new Date(fault.expiresAt!).toISOString())} 자동 해제
                    {fault.key === "api-hold" && (
                      <span>
                        {" "}
                        ·{" "}
                        {fault.delayMs === null
                          ? "해제까지 대기"
                          : `${fault.delayMs} ms 주입`}
                      </span>
                    )}
                  </small>
                )}
              </div>
            ))}
          </div>
          <p className="scope-note">
            격리된 로컬 앱에만 적용 · 모두 60초 뒤 해제
            <br />
            CPU 연산·64 MiB 점유는 제한된 자원 압박입니다. PC 전체 고갈이나 실제
            패킷 손실을 가장하지 않습니다.
          </p>
        </>
      ) : (
        <>
          <div className="route-picker">
            <label>
              비교할 요청
              <select
                value={route}
                onChange={(event) => setRoute(event.target.value)}
              >
                <option value="GET /api/pulse">
                  GET /api/pulse · 연결 확인
                </option>
                {data?.comparisons
                  .filter((item) => item.route !== "GET /api/pulse")
                  .map((item) => (
                    <option key={item.route}>{item.route}</option>
                  ))}
              </select>
            </label>
          </div>
          <ComparisonView data={data} route={route} />
          <button className="wide-button" onClick={() => setReportOpen(true)}>
            자원·브라우저·변경 기록 자세히 ↗
          </button>
        </>
      )}
      <div className="mini-metrics">
        <div>
          <span>서버 CPU</span>
          <strong>
            {number(latest?.cpuPercent)}
            <small>%</small>
          </strong>
        </div>
        <div>
          <span>서버 메모리</span>
          <strong>
            {number(latest?.rssMiB)}
            <small> MiB</small>
          </strong>
        </div>
        <div>
          <span>완료·중단 요청</span>
          <strong>
            {data?.requestCount ?? data?.requests.length ?? "—"}
            <small>건</small>
          </strong>
        </div>
      </div>
      <div className="lab-chart">
        {responseChart}
        <div className="legend">
          {(["baseline", "active", "recovery"] as Phase[]).map((phase) => (
            <span key={phase}>
              <i style={{ background: phaseColors[phase] }} />
              {phaseLabels[phase]}
            </span>
          ))}
        </div>
        <small className="muted">
          {route} · 최근 80개 · 전체 원본은 엑셀에 보관
        </small>
      </div>
      <div className="lab-footer">
        <button
          onClick={() => action("/api/lab/runs")}
          disabled={busy || !!active.length}
        >
          새 관찰
        </button>
        <button
          onClick={() => exportReport("current")}
          disabled={busy || !data}
        >
          엑셀 저장 ↓
        </button>
        <button onClick={() => setReportOpen(true)}>진단 펼치기 ↗</button>
      </div>
      <p className="scope-note">
        새 관찰은 기존 기록을 삭제하지 않습니다. 서버 재시작 시 관측 기록이
        사라지므로 먼저 저장하세요.
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
            aria-label="관측 보고서"
            onKeyDown={(event) => {
              if (event.key === "Escape") setReportOpen(false);
            }}
          >
            <div className="report-heading">
              <div>
                <p className="eyebrow">MEASURED, NOT ASSUMED</p>
                <h2>관찰에서 근거로.</h2>
              </div>
              <button
                autoFocus
                aria-label="보고서 닫기"
                onClick={() => setReportOpen(false)}
              >
                닫기 ×
              </button>
            </div>
            <p className="muted">
              {data?.runId} · 마지막 수신 {time(data?.capturedAt)} · 손실 표본{" "}
              {data?.dropped ?? 0}개
            </p>
            <p>
              비교는 같은 경로의 실제 표본으로 계산합니다. 요청 종류·외부
              공급자·캐시의 영향도 함께 보세요. 장애 전 표본이 없거나 여러
              장애가 겹친 경우 단일 원인을 단정하지 않습니다.
            </p>
            <label className="route-picker">
              비교 요청
              <select
                value={route}
                onChange={(event) => setRoute(event.target.value)}
              >
                <option value="GET /api/pulse">GET /api/pulse</option>
                {data?.comparisons
                  .filter((item) => item.route !== "GET /api/pulse")
                  .map((item) => (
                    <option key={item.route}>{item.route}</option>
                  ))}
              </select>
            </label>
            <ComparisonView data={data} route={route} />
            <div className="report-charts">
              {responseChart}
              <Plot
                title="서버 CPU의 변화"
                yLabel="% · 100 = 1코어"
                points={(data?.resources ?? []).slice(-180).map((item) => ({
                  x: Date.parse(item.at),
                  y: item.cpuPercent,
                  phase: item.phase,
                  label: `${time(item.at)} · ${number(item.cpuPercent)}%`,
                }))}
                transitions={data?.transitions}
              />
              <Plot
                title="서버 상주 메모리"
                yLabel="MiB"
                points={(data?.resources ?? []).slice(-180).map((item) => ({
                  x: Date.parse(item.at),
                  y: item.rssMiB,
                  phase: item.phase,
                  label: `${time(item.at)} · ${number(item.rssMiB)} MiB`,
                }))}
                transitions={data?.transitions}
              />
              <Plot
                title="동시 요청과 응답시간"
                yLabel="ms"
                xLabel="요청 시작 시 동시 요청 수"
                scatter
                points={selected.slice(-180).map((item) => ({
                  x: item.concurrent,
                  y: item.durationMs,
                  phase: item.phase,
                  failure: item.status === null || item.status >= 400,
                  label: `${item.concurrent}개 · ${number(item.durationMs)} ms · ${time(item.endedAt)}`,
                }))}
              />
            </div>
            <EvidenceChain data={data} route={route} />
            <ResourceComparison data={data} />
            <div className="report-columns">
              <section>
                <h3>브라우저에서 실제 발생한 이벤트</h3>
                <p className="muted">
                  서버 결과만으로 화면 손상을 추측하지 않습니다. JSON 해석과
                  이미지·스타일 로드 이벤트를 수집합니다.
                </p>
                <div className="event-list">
                  {data?.browserEvents
                    .slice(-20)
                    .reverse()
                    .map((item, index) => (
                      <article key={index}>
                        <small>
                          {time(item.at)} · {phaseLabels[item.phase]}
                        </small>
                        <b>
                          {item.kind} · {item.route}
                        </b>
                        <p>
                          {item.detail}{" "}
                          {item.durationMs !== null
                            ? `(${number(item.durationMs)} ms)`
                            : ""}
                        </p>
                      </article>
                    ))}
                </div>
              </section>
              <section>
                <h3>장애 변경 기록</h3>
                <div className="event-list">
                  {data?.transitions
                    .slice(-30)
                    .reverse()
                    .map((item, index) => (
                      <article key={index}>
                        <small>
                          {time(item.at)} · 구간 {item.segment}
                        </small>
                        <p>{item.reason}</p>
                        <small>활성: {item.faults.join(", ") || "없음"}</small>
                      </article>
                    ))}
                </div>
              </section>
            </div>
            <div className="report-actions">
              <button disabled={busy} onClick={() => exportReport("current")}>
                현재 관찰 엑셀 저장
              </button>
              <button disabled={busy} onClick={() => exportReport("session")}>
                서버 세션 전체 저장
              </button>
            </div>
            <p className="muted">
              엑셀: 경로별 비교 · 요청 원본 · 자원 원본 · 브라우저 관찰 · 장애
              전환 · 편집 가능한 차트. CPU는 서버 프로세스 기준이며, 차트는
              인과관계나 복원 합격을 자동 판정하지 않습니다.
            </p>
          </section>
        </div>
      )}
    </aside>
  );
}

function ComparisonView({
  data,
  route,
}: {
  data: Diagnostic | null;
  route: string;
}) {
  const comparison = data?.comparisons.find((item) => item.route === route);
  const baseline = comparison?.baseline;
  const active = comparison?.active;
  const recovery = comparison?.recovery;
  const failureDelta =
    baseline?.failurePercent != null && active?.failurePercent != null
      ? active.failurePercent - baseline.failurePercent
      : null;
  const delta =
    baseline?.meanMs !== null &&
    baseline?.meanMs !== undefined &&
    active?.meanMs !== null &&
    active?.meanMs !== undefined
      ? active.meanMs - baseline.meanMs
      : null;
  return (
    <section className="comparison">
      <p className="finding">
        {delta === null
          ? "주입 전과 주입 중에 같은 요청을 수집하면 변화폭을 비교할 수 있습니다."
          : `같은 요청의 평균 소요시간이 주입 전 ${number(baseline!.meanMs)} ms에서 주입 중 ${number(active!.meanMs)} ms로 바뀌었습니다. 차이는 ${delta >= 0 ? "+" : ""}${number(delta)} ms입니다.`}
      </p>
      {failureDelta !== null && (
        <p className="muted">
          실패 비율의 변화: {failureDelta >= 0 ? "+" : ""}
          {number(failureDelta)}%p.{" "}
          {baseline?.meanMs && delta !== null
            ? `응답시간 변화율: ${number((delta / baseline.meanMs) * 100)}%.`
            : ""}{" "}
          변화율은 실측 평균의 비교이며, 성능 합격선이 아닙니다.
        </p>
      )}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>구간</th>
              <th>표본</th>
              <th>평균 ms</th>
              <th>실패 %</th>
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
                <td>{number(comparison?.[phase].meanMs)}</td>
                <td>{number(comparison?.[phase].failurePercent)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="success-bars">
        {(["baseline", "active", "recovery"] as const).map((phase) => {
          const failure = comparison?.[phase].failurePercent;
          return (
            <div key={phase}>
              <span>{phaseLabels[phase]}</span>
              <div>
                <i
                  style={{
                    width:
                      failure === null || failure === undefined
                        ? "0%"
                        : `${100 - failure}%`,
                    background: phaseColors[phase],
                  }}
                />
              </div>
              <b>
                {failure === null || failure === undefined
                  ? "표본 없음"
                  : `${number(100 - failure)}%`}
              </b>
            </div>
          );
        })}
      </div>
      <small className="muted">
        막대: HTTP 2xx/3xx 완료 비율. JSON 해석 성공과 다릅니다. 전환 교차{" "}
        {comparison?.mixed.count ?? 0}건은 위 비교에서 제외. 주입 중 수치는 여러
        설정 구간을 합산합니다. 개별 장애의 차이는 상세 구간표에서 확인하세요.
      </small>
      <p className="recovery-note">
        {recovery?.count
          ? `해제 후 ${recovery.count}건에서 평균 ${number(recovery.meanMs)} ms, 실패 ${number(recovery.failurePercent)}%가 관측됐습니다. 주입 전 분포와 표본 수를 보고 복원을 판단하세요.`
          : "아직 해제 후 표본이 없습니다. 장애를 해제하고 같은 기능을 다시 사용하세요."}
      </p>
    </section>
  );
}

function EvidenceChain({
  data,
  route,
}: {
  data: Diagnostic | null;
  route: string;
}) {
  const requests =
    data?.requests.filter((item) => `${item.method} ${item.route}` === route) ??
    [];
  const ids = new Set(requests.map((item) => item.id));
  const events =
    data?.browserEvents.filter(
      (item) => item.requestId && ids.has(item.requestId),
    ) ?? [];
  const affected = [...new Set(requests.flatMap((item) => item.faults))];
  const failures = events.filter((item) =>
    ["request-error", "image-error", "style-error"].includes(item.kind),
  );
  return (
    <section className="evidence-chain">
      <h3>같은 요청으로 연결해 보는 내부와 화면</h3>
      <p className="muted">
        화면 상세는 최근 요청 600건·브라우저 이벤트 100건 중 선택한 경로입니다.
        단계별 집계와 엑셀 원본은 서버 보관 전체 표본을 사용합니다.
      </p>
      <div className="evidence-steps">
        <div>
          <span>01 / 주입 기록</span>
          <p>
            {affected.length
              ? affected
                  .map(
                    (key) =>
                      data?.catalog.find((item) => item.key === key)?.label ??
                      key,
                  )
                  .join(", ")
              : "이 요청의 시작 시점에 활성화된 장애가 없습니다."}
          </p>
        </div>
        <div>
          <span>02 / 서버 전송</span>
          <p>
            {requests.length}건 중 HTTP 오류{" "}
            {
              requests.filter(
                (item) => item.status !== null && item.status >= 400,
              ).length
            }
            건, 연결 종료{" "}
            {requests.filter((item) => item.status === null).length}건.
          </p>
        </div>
        <div>
          <span>03 / 브라우저 관찰</span>
          <p>
            요청 ID로 연결된 이벤트 {events.length}건 중 수신·해석·자원 로드
            실패 {failures.length}건.
          </p>
        </div>
      </div>
      <p className="muted">
        서버와 브라우저는 같은 요청 ID로 연결합니다. 성공 코드를 보내도 본문
        해석에 실패할 수 있습니다. 브라우저 기록이 없으면 화면 결과를 추정하지
        않습니다.
      </p>
      {affected.map((key) => (
        <p className="mechanism-note" key={key}>
          {data?.catalog.find((item) => item.key === key)?.mechanism}
        </p>
      ))}
      <p className="muted">
        위 설명은 주입 경로입니다. 여러 장애가 동시에 켜진 경우 앞 단계의 오류로
        뒤 단계가 실행되지 않을 수 있습니다. 다음 구간별 측정값으로 조합을
        구분하세요.
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>구간</th>
              <th>활성 장애</th>
              <th>표본</th>
              <th>평균 ms</th>
              <th>실패 %</th>
            </tr>
          </thead>
          <tbody>
            {data?.segments
              ?.filter((item) => item.route === route)
              .map((item) => (
                <tr key={`${item.segment}-${item.phase}`}>
                  <th>
                    {item.segment} · {phaseLabels[item.phase]}
                  </th>
                  <td>{item.faults.join(", ") || "없음"}</td>
                  <td>{item.count}</td>
                  <td>{number(item.meanMs)}</td>
                  <td>{number(item.failurePercent)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ResourceComparison({ data }: { data: Diagnostic | null }) {
  return (
    <section>
      <h3>서버 내부 변화 비교</h3>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>구간</th>
              <th>표본</th>
              <th>CPU 평균 %</th>
              <th>RSS 평균 MiB</th>
              <th>이벤트 루프 지연 ms</th>
            </tr>
          </thead>
          <tbody>
            {(["baseline", "active", "recovery"] as const).map((phase) => {
              const samples = data?.resourceComparisons?.find(
                (item) => item.phase === phase,
              );
              const mean = (
                field: "cpuPercent" | "rssMiB" | "eventLoopDelayMs",
              ) => samples?.[field] ?? null;
              return (
                <tr key={phase}>
                  <th>{phaseLabels[phase]}</th>
                  <td>{samples?.count ?? 0}</td>
                  <td>{number(mean("cpuPercent"))}</td>
                  <td>{number(mean("rssMiB"))}</td>
                  <td>{number(mean("eventLoopDelayMs"))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted">
        CPU는 한 코어 사용량 기준. 루프 지연은 1초 측정 타이머의 실제 초과
        시간입니다. 메모리 점유 해제는 운영체제의 즉시 회수를 의미하지 않습니다.
      </p>
    </section>
  );
}

import { number, time } from "./api";
import type { Phase } from "./types";
import { phaseColors } from "./phases";
type Point = {
  x: number;
  y: number;
  phase: Phase;
  label: string;
  failure?: boolean;
};

export function Plot({
  points,
  title,
  yLabel,
  scatter = false,
  xLabel = "시각",
  transitions = [],
}: {
  points: Point[];
  title: string;
  yLabel: string;
  scatter?: boolean;
  xLabel?: string;
  transitions?: { at: string; reason: string }[];
}) {
  const minX = points.length ? Math.min(...points.map((point) => point.x)) : 0;
  const maxX = points.length ? Math.max(...points.map((point) => point.x)) : 1;
  const maxY = Math.max(0.001, ...points.map((point) => point.y));
  const x = (value: number) => 46 + ((value - minX) / (maxX - minX || 1)) * 310;
  const y = (value: number) => 136 - (value / maxY) * 106;
  return (
    <figure className="plot">
      <figcaption>
        {title}
        <span>{yLabel}</span>
      </figcaption>
      {!points.length ? (
        <div className="chart-empty">아직 측정값이 없습니다.</div>
      ) : (
        <svg
          viewBox="0 0 380 170"
          role="img"
          aria-label={`${title}. 표본 ${points.length}개. 세로축 ${yLabel}, 가로축 ${xLabel}.`}
        >
          {[0, 0.5, 1].map((fraction) => (
            <g key={fraction}>
              <line
                x1="46"
                x2="356"
                y1={y(maxY * fraction)}
                y2={y(maxY * fraction)}
                className="gridline"
              />
              <text x="40" y={y(maxY * fraction) + 3} textAnchor="end">
                {number(maxY * fraction)}
              </text>
            </g>
          ))}
          {!scatter &&
            transitions
              .filter(
                (item) =>
                  Date.parse(item.at) >= minX && Date.parse(item.at) <= maxX,
              )
              .map((item, index) => (
                <line
                  key={index}
                  x1={x(Date.parse(item.at))}
                  x2={x(Date.parse(item.at))}
                  y1="26"
                  y2="136"
                  className="transition-line"
                >
                  <title>{item.reason}</title>
                </line>
              ))}
          {!scatter &&
            points
              .slice(1)
              .map((point, index) => (
                <line
                  key={index}
                  x1={x(points[index].x)}
                  y1={y(points[index].y)}
                  x2={x(point.x)}
                  y2={y(point.y)}
                  stroke={phaseColors[point.phase]}
                  strokeWidth="1.4"
                  opacity=".6"
                />
              ))}
          {points.map((point, index) => (
            <circle
              key={index}
              cx={x(point.x)}
              cy={y(point.y)}
              r={point.failure ? 4 : 2.7}
              fill={point.failure ? "#ff6975" : phaseColors[point.phase]}
            >
              <title>{point.label}</title>
            </circle>
          ))}
          <text x="46" y="158">
            {scatter ? number(minX) : time(new Date(minX).toISOString())}
          </text>
          <text x="356" y="158" textAnchor="end">
            {scatter ? number(maxX) : time(new Date(maxX).toISOString())}
          </text>
        </svg>
      )}
      <small>
        {xLabel} · 점에 마우스를 올리면 원본 값 · 빨강: HTTP 오류/연결 끊김
      </small>
    </figure>
  );
}

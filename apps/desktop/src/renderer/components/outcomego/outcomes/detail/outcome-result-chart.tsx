import { useEffect, useRef } from "react";
import type { OutcomeResultChart } from "@outcomego/contracts/outcomes";

const COLORS = ["#4379b8", "#328678", "#ae6a32", "#8967a8", "#bd6276", "#68755b", "#b08820", "#636b91"];

type ChartRange = { min: number; max: number };

function LinePlot({ points, range }: Pick<OutcomeResultChart, "points"> & { range: ChartRange }) {
  const { min, max } = range;
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!element || !context) return;
    const draw = () => {
      const ratio = window.devicePixelRatio || 1;
      const width = element.clientWidth;
      const height = 104;
      if (!width) return;
      element.width = width * ratio;
      element.height = height * ratio;
      context.scale(ratio, ratio);
      const coords = points.map(({ value }, index) => ({
        x: 6 + index * (width - 12) / (points.length - 1),
        y: min === max ? height / 2 : 6 + (max - value) / (max - min) * (height - 12),
      }));
      context.strokeStyle = COLORS[0]!;
      context.fillStyle = COLORS[0]!;
      context.lineWidth = 2;
      context.beginPath();
      for (const { x, y } of coords) context.lineTo(x, y);
      context.stroke();
      for (const { x, y } of coords) {
        context.beginPath();
        context.arc(x, y, 3, 0, 2 * Math.PI);
        context.fill();
      }
    };
    const observer = new ResizeObserver(draw);
    observer.observe(element);
    draw();
    return () => observer.disconnect();
  }, [points, min, max]);
  return <canvas ref={canvas} className="outcome-chart-line" aria-hidden="true" />;
}

export function OutcomeResultChartView({ chart }: { chart: OutcomeResultChart }) {
  const { title, type, unit, points } = chart;
  const isPercentage = unit.normalize("NFKC").trim() === "%";
  const formatter = new Intl.NumberFormat(undefined, { maximumSignificantDigits: 17 });
  const reading = (value: number) =>
    `${formatter.format(value)}${isPercentage ? "%" : unit ? ` ${unit}` : ""}`;
  const values = points.map((point) => point.value);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const min = isPercentage || type === "bar" ? Math.min(0, low) : low;
  const max = isPercentage ? Math.max(100, high) : type === "bar" ? Math.max(0, high) : high;
  const span = max - min;
  const total = type === "pie" ? values.reduce((sum, value) => sum + value, 0) : 0;
  let angle = 0;
  const slices = type === "pie" ? points.map(({ value }, index) => {
    const start = angle;
    angle += (value / total) * 360;
    return `${COLORS[index]} ${start}deg ${angle}deg`;
  }) : [];
  const rows = type === "heatmap" ? [...new Set(points.map((point) => point.row!))] : [];
  const columns = type === "heatmap" ? [...new Set(points.map((point) => point.label))] : [];
  return (
    <figure className="outcome-result-chart" data-chart-type={type}>
      <figcaption>{title}</figcaption>
      {type === "metric" && (
        <div className="outcome-chart-metric">
          <strong>{reading(points[0]!.value)}</strong>
          <span>{points[0]!.label}</span>
        </div>
      )}
      {type === "line" && (
        <div className="outcome-chart-trend">
          <div className="outcome-chart-scale">
            <span>{reading(max)}</span>
            {min !== max && <span>{reading(min)}</span>}
          </div>
          <LinePlot points={points} range={{ min, max }} />
        </div>
      )}
      {type === "pie" && (
        <div
          className="outcome-chart-pie"
          style={{ background: `conic-gradient(${slices.join(", ")})` }}
          aria-hidden="true"
        />
      )}
      {type === "heatmap" && (
        <div className="outcome-chart-table">
          <table aria-label={title}>
            <thead><tr><td />{columns.map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row}>
                  <th scope="row">{row}</th>
                  {columns.map((label) => {
                    const point = points.find((item) => item.row === row && item.label === label)!;
                    const intensity = span === 0 ? 15 : 8 + 28 * (point.value - min) / span;
                    return <td key={label} style={{ background: `color-mix(in srgb, ${COLORS[0]} ${intensity}%, transparent)` }}>{reading(point.value)}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(type === "bar" || type === "line" || type === "pie") && (
        <ul className="outcome-chart-values">
          {points.map(({ label, value }, index) => (
            <li key={label}>
              {type === "pie" && <span className="outcome-chart-key" style={{ background: COLORS[index] }} aria-hidden="true" />}
              <span>{label}</span>
              {type === "bar" && (
                <span className="outcome-chart-bar" aria-hidden="true">
                  <span
                    className="outcome-chart-bar-fill"
                    style={{
                      left: `${100 * (Math.min(0, value) - min) / (span || 1)}%`,
                      width: `${100 * Math.abs(value) / (span || 1)}%`,
                    }}
                  />
                </span>
              )}
              <strong>{reading(value)}</strong>
            </li>
          ))}
          {type === "bar" && (
            <li role="presentation">
              <div className="outcome-chart-scale">
                <span>{reading(min)}</span>
                {min !== max && <span>{reading(max)}</span>}
              </div>
            </li>
          )}
        </ul>
      )}
    </figure>
  );
}

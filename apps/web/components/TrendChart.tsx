/** Missing observations deliberately create gaps in the line. */
export function TrendChart({
  title,
  points,
  unit,
}: {
  title: string;
  points: Array<{ date: string; value: number | null }>;
  unit: string;
}) {
  const known = points.flatMap((point) =>
    point.value === null ? [] : [point.value],
  );
  if (!known.length)
    return (
      <p className="text-sm text-zinc-400">{title}: пока нет измерений.</p>
    );
  const min = Math.min(...known),
    max = Math.max(...known),
    span = max - min || 1;
  const x = (i: number) => 24 + (i * 552) / Math.max(1, points.length - 1);
  const y = (value: number) => 128 - ((value - min) / span) * 96;
  return (
    <figure className="min-w-0">
      <figcaption className="mb-3 text-sm font-medium text-zinc-200">
        {title} · {known.length} измерений
      </figcaption>
      <svg
        role="img"
        aria-label={`${title}; только измеренные дни; диапазон ${min}–${max} ${unit}`}
        viewBox="0 0 600 160"
        className="h-auto w-full rounded-lg bg-white/[0.02]"
      >
        <line
          x1="24"
          x2="576"
          y1="136"
          y2="136"
          stroke="currentColor"
          className="text-zinc-700"
        />
        {points.map((point, i) =>
          point.value === null ? null : (
            <g key={`${point.date}-${i}`}>
              {i > 0 && points[i - 1].value !== null ? (
                <line
                  x1={x(i - 1)}
                  y1={y(points[i - 1].value!)}
                  x2={x(i)}
                  y2={y(point.value)}
                  stroke="currentColor"
                  strokeWidth="2"
                  className="text-cyan-300"
                />
              ) : null}
              <circle
                cx={x(i)}
                cy={y(point.value)}
                r="4"
                fill="currentColor"
                className="text-cyan-200"
              >
                <title>
                  {point.date}: {point.value} {unit}
                </title>
              </circle>
              <text
                x={x(i)}
                y="151"
                textAnchor="middle"
                fontSize="10"
                fill="currentColor"
                className="text-zinc-400"
              >
                {point.date.slice(5)}
              </text>
            </g>
          ),
        )}
      </svg>
      <p className="mt-2 text-xs text-zinc-400">
        {min}–{max} {unit}. Пропуски остаются пустыми.
      </p>
    </figure>
  );
}

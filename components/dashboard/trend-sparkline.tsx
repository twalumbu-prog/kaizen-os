"use client";

import { Line, LineChart, ResponsiveContainer, Tooltip, YAxis } from "recharts";
import { statusForScore } from "@/convex/lib/scoring";
import { STATUS_COLOR_CLASSES } from "@/lib/status-colors";

export function TrendSparkline({
  data,
  height = 48,
}: {
  data: { periodLabel: string; score: number }[];
  height?: number;
}) {
  if (data.length < 2) {
    return <div style={{ height }} className="flex items-center text-xs text-muted-foreground">Not enough history yet</div>;
  }

  const latestScore = data[data.length - 1]?.score ?? 0;
  const stroke = STATUS_COLOR_CLASSES[statusForScore(latestScore).color].stroke;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
        <YAxis domain={[0, 100]} hide />
        <Tooltip
          formatter={(value) => [`${value}`, "Score"]}
          contentStyle={{ fontSize: 12, borderRadius: 8 }}
        />
        <Line
          type="monotone"
          dataKey="score"
          stroke={stroke}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

"use client";

import { Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, YAxis } from "recharts";

export function VarianceSparkline({
  data,
  height = 36,
}: {
  data: { periodLabel: string; variance: number }[];
  height?: number;
}) {
  if (data.length < 2) {
    return <div style={{ height }} className="flex items-center text-xs text-muted-foreground">Not enough history yet</div>;
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
        <YAxis domain={["auto", "auto"]} hide />
        <ReferenceLine y={0} stroke="#10b981" strokeDasharray="3 3" />
        <Tooltip
          formatter={(value) => [Number(value).toLocaleString("en-US", { minimumFractionDigits: 2 }), "Variance"]}
          labelFormatter={(_, payload) => payload?.[0]?.payload?.periodLabel ?? ""}
          contentStyle={{ fontSize: 12, borderRadius: 8 }}
        />
        <Line type="monotone" dataKey="variance" stroke="#f59e0b" strokeWidth={2} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

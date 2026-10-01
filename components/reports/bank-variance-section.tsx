"use client";

import { Activity, CheckCircle2, Scale } from "lucide-react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export type BankVariancePoint = {
  periodLabel: string;
  bankClosingBalance: number | null;
  ledgerClosingBalance: number | null;
  variance: number | null;
};

const money = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "-" : ""}${money(Math.abs(n))}`;

function shortLabel(label: string): string {
  const m = label.match(/(\d{4}-\d{2}-\d{2})$/);
  if (!m) return label;
  return new Date(`${m[1]}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Variance = QuickBooks (ledger) closing balance minus bank statement closing balance. */
export function BankVarianceSection({
  points,
  tolerance,
  currency = "ZMW",
}: {
  points: BankVariancePoint[];
  tolerance: number;
  currency?: string;
}) {
  const data = points
    .filter((p): p is BankVariancePoint & { variance: number } => p.variance !== null)
    .map((p) => ({ ...p, shortLabel: shortLabel(p.periodLabel) }));

  const latest = data.length > 0 ? data[data.length - 1] : null;
  const avgAbs = data.length > 0 ? data.reduce((s, p) => s + Math.abs(p.variance), 0) / data.length : 0;
  const matched = data.filter((p) => Math.abs(p.variance) <= tolerance).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Latest Variance</CardTitle>
            <Scale className="size-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div
              className={`text-2xl font-bold tracking-tight ${
                latest && Math.abs(latest.variance) > tolerance ? "text-red-600 dark:text-red-400" : ""
              }`}
            >
              {latest ? `${currency} ${signed(latest.variance)}` : "—"}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {latest
                ? `${latest.periodLabel}: QuickBooks ${latest.variance >= 0 ? "above" : "below"} the bank statement`
                : "No reconciled periods yet"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Average Absolute Variance</CardTitle>
            <Activity className="size-4 text-amber-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tracking-tight">
              {data.length > 0 ? `${currency} ${money(avgAbs)}` : "—"}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Average gap per period between bank and QuickBooks</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Periods Fully Reconciled</CardTitle>
            <CheckCircle2 className="size-4 text-emerald-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tracking-tight">
              {matched} <span className="text-base font-medium text-muted-foreground">of {data.length}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Closing balances within {currency} {money(tolerance)}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <div>
            <CardTitle className="text-base">Bank vs QuickBooks Variance</CardTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Closing balance deviation per period (QuickBooks minus bank statement); zero means fully reconciled
            </p>
          </div>
          <Badge variant="outline" className="border-amber-500/20 bg-amber-500/10 font-medium text-amber-700 dark:text-amber-400">
            Outcome: Variance
          </Badge>
        </CardHeader>
        <CardContent className="pt-4">
          {data.length < 2 ? (
            <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
              Not enough reconciled periods to plot the variance trend yet.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={data} margin={{ top: 10, right: 12, bottom: 0, left: 8 }}>
                <defs>
                  <linearGradient id="varianceGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
                <XAxis dataKey="shortLabel" tick={{ fontSize: 12 }} interval="preserveStartEnd" tickLine={false} />
                <YAxis
                  tick={{ fontSize: 12 }}
                  width={64}
                  tickFormatter={(v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : `${v}`)}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    const p = active ? (payload?.[0]?.payload as (typeof data)[number] | undefined) : undefined;
                    if (!p) return null;
                    return (
                      <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
                        <div className="mb-1 font-medium">{p.periodLabel}</div>
                        <div>
                          Variance: <span className="font-semibold">{currency} {signed(p.variance)}</span>
                        </div>
                        {p.ledgerClosingBalance !== null && (
                          <div className="text-muted-foreground">QuickBooks closing: {money(p.ledgerClosingBalance)}</div>
                        )}
                        {p.bankClosingBalance !== null && (
                          <div className="text-muted-foreground">Bank closing: {money(p.bankClosingBalance)}</div>
                        )}
                      </div>
                    );
                  }}
                />
                <ReferenceLine
                  y={0}
                  stroke="#10b981"
                  strokeDasharray="5 5"
                  label={{ value: "Reconciled", position: "insideTopRight", fontSize: 11, fill: "#10b981" }}
                />
                <Area
                  type="monotone"
                  dataKey="variance"
                  name="Variance"
                  stroke="#f59e0b"
                  strokeWidth={2.5}
                  fill="url(#varianceGradient)"
                  dot={{ r: 2.5 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

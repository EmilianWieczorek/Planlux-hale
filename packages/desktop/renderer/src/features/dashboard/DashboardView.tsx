/**
 * Dashboard – podsumowanie ofert, statystyki, wykresy.
 */

import { useState, useEffect } from "react";
import { Box, Typography, Card, CardContent } from "@mui/material";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { tokens } from "../../theme/tokens";

const STATUS_LABELS: Record<string, string> = {
  IN_PROGRESS: "W trakcie",
  GENERATED: "Wygenerowane",
  SENT: "Wysłane",
  REALIZED: "Zrealizowane",
};

const CHART_COLORS = [tokens.color.primary, tokens.color.navy, tokens.color.success, tokens.color.warning];

const styles = {
  card: {
    background: tokens.color.white,
    borderRadius: tokens.radius.lg,
    boxShadow: tokens.shadow.md,
    height: "100%",
  } as React.CSSProperties,
  statValue: {
    fontSize: tokens.font.size["2xl"],
    fontWeight: tokens.font.weight.bold,
    color: tokens.color.navy,
  } as React.CSSProperties,
  statLabel: {
    fontSize: tokens.font.size.sm,
    color: tokens.color.textMuted,
    marginTop: 4,
  } as React.CSSProperties,
};

interface Props {
  api: (channel: string, ...args: unknown[]) => Promise<unknown>;
  userId: string;
  isAdmin: boolean;
}

export function DashboardView({ api, userId, isAdmin }: Props) {
  const [stats, setStats] = useState<{
    byStatus: Record<string, number>;
    totalPln: number;
    perUser: Array<{ userId: string; displayName: string; email: string; count: number; totalPln: number }>;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const r = (await api("planlux:getDashboardStats")) as {
          ok: boolean;
          byStatus?: Record<string, number>;
          totalPln?: number;
          perUser?: Array<{ userId: string; displayName: string; email: string; count: number; totalPln: number }>;
        };
        if (cancelled) return;
        if (r.ok) {
          setStats({
            byStatus: r.byStatus ?? { IN_PROGRESS: 0, GENERATED: 0, SENT: 0, REALIZED: 0 },
            totalPln: r.totalPln ?? 0,
            perUser: r.perUser ?? [],
          });
        } else {
          setStats(null);
        }
      } catch {
        if (!cancelled) setStats(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [api, userId, isAdmin]);

  if (loading) {
    return (
      <Box>
        <Typography variant="h5" sx={{ mb: 2 }}>
          Dashboard
        </Typography>
        <Typography color="text.secondary">Ładowanie...</Typography>
      </Box>
    );
  }

  const byStatus = stats?.byStatus ?? { IN_PROGRESS: 0, GENERATED: 0, SENT: 0, REALIZED: 0 };
  const totalPln = stats?.totalPln ?? 0;
  const perUser = stats?.perUser ?? [];

  const statusChartData = Object.entries(byStatus).map(([k, v]) => ({
    name: STATUS_LABELS[k] ?? k,
    count: v,
  }));

  const userChartData = perUser.map((u) => ({
    name: u.displayName || u.email || u.userId.slice(0, 8),
    count: u.count,
    totalPln: u.totalPln,
  }));

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 3 }}>
        Dashboard
      </Typography>
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", md: "repeat(4, 1fr)" }, gap: 3 }}>
        <Card style={styles.card}>
          <CardContent>
            <Typography style={styles.statValue}>
              {Object.values(byStatus).reduce((a, b) => a + b, 0)}
            </Typography>
            <Typography style={styles.statLabel}>Wszystkie oferty</Typography>
          </CardContent>
        </Card>
        <Card style={styles.card}>
          <CardContent>
            <Typography style={styles.statValue}>
              {new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN", maximumFractionDigits: 0 }).format(totalPln)}
            </Typography>
            <Typography style={styles.statLabel}>Suma wartości</Typography>
          </CardContent>
        </Card>
        <Card style={styles.card}>
          <CardContent>
            <Typography style={styles.statValue}>{byStatus.REALIZED ?? 0}</Typography>
            <Typography style={styles.statLabel}>Zrealizowane</Typography>
          </CardContent>
        </Card>
        <Card style={styles.card}>
          <CardContent>
            <Typography style={styles.statValue}>{byStatus.IN_PROGRESS ?? 0}</Typography>
            <Typography style={styles.statLabel}>W trakcie</Typography>
          </CardContent>
        </Card>
      </Box>
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 3, mt: 3 }}>
        <Card style={styles.card}>
          <CardContent>
            <Typography variant="subtitle1" sx={{ mb: 2 }}>
              Oferty według statusu
            </Typography>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={statusChartData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={tokens.color.gray[200]} />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" fill={tokens.color.primary} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        {isAdmin && userChartData.length > 0 && (
          <Card style={styles.card}>
            <CardContent>
              <Typography variant="subtitle1" sx={{ mb: 2 }}>
                Oferty per handlowiec
              </Typography>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={userChartData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={tokens.color.gray[200]} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                  <Tooltip
                    formatter={(value: number, _name: string, props: { payload?: { totalPln?: number } }) => {
                      const pln = props?.payload?.totalPln;
                      const suffix = pln != null ? ` (${new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN", maximumFractionDigits: 0 }).format(pln)})` : "";
                      return `${value} ofert${suffix}`;
                    }}
                  />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {userChartData.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}
      </Box>
    </Box>
  );
}

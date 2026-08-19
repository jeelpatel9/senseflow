import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { subDays, format } from "date-fns";
import { Users, UserCheck, Droplets, Activity, BarChart3 } from "lucide-react";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { DashboardLayout } from "@/components/DashboardLayout";
import { StatsCard } from "@/components/StatsCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useSession, useMyProfile } from "@/hooks/use-session";
import { ADMIN_NAV } from "@/lib/nav";
import { getAdminDashboardStats } from "@/lib/meter.functions";

export const Route = createFileRoute("/_authenticated/admin/")({
  component: AdminDashboard,
});

const ALL = "__all__";

type DashboardConsumerRow = {
  id: string;
  name: string;
  locationId: string | null;
  block: string;
  device: string;
};

function AdminDashboard() {
  const { user } = useSession();
  const { data: profile } = useMyProfile(user);
  const getLiveStats = useServerFn(getAdminDashboardStats);
  const [preset, setPreset] = useState<7 | 15 | 30 | 0>(7);
  const [start, setStart] = useState<string>(format(subDays(new Date(), 7), "yyyy-MM-dd"));
  const [end, setEnd] = useState<string>(format(new Date(), "yyyy-MM-dd"));
  const [locId, setLocId] = useState<string>(ALL);
  const [userId, setUserId] = useState<string>(ALL);
  const [topLimit, setTopLimit] = useState<number>(10);

  const setRange = (d: 7 | 15 | 30) => {
    setPreset(d);
    setStart(format(subDays(new Date(), d), "yyyy-MM-dd"));
    setEnd(format(new Date(), "yyyy-MM-dd"));
  };

  const locs = useQuery({
    queryKey: ["all-locations"],
    queryFn: async () => (await supabase.from("locations").select("id, name, code").order("name")).data || [],
  });

  const consumers = useQuery({
    queryKey: ["admin-dashboard-consumers"],
    queryFn: async () => {
      const { data: roles, error: roleError } = await supabase.from("user_roles").select("user_id").eq("role", "consumer");
      if (roleError) throw roleError;
      const ids = (roles || []).map((r) => r.user_id);
      if (!ids.length) return [] as DashboardConsumerRow[];
      const [{ data: profiles, error: profileError }, { data: details, error: detailsError }] = await Promise.all([
        supabase.from("profiles").select("id, full_name, phone, is_active").in("id", ids),
        supabase.from("consumer_details").select("user_id, device_id, block_id, location_id").in("user_id", ids).not("device_id", "is", null),
      ]);
      if (profileError) throw profileError;
      if (detailsError) throw detailsError;
      const pMap = new Map((profiles || []).map((p) => [p.id, p]));
      const byKey = new Map<string, DashboardConsumerRow>();
      (details || []).forEach((d) => {
        const p = pMap.get(d.user_id);
        if (!p || p.is_active === false || !d.device_id || d.device_id === "USFL_FL7053" || d.block_id === "00") return;
        const key = `${d.device_id}|${d.block_id ?? ""}`;
        if (!byKey.has(key)) {
          byKey.set(key, {
            id: d.user_id,
            name: `${d.block_id ? `${d.block_id} · ` : ""}${p.full_name || p.phone || d.device_id}`,
            locationId: d.location_id,
            block: d.block_id || "",
            device: d.device_id,
          });
        }
      });
      return Array.from(byKey.values())
        .sort((a, b) => a.block.localeCompare(b.block, undefined, { numeric: true }) || a.name.localeCompare(b.name));
    },
  });

  const secretaries = useQuery({
    queryKey: ["admin-dashboard-secretaries", locId],
    queryFn: async () => {
      const { data: roles, error } = await supabase.from("user_roles").select("user_id").eq("role", "secretary");
      if (error) throw error;
      const ids = Array.from(new Set((roles || []).map((r) => r.user_id)));
      if (locId === ALL || !ids.length) return ids.length;
      const { data: assigned, error: assignedError } = await supabase
        .from("secretary_locations")
        .select("secretary_id")
        .eq("location_id", locId);
      if (assignedError) throw assignedError;
      return new Set((assigned || []).map((s) => s.secretary_id)).size;
    },
  });

  const localReadings = useQuery({
    queryKey: ["admin-dashboard-local-readings", start, end, locId, userId, topLimit, consumers.data?.map((c) => c.id).join(",")],
    queryFn: async () => {
      const filtered = (consumers.data || []).filter((c) =>
        (locId === ALL || c.locationId === locId) && (userId === ALL || c.id === userId),
      );
      const ids = filtered.map((c) => c.id);
      if (!ids.length) return { trend: [], leaders: [], totalConsumptionL: 0, flowRate: 0 };
      const { data, error } = await supabase
        .from("meter_readings")
        .select("consumer_id, consumption, reading_date, flow_rate")
        .in("consumer_id", ids)
        .gte("reading_date", `${start}T00:00:00`)
        .lte("reading_date", `${end}T23:59:59`)
        .order("reading_date", { ascending: true });
      if (error) throw error;
      const byId = new Map(filtered.map((c) => [c.id, c]));
      const byDay = new Map<string, number>();
      const byUser = new Map<string, number>();
      let flowRate = 0;
      for (const row of data || []) {
        const day = String(row.reading_date).slice(0, 10);
        const litres = Math.max(0, Number(row.consumption || 0)) * 1000;
        byDay.set(day, (byDay.get(day) || 0) + litres);
        byUser.set(row.consumer_id, (byUser.get(row.consumer_id) || 0) + litres);
        if (row.flow_rate != null) flowRate = Number(row.flow_rate) || flowRate;
      }
      const trend = Array.from(byDay.entries()).map(([date, consumption]) => ({ date, consumption: Math.round(consumption) }));
      const leaders = Array.from(byUser.entries())
        .map(([id, consumption]) => {
          const c = byId.get(id);
          return { id, name: c ? `${c.block} · ${c.name.replace(/^\d+ · /, "")}` : id, device_id: c?.device || "", consumption: Math.round(consumption) };
        })
        .sort((a, b) => b.consumption - a.consumption)
        .slice(0, topLimit);
      return {
        trend,
        leaders,
        totalConsumptionL: Math.round(Array.from(byDay.values()).reduce((sum, v) => sum + v, 0)),
        flowRate,
      };
    },
    enabled: !!consumers.data,
  });

  const liveStats = useQuery({
    queryKey: ["admin-dashboard-live-stats", start, end, locId, userId, topLimit],
    queryFn: () => getLiveStats({
      data: {
        start,
        end,
        locationId: locId === ALL ? null : locId,
        userId: userId === ALL ? null : userId,
        topLimit,
      },
    }),
    retry: false,
    staleTime: 60_000,
  });

  const usersForDropdown = useMemo(() => {
    return (consumers.data || []).filter((c) => locId === ALL || c.locationId === locId);
  }, [consumers.data, locId]);

  const filteredConsumers = (consumers.data || []).filter((c) =>
    (locId === ALL || c.locationId === locId) && (userId === ALL || c.id === userId),
  );
  const live = liveStats.data;
  const liveTrend = live?.trend ?? [];
  const liveLeaders = live?.leaders ?? [];
  const s = {
    consumers: filteredConsumers.length,
    secretaries: secretaries.data ?? 0,
    mainMeter: live?.mainMeter ?? { todaysUsageL: 0, thisMonthL: 0, totalUsageL: 0 },
    flowRate: live?.flowRate ?? localReadings.data?.flowRate ?? 0,
    totalConsumptionL: live?.totalConsumptionL ?? localReadings.data?.totalConsumptionL ?? 0,
    trend: liveTrend.length ? liveTrend : (localReadings.data?.trend ?? []),
    leaders: liveLeaders.length ? liveLeaders : (localReadings.data?.leaders ?? []),
  };
  const trend = (s?.trend || []).map((t) => ({ date: format(new Date(t.date), "MMM d"), consumption: t.consumption }));
  const leaders = s?.leaders || [];
  const fmtL = (n: number) => `${n.toLocaleString("en-IN")} L`;

  return (
    <DashboardLayout
      navItems={ADMIN_NAV}
      title="Admin dashboard"
      userName={profile?.full_name || null}
      userPhone={profile?.phone || null}
    >
      {/* Main Meter Overview */}
      <Card className="border-primary/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" /> Main Meter Overview
          </CardTitle>
          <p className="text-sm text-muted-foreground">Live values from Senseflow (USFL_FL7053)</p>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border bg-blue-50/60 dark:bg-blue-950/20 p-4">
              <p className="text-xs text-muted-foreground">Today's Usage</p>
              <p className="text-2xl font-bold text-blue-700 dark:text-blue-300">{s ? fmtL(s.mainMeter.todaysUsageL) : "—"}</p>
            </div>
            <div className="rounded-lg border bg-emerald-50/60 dark:bg-emerald-950/20 p-4">
              <p className="text-xs text-muted-foreground">This Month</p>
              <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-300">{s ? fmtL(s.mainMeter.thisMonthL) : "—"}</p>
            </div>
            <div className="rounded-lg border bg-purple-50/60 dark:bg-purple-950/20 p-4">
              <p className="text-xs text-muted-foreground">Total Usage</p>
              <p className="text-2xl font-bold text-purple-700 dark:text-purple-300">{s ? fmtL(s.mainMeter.totalUsageL) : "—"}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="mt-6">
        <h2 className="text-xl font-bold">Water Analytics Overview</h2>
        <p className="text-sm text-muted-foreground">Monitor consumption, flow rate and user activity</p>
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-2">
        {([7, 15, 30] as const).map((d) => (
          <Button key={d} size="sm" variant={preset === d ? "default" : "outline"} onClick={() => setRange(d)}>Last {d} days</Button>
        ))}
        <Input type="date" value={start} onChange={(e) => { setPreset(0); setStart(e.target.value); }} className="w-40" />
        <span className="text-muted-foreground text-sm">to</span>
        <Input type="date" value={end} onChange={(e) => { setPreset(0); setEnd(e.target.value); }} className="w-40" />
        <Select value={locId} onValueChange={(v) => { setLocId(v); setUserId(ALL); }}>
          <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All locations</SelectItem>
            {(locs.data || []).map((l) => <SelectItem key={l.id} value={l.id}>{l.name} ({l.code})</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={userId} onValueChange={setUserId}>
          <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All users</SelectItem>
            {usersForDropdown.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={String(topLimit)} onValueChange={(v) => setTopLimit(Number(v))}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            {[5, 10, 20].map((n) => <SelectItem key={n} value={String(n)}>Top {n}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="lg:col-span-2 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatsCard label="Consumers" value={s?.consumers ?? "—"} icon={Users} />
          <StatsCard label="Secretaries" value={s?.secretaries ?? "—"} icon={UserCheck} tone="success" />
          <StatsCard label="Flow Rate (L/s)" value={s ? s.flowRate.toFixed(2) : "—"} icon={Activity} tone="warning" />
          <StatsCard label="Total Consumption" value={s ? fmtL(s.totalConsumptionL) : "—"} icon={Droplets} />
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Water Consumption Trend</CardTitle>
            <p className="text-xs text-muted-foreground">Aggregated daily usage (litres) across sub-meters</p>
          </CardHeader>
          <CardContent className="h-72">
            {trend.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" fontSize={10} />
                  <YAxis fontSize={10} domain={[0, "auto"]} />
                  <Tooltip />
                  <Line type="monotone" dataKey="consumption" stroke="var(--primary)" />
                </LineChart>
              </ResponsiveContainer>
            ) : <p className="text-sm text-muted-foreground">{liveStats.isLoading || localReadings.isLoading ? "Loading readings…" : "No consumption in range."}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><BarChart3 className="h-4 w-4" /> Top consumers</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            {leaders.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={leaders} layout="vertical" margin={{ left: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" fontSize={10} domain={[0, "auto"]} />
                  <YAxis type="category" dataKey="name" fontSize={10} width={110} />
                  <Tooltip />
                  <Bar dataKey="consumption" fill="var(--primary)" />
                </BarChart>
              </ResponsiveContainer>
            ) : <p className="text-sm text-muted-foreground">No data.</p>}
          </CardContent>
        </Card>
      </div>

      {leaders.length > 0 && (
        <Card className="mt-4">
          <CardHeader><CardTitle>Leaderboard</CardTitle></CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                <tr><th className="px-4 py-3">#</th><th className="px-4 py-3">Consumer</th><th className="px-4 py-3">Consumption</th><th className="px-4 py-3 text-right"></th></tr>
              </thead>
              <tbody className="divide-y">
                {leaders.map((l, i) => (
                  <tr key={l.id}>
                    <td className="px-4 py-2 text-muted-foreground">{i + 1}</td>
                    <td className="px-4 py-2 font-medium">{l.name}</td>
                    <td className="px-4 py-2">{l.consumption.toLocaleString("en-IN")} L</td>
                    <td className="px-4 py-2 text-right"><Link to="/admin/consumers/$id" params={{ id: l.id }}><Button size="sm" variant="ghost">View</Button></Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </DashboardLayout>
  );
}
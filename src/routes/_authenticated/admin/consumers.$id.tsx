import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { subDays, format, startOfDay } from "date-fns";
import { ArrowLeft, RefreshCw, Loader2, Gauge, Droplets, Activity } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from "recharts";
import { DashboardLayout } from "@/components/DashboardLayout";
import { StatsCard } from "@/components/StatsCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useSession, useMyProfile } from "@/hooks/use-session";
import { fetchAndStoreLatestReading } from "@/lib/meter.functions";
import { ADMIN_NAV } from "@/lib/nav";

export const Route = createFileRoute("/_authenticated/admin/consumers/$id")({
  component: ConsumerAnalysis,
});

function ConsumerAnalysis() {
  const { id } = Route.useParams();
  const { user } = useSession();
  const { data: profile } = useMyProfile(user);
  const qc = useQueryClient();
  const [preset, setPreset] = useState<7 | 15 | 30 | 0>(7);
  const [start, setStart] = useState<string>(format(subDays(new Date(), 7), "yyyy-MM-dd"));
  const [end, setEnd] = useState<string>(format(new Date(), "yyyy-MM-dd"));

  const setRange = (days: 7 | 15 | 30) => {
    setPreset(days);
    setStart(format(subDays(new Date(), days), "yyyy-MM-dd"));
    setEnd(format(new Date(), "yyyy-MM-dd"));
  };

  const consumer = useQuery({
    queryKey: ["admin-consumer", id],
    queryFn: async () => {
      const { data: profileData, error } = await supabase
        .from("profiles")
        .select("id, full_name, phone, email, is_active")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      if (!profileData) return null;
      const { data: details, error: detailsError } = await supabase
        .from("consumer_details")
        .select("meter_id, serial_number, device_id, block_id, location_id")
        .eq("user_id", id)
        .maybeSingle();
      if (detailsError) throw detailsError;
      let location: { name: string; code: string } | null = null;
      if (details?.location_id) {
        const { data: loc, error: locError } = await supabase
          .from("locations")
          .select("name, code")
          .eq("id", details.location_id)
          .maybeSingle();
        if (locError) throw locError;
        location = loc;
      }
      return {
        ...profileData,
        consumer_details: details ? { ...details, locations: location } : null,
      } as any;
    },
  });

  const readings = useQuery({
    queryKey: ["admin-consumer-readings", id, start, end],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meter_readings")
        .select("id, reading, consumption, reading_date, flow_rate, rssi, source")
        .eq("consumer_id", id)
        .gte("reading_date", start)
        .lte("reading_date", `${end}T23:59:59.999Z`)
        .order("reading_date", { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });

  const refreshMut = useMutation({
    mutationFn: async () => fetchAndStoreLatestReading({ data: { consumerId: id } }),
    onSuccess: (r) => {
      toast.success(r.skipped ? "Already up to date." : "Latest reading pulled.");
      qc.invalidateQueries({ queryKey: ["admin-consumer-readings", id] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const cd = consumer.data?.consumer_details;
  const latest = readings.data?.[readings.data.length - 1];
  const totalConsumption = (readings.data || []).reduce((s, r) => s + Math.max(0, Number(r.consumption || 0)), 0);
  const dailyMap = new Map<string, number>();
  (readings.data || []).forEach((r) => {
    const day = format(startOfDay(new Date(r.reading_date)), "yyyy-MM-dd");
    dailyMap.set(day, (dailyMap.get(day) || 0) + Math.max(0, Number(r.consumption || 0)));
  });
  const dailyData = Array.from(dailyMap.entries()).map(([date, consumption]) => ({
    date: format(new Date(date), "MMM d"), consumption: Number(consumption.toFixed(2)),
  }));
  const lineData = (readings.data || []).map((r) => ({
    time: format(new Date(r.reading_date), "MMM d HH:mm"),
    reading: Number(r.reading),
  }));

  return (
    <DashboardLayout navItems={ADMIN_NAV} title="Consumer analysis" userName={profile?.full_name || null} userPhone={profile?.phone || null}>
      <div className="mb-4 flex items-center gap-2">
        <Link to="/admin/consumers"><Button variant="ghost" size="sm"><ArrowLeft className="mr-1 h-4 w-4" /> Back</Button></Link>
        <Button size="sm" variant="outline" onClick={() => refreshMut.mutate()} disabled={refreshMut.isPending || !cd?.device_id}>
          {refreshMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Fetch latest
        </Button>
      </div>

      <Card className="mb-4">
        <CardContent className="p-4">
          <div className="grid gap-3 md:grid-cols-4">
            <div><div className="text-xs text-muted-foreground">Name</div><div className="font-medium">{consumer.data?.full_name || "—"}</div></div>
            <div><div className="text-xs text-muted-foreground">Phone</div><div className="font-medium">{consumer.data?.phone || "—"}</div></div>
            <div><div className="text-xs text-muted-foreground">Block</div><div className="font-mono text-sm">{cd?.block_id || "—"}</div></div>
            <div><div className="text-xs text-muted-foreground">Location</div><div className="text-sm">{cd?.locations?.name || "—"}</div></div>
            <div><div className="text-xs text-muted-foreground">Meter ID</div><div className="font-mono text-sm">{cd?.meter_id || "—"}</div></div>
            <div><div className="text-xs text-muted-foreground">Serial</div><div className="font-mono text-sm">{cd?.serial_number || "—"}</div></div>
            <div><div className="text-xs text-muted-foreground">Device ID</div><div className="font-mono text-sm">{cd?.device_id || "—"}</div></div>
          </div>
        </CardContent>
      </Card>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {([7, 15, 30] as const).map((d) => (
          <Button key={d} size="sm" variant={preset === d ? "default" : "outline"} onClick={() => setRange(d)}>Last {d} days</Button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <Input type="date" value={start} onChange={(e) => { setPreset(0); setStart(e.target.value); }} className="w-40" />
          <span className="text-muted-foreground">to</span>
          <Input type="date" value={end} onChange={(e) => { setPreset(0); setEnd(e.target.value); }} className="w-40" />
        </div>
      </div>

      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <StatsCard label="Latest reading" value={latest ? `${Number(latest.reading).toLocaleString("en-IN")} L` : "—"} hint={latest ? format(new Date(latest.reading_date), "PPp") : undefined} icon={Gauge} />
        <StatsCard label="Consumption (range)" value={`${totalConsumption.toLocaleString("en-IN")} L`} icon={Droplets} tone="success" />
        <StatsCard label="Data points" value={readings.data?.length ?? 0} icon={Activity} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Meter reading over time</CardTitle></CardHeader>
          <CardContent className="h-72">
            {lineData.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={lineData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="time" fontSize={10} />
                  <YAxis fontSize={10} domain={[0, "auto"]} />
                  <Tooltip />
                  <Line type="monotone" dataKey="reading" stroke="var(--primary)" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : <p className="text-sm text-muted-foreground">No readings in range.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Daily consumption</CardTitle></CardHeader>
          <CardContent className="h-72">
            {dailyData.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dailyData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" fontSize={10} />
                  <YAxis fontSize={10} domain={[0, "auto"]} />
                  <Tooltip />
                  <Bar dataKey="consumption" fill="var(--primary)" />
                </BarChart>
              </ResponsiveContainer>
            ) : <p className="text-sm text-muted-foreground">No consumption data.</p>}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
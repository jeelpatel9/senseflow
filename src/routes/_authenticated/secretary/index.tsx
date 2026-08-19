import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { subDays, format } from "date-fns";
import { toast } from "sonner";
import {
  Users, Droplets, TrendingUp, FileText, IndianRupee, BarChart3, Plus, Wallet,
} from "lucide-react";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, LabelList,
} from "recharts";
import { DashboardLayout } from "@/components/DashboardLayout";
import { StatsCard } from "@/components/StatsCard";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useSession, useMyProfile } from "@/hooks/use-session";
import { SECRETARY_NAV } from "@/lib/nav";
import { addCashBalance } from "@/lib/prepaid.functions";
import { getSecretaryDashboardStats } from "@/lib/meter.functions";

export const Route = createFileRoute("/_authenticated/secretary/")({
  component: SecretaryDashboard,
});

type Consumer = {
  user_id: string;
  meter_id: string | null;
  device_id: string | null;
  serial_number: string | null;
  block_id: string | null;
  location_id: string | null;
  full_name: string | null;
  phone: string | null;
  email: string | null;
};

function formatName(c: { block_id: string | null; full_name: string | null; phone: string | null }) {
  const name = c.full_name || c.phone || "—";
  return c.block_id ? `${c.block_id}-${name}` : name;
}

function formatLiters(v: number) {
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(2) + " ML";
  if (v >= 1000) return (v / 1000).toFixed(2) + "K L";
  return v.toFixed(0) + " L";
}

function SecretaryDashboard() {
  const { user } = useSession();
  const { data: profile } = useMyProfile(user);
  const qc = useQueryClient();

  const [selectedUser, setSelectedUser] = useState<string>("all");
  const [preset, setPreset] = useState<7 | 15 | 30 | 0>(7);
  const [start, setStart] = useState<string>(format(subDays(new Date(), 7), "yyyy-MM-dd"));
  const [end, setEnd] = useState<string>(format(new Date(), "yyyy-MM-dd"));

  const setRange = (d: 7 | 15 | 30) => {
    setPreset(d);
    setStart(format(subDays(new Date(), d), "yyyy-MM-dd"));
    setEnd(format(new Date(), "yyyy-MM-dd"));
  };

  // Assigned location + consumers + live Senseflow usage for range
  const scope = useQuery({
    queryKey: ["secretary-scope", user?.id ?? "no-auth", selectedUser, start, end],
    enabled: !!user,
    queryFn: async () => {
      const res = await getSecretaryDashboardStats({
        data: {
          secretaryId: user!.id,
          start,
          end,
          userId: selectedUser === "all" ? null : selectedUser,
        },
      });
      const consumers: Consumer[] = (res.consumers ?? []).map((c: any) => ({
        user_id: c.user_id,
        meter_id: null,
        device_id: c.device_id ?? null,
        serial_number: c.serial_number ?? null,
        block_id: c.block_id ?? null,
        location_id: c.location_id ?? null,
        full_name: c.full_name ?? null,
        phone: c.phone ?? null,
        email: c.email ?? null,
      }));
      return {
        locationId: res.locationId,
        locationName: res.locationName,
        consumers,
        usageByConsumer: res.usageByConsumer as Record<string, number>,
        trend: res.trend as Array<{ date: string; consumption: number }>,
        totalUsageL: res.totalUsageL,
      };
    },
  });

  const consumers = scope.data?.consumers ?? [];
  const consumerIds = useMemo(() => consumers.map((c) => c.user_id), [consumers]);

  // Invoices for assigned consumers (all-time)
  const invoicesQ = useQuery({
    queryKey: ["secretary-invoices", consumerIds.join(",")],
    enabled: consumerIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("invoices").select("id, consumer_id, status, total_amount, consumption")
        .in("consumer_id", consumerIds);
      return data || [];
    },
  });

  // Prepaid balances for assigned consumers
  const balancesQ = useQuery({
    queryKey: ["secretary-balances", consumerIds.join(",")],
    enabled: consumerIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("prepaid_balances").select("consumer_id, balance").in("consumer_id", consumerIds);
      return data || [];
    },
  });

  const invoices = invoicesQ.data || [];

  const pendingInvoices = invoices.filter((i) => i.status === "pending").length;
  const totalOutstanding = invoices
    .filter((i) => i.status !== "paid")
    .reduce((s, i) => s + Number(i.total_amount || 0), 0);

  const totalUsage = scope.data?.totalUsageL ?? 0;
  const avgUsagePerUser = consumers.length ? totalUsage / consumers.length : 0;

  // Daily consumption chart (liters, from live Senseflow history)
  const byDay = useMemo(() => {
    return (scope.data?.trend ?? []).map((t) => ({
      date: format(new Date(t.date), "dd/MM"),
      consumption: t.consumption,
    }));
  }, [scope.data?.trend]);

  // Per-consumer totals in range (from live Senseflow history)
  const usageByConsumer = useMemo(() => {
    const m = new Map<string, number>();
    const src = scope.data?.usageByConsumer ?? {};
    Object.entries(src).forEach(([k, v]) => m.set(k, Number(v || 0)));
    return m;
  }, [scope.data?.usageByConsumer]);

  const top5 = useMemo(() => {
    return consumers
      .map((c) => ({ name: formatName(c), usage: Number((usageByConsumer.get(c.user_id) || 0).toFixed(2)) }))
      .filter((x) => x.usage > 0)
      .sort((a, b) => b.usage - a.usage)
      .slice(0, 5);
  }, [consumers, usageByConsumer]);

  // Table sorting
  const [sortColumn, setSortColumn] = useState<"name" | "meter" | "serial" | "usage">("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const toggleSort = (col: typeof sortColumn) => {
    if (sortColumn === col) setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    else { setSortColumn(col); setSortDirection("asc"); }
  };
  const sortedConsumers = useMemo(() => {
    const arr = [...consumers];
    const dir = sortDirection === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      let va: string | number = "", vb: string | number = "";
      if (sortColumn === "name") { va = formatName(a).toLowerCase(); vb = formatName(b).toLowerCase(); }
      else if (sortColumn === "meter") { va = (a.meter_id || a.device_id || "").toLowerCase(); vb = (b.meter_id || b.device_id || "").toLowerCase(); }
      else if (sortColumn === "serial") { va = (a.serial_number || "").toLowerCase(); vb = (b.serial_number || "").toLowerCase(); }
      else if (sortColumn === "usage") { va = usageByConsumer.get(a.user_id) || 0; vb = usageByConsumer.get(b.user_id) || 0; }
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
    return arr;
  }, [consumers, sortColumn, sortDirection, usageByConsumer]);

  // Add cash dialog
  const [cashOpen, setCashOpen] = useState(false);
  const [cashConsumer, setCashConsumer] = useState<Consumer | null>(null);
  const [cashAmount, setCashAmount] = useState("");
  const openCash = (c: Consumer) => { setCashConsumer(c); setCashAmount(""); setCashOpen(true); };
  const getBalance = (id: string) => Number(balancesQ.data?.find((b) => b.consumer_id === id)?.balance || 0);

  const cashMut = useMutation({
    mutationFn: async () => {
      if (!cashConsumer) throw new Error("No consumer selected");
      const amt = parseFloat(cashAmount);
      if (!Number.isFinite(amt) || amt <= 0) throw new Error("Enter a valid amount.");
      return addCashBalance({ data: { consumerId: cashConsumer.user_id, amount: amt } });
    },
    onSuccess: (r) => {
      toast.success(`Balance added. New balance: ₹${r.balance.toFixed(2)}`);
      qc.invalidateQueries({ queryKey: ["secretary-balances"] });
      setCashOpen(false);
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed to add balance."),
  });

  const arrow = (col: typeof sortColumn) => sortColumn === col ? (sortDirection === "asc" ? "↑" : "↓") : "";

  return (
    <DashboardLayout
      navItems={SECRETARY_NAV}
      title="Secretary dashboard"
      userName={profile?.full_name || null}
      userPhone={profile?.phone || null}
    >
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">
            Welcome, {profile?.full_name || "Secretary"}
            {scope.data?.locationName ? ` — ${scope.data.locationName}` : ""}
          </h1>
          <p className="text-sm text-muted-foreground">
            Manage your assigned consumers and monitor water usage.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <StatsCard label="Assigned consumers" value={consumers.length} icon={Users} />
          <StatsCard label="Total usage (filtered)" value={formatLiters(totalUsage)} icon={Droplets} />
          <StatsCard label="Avg usage / user" value={formatLiters(avgUsagePerUser)} icon={TrendingUp} />
          <StatsCard label="Pending invoices" value={pendingInvoices} icon={FileText} tone="warning" />
          <StatsCard label="Outstanding" value={`₹${totalOutstanding.toLocaleString("en-IN")}`} icon={IndianRupee} tone="danger" />
        </div>

        <Card>
          <CardContent className="p-4 grid gap-4 md:grid-cols-3">
            <div>
              <Label className="mb-1 block">User</Label>
              <Select value={selectedUser} onValueChange={setSelectedUser}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All users</SelectItem>
                  {consumers.map((c) => (
                    <SelectItem key={c.user_id} value={c.user_id}>{formatName(c)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2">
              <Label className="mb-1 block">Date range</Label>
              <div className="flex flex-wrap items-center gap-2">
                {([7, 15, 30] as const).map((d) => (
                  <Button key={d} size="sm" variant={preset === d ? "default" : "outline"} onClick={() => setRange(d)}>
                    Last {d} days
                  </Button>
                ))}
                <Input type="date" value={start} className="w-40" onChange={(e) => { setPreset(0); setStart(e.target.value); }} />
                <span className="text-muted-foreground text-sm">to</span>
                <Input type="date" value={end} className="w-40" onChange={(e) => { setPreset(0); setEnd(e.target.value); }} />
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Water consumption trend</CardTitle>
              <CardDescription>Based on selected user & date range</CardDescription>
            </CardHeader>
            <CardContent className="h-72">
              {scope.isLoading ? (
                <div className="flex h-full items-center justify-center text-muted-foreground">Loading…</div>
              ) : byDay.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={byDay}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="date" fontSize={11} />
                    <YAxis fontSize={11} domain={[0, "auto"]} />
                    <Tooltip />
                    <Line type="monotone" dataKey="consumption" stroke="var(--primary)" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-muted-foreground">No data in range.</div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><BarChart3 className="h-4 w-4" /> Top 5 users by usage</CardTitle>
              <CardDescription>Water consumption comparison (Liters)</CardDescription>
            </CardHeader>
            <CardContent className="h-72">
              {top5.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={top5} layout="vertical" margin={{ left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis type="number" fontSize={11} domain={[0, "auto"]} />
                    <YAxis type="category" dataKey="name" width={130} fontSize={11}
                           tickFormatter={(v: string) => v.length > 14 ? v.slice(0, 14) + "…" : v} />
                    <Tooltip formatter={(v: number) => [`${v.toLocaleString()} L`, "Usage"]} />
                    <Bar dataKey="usage" fill="var(--primary)" radius={[0, 6, 6, 0]}>
                      <LabelList dataKey="usage" position="insideRight" style={{ fill: "#fff", fontSize: 11, fontWeight: 600 }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-muted-foreground">No usage data.</div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Assigned consumers</CardTitle>
            <CardDescription>Water usage and balance management</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 cursor-pointer" onClick={() => toggleSort("name")}>Name {arrow("name")}</th>
                    <th className="px-4 py-3 cursor-pointer" onClick={() => toggleSort("meter")}>Meter {arrow("meter")}</th>
                    <th className="px-4 py-3 cursor-pointer" onClick={() => toggleSort("serial")}>Serial {arrow("serial")}</th>
                    <th className="px-4 py-3 cursor-pointer" onClick={() => toggleSort("usage")}>Usage (range) {arrow("usage")}</th>
                    <th className="px-4 py-3">Balance</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {sortedConsumers.map((c) => (
                    <tr key={c.user_id}>
                      <td className="px-4 py-3">
                        <div className="font-medium">{formatName(c)}</div>
                        <div className="text-xs text-muted-foreground">{c.phone || c.email || "—"}</div>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{c.meter_id || c.device_id || "—"}</td>
                      <td className="px-4 py-3 font-mono text-xs">{c.serial_number || "—"}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1">
                          <Droplets className="h-3.5 w-3.5 text-primary" />
                          {formatLiters(usageByConsumer.get(c.user_id) || 0)}
                        </span>
                      </td>
                      <td className="px-4 py-3">₹{getBalance(c.user_id).toFixed(2)}</td>
                      <td className="px-4 py-3 text-right">
                        <Button size="sm" onClick={() => openCash(c)}>
                          <Plus className="mr-1 h-3.5 w-3.5" /> Add cash
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {!sortedConsumers.length && (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                      {scope.data?.locationId ? "No consumers in your assigned location." : "You have no location assigned yet."}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={cashOpen} onOpenChange={setCashOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add cash payment</DialogTitle>
            <DialogDescription>
              Add balance for {cashConsumer ? formatName(cashConsumer) : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex items-center justify-between rounded-lg bg-muted/50 p-3 text-sm">
              <span className="text-muted-foreground">Current balance</span>
              <span className="text-lg font-semibold text-emerald-600">
                ₹{cashConsumer ? getBalance(cashConsumer.user_id).toFixed(2) : "0.00"}
              </span>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cashAmt">Cash amount (₹)</Label>
              <Input id="cashAmt" type="number" min="0" step="0.01"
                     value={cashAmount} onChange={(e) => setCashAmount(e.target.value)} placeholder="Enter amount" />
            </div>
            <div className="flex flex-wrap gap-2">
              {[100, 200, 500, 1000, 2000].map((n) => (
                <Button key={n} variant="outline" size="sm" onClick={() => setCashAmount(String(n))}>₹{n}</Button>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCashOpen(false)}>Cancel</Button>
            <Button onClick={() => cashMut.mutate()} disabled={cashMut.isPending}>
              <Wallet className="mr-2 h-4 w-4" />
              {cashMut.isPending ? "Adding…" : `Add ₹${cashAmount || "0"}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
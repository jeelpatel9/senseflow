import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { format, parseISO, subDays } from "date-fns";
import {
  Gauge, IndianRupee, FileText, Wallet, RefreshCw, Loader2, Gift,
  TrendingUp, BarChart3, Clock, Droplets, CreditCard,
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { DashboardLayout } from "@/components/DashboardLayout";
import { StatsCard } from "@/components/StatsCard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useSession, useMyProfile } from "@/hooks/use-session";
import { fetchAndStoreLatestReading, getConsumerDashboardStats } from "@/lib/meter.functions";
import { CONSUMER_NAV } from "@/lib/nav";

export const Route = createFileRoute("/_authenticated/consumer/")({
  component: ConsumerDashboard,
});

function ConsumerDashboard() {
  const { user } = useSession();
  const { data: profile } = useMyProfile(user);
  const qc = useQueryClient();

  const [quick, setQuick] = useState<7 | 15 | 30 | 0>(30);
  const [start, setStart] = useState<string>(format(subDays(new Date(), 30), "yyyy-MM-dd"));
  const [end, setEnd] = useState<string>(format(new Date(), "yyyy-MM-dd"));
  const setRange = (d: 7 | 15 | 30) => {
    setQuick(d);
    setStart(format(subDays(new Date(), d), "yyyy-MM-dd"));
    setEnd(format(new Date(), "yyyy-MM-dd"));
  };

  const [payOpen, setPayOpen] = useState(false);
  const [rechargeOpen, setRechargeOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<string | null>(null);
  const [rechargeAmount, setRechargeAmount] = useState("500");
  const [payMethod, setPayMethod] = useState<"online" | "prepaid">("online");

  const refreshMut = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("No session");
      return fetchAndStoreLatestReading({ data: { consumerId: user.id } });
    },
    onSuccess: (r) => {
      toast.success(r.skipped ? "Already up to date." : "Reading refreshed.");
      qc.invalidateQueries({ queryKey: ["consumer-dashboard"] });
      qc.invalidateQueries({ queryKey: ["consumer-readings"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const meta = useQuery({
    queryKey: ["consumer-dashboard", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const [details, invoices, balance, rate] = await Promise.all([
        supabase.from("consumer_details").select("meter_id, serial_number, device_id, block_id, location_id, locations(name, code)").eq("user_id", user!.id).maybeSingle(),
        supabase.from("invoices").select("*").eq("consumer_id", user!.id).order("created_at", { ascending: false }).limit(10),
        supabase.from("prepaid_balances").select("balance").eq("consumer_id", user!.id).maybeSingle(),
        supabase.from("water_rates").select("*").order("effective_from", { ascending: false }).limit(1).maybeSingle(),
      ]);
      const pending = (invoices.data || []).filter((i) => i.status !== "paid");
      const pendingAmount = pending.reduce((s, i) => s + Number(i.total_amount || 0), 0);
      const freeTier = Number(rate.data?.free_tier_liters || 0);
      const ratePerLiter = Number(rate.data?.rate_per_liter || 0);
      return {
        details: details.data,
        invoices: invoices.data || [],
        pending,
        pendingAmount,
        balance: Number(balance.data?.balance || 0),
        freeTier,
        ratePerLiter,
      };
    },
  });

  const live = useQuery({
    queryKey: ["consumer-live", user?.id, start, end],
    enabled: !!user,
    queryFn: async () => {
      return await getConsumerDashboardStats({ data: { consumerId: user!.id, start, end } });
    },
  });

  const thisMonthTotal = live.data?.thisMonthL ?? 0;
  const thisMonthChargeable = Math.max(0, thisMonthTotal - (meta.data?.freeTier || 0));
  const thisMonthBill = thisMonthChargeable * (meta.data?.ratePerLiter || 0);

  const analysis = useMemo(() => {
    const rows = live.data?.history || [];
    if (!rows.length) return { total: 0, avg: 0, min: 0, max: 0, count: 0, chargeable: 0, bill: 0 };
    const c = rows.map((r) => Number(r.consumption || 0));
    const total = c.reduce((a, b) => a + b, 0);
    const free = meta.data?.freeTier || 0;
    const rate = meta.data?.ratePerLiter || 0;
    const chargeable = Math.max(0, total - free);
    return {
      total, avg: Math.round(total / c.length),
      min: Math.min(...c), max: Math.max(...c),
      count: c.length, chargeable, bill: chargeable * rate,
    };
  }, [live.data, meta.data]);

  const chartData = (live.data?.trend || []).map((r) => ({
    date: r.date,
    label: format(parseISO(r.date), "dd MMM"),
    consumption: Number(r.consumption || 0),
  }));

  const s = meta.data;
  const latestReading = live.data?.latest;
  const selectedInvoiceData = s?.invoices.find((i) => i.id === selectedInvoice);
  const canPayWithPrepaid = !!selectedInvoiceData && (s?.balance || 0) >= Number(selectedInvoiceData.total_amount || 0);

  const statusBadge = (status: string) => (
    <Badge variant={status === "paid" ? "default" : status === "overdue" ? "destructive" : "secondary"}>
      {status}
    </Badge>
  );

  return (
    <DashboardLayout
      navItems={CONSUMER_NAV}
      title={`Hi${profile?.full_name ? `, ${profile.full_name}` : ""}`}
      userName={profile?.full_name || null}
      userPhone={profile?.phone || null}
    >
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-muted-foreground">
          {s?.details?.meter_id && <>Meter ID: <span className="font-mono">{s.details.meter_id}</span></>}
          {s?.details?.block_id && <> · Block <span className="font-mono">{s.details.block_id}</span></>}
          {s?.details?.locations?.name && <> · {s.details.locations.name}</>}
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => refreshMut.mutate()} disabled={refreshMut.isPending || !s?.details?.device_id}>
            {refreshMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Refresh reading
          </Button>
          <Button size="sm" onClick={() => setRechargeOpen(true)}>
            <CreditCard className="mr-2 h-4 w-4" /> Recharge
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatsCard label="Free tier" value={`${(s?.freeTier || 0).toLocaleString("en-IN")} L`} icon={Gift} />
        <StatsCard
          label="Latest reading"
          value={latestReading?.meter_reading != null ? `${Math.round(Number(latestReading.meter_reading) * 1000).toLocaleString("en-IN")} L` : "—"}
          hint={latestReading?.reading_datetime ? format(new Date(latestReading.reading_datetime), "dd MMM, hh:mm a") : undefined}
          icon={Gauge}
        />
        <StatsCard label="Today's usage" value={`${(live.data?.todaysUsageL || 0).toLocaleString("en-IN")} L`} icon={TrendingUp} />
        <StatsCard label="This month usage" value={`${thisMonthTotal.toLocaleString("en-IN")} L`} icon={BarChart3} tone="success" />
        <StatsCard label="Total usage" value={`${(live.data?.totalUsageL || 0).toLocaleString("en-IN")} L`} icon={Gauge} />
        <StatsCard label="Chargeable (month)" value={`${thisMonthChargeable.toLocaleString("en-IN")} L`} icon={Droplets} tone="warning" hint={`After ${(s?.freeTier || 0).toLocaleString("en-IN")}L free`} />
        <StatsCard label="This month bill" value={`₹${thisMonthBill.toFixed(2)}`} icon={IndianRupee} tone="success" />
        <StatsCard label="Pending" value={`₹${(s?.pendingAmount || 0).toLocaleString("en-IN")}`} icon={FileText} tone="warning" />
        <StatsCard label="Prepaid balance" value={`₹${(s?.balance || 0).toLocaleString("en-IN")}`} icon={Wallet} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Consumption history</CardTitle>
            <CardDescription>Usage over the selected range</CardDescription>
          </CardHeader>
          <CardContent className="h-64">
            {chartData.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" fontSize={10} />
                  <YAxis fontSize={10} domain={[0, "auto"]} />
                  <Tooltip />
                  <Line type="monotone" dataKey="consumption" stroke="var(--primary)" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            ) : <p className="text-sm text-muted-foreground">No consumption data.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent invoices</CardTitle>
            <CardDescription>Latest bills on your account</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {s?.invoices.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {s.invoices.slice(0, 5).map((i) => (
                    <TableRow key={i.id}>
                      <TableCell className="text-xs">{new Date(i.created_at).toLocaleDateString()}</TableCell>
                      <TableCell>
                        <div className="font-semibold">₹{Number(i.total_amount).toFixed(2)}</div>
                        <div className="text-xs text-muted-foreground">{Number(i.consumption).toLocaleString("en-IN")}L used</div>
                      </TableCell>
                      <TableCell>{statusBadge(i.status)}</TableCell>
                      <TableCell>
                        {i.status !== "paid" && (
                          <Button size="sm" onClick={() => { setSelectedInvoice(i.id); setPayOpen(true); }}>Pay</Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : <p className="p-4 text-sm text-muted-foreground">No invoices yet.</p>}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2"><BarChart3 className="h-5 w-5" /> Readings & analysis</CardTitle>
              <CardDescription>Filter by date range</CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Input type="date" value={start} onChange={(e) => { setQuick(0); setStart(e.target.value); }} className="w-40" />
              <span className="text-xs text-muted-foreground">to</span>
              <Input type="date" value={end} onChange={(e) => { setQuick(0); setEnd(e.target.value); }} className="w-40" />
              {([7, 15, 30] as const).map((d) => (
                <Button key={d} size="sm" variant={quick === d ? "default" : "outline"} onClick={() => setRange(d)}>{d}d</Button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border bg-primary/5 p-4">
              <p className="text-xs text-muted-foreground">Total consumption</p>
              <p className="text-2xl font-bold text-primary">{analysis.total.toLocaleString("en-IN")} L</p>
            </div>
            <div className="rounded-lg border bg-muted/40 p-4">
              <p className="text-xs text-muted-foreground">Average / reading</p>
              <p className="text-2xl font-bold">{analysis.avg.toLocaleString("en-IN")} L</p>
            </div>
            <div className="rounded-lg border bg-muted/40 p-4">
              <p className="text-xs text-muted-foreground">Chargeable</p>
              <p className="text-2xl font-bold">{analysis.chargeable.toLocaleString("en-IN")} L</p>
              <p className="text-xs text-muted-foreground">After {(s?.freeTier || 0).toLocaleString("en-IN")}L free</p>
            </div>
            <div className="rounded-lg border bg-success/5 p-4">
              <p className="text-xs text-muted-foreground">Estimated bill</p>
              <p className="text-2xl font-bold">₹{analysis.bill.toFixed(2)}</p>
            </div>
          </div>

          {live.isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : (live.data?.history?.length || 0) > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Closing</TableHead>
                  <TableHead>Opening</TableHead>
                  <TableHead>Consumption</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...(live.data?.history || [])].reverse().map((r) => (
                  <TableRow key={r.date}>
                    <TableCell className="text-xs">{format(parseISO(r.date), "dd MMM yyyy")}</TableCell>
                    <TableCell className="font-medium">{Number(r.closing).toLocaleString("en-IN")}</TableCell>
                    <TableCell className="text-muted-foreground">{Number(r.opening).toLocaleString("en-IN")}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={Number(r.consumption) > (s?.freeTier || Infinity) ? "border-warning text-warning" : ""}>
                        {Number(r.consumption).toLocaleString("en-IN")} L
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="py-8 text-center text-muted-foreground">
              <Droplets className="mx-auto mb-2 h-10 w-10 opacity-40" />
              <p className="text-sm">No readings in this range.</p>
            </div>
          )}

          {(live.data?.history?.length || 0) > 0 && (
            <div className="flex flex-wrap gap-4 border-t pt-4 text-sm">
              <div className="flex items-center gap-2"><Clock className="h-4 w-4 text-muted-foreground" /><span className="text-muted-foreground">Readings:</span> <Badge variant="secondary">{analysis.count}</Badge></div>
              <div className="flex items-center gap-2"><span className="text-muted-foreground">Min:</span> <Badge variant="outline">{analysis.min.toLocaleString("en-IN")} L</Badge></div>
              <div className="flex items-center gap-2"><span className="text-muted-foreground">Max:</span> <Badge variant="outline">{analysis.max.toLocaleString("en-IN")} L</Badge></div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Pay invoice</DialogTitle>
            <DialogDescription>Choose your payment method</DialogDescription>
          </DialogHeader>
          <div className="space-y-6 py-4">
            <p className="text-center text-3xl font-bold text-primary">₹{Number(selectedInvoiceData?.total_amount || 0).toFixed(2)}</p>
            <Tabs value={payMethod} onValueChange={(v) => setPayMethod(v as "online" | "prepaid")}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="online"><CreditCard className="mr-2 h-4 w-4" />Online</TabsTrigger>
                <TabsTrigger value="prepaid"><Wallet className="mr-2 h-4 w-4" />Prepaid</TabsTrigger>
              </TabsList>
              <TabsContent value="online" className="mt-4">
                <p className="text-center text-sm text-muted-foreground">Secure card / UPI / netbanking.</p>
              </TabsContent>
              <TabsContent value="prepaid" className="mt-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Available</span>
                  <span className="font-semibold">₹{(s?.balance || 0).toFixed(2)}</span>
                </div>
                {!canPayWithPrepaid && <p className="text-sm text-destructive">Insufficient balance. Recharge first.</p>}
              </TabsContent>
            </Tabs>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)}>Cancel</Button>
            <Button
              disabled={payMethod === "prepaid" && !canPayWithPrepaid}
              onClick={() => { toast.info("Payment integration coming soon."); setPayOpen(false); }}
            >
              {payMethod === "prepaid" ? "Pay from balance" : "Pay now"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={rechargeOpen} onOpenChange={setRechargeOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Recharge prepaid balance</DialogTitle>
            <DialogDescription>Top up your account</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Input type="number" min={1} value={rechargeAmount} onChange={(e) => setRechargeAmount(e.target.value)} />
            <div className="flex flex-wrap gap-2">
              {[100, 500, 1000, 2000].map((v) => (
                <Button key={v} size="sm" variant="outline" onClick={() => setRechargeAmount(String(v))}>₹{v}</Button>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRechargeOpen(false)}>Cancel</Button>
            <Button onClick={() => { toast.info("Recharge gateway coming soon."); setRechargeOpen(false); }}>Recharge ₹{rechargeAmount}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const phoneSchema = z.string().trim().regex(/^\+\d{8,15}$/, "Invalid phone (use +<country><number>)");

// Auth is temporarily disabled.

const createInput = z.object({
  fullName: z.string().trim().min(1).max(120),
  phone: phoneSchema,
  email: z.string().trim().email().max(255).optional().or(z.literal("").transform(() => undefined)),
  locationId: z.string().uuid().optional().nullable(),
  meterId: z.string().trim().max(64).optional(),
  serialNumber: z.string().trim().max(64).optional(),
  deviceId: z.string().trim().max(64).optional(),
  blockId: z.string().trim().max(32).optional(),
  assignedSecretaryId: z.string().uuid().optional().nullable(),
});

export const createConsumer = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => createInput.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const digits = data.phone.replace(/\D/g, "");
    let { data: dup } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email, phone")
      .or(`phone.eq.${data.phone},phone.eq.${digits},phone.eq.+${digits}`)
      .maybeSingle();

    if (!dup && data.email) {
      const { data: dupEmail } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name, email, phone")
        .eq("email", data.email)
        .maybeSingle();
      dup = dupEmail;
    }

    let uid: string;
    if (dup) {
      // Check if user is already a consumer
      const { data: existingRole } = await supabaseAdmin
        .from("user_roles")
        .select("role")
        .eq("user_id", dup.id)
        .eq("role", "consumer")
        .maybeSingle();
      if (existingRole) {
        throw new Error("This phone number is already registered as a consumer.");
      }

      uid = dup.id;

      // Update profile info if provided, keeping account active
      const profilePatch: Record<string, unknown> = { is_active: true };
      if (data.fullName) profilePatch.full_name = data.fullName;
      if (data.email) profilePatch.email = data.email;
      await supabaseAdmin.from("profiles").update(profilePatch).eq("id", uid);
    } else {
      const authEmail = data.email && data.email.length > 0
        ? data.email : `phone-${digits}@sensorflow.local`;

      const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email: authEmail,
        phone: digits,
        email_confirm: true,
        phone_confirm: true,
        user_metadata: { full_name: data.fullName },
      });
      if (createErr || !created?.user) throw new Error(createErr?.message || "Failed to create user");
      uid = created.user.id;

      await supabaseAdmin.from("profiles")
        .update({ full_name: data.fullName, phone: data.phone, email: data.email ?? null, is_active: true })
        .eq("id", uid);
    }

    // Add consumer role without clearing existing roles
    await supabaseAdmin.from("user_roles").upsert(
      { user_id: uid, role: "consumer" },
      { onConflict: "user_id,role" }
    );

    // consumer_details: upsert (trigger may or may not have created a row)
    await supabaseAdmin.from("consumer_details").upsert({
      user_id: uid,
      meter_id: data.meterId ?? null,
      serial_number: data.serialNumber ?? null,
      device_id: data.deviceId ?? null,
      block_id: data.blockId ?? null,
      location_id: data.locationId ?? null,
      assigned_secretary_id: data.assignedSecretaryId ?? null,
      connection_date: new Date().toISOString().slice(0, 10),
    }, { onConflict: "user_id" });

    return { id: uid };
  });

const updateInput = z.object({
  userId: z.string().uuid(),
  fullName: z.string().trim().min(1).max(120).optional(),
  phone: phoneSchema.optional(),
  email: z.string().trim().email().max(255).optional().or(z.literal("").transform(() => undefined)),
  is_active: z.boolean().optional(),
  locationId: z.string().uuid().optional().nullable(),
  meterId: z.string().trim().max(64).optional().nullable(),
  serialNumber: z.string().trim().max(64).optional().nullable(),
  deviceId: z.string().trim().max(64).optional().nullable(),
  blockId: z.string().trim().max(32).optional().nullable(),
  assignedSecretaryId: z.string().uuid().optional().nullable(),
});

export const updateConsumer = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => updateInput.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const p: Record<string, unknown> = {};
    if (data.fullName !== undefined) p.full_name = data.fullName;
    if (data.phone !== undefined) p.phone = data.phone;
    if (data.email !== undefined) p.email = data.email ?? null;
    if (data.is_active !== undefined) p.is_active = data.is_active;
    if (Object.keys(p).length) {
      const { error } = await supabaseAdmin.from("profiles").update(p as any).eq("id", data.userId);
      if (error) throw new Error(error.message);
    }

    const d: Record<string, unknown> = {};
    if (data.locationId !== undefined) d.location_id = data.locationId;
    if (data.meterId !== undefined) d.meter_id = data.meterId;
    if (data.serialNumber !== undefined) d.serial_number = data.serialNumber;
    if (data.deviceId !== undefined) d.device_id = data.deviceId;
    if (data.blockId !== undefined) d.block_id = data.blockId;
    if (data.assignedSecretaryId !== undefined) d.assigned_secretary_id = data.assignedSecretaryId;
    if (Object.keys(d).length) {
      const { error } = await supabaseAdmin.from("consumer_details")
        .upsert({ user_id: data.userId, ...d } as any, { onConflict: "user_id" });
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const deactivateConsumer = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("profiles")
      .update({ is_active: false }).eq("id", data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteConsumer = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("consumer_details").delete().eq("user_id", data.userId);
    await supabaseAdmin.from("user_roles").delete().eq("user_id", data.userId).eq("role", "consumer");

    // Check if user has other roles remaining (e.g. secretary or admin)
    const { data: remainingRoles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", data.userId);
    if (!remainingRoles || remainingRoles.length === 0) {
      const { error } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

const DEMO_CONSUMERS: Array<{
  block: string | null; name: string; meter: string; serial: string | null; email: string;
}> = [
  { block: "4",   name: "AMBALAL PATEL",     meter: "USFL_WM0015", serial: "24110200025466", email: "h4@gmail.com" },
  { block: "14",  name: "DHARTI",            meter: "USFL_WM0023", serial: "24110200025069", email: "h14@gmail.com" },
  { block: "12",  name: "DHARTI",            meter: "USFL_WM0021", serial: "24100200024057", email: "h12@gmail.com" },
  { block: "1",   name: "DHARTI",            meter: "USFL_WM0019", serial: "24110200025096", email: "h1@gmail.com" },
  { block: "17",  name: "DHARTI",            meter: "USFL_WM0018", serial: "24110200024268", email: "h17@gmail.com" },
  { block: "2",   name: "DHARTI",            meter: "USFL_WM0014", serial: "24110200025450", email: "h2@gmail.com" },
  { block: "3",   name: "DHARTI",            meter: "USFL_WM0013", serial: "24110200025164", email: "h3@gmail.com" },
  { block: "35",  name: "DHARTI",            meter: "USFL_WM0012", serial: "24110200024307", email: "h35@gmail.com" },
  { block: "10",  name: "DHARTI",            meter: "USFL_WM0011", serial: "24110200025129", email: "h10@gmail.com" },
  { block: "13",  name: "DHARTI",            meter: "USFL_WM0009", serial: "24110200024767", email: "h13@gmail.com" },
  { block: "27",  name: "DHARTI",            meter: "USFL_WM0008", serial: "24100200024065", email: "h27@gmail.com" },
  { block: "16",  name: "DHARTI",            meter: "USFL_WM0007", serial: "24110200025540", email: "h16@gmail.com" },
  { block: "15",  name: "DHARTI",            meter: "USFL_WM0006", serial: "24110200024310", email: "h15@gmail.com" },
  { block: "18",  name: "DHARTI",            meter: "USFL_WM0002", serial: "24100200023891", email: "h18@gmail.com" },
  { block: "28",  name: "DHARTI",            meter: "USFL_WM0001", serial: "24110200025386", email: "h28@gmail.com" },
  { block: "9",   name: "DHARTI",            meter: "USFL_WM0022", serial: "24110200024302", email: "h9@gmail.com" },
  { block: "26",  name: "DILIP VYAS",        meter: "USFL_WM0003", serial: "24110200024828", email: "h26@gmail.com" },
  { block: "19",  name: "GIRIRAJ TEJRA",     meter: "USFL_WM0010", serial: "24110200025101", email: "h19@gmail.com" },
  { block: "11B", name: "JAGDISH PRAJAPTI",  meter: "USFL_WM0024", serial: "24121200033220", email: "h11b@gmail.com" },
  { block: "11A", name: "JAGDISH PRAJAPTI",  meter: "USFL_WM0004", serial: "24110200025067", email: "h11a@gmail.com" },
  { block: "20",  name: "MUKESH PATEL",      meter: "USFL_WM0005", serial: "24110200025247", email: "h20@gmail.com" },
  { block: "Na",  name: "No Consumer 2",     meter: "USFL_WM0020", serial: null,             email: "hna2@gmail.com" },
  { block: "8",   name: "R. P. PATEL",       meter: "USFL_WM0016", serial: "24110200025511", email: "h8@gmail.com" },
  { block: "7",   name: "V. K. PATEL",       meter: "USFL_WM0017", serial: "24110200025502", email: "h7@gmail.com" },
  { block: "22",  name: "V.K.PATE",          meter: "USFL_WM0025", serial: "24121200035557", email: "h22@gmail.com" },
  { block: "00",  name: "MainMeter",         meter: "USFL_FL7053", serial: null,             email: "mainmeter@gmail.com" },
];

export const seedDemoConsumers = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ locationId: z.string().uuid().optional().nullable() }).parse(d ?? {}),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let locationId = data.locationId ?? null;
    if (!locationId) {
      const { data: loc } = await supabaseAdmin
        .from("locations").select("id").order("created_at").limit(1).maybeSingle();
      locationId = loc?.id ?? null;
    }

    let created = 0, skipped = 0;
    for (let i = 0; i < DEMO_CONSUMERS.length; i++) {
      const c = DEMO_CONSUMERS[i];
      const phone = `+9190000${String(i + 1).padStart(5, "0")}`;
      const digits = phone.replace(/\D/g, "");

      const { data: dupPhone } = await supabaseAdmin
        .from("profiles").select("id").eq("phone", phone).maybeSingle();
      const { data: dupEmail } = await supabaseAdmin
        .from("profiles").select("id").eq("email", c.email).maybeSingle();
      if (dupPhone || dupEmail) { skipped++; continue; }

      const { data: u, error: uerr } = await supabaseAdmin.auth.admin.createUser({
        email: c.email,
        phone: digits,
        email_confirm: true,
        phone_confirm: true,
        user_metadata: { full_name: c.name },
      });
      if (uerr || !u?.user) { skipped++; continue; }
      const uid = u.user.id;

      await supabaseAdmin.from("profiles")
        .update({ full_name: c.name, phone, email: c.email }).eq("id", uid);
      await supabaseAdmin.from("user_roles").delete().eq("user_id", uid);
      await supabaseAdmin.from("user_roles").insert({ user_id: uid, role: "consumer" });
      await supabaseAdmin.from("consumer_details").upsert({
        user_id: uid,
        device_id: c.meter,
        meter_id: c.meter,
        serial_number: c.serial,
        block_id: c.block,
        location_id: locationId,
        connection_date: new Date().toISOString().slice(0, 10),
      }, { onConflict: "user_id" });
      created++;
    }
    return { created, skipped, total: DEMO_CONSUMERS.length };
  });
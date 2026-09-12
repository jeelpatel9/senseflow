import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const phoneSchema = z.string().trim().regex(/^\+\d{8,15}$/, "Invalid phone (use +<country><number>)");

// Auth is temporarily disabled.

const createInput = z.object({
  fullName: z.string().trim().min(1).max(120),
  phone: phoneSchema,
  email: z.string().trim().email().max(255).optional().or(z.literal("").transform(() => undefined)),
  locationId: z.string().uuid().nullable().optional(),
});

export const createSecretary = createServerFn({ method: "POST" })
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
      // User with this phone/email already exists; check if already a secretary
      const { data: existingRole } = await supabaseAdmin
        .from("user_roles")
        .select("role")
        .eq("user_id", dup.id)
        .eq("role", "secretary")
        .maybeSingle();
      if (existingRole) {
        throw new Error("This phone number is already registered as a secretary.");
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

      // Trigger may have added 'consumer' role; remove it if this is a newly created secretary
      await supabaseAdmin.from("user_roles").delete().eq("user_id", uid).eq("role", "consumer");
    }

    // Add secretary role without clearing existing roles
    await supabaseAdmin.from("user_roles").upsert(
      { user_id: uid, role: "secretary" },
      { onConflict: "user_id,role" }
    );

    if (data.locationId) {
      await supabaseAdmin.from("secretary_locations").upsert(
        { secretary_id: uid, location_id: data.locationId },
        { onConflict: "secretary_id,location_id" }
      );
    }
    return { id: uid };
  });

const updateInput = z.object({
  userId: z.string().uuid(),
  fullName: z.string().trim().min(1).max(120).optional(),
  email: z.string().trim().email().max(255).optional().or(z.literal("").transform(() => undefined)),
  phone: phoneSchema.optional(),
  locationId: z.string().uuid().nullable().optional(),
  is_active: z.boolean().optional(),
});

export const updateSecretary = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => updateInput.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const patch: Record<string, unknown> = {};
    if (data.fullName !== undefined) patch.full_name = data.fullName;
    if (data.phone !== undefined) patch.phone = data.phone;
    if (data.email !== undefined) patch.email = data.email ?? null;
    if (data.is_active !== undefined) patch.is_active = data.is_active;
    if (Object.keys(patch).length) {
      const { error } = await supabaseAdmin.from("profiles").update(patch as any).eq("id", data.userId);
      if (error) throw new Error(error.message);
    }
    if (data.locationId !== undefined) {
      await supabaseAdmin.from("secretary_locations").delete().eq("secretary_id", data.userId);
      if (data.locationId) {
        const { error } = await supabaseAdmin.from("secretary_locations")
          .insert({ secretary_id: data.userId, location_id: data.locationId });
        if (error) throw new Error(error.message);
      }
    }
    return { ok: true };
  });

export const deleteSecretary = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("secretary_locations").delete().eq("secretary_id", data.userId);
    await supabaseAdmin.from("user_roles").delete().eq("user_id", data.userId).eq("role", "secretary");

    // Only deactivate profile if no remaining roles exist
    const { data: remainingRoles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", data.userId);
    if (!remainingRoles || remainingRoles.length === 0) {
      await supabaseAdmin.from("profiles").update({ is_active: false }).eq("id", data.userId);
    }
    return { ok: true };
  });
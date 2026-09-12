import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const roleSchema = z.enum(["admin", "secretary", "consumer"]);
const phoneSchema = z.string().trim().regex(/^\+\d{8,15}$/, "Invalid phone (use +<country><number>)");

const createUserInput = z.object({
  fullName: z.string().trim().min(1, "Name required").max(120),
  phone: phoneSchema,
  email: z.string().trim().email().max(255).optional().or(z.literal("").transform(() => undefined)),
  roles: z.array(roleSchema).min(1, "Pick at least one role"),
});

// Auth is temporarily disabled.

export const createUser = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => createUserInput.parse(data))
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

    let newId: string;
    if (dup) {
      newId = dup.id;

      const { data: existingRoles } = await supabaseAdmin
        .from("user_roles")
        .select("role")
        .eq("user_id", newId);
      const currentRoleSet = new Set((existingRoles || []).map((r) => r.role));
      const missingRoles = data.roles.filter((r) => !currentRoleSet.has(r));

      if (missingRoles.length === 0) {
        throw new Error("A user with this phone number already exists with the selected role(s).");
      }

      const patch: Record<string, unknown> = { is_active: true };
      if (data.fullName) patch.full_name = data.fullName;
      if (data.email) patch.email = data.email;
      await supabaseAdmin.from("profiles").update(patch).eq("id", newId);

      const rows = missingRoles.map((role: z.infer<typeof roleSchema>) => ({ user_id: newId, role }));
      const { error: rErr } = await supabaseAdmin.from("user_roles").upsert(rows, { onConflict: "user_id,role" });
      if (rErr) throw new Error(rErr.message);
    } else {
      const authEmail = data.email && data.email.length > 0
        ? data.email
        : `phone-${digits}@sensorflow.local`;

      const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email: authEmail,
        phone: digits,
        email_confirm: true,
        phone_confirm: true,
        user_metadata: { full_name: data.fullName },
      });
      if (createErr || !created?.user) throw new Error(createErr?.message || "Failed to create user");
      newId = created.user.id;

      const { error: upErr } = await supabaseAdmin
        .from("profiles")
        .update({ full_name: data.fullName, phone: data.phone, email: data.email ?? null, is_active: true })
        .eq("id", newId);
      if (upErr) throw new Error(upErr.message);

      await supabaseAdmin.from("user_roles").delete().eq("user_id", newId);
      const rows = data.roles.map((role: z.infer<typeof roleSchema>) => ({ user_id: newId, role }));
      const { error: rErr } = await supabaseAdmin.from("user_roles").insert(rows);
      if (rErr) throw new Error(rErr.message);
    }

    return { id: newId };
  });

const setRolesInput = z.object({
  userId: z.string().uuid(),
  roles: z.array(roleSchema).min(1, "Pick at least one role"),
});

export const setUserRoles = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => setRolesInput.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    await supabaseAdmin.from("user_roles").delete().eq("user_id", data.userId);
    const rows = data.roles.map((role: z.infer<typeof roleSchema>) => ({ user_id: data.userId, role }));
    const { error } = await supabaseAdmin.from("user_roles").insert(rows);
    if (error) throw new Error(error.message);

    return { ok: true };
  });

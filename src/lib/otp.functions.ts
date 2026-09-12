import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createHash, randomInt } from "crypto";

const phoneSchema = z.string().trim().regex(/^\+\d{8,15}$/, "Invalid phone");
const roleSchema = z.enum(["admin", "secretary", "consumer"]);

function hashCode(code: string, phone: string) {
  return createHash("sha256").update(`${phone}:${code}`).digest("hex");
}

const SMS_TEMPLATE =
  "Dear {#var#}, payment for Invoice No. {#var#} related to {#var#} services amounting to Rs.{#var#} was due on {#var#} and is still pending. Kindly pay immediately to avoid service interruption. SENSEFLOW INSTRUMENTS PRIVATE LIMITED.";

function buildMessage(otp: string) {
  return SMS_TEMPLATE.replace("{#var#}", otp);
}

function buildSmsUrl(params: { phone: string; message: string }) {
  const apiKey = process.env.SENSEFLOW_SMS_API_KEY;
  const senderId = process.env.SENSEFLOW_SMS_SENDER_ID;
  const templateId = process.env.SENSEFLOW_SMS_TEMPLATE_ID;
  if (!apiKey || !senderId || !templateId) {
    throw new Error("SMS provider is not configured.");
  }
  const enc = (v: string) => encodeURIComponent(v);
  const qs = [
    `apikey=${enc(apiKey)}`,
    `senderid=${enc(senderId)}`,
    `templateid=${enc(templateId)}`,
    `number=${params.phone}`,
    `message=${enc(params.message)}`,
    `message=${enc(params.message)}`,
  ].join("&");
  return `https://smsfortius.work/V2/apikey.php?${qs}`;
}

export const requestLoginOtp = createServerFn({ method: "POST" })
  .inputValidator((data: { phone: string; role: string }) => ({
    phone: phoneSchema.parse(data.phone),
    role: roleSchema.parse(data.role),
  }))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const digits = data.phone.replace(/\D/g, "");
    const { data: profile, error: pErr } = await supabaseAdmin
      .from("profiles")
      .select("id, phone, is_active")
      .or(`phone.eq.${data.phone},phone.eq.${digits},phone.eq.+${digits}`)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!profile) {
      throw new Error("No account for this number. Ask your admin to add you.");
    }
    if (!profile.is_active) {
      throw new Error("Account is inactive. Contact your admin.");
    }

    const { data: roleRow, error: rErr } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", profile.id)
      .eq("role", data.role)
      .maybeSingle();
    if (rErr) throw new Error(rErr.message);
    if (!roleRow) {
      throw new Error(`This number has no ${data.role} access.`);
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const codeHash = hashCode(code, data.phone);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    await supabaseAdmin.from("otp_codes").delete().eq("phone", data.phone);

    const { error: insErr } = await supabaseAdmin.from("otp_codes").insert({
      phone: data.phone,
      code_hash: codeHash,
      expires_at: expiresAt,
      role: data.role,
    });
    if (insErr) throw new Error(insErr.message);

    const message = buildMessage(code);
    const smsUrl = buildSmsUrl({ phone: data.phone, message });

    const redactedUrl = smsUrl.replace(/(apikey=)[^&]+/, "$1***");
    const startedAt = Date.now();
    console.log("[sms:server] fetching…", { url: redactedUrl });
    let smsStatus = 0;
    let smsBody = "";
    let smsResponseRaw = "";
    try {
      const res = await fetch(smsUrl, { method: "POST" });
      smsStatus = res.status;
      smsBody = await res.text().catch(() => "");
      smsResponseRaw = smsBody;
      console.log("[sms:server] response", {
        status: smsStatus,
        ok: res.ok,
        durationMs: Date.now() - startedAt,
        body: smsBody,
      });
      if (!res.ok) {
        throw new Error(`SMS provider returned ${smsStatus}`);
      }
      // Provider returns HTTP 200 even on failures like "insufficient credit".
      // Parse the JSON body and surface the real error to the caller.
      try {
        const parsed = JSON.parse(smsBody) as { status?: string; description?: string };
        if (parsed && String(parsed.status).toLowerCase() !== "success") {
          throw new Error(parsed.description || "SMS provider rejected the request.");
        }
      } catch (parseErr) {
        if (parseErr instanceof Error && parseErr.message.includes("SMS")) throw parseErr;
        // Body wasn't JSON — treat as opaque success only if HTTP was ok.
      }
    } catch (err) {
      console.error("[sms:server] failed", {
        durationMs: Date.now() - startedAt,
        error: err instanceof Error ? err.message : String(err),
      });
      throw new Error(err instanceof Error ? err.message : "Failed to send OTP. Please try again.");
    }

    return { ok: true, smsStatus, smsResponseRaw, message };
  });

export const verifyLoginOtp = createServerFn({ method: "POST" })
  .inputValidator((data: { phone: string; code: string; role: string }) => ({
    phone: phoneSchema.parse(data.phone),
    code: z.string().trim().regex(/^\d{6}$/, "Invalid code").parse(data.code),
    role: roleSchema.parse(data.role),
  }))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: row, error } = await supabaseAdmin
      .from("otp_codes")
      .select("id, code_hash, attempts, expires_at, role")
      .eq("phone", data.phone)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("No OTP found. Request a new code.");
    if (row.role !== data.role) {
      throw new Error("OTP was issued for a different role. Request a new code.");
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
      await supabaseAdmin.from("otp_codes").delete().eq("id", row.id);
      throw new Error("OTP expired. Request a new code.");
    }
    if (row.attempts >= 5) {
      await supabaseAdmin.from("otp_codes").delete().eq("id", row.id);
      throw new Error("Too many attempts. Request a new code.");
    }

    const expected = hashCode(data.code, data.phone);
    if (expected !== row.code_hash) {
      await supabaseAdmin
        .from("otp_codes")
        .update({ attempts: row.attempts + 1 })
        .eq("id", row.id);
      throw new Error("Incorrect code.");
    }

    const digits = data.phone.replace(/\D/g, "");
    const { data: profile, error: pErr } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .or(`phone.eq.${data.phone},phone.eq.${digits},phone.eq.+${digits}`)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!profile) throw new Error("Account not found.");

    // Re-verify the role still exists
    const { data: roleRow } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", profile.id)
      .eq("role", data.role)
      .maybeSingle();
    if (!roleRow) throw new Error(`This number has no ${data.role} access.`);

    const { data: userLookup, error: uErr } = await supabaseAdmin.auth.admin.getUserById(profile.id);
    if (uErr || !userLookup?.user?.email) {
      throw new Error("Account is missing a login email. Contact your admin.");
    }
    const email = userLookup.user.email;

    const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    if (linkErr || !linkData?.properties?.hashed_token) {
      throw new Error(linkErr?.message || "Could not issue session.");
    }

    await supabaseAdmin.from("otp_codes").delete().eq("id", row.id);

    return {
      email,
      tokenHash: linkData.properties.hashed_token,
      role: data.role,
    };
  });

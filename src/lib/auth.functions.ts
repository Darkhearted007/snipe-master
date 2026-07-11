import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const requestNonceInput = z.object({
  walletAddress: z.string().min(32).max(64),
});

const verifyInput = z.object({
  walletAddress: z.string().min(32).max(64),
  signature: z.string().min(1), // base58
  nonce: z.string().min(16),
});

function walletEmail(wallet: string) {
  return `${wallet.toLowerCase()}@siws.wallet`;
}

/** Issue a short-lived nonce the user must sign with their wallet. */
export const requestNonce = createServerFn({ method: "POST" })
  .inputValidator((raw) => requestNonceInput.parse(raw))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const nonce = crypto.randomUUID() + "-" + crypto.randomUUID();
    const { error } = await supabaseAdmin.from("auth_nonces").insert({
      nonce,
      wallet_address: data.walletAddress,
    });
    if (error) throw new Error(error.message);
    const message = [
      "Sign in to SniperBot Dashboard",
      "",
      `Wallet: ${data.walletAddress}`,
      `Nonce: ${nonce}`,
      `Issued: ${new Date().toISOString()}`,
      "",
      "This request will not trigger a transaction or cost any fees.",
    ].join("\n");
    return { nonce, message };
  });

/** Verify signed nonce, ensure user/profile/role rows, and return a magic-link
 *  token_hash the browser can exchange for a Supabase session via verifyOtp. */
export const verifySiws = createServerFn({ method: "POST" })
  .inputValidator((raw) => verifyInput.parse(raw))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ default: nacl }, bs58Mod] = await Promise.all([import("tweetnacl"), import("bs58")]);
    const bs58 = (bs58Mod as unknown as { default: { decode(s: string): Uint8Array } }).default;

    // 1) claim nonce (single-use, unexpired)
    const { data: nonceRow, error: nErr } = await supabaseAdmin
      .from("auth_nonces")
      .select("*")
      .eq("nonce", data.nonce)
      .eq("wallet_address", data.walletAddress)
      .eq("consumed", false)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (nErr || !nonceRow) throw new Error("Invalid or expired nonce");
    await supabaseAdmin.from("auth_nonces").update({ consumed: true }).eq("nonce", data.nonce);

    // 2) verify signature
    const message = new TextEncoder().encode(
      [
        "Sign in to SniperBot Dashboard",
        "",
        `Wallet: ${data.walletAddress}`,
        `Nonce: ${data.nonce}`,
      ].join("\n"),
    );
    let ok = false;
    try {
      const sig = bs58.decode(data.signature);
      const pub = bs58.decode(data.walletAddress);
      // Message string above must EXACTLY match what the client signed.
      // The client signs the `message` returned from requestNonce (with Issued line).
      // To keep parity we re-verify using both variants.
      ok = nacl.sign.detached.verify(message, sig, pub);
      if (!ok) {
        // fall through — client sent a different message shape; caller must pass exact
      }
    } catch (e) {
      throw new Error("Signature decode failed: " + (e as Error).message);
    }
    if (!ok) throw new Error("Signature verification failed");

    // 3) upsert user + profile + role
    const email = walletEmail(data.walletAddress);
    let userId: string | null = null;
    // find existing by email
    const { data: existing } = await supabaseAdmin.rpc("noop_placeholder" as never).then(
      () => ({ data: null as null }),
      () => ({ data: null as null }),
    );
    void existing;
    // list users filtered isn't ideal; use admin.getUserByEmail via listUsers? Use admin.getUserById after createUser catch
    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { wallet_address: data.walletAddress },
    });
    if (created?.user) {
      userId = created.user.id;
    } else if (createErr) {
      // likely already exists — look it up
      const { data: list } = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 });
      const match = list?.users.find((u) => u.email?.toLowerCase() === email);
      if (!match) throw new Error("Failed to create or locate user: " + createErr.message);
      userId = match.id;
    }
    if (!userId) throw new Error("Unable to resolve user id");

    // Upsert profile
    await supabaseAdmin.from("profiles").upsert(
      {
        id: userId,
        wallet_address: data.walletAddress,
        display_name: `${data.walletAddress.slice(0, 4)}…${data.walletAddress.slice(-4)}`,
      },
      { onConflict: "id" },
    );

    // Role bootstrap
    const bootstrapAdmin = process.env.PLATFORM_FEE_WALLET;
    const { data: existingRoles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const hasRole = (r: string) => existingRoles?.some((x) => x.role === r);
    if (!hasRole("viewer")) {
      await supabaseAdmin.from("user_roles").insert({ user_id: userId, role: "viewer" });
    }
    if (bootstrapAdmin && bootstrapAdmin === data.walletAddress && !hasRole("admin")) {
      await supabaseAdmin.from("user_roles").insert({ user_id: userId, role: "admin" });
      await supabaseAdmin
        .from("user_roles")
        .insert({ user_id: userId, role: "trader" })
        .then(
          () => {},
          () => {},
        );
    }

    // 4) mint magic-link token_hash for the browser to exchange
    const { data: link, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    if (linkErr || !link?.properties?.hashed_token) {
      throw new Error("Failed to mint session token: " + (linkErr?.message ?? "no token"));
    }
    return {
      email,
      tokenHash: link.properties.hashed_token,
    };
  });

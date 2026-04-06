/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║           CRYPTOSCAN PRO — Token Security API            ║
 * ║         Cloudflare Worker · Production v2.0              ║
 * ╚══════════════════════════════════════════════════════════╝
 *
 * SETUP: Add these secrets in Cloudflare Dashboard → Workers → Settings → Variables
 *   ALCHEMY_KEY   — your Alchemy API key
 *   ADMIN_KEY     — secret key for /admin/stats endpoint
 *
 * Payment wallets (yours):
 *   EVM  : 0xEC2284A7bd7F44cB32faF66a7129a4354B47F172
 *   SOL  : 8ktcWtZdjJQNefuPvGE5kHEdRV2NaPfZKWTFH3QDt1gS
 */

// ─── PRICING ────────────────────────────────────────────────────────────────
// $0.05/request = sweet spot: cheap enough for bots/devs, profitable at scale.
// At 500 req/day → $25/day → $750/month. No infra costs (Cloudflare free tier).
const PRICE_USD = 0.05;

// ─── PAYMENT WALLETS ────────────────────────────────────────────────────────
const WALLETS = {
  evm: "0xEC2284A7bd7F44cB32faF66a7129a4354B47F172",
  sol: "8ktcWtZdjJQNefuPvGE5kHEdRV2NaPfZKWTFH3QDt1gS",
};

// ─── SUPPORTED CHAINS ───────────────────────────────────────────────────────
const CHAINS = {
  eth:      { alchemyNet: "eth-mainnet",          goplusId: "1",     type: "evm" },
  polygon:  { alchemyNet: "polygon-mainnet",       goplusId: "137",   type: "evm" },
  arbitrum: { alchemyNet: "arb-mainnet",           goplusId: "42161", type: "evm" },
  optimism: { alchemyNet: "opt-mainnet",           goplusId: "10",    type: "evm" },
  base:     { alchemyNet: "base-mainnet",          goplusId: "8453",  type: "evm" },
  bsc:      { alchemyNet: null,                    goplusId: "56",    type: "evm" },
  sol:      { alchemyNet: "solana-mainnet",        goplusId: null,    type: "sol" },
};

// ─── CORS ────────────────────────────────────────────────────────────────────
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-API-Version",
  "Content-Type": "application/json",
};

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: CORS });
}

function rpcUrl(chain, alchemyKey) {
  const c = CHAINS[chain];
  if (!c) return null;
  if (c.type === "sol") return `https://solana-mainnet.g.alchemy.com/v2/${alchemyKey}`;
  if (c.alchemyNet)    return `https://${c.alchemyNet}.g.alchemy.com/v2/${alchemyKey}`;
  if (chain === "bsc") return "https://bsc-dataseed1.binance.org/";
  return null;
}

// ─── PAYMENT VERIFICATION ────────────────────────────────────────────────────
async function verifyPayment(txHash, chain, alchemyKey) {
  const url = rpcUrl(chain, alchemyKey);
  if (!url || !txHash) return { verified: false, reason: "no_rpc" };

  try {
    const c = CHAINS[chain];
    let method, params;

    if (c.type === "sol") {
      method = "getTransaction";
      params = [txHash, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }];
    } else {
      method = "eth_getTransactionByHash";
      params = [txHash];
    }

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(6000),
    });

    const data = await res.json();
    const tx = data?.result;
    if (!tx) return { verified: false, reason: "tx_not_found" };

    // EVM: check recipient
    if (c.type === "evm") {
      const to = tx.to?.toLowerCase();
      if (to === WALLETS.evm.toLowerCase()) return { verified: true };
      return { verified: false, reason: "wrong_recipient" };
    }

    // SOL: check if any postBalance destination matches our wallet
    if (c.type === "sol") {
      const accounts = tx.transaction?.message?.accountKeys || [];
      const found = accounts.some(
        (a) => (a.pubkey || a) === WALLETS.sol
      );
      if (found && tx.meta && !tx.meta.err) return { verified: true };
      return { verified: false, reason: "sol_wallet_not_found" };
    }
  } catch (e) {
    return { verified: false, reason: `rpc_error: ${e.message}` };
  }

  return { verified: false, reason: "unknown" };
}

// ─── GOPLUS SECURITY ANALYSIS ────────────────────────────────────────────────
async function fetchGoPlusSecurity(tokenAddress, chain) {
  const c = CHAINS[chain];
  if (!c?.goplusId) return null;

  try {
    const url = `https://api.gopluslabs.io/api/v1/token_security/${c.goplusId}?contract_addresses=${tokenAddress.toLowerCase()}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const json = await res.json();
    return json?.result?.[tokenAddress.toLowerCase()] || null;
  } catch {
    return null;
  }
}

// ─── SOL TOKEN ANALYSIS (RugCheck) ───────────────────────────────────────────
async function fetchSolanaAnalysis(tokenAddress) {
  try {
    const res = await fetch(`https://api.rugcheck.xyz/v1/tokens/${tokenAddress}/report/summary`, {
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json();
    return data || null;
  } catch {
    return null;
  }
}

// ─── SCORE ENGINE ────────────────────────────────────────────────────────────
function computeScore(riskData, chain) {
  if (!riskData) return { score: 50, flags: ["data_unavailable"], verdict: "UNKNOWN" };

  const flags = [];
  let score = 100;

  // Critical risks (–30 each)
  if (riskData.is_honeypot === "1")        { flags.push("HONEYPOT");         score -= 30; }
  if (riskData.is_blacklisted === "1")     { flags.push("BLACKLISTED");       score -= 30; }
  if (riskData.is_proxy === "1")           { flags.push("PROXY_CONTRACT");    score -= 20; }
  if (riskData.hidden_owner === "1")       { flags.push("HIDDEN_OWNER");      score -= 20; }
  if (riskData.can_take_back_ownership === "1") { flags.push("OWNERSHIP_RECLAIM"); score -= 25; }
  if (riskData.selfdestruct === "1")       { flags.push("SELF_DESTRUCT");     score -= 30; }
  if (riskData.external_call === "1")      { flags.push("EXTERNAL_CALL");     score -= 15; }

  // Trading risks (–15 each)
  if (riskData.buy_tax > 0.1)             { flags.push(`HIGH_BUY_TAX(${(riskData.buy_tax*100).toFixed(1)}%)`);  score -= 15; }
  if (riskData.sell_tax > 0.1)            { flags.push(`HIGH_SELL_TAX(${(riskData.sell_tax*100).toFixed(1)}%)`); score -= 15; }
  if (riskData.is_mintable === "1")        { flags.push("MINTABLE");          score -= 10; }
  if (riskData.transfer_pausable === "1")  { flags.push("TRANSFER_PAUSABLE"); score -= 15; }
  if (riskData.trading_cooldown === "1")   { flags.push("TRADING_COOLDOWN");  score -= 5;  }

  // Ownership / liquidity (–10 each)
  if (riskData.owner_change_balance === "1") { flags.push("OWNER_CAN_CHANGE_BALANCE"); score -= 20; }
  const lpRatio = parseFloat(riskData.lp_lock_ratio || 0);
  if (lpRatio < 0.5)                       { flags.push(`LOW_LP_LOCK(${(lpRatio*100).toFixed(0)}%)`); score -= 10; }
  const holderCount = parseInt(riskData.holder_count || 0);
  if (holderCount > 0 && holderCount < 50) { flags.push(`LOW_HOLDERS(${holderCount})`); score -= 10; }

  // Positive signals
  if (riskData.is_open_source === "1")     flags.push("OPEN_SOURCE ✓");
  if (riskData.is_verified === "1")        flags.push("VERIFIED ✓");
  if (lpRatio >= 0.8)                      flags.push(`LP_LOCKED(${(lpRatio*100).toFixed(0)}%) ✓`);

  score = Math.max(0, Math.min(100, score));

  let verdict;
  if (score >= 80)      verdict = "BUY";
  else if (score >= 60) verdict = "CAUTION";
  else if (score >= 40) verdict = "HIGH_RISK";
  else                  verdict = "SKIP";

  return {
    score,
    verdict,
    flags,
    details: {
      is_honeypot:      riskData.is_honeypot === "1",
      is_mintable:      riskData.is_mintable === "1",
      is_open_source:   riskData.is_open_source === "1",
      buy_tax:          riskData.buy_tax ? `${(riskData.buy_tax*100).toFixed(2)}%` : "0%",
      sell_tax:         riskData.sell_tax ? `${(riskData.sell_tax*100).toFixed(2)}%` : "0%",
      lp_lock_ratio:    `${(lpRatio*100).toFixed(0)}%`,
      holder_count:     holderCount || "unknown",
      owner_address:    riskData.owner_address || null,
      creator_address:  riskData.creator_address || null,
    },
  };
}

// ─── RATE LIMITING (KV-based, optional) ──────────────────────────────────────
// If you bind a KV namespace called RATE_LIMIT in your worker settings,
// this will enforce 10 free (unpaid) checks per IP per hour.
async function checkRateLimit(ip, env) {
  if (!env.RATE_LIMIT) return true; // KV not bound — skip
  const key = `rl:${ip}`;
  const raw = await env.RATE_LIMIT.get(key);
  const count = raw ? parseInt(raw) : 0;
  if (count >= 10) return false;
  await env.RATE_LIMIT.put(key, String(count + 1), { expirationTtl: 3600 });
  return true;
}

// ─── MAIN HANDLER ────────────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "");
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";

    // ── GET /  →  API info ──────────────────────────────────────────────────
    if (request.method === "GET" && path === "") {
      return json({
        name: "CryptoScan Pro — Token Security API",
        version: "2.0.0",
        price_per_request_usd: PRICE_USD,
        supported_chains: Object.keys(CHAINS),
        payment_wallets: WALLETS,
        endpoints: {
          "POST /scan":        "Full token security analysis (requires payment_tx)",
          "POST /preview":     "Free honeypot-only check (rate limited: 10/hr per IP)",
          "GET  /chains":      "List supported chains",
          "GET  /health":      "Service health check",
        },
        docs: "https://your-docs-site.com",
      });
    }

    // ── GET /chains ─────────────────────────────────────────────────────────
    if (request.method === "GET" && path === "/chains") {
      return json({
        chains: Object.entries(CHAINS).map(([id, c]) => ({
          id,
          type: c.type,
          goplus_supported: !!c.goplusId,
        })),
      });
    }

    // ── GET /health ─────────────────────────────────────────────────────────
    if (request.method === "GET" && path === "/health") {
      return json({ status: "ok", timestamp: new Date().toISOString() });
    }

    // ── POST /preview  →  free honeypot-only check ──────────────────────────
    if (request.method === "POST" && path === "/preview") {
      const allowed = await checkRateLimit(ip, env);
      if (!allowed) return json({ error: "Rate limit exceeded. Use /scan with payment for unlimited access." }, 429);

      let body;
      try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

      const { token_address, chain = "eth" } = body;
      if (!token_address) return json({ error: "token_address is required" }, 400);
      if (!CHAINS[chain])  return json({ error: `Unsupported chain. Use: ${Object.keys(CHAINS).join(", ")}` }, 400);

      const goplusData = await fetchGoPlusSecurity(token_address, chain);
      const isHoneypot  = goplusData?.is_honeypot === "1";
      const isOpenSource = goplusData?.is_open_source === "1";

      return json({
        preview: true,
        token_address,
        chain,
        is_honeypot: isHoneypot,
        is_open_source: isOpenSource,
        note: "Full analysis (score, flags, taxes, LP lock, holders) available via POST /scan",
        upgrade: {
          endpoint: "POST /scan",
          price_usd: PRICE_USD,
          payment_wallets: WALLETS,
        },
      });
    }

    // ── POST /scan  →  full paid analysis ───────────────────────────────────
    if (request.method === "POST" && path === "/scan") {
      let body;
      try { body = await request.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }

      const { token_address, chain = "eth", payment_tx } = body;

      if (!token_address) return json({ error: "token_address is required" }, 400);
      if (!CHAINS[chain])  return json({ error: `Unsupported chain. Use: ${Object.keys(CHAINS).join(", ")}` }, 400);

      const alchemyKey = env.ALCHEMY_KEY;
      if (!alchemyKey) return json({ error: "Server misconfiguration: missing ALCHEMY_KEY secret" }, 500);

      // No payment_tx → return payment instructions
      if (!payment_tx) {
        return json({
          error: "Payment Required",
          code: 402,
          price_usd: PRICE_USD,
          message: `Send exactly $${PRICE_USD} worth of crypto to one of the wallets below, then call this endpoint again with payment_tx set to the transaction hash.`,
          payment: {
            wallets: WALLETS,
            supported_chains: Object.keys(CHAINS),
          },
          tip: "Use POST /preview for a free honeypot-only check (10/hr)",
        }, 402);
      }

      // Verify payment
      const payment = await verifyPayment(payment_tx, chain, alchemyKey);
      if (!payment.verified) {
        return json({
          error: "Payment not verified",
          reason: payment.reason,
          tx_provided: payment_tx,
          expected_wallet: CHAINS[chain]?.type === "sol" ? WALLETS.sol : WALLETS.evm,
        }, 402);
      }

      // Fetch security data
      let rawData = null;
      if (chain === "sol") {
        rawData = await fetchSolanaAnalysis(token_address);
        // Normalize RugCheck response to our expected shape
        if (rawData) {
          rawData = {
            is_honeypot: rawData.rugged ? "1" : "0",
            is_open_source: "0",
            holder_count: rawData.topHolders?.length?.toString() || "0",
            lp_lock_ratio: "0",
          };
        }
      } else {
        rawData = await fetchGoPlusSecurity(token_address, chain);
      }

      const analysis = computeScore(rawData, chain);

      return json({
        payment_verified: true,
        token_address,
        chain,
        timestamp: new Date().toISOString(),
        safety_score:   analysis.score,
        verdict:        analysis.verdict,
        flags:          analysis.flags,
        details:        analysis.details,
        meta: {
          price_paid_usd: PRICE_USD,
          api_version: "2.0.0",
        },
      });
    }

    // ── 404 ─────────────────────────────────────────────────────────────────
    return json({
      error: "Not Found",
      available_endpoints: ["GET /", "GET /chains", "GET /health", "POST /preview", "POST /scan"],
    }, 404);
  },
};

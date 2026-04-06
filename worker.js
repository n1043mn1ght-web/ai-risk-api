const PRICE_USDC = 0.1;

// ─── WALLETS ─────────────────────────────────────────────
const WALLETS = {
  evm: "0xEC2284A7bd7F44cB32faF66a7129a4354B47F172",
  sol: "8ktcWtZdjJQNefuPvGE5kHEdRV2NaPfZKWTFH3QDt1g",
};

// ─── CHAINS ───────────────────────────────────────────────
const CHAINS = {
  eth: { alchemyNet: "eth-mainnet", type: "evm" },
  polygon: { alchemyNet: "polygon-mainnet", type: "evm" },
  arbitrum: { alchemyNet: "arb-mainnet", type: "evm" },
  optimism: { alchemyNet: "opt-mainnet", type: "evm" },
  base: { alchemyNet: "base-mainnet", type: "evm" },
  bsc: { rpc: "https://bsc-dataseed.binance.org/", type: "evm" },
  monad: { rpc: "https://rpc.monad.xyz", type: "evm" },
  sol: { alchemyNet: "solana-mainnet", type: "sol" },
};

// ─── CORS ────────────────────────────────────────────────
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: CORS,
  });
}

// ─── RPC ────────────────────────────────────────────────
function rpcUrl(chain, alchemyKey) {
  const c = CHAINS[chain];
  if (!c) return null;

  if (c.type === "sol") {
    return `https://solana-mainnet.g.alchemy.com/v2/${alchemyKey}`;
  }

  if (c.rpc) return c.rpc;

  return `https://${c.alchemyNet}.g.alchemy.com/v2/${alchemyKey}`;
}

// ─── PAYMENT CHECK ───────────────────────────────────────
async function verifyPayment(txHash, chain, env) {
  const url = rpcUrl(chain, env.ALCHEMY_KEY);
  if (!url) return { verified: false };

  // SOLANA
  if (chain === "sol") {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTransaction",
        params: [
          txHash,
          { encoding: "jsonParsed" },
        ],
      }),
    });

    const data = await res.json();
    const tx = data.result;

    if (!tx || tx.meta?.err) return { verified: false };

    const ok = (tx.transaction.message.instructions || []).some((ix) => {
      const p = ix.parsed;
      return (
        p?.type === "transfer" &&
        p.info?.destination === WALLETS.sol
      );
    });

    return { verified: ok };
  }

  // EVM
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getTransactionByHash",
      params: [txHash],
    }),
  });

  const data = await res.json();
  const tx = data.result;

  if (!tx) return { verified: false };

  return {
    verified:
      tx.to?.toLowerCase() === WALLETS.evm.toLowerCase(),
  };
}

// ─── TOKEN DATA ──────────────────────────────────────────
async function fetchTokenData(token) {
  try {
    const res = await fetch(
      `https://api.gopluslabs.io/api/v1/token_security/1?contract_addresses=${token}`
    );
    const data = await res.json();
    return data?.result?.[token.toLowerCase()] || null;
  } catch {
    return null;
  }
}

// ─── SCORE ENGINE ────────────────────────────────────────
function computeScore(data) {
  if (!data) {
    return { score: 50, verdict: "UNKNOWN", flags: ["NO_DATA"] };
  }

  let score = 100;
  const flags = [];

  if (data.is_honeypot === "1") {
    score -= 50;
    flags.push("HONEYPOT");
  }

  if (data.is_mintable === "1") {
    score -= 10;
    flags.push("MINTABLE");
  }

  if (data.buy_tax > 0.1) {
    score -= 10;
    flags.push("HIGH_BUY_TAX");
  }

  if (data.sell_tax > 0.1) {
    score -= 10;
    flags.push("HIGH_SELL_TAX");
  }

  score = Math.max(0, Math.min(100, score));

  let verdict = "BUY";
  if (score < 80) verdict = "CAUTION";
  if (score < 60) verdict = "HIGH_RISK";
  if (score < 40) verdict = "SKIP";

  return { score, verdict, flags };
}

// ─── AI EXPLANATION ──────────────────────────────────────
async function explain(result, env) {
  try {
    const res = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "user",
              content: `Explain this crypto risk clearly:\n${JSON.stringify(result, null, 2)}`,
            },
          ],
        }),
      }
    );

    const data = await res.json();
    return data.choices?.[0]?.message?.content;
  } catch {
    return "AI unavailable";
  }
}

// ─── MAIN ────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // HEALTH
    if (path === "/health") {
      return json({ status: "ok" });
    }

    // LIST CHAINS
    if (path === "/chains") {
      return json({
        chains: Object.keys(CHAINS).map((c) => ({
          id: c,
          type: CHAINS[c].type,
        })),
      });
    }

    // FREE PREVIEW
    if (path === "/preview") {
      const { token } = await request.json();
      const data = await fetchTokenData(token);
      return json({ preview: true, ...computeScore(data) });
    }

    // PAID AGENT
    if (path === "/agent") {
      const body = await request.json();
      const { token, chain = "eth", payment_tx } = body;

      if (!token) return json({ error: "token required" }, 400);

      if (!payment_tx) {
        return json({
          error: "Payment required",
          price: PRICE_USDC,
          wallets: WALLETS,
        }, 402);
      }

      const payment = await verifyPayment(payment_tx, chain, env);

      if (!payment.verified) {
        return json({ error: "Payment not verified" }, 402);
      }

      const raw = await fetchTokenData(token);
      const result = computeScore(raw);
      const explanation = await explain(result, env);

      return json({
        token,
        chain,
        ...result,
        explanation,
        paid: true,
      });
    }

    return json({ error: "Not found" }, 404);
  },
};

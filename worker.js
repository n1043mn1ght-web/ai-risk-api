export default {
  async fetch(request) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "application/json"
    };

    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
    if (request.method !== "POST") return new Response("POST only", { status: 405, headers: corsHeaders });

    try {
      const body = await request.json();
      const { token_address, chain, payment_tx } = body;

      // 🔑 НАСТРОЙКИ КЛЮЧЕЙ
      const ALCHEMY_KEY = "ТВОЙ_КЛЮЧ_ОТ_ALCHEMY"; 
      const QUICKNODE_SOL_URL = "ТВОЙ_URL_ОТ_QUICKNODE"; 

      if (!token_address || !chain) {
        return new Response(JSON.stringify({ error: "token_address and chain required" }), { status: 400, headers: corsHeaders });
      }

      const network = chain.toLowerCase();

      // 💰 1. PAYWALL (x402)
      if (!payment_tx) {
        return new Response(JSON.stringify({
          error: "Payment Required",
          code: 402,
          payment: {
            price_usd: 0.002,
            chains: ["eth", "bsc", "polygon", "base", "arbitrum", "optimism", "monad", "sol", "sui"],
            addresses: {
              evm: "0xEC2284A7bd7F44cB32faF66a7129a4354B47F172",
              sol: "8ktcWtZdjJQNefuPvGE5kHEdRV2NaPfZKWTFH3QDt1gS",
              sui: "0xaebdf03de6b2df4ea8d1346d6ac085f226110aec8f81e1081e2a618c4062c76c"
            }
          }
        }), { status: 402, headers: corsHeaders });
      }

      // 🔍 2. BLOCKCHAIN VERIFICATION (RPC)
      let isPaid = false;
      const rpcEndpoints = {
        "eth": `https://alchemy.com{ALCHEMY_KEY}`,
        "polygon": `https://alchemy.com{ALCHEMY_KEY}`,
        "arbitrum": `https://alchemy.com{ALCHEMY_KEY}`,
        "base": `https://alchemy.com{ALCHEMY_KEY}`,
        "optimism": `https://alchemy.com{ALCHEMY_KEY}`,
        "monad": "https://monad.xyz", // Monad Devnet/Testnet RPC
        "bsc": "https://llamarpc.com",
        "sol": QUICKNODE_SOL_URL || "https://solana.com",
        "sui": "https://sui.io"
      };

      const rpcUrl = rpcEndpoints[network];

      if (rpcUrl) {
        try {
          // Универсальная проверка для всех EVM сетей
          if (["eth", "polygon", "arbitrum", "base", "optimism", "monad", "bsc"].includes(network)) {
            const res = await fetch(rpcUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionByHash", params: [payment_tx] })
            });
            const txData = await res.json();
            // Проверка получателя платежа
            if (txData.result?.to?.toLowerCase() === "0xec2284a7bd7f44cb32faf66a7129a4354B47F172".toLowerCase()) isPaid = true;
          } 
          else if (network === "sol") {
            const res = await fetch(rpcUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTransaction", params: [payment_tx, {encoding: "json", maxSupportedTransactionVersion:0}] })
            });
            const txData = await res.json();
            if (txData.result) isPaid = true;
          }
        } catch (e) { console.error("RPC Error:", e); }
      }

      // 🧠 3. RISK ENGINE (GoPlus)
      // Маппинг ID сетей для GoPlus API
      const goplusChainIds = { 
        "eth": "1", "bsc": "56", "polygon": "137", 
        "arbitrum": "42161", "optimism": "10", "base": "8453" 
      };
      const goplusId = goplusChainIds[network] || "1";

      let score = 100;
      let riskData = {};

      try {
        const goplusRes = await fetch(`https://gopluslabs.io{goplusId}?contract_addresses=${token_address.toLowerCase()}`);
        const goplusJson = await goplusRes.json();
        riskData = goplusJson.result?.[token_address.toLowerCase()] || {};

        const is_rugged = riskData.is_honeypot === "1" || riskData.is_blacklisted === "1";
        const liquidity = parseFloat(riskData.lp_lock_ratio || "0");

        if (is_rugged) score -= 80;
        if (liquidity < 50) score -= 20;
      } catch (e) {
        score = 50; // Ошибка анализа - средний риск
      }

      score = Math.max(0, Math.min(100, Math.round(score)));
      const action = score >= 70 ? "BUY" : "SKIP";

      return new Response(JSON.stringify({
        payment_verified: isPaid,
        safety_score: score,
        action,
        verdict: action === "BUY" ? "SAFE_TO_TRADE" : "DO_NOT_TRADE",
        risk: { 
          is_rugged: riskData.is_honeypot === "1", 
          liquidity_locked: riskData.lp_lock_ratio || "0",
          top_holders: riskData.top10_holder_ratio || "0"
        },
        network_checked: network,
        timestamp: Date.now()
      }), { headers: corsHeaders });

    } catch (err) {
      return new Response(JSON.stringify({ error: "Internal Error", msg: err.message }), { status: 500, headers: corsHeaders });
    }
  }
};

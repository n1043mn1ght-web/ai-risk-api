export default {
  async fetch(request) {
    // Настройка CORS заголовков
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "application/json"
    };

    // Обработка Preflight запроса (для браузеров)
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return new Response("POST only", { status: 405, headers: corsHeaders });
    }

    try {
      const body = await request.json();
      const { token_address, chain, payment_tx } = body;

      if (!token_address || !chain) {
        return new Response(JSON.stringify({
          error: "token_address and chain required"
        }), { status: 400, headers: corsHeaders });
      }

      // 💰 ШАГ 1. PAYMENT REQUIRED (x402)
      if (!payment_tx) {
        return new Response(JSON.stringify({
          error: "Payment Required",
          code: 402,
          payment: {
            price_usd: 0.002,
            chains: ["eth", "sol", "sui"],
            addresses: {
              eth: "0xEC2284A7bd7F44cB32faF66a7129a4354B47F172",
              sol: "8ktcWtZdjJQNefuPvGE5kHEdRV2NaPfZKWTFH3QDt1gS",
              sui: "0xaebdf03de6b2df4ea8d1346d6ac085f226110aec8f81e1081e2a618c4062c76c"
            }
          }
        }), { status: 402, headers: corsHeaders });
      }

      // ⚠️ ШАГ 2. MOCK VALIDATION
      const payment_valid = payment_tx.length > 10;
      if (!payment_valid) {
        return new Response(JSON.stringify({ error: "Invalid payment hash" }), { status: 402, headers: corsHeaders });
      }

      // 🧠 ШАГ 3. GO+ API (Маппинг сетей)
      const chainMap = {
        "eth": "1",
        "bsc": "56",
        "polygon": "137",
        "arbitrum": "42161",
        "base": "8453"
      };

      const chainId = chainMap[chain.toLowerCase()] || chain;
      let riskData = {};

      try {
        const res = await fetch(`https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${token_address.toLowerCase()}`);
        const json = await res.json();
        riskData = json.result?.[token_address.toLowerCase()] || {};
      } catch (e) {
        console.error("GoPlus API error", e);
      }

      // 📊 ШАГ 4. NORMALIZATION & SCORING
      const is_rugged = riskData.is_honeypot === "1" || riskData.is_blacklisted === "1";
      const liquidity = parseFloat(riskData.lp_lock_ratio || "0");
      const holders = parseFloat(riskData.top10_holder_ratio || "0");

      let score = 100;
      if (is_rugged) score -= 70;
      score += (liquidity * 0.3); // Прибавляем за заблокированную ликвидность
      score -= (holders * 0.5);   // Отымаем, если у топ-холдеров слишком много

      score = Math.max(0, Math.min(100, Math.round(score)));

      // 🏁 ШАГ 5. VERDICT
      const action = score >= 70 ? "BUY" : "SKIP";

      return new Response(JSON.stringify({
        safety_score: score,
        action,
        verdict: action === "BUY" ? "SAFE_TO_TRADE" : "DO_NOT_TRADE",
        confidence: 0.9,
        risk: {
          is_rugged,
          liquidity_locked: Math.round(liquidity),
          top_holders_share: Math.round(holders)
        },
        timestamp: Date.now()
      }), { headers: corsHeaders });

    } catch (err) {
      return new Response(JSON.stringify({ error: "Server Error", details: err.message }), { status: 500, headers: corsHeaders });
    }
  }
};

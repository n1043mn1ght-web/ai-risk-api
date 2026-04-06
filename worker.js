export default {
  async fetch(request) {
    if (request.method !== "POST") {
      return new Response("POST only", { status: 405 });
    }

    const body = await request.json();
    const { token_address, chain, payment_tx } = body;

    if (!token_address || !chain) {
      return new Response(JSON.stringify({
        error: "token_address and chain required"
      }), { status: 400 });
    }

    // 💰 PAYMENT REQUIRED (x402 style)
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
      }), { status: 402 });
    }

    // ⚠️ MOCK VALIDATION (в MVP)
    const payment_valid = payment_tx.length > 10;

    if (!payment_valid) {
      return new Response(JSON.stringify({
        error: "Invalid payment"
      }), { status: 402 });
    }

    // 🧠 GO+ API (пример)
    let riskData = {};

    try {
      const res = await fetch(`https://api.gopluslabs.io/api/v1/token_security/${chain}?contract_addresses=${token_address}`);
      const json = await res.json();
      riskData = json.result?.[token_address.toLowerCase()] || {};
    } catch (e) {
      riskData = {};
    }

    // 🧠 NORMALIZATION
    const is_rugged = riskData.is_honeypot === "1";

    const liquidity = parseFloat(riskData.lp_lock_ratio || "0");
    const holders = parseFloat(riskData.top10_holder_ratio || "0");

    // 🧠 SCORE ENGINE
    let score = 100;

    if (is_rugged) score -= 70;
    score += liquidity * 0.3;
    score -= holders * 0.5;

    score = Math.max(0, Math.min(100, Math.round(score)));

    // 🧠 VERDICT (killer feature)
    let action = "BUY";

    if (score < 70) action = "SKIP";

    // 🧠 RESPONSE
    return new Response(JSON.stringify({
      safety_score: score,
      action,
      verdict: action === "BUY" ? "SAFE_TO_TRADE" : "DO_NOT_TRADE",
      confidence: 0.9,
      risk: {
        is_rugged,
        liquidity_locked: liquidity,
        top_holders_share: holders
      }
    }), {
      headers: { "Content-Type": "application/json" }
    });
  }
};

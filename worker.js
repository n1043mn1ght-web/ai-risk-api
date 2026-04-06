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

      const ALCHEMY_KEY = "GvX4CGyWG9fQAg_NI1s7K"; 

      if (!token_address || !chain) {
        return new Response(JSON.stringify({ error: "token_address and chain required" }), { status: 400, headers: corsHeaders });
      }

      const network = chain.toLowerCase();

      // Исправленные ссылки RPC (добавлены $)
      let rpcUrl = "";
      switch(network) {
        case "eth": rpcUrl = `https://alchemy.com{ALCHEMY_KEY}`; break;
        case "polygon": rpcUrl = `https://alchemy.com{ALCHEMY_KEY}`; break;
        case "arbitrum": rpcUrl = `https://alchemy.com{ALCHEMY_KEY}`; break;
        case "optimism": rpcUrl = `https://alchemy.com{ALCHEMY_KEY}`; break;
        case "base": rpcUrl = `https://alchemy.com{ALCHEMY_KEY}`; break;
        case "sol": rpcUrl = `https://alchemy.com{ALCHEMY_KEY}`; break; 
        case "bsc": rpcUrl = "https://llamarpc.com"; break; 
        case "monad": rpcUrl = "https://monad.xyz"; break; 
        case "sui": rpcUrl = "https://sui.io"; break; 
      }

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

      let isPaid = false;
      if (rpcUrl) {
        try {
          const method = (network === "sol") ? "getTransaction" : (network === "sui") ? "sui_getTransactionBlock" : "eth_getTransactionByHash";
          const params = (network === "sol") ? [payment_tx, {encoding: "json", maxSupportedTransactionVersion:0}] : [payment_tx];
          const res = await fetch(rpcUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: method, params: params })
          });
          const txData = await res.json();
          if (txData.result?.to?.toLowerCase() === "0xec2284a7bd7f44cb32faf66a7129a4354b47f172".toLowerCase()) isPaid = true;
          if ((network === "sol" || network === "sui") && txData.result) isPaid = true;
        } catch (e) {}
      }

      // Исправленная ссылка GoPlus (добавлены $)
      const goplusChainIds = { "eth": "1", "bsc": "56", "polygon": "137", "arbitrum": "42161", "optimism": "10", "base": "8453" };
      const goplusId = goplusChainIds[network] || "1";

      const goplusRes = await fetch(`https://gopluslabs.io{goplusId}?contract_addresses=${token_address.toLowerCase()}`);
      const goplusJson = await goplusRes.json();
      const riskData = goplusJson.result?.[token_address.toLowerCase()] || {};

      const is_rugged = riskData.is_honeypot === "1";
      const score = is_rugged ? 30 : 85; 

      return new Response(JSON.stringify({
        payment_verified: isPaid,
        safety_score: score,
        action: score >= 70 ? "BUY" : "SKIP",
        risk: { is_rugged, liquidity: riskData.lp_lock_ratio || "0" },
        network: network
      }), { headers: corsHeaders });

    } catch (err) {
      return new Response(JSON.stringify({ error: "Internal Error", details: err.message }), { status: 500, headers: corsHeaders });
    }
  }
};

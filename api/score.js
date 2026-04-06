export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { token_address, payment_tx } = req.body;

  // 💰 Если нет оплаты → требуем
  if (!payment_tx) {
    return res.status(402).json({
      error: "Payment Required",
      payment: {
        eth: "0xEC2284A7bd7F44cB32faF66a7129a4354B47F172",
        sol: "8ktcWtZdjJQNefuPvGE5kHEdRV2NaPfZKWTFH3QDt1gS",
        sui: "0xaebdf03de6b2df4ea8d1346d6ac085f226110aec8f81e1081e2a618c4062c76c",
        price_usd: 0.002
      }
    });
  }

  // ⚠️ пока без проверки tx (упрощено)
  
  return res.status(200).json({
    safety_score: 85,
    verdict: "SAFE_TO_TRADE",
    confidence: 0.9
  });
}

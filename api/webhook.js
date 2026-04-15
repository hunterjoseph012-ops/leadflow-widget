const VERIFY_TOKEN = "leadflow_webhook_2024";

const conversations = {};

const SYSTEM_PROMPT = "You are LeadFlow AI - a sharp, friendly lead qualification assistant for LeadFlow, a UK B2B appointment setting agency. YOUR PERSONALITY: Warm, enthusiastic, naturally conversational. Responses SHORT: 1-3 sentences max. Ask ONE question at a time. British English. QUALIFICATION: GOOD FIT: coaches, consultants, agencies, real estate, financial advisers, B2B service businesses, willing to invest 500+ GBP/month, decision maker. NOT A FIT: ecommerce, B2C, retail, zero budget, not decision maker. FLOW: 1. Greet and ask about business 2. Explore lead gen challenges 3. Ask monthly growth investment 4. Confirm decision maker 5. Make qualification call. When QUALIFIED: excited, ask for name email and phone. End with ##QUALIFIED##. When you have all contact details: thank them, say team will be in touch within 24 hours. End with ##SAVE_LEAD##. When NOT QUALIFIED: kind, explain why, wish well. End with ##NOT_QUALIFIED##";

async function callClaude(userId, userMessage) {
  if (!conversations[userId]) conversations[userId] = [];
  conversations[userId].push({ role: "user", content: userMessage });
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 350,
      system: SYSTEM_PROMPT,
      messages: conversations[userId]
    })
  });
  const data = await response.json();
  const reply = data.content[0].text;
  conversations[userId].push({ role: "assistant", content: reply });
  return reply;
}

async function sendFBMessage(recipientId, text, accessToken) {
  const clean = text.replace(/##QUALIFIED##/g, "").replace(/##SAVE_LEAD##/g, "").replace(/##NOT_QUALIFIED##/g, "").trim();
  await fetch("https://graph.facebook.com/v18.0/me/messages?access_token=" + accessToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipient: { id: recipientId }, message: { text: clean } })
  });
}

async function saveLead(userId) {
  try {
    const msgs = conversations[userId] || [];
    const emailRe = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/;
    const phoneRe = /(\+?[\d][\d\s\-\(\)\.]{8,18}[\d])/;
    let email = "", phone = "", name = "Unknown";
    for (const m of msgs.filter(m => m.role === "user").reverse()) {
      if (!email && emailRe.test(m.content)) email = m.content.match(emailRe)[0];
      if (!phone) { const p = m.content.match(phoneRe); if (p) phone = p[0].trim(); }
    }
    const nameRe = /(?:hi|hey|thanks|thank you|great|perfect),?\s+([A-Z][a-z]+)/i;
    for (const m of msgs.filter(m => m.role === "assistant").reverse()) {
      const match = m.content.match(nameRe);
      if (match) { name = match[1]; break; }
    }
    await fetch(process.env.SUPABASE_URL + "/rest/v1/leads", {
      method: "POST",
      headers: { "apikey": process.env.SUPABASE_KEY, "Authorization": "Bearer " + process.env.SUPABASE_KEY, "Content-Type": "application/json", "Prefer": "return=minimal" },
      body: JSON.stringify({ lead_name: name, email, phone, client_id: "0a5f9d27-55c3-4503-b2e2-8499fa6b6939", status: "New", created_at: new Date().toISOString() })
    });
  } catch(e) { console.error("saveLead error:", e); }
}

module.exports = async function handler(req, res) {
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === VERIFY_TOKEN) return res.status(200).send(challenge);
    return res.status(403).send("Forbidden");
  }
  if (req.method === "POST") {
    try {
      const entry = req.body.entry?.[0];
      const messaging = entry?.messaging?.[0] || entry?.changes?.[0]?.value?.messages?.[0];
      if (!messaging) return res.status(200).send("OK");
      const senderId = messaging.sender?.id || messaging.from;
      const messageText = messaging.message?.text || messaging.text?.body;
      if (!messageText || !senderId) return res.status(200).send("OK");
      const reply = await callClaude(senderId, messageText);
      await sendFBMessage(senderId, reply, process.env.PAGE_ACCESS_TOKEN);
      if (reply.includes("##SAVE_LEAD##")) await saveLead(senderId);
    } catch(e) { console.error("Webhook error:", e); }
    return res.status(200).send("OK");
  }
  res.status(405).send("Method not allowed");
};
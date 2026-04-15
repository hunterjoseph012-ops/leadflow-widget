const Anthropic = require('@anthropic-ai/sdk');

const VERIFY_TOKEN = 'leadflow_webhook_2024';

const SYSTEM_PROMPT = 'You are LeadFlow AI - a sharp, friendly lead qualification assistant for LeadFlow, a UK B2B appointment setting agency. YOUR PERSONALITY: Warm, enthusiastic, and naturally conversational. Responses are SHORT: 1-3 sentences maximum. Ask ONE question at a time. British English throughout. QUALIFICATION CRITERIA: GOOD FIT: coaches, consultants, agencies, real estate, financial advisers, B2B service businesses, willing to invest 500+/month, decision maker. NOT A FIT: ecommerce, B2C, retai
@"
const Anthropic = require('@anthropic-ai/sdk');

const VERIFY_TOKEN = 'leadflow_webhook_2024';

const SYSTEM_PROMPT = 'You are LeadFlow AI - a sharp, friendly lead qualification assistant for LeadFlow, a UK B2B appointment setting agency. YOUR PERSONALITY: Warm, enthusiastic, naturally conversational. Responses SHORT: 1-3 sentences max. Ask ONE question at a time. British English. QUALIFICATION: GOOD FIT: coaches, consultants, agencies, real estate, financial advisers, B2B service businesses, willing to invest 500+ GBP/month, decision maker. NOT A FIT: ecommerce, B2C, retail, zero budget, not decision maker. FLOW: 1. Greet and ask about business 2. Explore lead gen challenges 3. Ask monthly growth investment 4. Confirm decision maker 5. Make qualification call. When QUALIFIED: excited, ask for name email and phone. End with ##QUALIFIED##. When you have contact details: thank them, say team will be in touch within 24 hours. End with ##SAVE_LEAD##. When NOT QUALIFIED: kind, explain why, wish well. End with ##NOT_QUALIFIED##';

const conversations = {};

async function callClaude(userId, userMessage) {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    if (!conversations[userId]) conversations[userId] = [];
    conversations[userId].push({ role: 'user', content: userMessage });
    const response = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 350,
        system: SYSTEM_PROMPT,
        messages: conversations[userId]
    });
    const reply = response.content[0].text;
    conversations[userId].push({ role: 'assistant', content: reply });
    return reply;
}

async function sendMessage(recipientId, message, accessToken) {
    const clean = message.replace(/##QUALIFIED##/g,'').replace(/##SAVE_LEAD##/g,'').replace(/##NOT_QUALIFIED##/g,'').trim();
    await fetch('https://graph.facebook.com/v18.0/me/messages?access_token=' + accessToken, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient: { id: recipientId }, message: { text: clean } })
    });
}

async function saveLead(userId, messages) {
    try {
        const emailRe = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/;
        const phoneRe = /(\+?[\d][\d\s\-\(\)\.]{8,18}[\d])/;
        let email = '', phone = '', name = 'Unknown';
        for (const msg of messages.filter(m => m.role === 'user').reverse()) {
            if (!email && emailRe.test(msg.content)) email = msg.content.match(emailRe)[0];
            if (!phone) { const pm = msg.content.match(phoneRe); if (pm) phone = pm[0].trim(); }
        }
        const nameRe = /(?:hi|hey|thanks|thank you|great|perfect),?\s+([A-Z][a-z]+)/i;
        for (const msg of messages.filter(m => m.role === 'assistant').reverse()) {
            const match = msg.content.match(nameRe);
            if (match) { name = match[1]; break; }
        }
        await fetch(process.env.SUPABASE_URL + '/rest/v1/leads', {
            method: 'POST',
            headers: { 'apikey': process.env.SUPABASE_KEY, 'Authorization': 'Bearer ' + process.env.SUPABASE_KEY, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
            body: JSON.stringify({ lead_name: name, email, phone, client_id: '0a5f9d27-55c3-4503-b2e2-8499fa6b6939', status: 'New', created_at: new Date().toISOString() })
        });
    } catch(err) { console.error('Save lead error:', err); }
}

module.exports = async function handler(req, res) {
    if (req.method === 'GET') {
        const mode = req.query['hub.mode'];
        const token = req.query['hub.verify_token'];
        const challenge = req.query['hub.challenge'];
        if (mode === 'subscribe' && token === VERIFY_TOKEN) return res.status(200).send(challenge);
        return res.status(403).send('Forbidden');
    }
    if (req.method === 'POST') {
        const body = req.body;
        try {
            const entry = body.entry?.[0];
            const messaging = entry?.messaging?.[0] || entry?.changes?.[0]?.value?.messages?.[0];
            if (!messaging) return res.status(200).send('OK');
            const senderId = messaging.sender?.id || messaging.from;
            const messageText = messaging.message?.text || messaging.text?.body;
            if (!messageText || !senderId) return res.status(200).send('OK');
            const accessToken = process.env.PAGE_ACCESS_TOKEN;
            const reply = await callClaude(senderId, messageText);
            await sendMessage(senderId, reply, accessToken);
            if (reply.includes('##SAVE_LEAD##')) await saveLead(senderId, conversations[senderId] || []);
        } catch(err) { console.error('Webhook error:', err); }
        return res.status(200).send('OK');
    }
    res.status(405).send('Method not allowed');
};

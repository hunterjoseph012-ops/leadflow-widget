const Anthropic = require('@anthropic-ai/sdk');

const VERIFY_TOKEN = 'leadflow_webhook_2024';

const SYSTEM_PROMPT = You are LeadFlow AI - a sharp, friendly lead qualification assistant for LeadFlow, a UK B2B appointment setting agency.

YOUR PERSONALITY:
- Warm, enthusiastic, and naturally conversational
- Responses are SHORT: 1-3 sentences maximum
- Ask ONE question at a time
- British English throughout

QUALIFICATION CRITERIA:
GOOD FIT: coaches, consultants, agencies, real estate, financial advisers, B2B service businesses, willing to invest £500+/month, decision maker
NOT A FIT: ecommerce, B2C, retail, zero budget, not decision maker

CONVERSATION FLOW:
1. Greet and ask about their business
2. Explore their lead gen challenges
3. Ask about monthly growth investment
4. Confirm decision maker status
5. Make qualification call

When QUALIFIED: tell them LeadFlow is a great fit, ask for name, email and phone number. End message with ##QUALIFIED##
When you have their contact details: thank them and tell them the team will be in touch within 24 hours. End with ##SAVE_LEAD##
When NOT QUALIFIED: be kind, explain why, wish them well. End with ##NOT_QUALIFIED##;

const conversations = {};

async function callClaude(userId, userMessage) {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    
    if (!conversations[userId]) {
        conversations[userId] = [];
    }
    
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

async function sendMessage(recipientId, message, platform, accessToken) {
    const cleanMessage = message
        .replace(/##QUALIFIED##/g, '')
        .replace(/##SAVE_LEAD##/g, '')
        .replace(/##NOT_QUALIFIED##/g, '')
        .trim();

    let url, body;
    
    if (platform === 'instagram') {
        url = 'https://graph.facebook.com/v18.0/me/messages';
        body = {
            recipient: { id: recipientId },
            message: { text: cleanMessage },
            messaging_type: 'RESPONSE'
        };
    } else {
        url = 'https://graph.facebook.com/v18.0/me/messages';
        body = {
            recipient: { id: recipientId },
            message: { text: cleanMessage }
        };
    }

    await fetch(url + '?access_token=' + accessToken, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
}

async function saveLead(userId, messages) {
    try {
        const emailRe = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/;
        const phoneRe = /(\+?[\d][\d\s\-\(\)\.]{8,18}[\d])/;
        
        let email = '', phone = '', name = 'Unknown';
        
        for (const msg of messages.filter(m => m.role === 'user').reverse()) {
            if (!email && emailRe.test(msg.content)) email = msg.content.match(emailRe)[0];
            if (!phone) {
                const pm = msg.content.match(phoneRe);
                if (pm) phone = pm[0].trim();
            }
        }
        
        const nameRe = /(?:hi|hey|thanks|thank you|great|perfect),?\s+([A-Z][a-z]+)/i;
        for (const msg of messages.filter(m => m.role === 'assistant').reverse()) {
            const match = msg.content.match(nameRe);
            if (match) { name = match[1]; break; }
        }

        await fetch(process.env.SUPABASE_URL + '/rest/v1/leads', {
            method: 'POST',
            headers: {
                'apikey': process.env.SUPABASE_KEY,
                'Authorization': 'Bearer ' + process.env.SUPABASE_KEY,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
            },
            body: JSON.stringify({
                lead_name: name,
                email,
                phone,
                client_id: '0a5f9d27-55c3-4503-b2e2-8499fa6b6939',
                status: 'New',
                created_at: new Date().toISOString()
            })
        });
    } catch (err) {
        console.error('Save lead error:', err);
    }
}

module.exports = async function handler(req, res) {
    if (req.method === 'GET') {
        const mode = req.query['hub.mode'];
        const token = req.query['hub.verify_token'];
        const challenge = req.query['hub.challenge'];
        
        if (mode === 'subscribe' && token === VERIFY_TOKEN) {
            return res.status(200).send(challenge);
        }
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
            
            const platform = body.object === 'instagram' ? 'instagram' : 'page';
            const accessToken = platform === 'instagram' 
                ? process.env.INSTAGRAM_ACCESS_TOKEN 
                : process.env.PAGE_ACCESS_TOKEN;
            
            const reply = await callClaude(senderId, messageText);
            await sendMessage(senderId, reply, platform, accessToken);
            
            if (reply.includes('##SAVE_LEAD##')) {
                await saveLead(senderId, conversations[senderId] || []);
            }
            
        } catch (err) {
            console.error('Webhook error:', err);
        }
        
        return res.status(200).send('OK');
    }

    res.status(405).send('Method not allowed');
};

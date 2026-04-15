const VERIFY_TOKEN = "leadflow_webhook_2024";

module.exports = async function handler(req, res) {
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === VERIFY_TOKEN) return res.status(200).send(challenge);
    return res.status(403).send("Forbidden");
  }
  if (req.method === "POST") {
    return res.status(200).send("OK");
  }
  res.status(405).send("Method not allowed");
};
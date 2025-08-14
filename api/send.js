/**
 * Vercel Serverless Function to send OneSignal notifications.
 * Uses CommonJS syntax (require) for compatibility.
 */
const admin = require('firebase-admin');
const fetch = require('node-fetch');

// --- Firebase Admin Initialization ---
if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(process.env.SERVICE_ACCOUNT_JSON))
    });
  } catch (err) {
    console.error("Firebase Admin initialization error:", err);
  }
}

const db = admin.firestore();

// --- Main Handler Function ---
module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = req.headers["x-api-key"];
  if (!apiKey || apiKey !== process.env.API_KEY) {
    return res.status(401).json({ error: "Unauthorized - Invalid API Key" });
  }

  if (!process.env.ONESIGNAL_APP_ID || !process.env.ONESIGNAL_REST_API_KEY) {
      console.error("OneSignal environment variables not set.");
      return res.status(500).json({ error: "OneSignal configuration missing on server." });
  }

  try {
    const { title, message, toAll } = req.body;

    if (!title || !message) {
      return res.status(400).json({ error: "Missing title or message" });
    }

    const payload = {
      app_id: process.env.ONESIGNAL_APP_ID,
      headings: { en: title },
      contents: { en: message },
    };

    if (toAll) {
      payload.included_segments = ["All"];
    } else {
      const usersSnapshot = await db.collection("users").where("playerId", "!=", null).get();
      const playerIds = [];
      usersSnapshot.forEach(doc => {
        const data = doc.data();
        if (data && data.playerId) {
          playerIds.push(data.playerId);
        }
      });

      if (playerIds.length === 0) {
        return res.status(200).json({ success: true, message: "No subscribed users found." });
      }
      payload.include_player_ids = playerIds;
    }

    const response = await fetch("https://onesignal.com/api/v1/notifications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Basic ${process.env.ONESIGNAL_REST_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    console.log("📤 OneSignal Response:", data);

    if (data.errors) {
      return res.status(500).json({ success: false, error: data.errors });
    }

    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("❌ Error:", error);
    return res.status(500).json({ success: false, error: "Internal Server Error" });
  }
};

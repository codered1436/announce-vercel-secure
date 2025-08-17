/**
 * Vercel Serverless Function to send OneSignal notifications.
 * Reads user data from Firebase Realtime Database.
 */
const admin = require('firebase-admin');
const fetch = require('node-fetch');

// --- Firebase Admin Initialization ---
if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(process.env.SERVICE_ACCOUNT_JSON)),
      // IMPORTANT: This must point to your Realtime Database
      databaseURL: "https://announce-cad6a-default-rtdb.asia-southeast1.firebasedatabase.app"
    });
  } catch (err) {
    console.error("Firebase Admin initialization error:", err);
    // If initialization fails, stop the function immediately
    return;
  }
}

// Get a reference to the Realtime Database service
const rtdb = admin.database();

// --- Main Handler Function ---
module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = req.headers["x-api-key"];
  if (!apiKey || apiKey !== process.env.API_KEY) {
    return res.status(401).json({ error: "Unauthorized - Invalid API Key" });
  }

  if (!process.env.ONESIGNAL_APP_ID || !process.env.ONESIGNAL_REST_KEY) {
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
      // Fetch users from Realtime Database
      const usersRef = rtdb.ref("users");
      const snapshot = await usersRef.once("value");
      const users = snapshot.val();

      const playerIds = [];
      if (users) {
        for (const uid in users) {
          if (users[uid] && users[uid].playerId) {
            playerIds.push(users[uid].playerId);
          }
        }
      }

      if (playerIds.length === 0) {
        console.log("No subscribed users with playerIds found in Realtime Database.");
        return res.status(200).json({ success: true, message: "No subscribed users found." });
      }
      payload.include_player_ids = playerIds;
    }

    const response = await fetch("https://onesignal.com/api/v1/notifications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Basic ${process.env.ONESIGNAL_REST_KEY}`,
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
    console.error("❌ Error processing request:", error);
    return res.status(500).json({ success: false, error: "Internal Server Error" });
  }
};

import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

// CORS Configuration
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  next();
});

const PORT = process.env.PORT || 10000;

// MULTI-STORE CONFIGURATION (Shopify Client ID/Secret)
const stores = {
  cartigo: {
    shop: process.env.CARTIGO_SHOP,
    clientId: process.env.CARTIGO_CLIENT_ID,
    clientSecret: process.env.CARTIGO_CLIENT_SECRET,
    trackingPage: "https://cartigo.shop/apps/track-order"
  },
  cutiee: {
    shop: process.env.CUTIEE_SHOP,
    clientId: process.env.CUTIEE_CLIENT_ID,
    clientSecret: process.env.CUTIEE_CLIENT_SECRET,
    trackingPage: "https://cutiee.in/apps/track-order"
  }
};

const orderCache = new Map();
const tokenCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// AUTO-FETCH SHOPIFY ACCESS TOKEN (24-Hour Expiry handling)
async function getAccessToken(storeName, storeConfig) {
  const cached = tokenCache.get(storeName);
  
  // Return cached token if valid
  if (cached && cached.expiresAt > Date.now() + 5 * 60 * 1000) {
    return cached.token;
  }

  // Request fresh token via Client Credentials Grant
  const response = await fetch(`https://${storeConfig.shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: storeConfig.clientId,
      client_secret: storeConfig.clientSecret,
      grant_type: "client_credentials"
    })
  });

  const data = await response.json();

  if (!data.access_token) {
    console.error("Token Error:", data);
    throw new Error(`Failed to fetch token for ${storeName}`);
  }

  const expiresInMs = (data.expires_in || 86400) * 1000;
  tokenCache.set(storeName, {
    token: data.access_token,
    expiresAt: Date.now() + expiresInMs
  });

  return data.access_token;
}

// AUTO-DETECT COURIER LINK
function getCourierLink(courier, trackingNumber) {
  if (!trackingNumber || trackingNumber === "Not available") return null;
  const c = (courier || "").toLowerCase();
  
  if (c.includes("delhivery")) return `https://www.delhivery.com/tracking/?id=${trackingNumber}`;
  if (c.includes("bluedart")) return `https://www.bluedart.com/tracking?track=${trackingNumber}`;
  if (c.includes("ekart")) return `https://ekartlogistics.com/shipmenttrack/${trackingNumber}`;
  if (c.includes("shiprocket")) return `https://www.shiprocket.in/shipment-tracking/?awb=${trackingNumber}`;
  if (c.includes("dtdc")) return `https://www.dtdc.in/tracking/shipment-tracking.asp`;
  
  return `https://t.17track.net/en#nums=${trackingNumber}`;
}

// TRACK ORDER ENDPOINT
app.post("/track", async (req, res) => {
  try {
    const { store, email, orderId } = req.body;

    if (!email || !orderId || !store) {
      return res.json({ error: "Missing store, email, or orderId" });
    }

    const storeConfig = stores[store];
    if (!storeConfig || !storeConfig.shop || !storeConfig.clientId || !storeConfig.clientSecret) {
      return res.json({ error: "Invalid store configuration" });
    }

    const cleanId = orderId.replace("#", "").trim();
    const cacheKey = `${store}-${cleanId}-${email}`;

    // 1. Check Cache
    if (orderCache.has(cacheKey)) {
      const cachedData = orderCache.get(cacheKey);
      if (Date.now() - cachedData.timestamp < CACHE_TTL) {
        return res.json(cachedData.response);
      } else {
        orderCache.delete(cacheKey);
      }
    }

    // 2. Refresh Token Automatically
    const activeToken = await getAccessToken(store, storeConfig);

    // 3. Fetch Order
    const shopifyRes = await fetch(
      `https://${storeConfig.shop}/admin/api/2023-10/orders.json?status=any&name=${cleanId}`,
      {
        headers: {
          "X-Shopify-Access-Token": activeToken,
          "Content-Type": "application/json",
        },
      }
    );

    const data = await shopifyRes.json();

    if (!data.orders || data.orders.length === 0) {
      return res.json({ error: "Order not found" });
    }

    const order = data.orders.find((o) => {
      return (
        o.email.toLowerCase() === email.toLowerCase() &&
        (o.name === orderId || o.name === `#${cleanId}` || o.order_number == cleanId)
      );
    });

    if (!order) {
      return res.json({ error: "Order not found or email mismatch" });
    }

    const fulfillment = order.fulfillments && order.fulfillments.length > 0
        ? order.fulfillments[0] : null;

    let trackingNumber = "Not available";
    if (fulfillment) {
      if (fulfillment.tracking_number) {
        trackingNumber = fulfillment.tracking_number;
      } else if (fulfillment.tracking_numbers && fulfillment.tracking_numbers.length > 0) {
        trackingNumber = fulfillment.tracking_numbers[0];
      }
    }

    const courier = fulfillment?.tracking_company || "Not assigned";
    const courierLink = getCourierLink(courier, trackingNumber);

    const responsePayload = {
      orderId: order.name,
      status: fulfillment ? "Shipped" : "Processing",
      trackingNumber: trackingNumber,
      courier: courier,
      trackingUrl: courierLink,
      storeBrandedPage: storeConfig.trackingPage,
      estimatedDelivery: fulfillment ? "3-5 Days" : "Will be updated after dispatch",
    };

    // 4. Save to Cache
    orderCache.set(cacheKey, {
      response: responsePayload,
      timestamp: Date.now()
    });

    res.json(responsePayload);

  } catch (err) {
    console.error("ERROR:", err);
    res.json({ error: "Server error or Token failure" });
  }
});

app.get("/", (req, res) => res.send("Multi-Store Tracking API Running"));

app.listen(PORT, () => console.log(`Server running on ${PORT}`));

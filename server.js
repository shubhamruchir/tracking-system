import express from "express";
import fetch from "node-fetch";
import fs from "fs";

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  next();
});

const PORT = 10000;

// Load stores
const loadStores = () =>
  JSON.parse(fs.readFileSync("./stores.json"));

// Cache
const CACHE = {};
const CACHE_TTL = 2 * 60 * 1000;

// Detect store
const getStore = (req) => {
  const stores = loadStores();
  const host =
    req.headers.origin ||
    req.headers.referer ||
    req.headers.host ||
    "";

  const match = Object.keys(stores).find((d) =>
    host.includes(d)
  );

  return match ? stores[match] : null;
};

// Courier links
const getTrackingLink = (courier, tn) => {
  if (!tn) return null;
  courier = (courier || "").toLowerCase();

  if (courier.includes("delhivery"))
    return `https://www.delhivery.com/track/package/${tn}`;
  if (courier.includes("bluedart"))
    return `https://www.bluedart.com/track/${tn}`;
  if (courier.includes("dtdc"))
    return `https://www.dtdc.in/tracking/${tn}`;
  if (courier.includes("amazon"))
    return `https://track.amazon.in/tracking/${tn}`;
  if (courier.includes("xpressbees"))
    return `https://www.xpressbees.com/track?awb=${tn}`;
  if (courier.includes("shadowfax"))
    return `https://shadowfax.in/track/${tn}`;
  if (courier.includes("ekart"))
    return `https://ekartlogistics.com/shipmenttrack/${tn}`;

  return `https://www.google.com/search?q=${tn}+tracking`;
};

// Fetch orders
const getOrders = async (SHOP, TOKEN) => {
  if (
    CACHE[SHOP] &&
    Date.now() - CACHE[SHOP].time < CACHE_TTL
  ) {
    return CACHE[SHOP].data;
  }

  const res = await fetch(
    `https://${SHOP}/admin/api/2023-10/orders.json?status=any&limit=50`,
    {
      headers: {
        "X-Shopify-Access-Token": TOKEN,
      },
    }
  );

  const data = await res.json();

  CACHE[SHOP] = { data, time: Date.now() };

  return data;
};

// API
app.post("/track", async (req, res) => {
  try {
    const { email, orderId } = req.body;

    const store = getStore(req);
    if (!store) return res.json({ error: "Store not found" });

    const data = await getOrders(
      store.SHOP,
      store.ACCESS_TOKEN
    );

    const cleanId = orderId.replace("#", "").trim();

    const order = data.orders.find(
      (o) =>
        o.email === email &&
        (o.name === orderId ||
          o.name === `#${cleanId}` ||
          o.order_number == cleanId)
    );

    if (!order)
      return res.json({ error: "Order not found" });

    const f = order.fulfillments?.[0];

    const tn =
      f?.tracking_number ||
      f?.tracking_numbers?.[0] ||
      "Not available";

    const courier = f?.tracking_company || "Unknown";

    res.json({
      brand: store,
      orderId: order.name,
      status: f ? "Shipped" : "Processing",
      trackingNumber: tn,
      courier,
      trackingLink: getTrackingLink(courier, tn),
    });
  } catch {
    res.json({ error: "Server error" });
  }
});

app.listen(PORT, () =>
  console.log("Server running")
);

import express from "express";
import fetch from "node-fetch";
import fs from "fs";

const app = express();
app.use(express.json());

// ✅ CORS
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  next();
});

const PORT = process.env.PORT || 10000;

// ------------------------
// LOAD STORES
// ------------------------
const loadStores = () =>
  JSON.parse(fs.readFileSync("./stores.json"));

// ------------------------
// CACHE
// ------------------------
const CACHE = {};
const CACHE_TTL = 2 * 60 * 1000;

// ------------------------
// DETECT STORE
// ------------------------
const getStore = (req) => {
  const stores = loadStores();

  const host =
    req.headers.origin ||
    req.headers.referer ||
    req.headers.host ||
    "";

  const domain = Object.keys(stores).find((d) =>
    host.includes(d)
  );

  return domain ? stores[domain] : null;
};

// ------------------------
// COURIER TRACKING LINKS
// ------------------------
const getTrackingLink = (courier, tn) => {
  if (!tn) return null;

  courier = (courier || "").toLowerCase();

  if (courier.includes("delhivery"))
    return `https://www.delhivery.com/track/package/${tn}`;

  if (courier.includes("bluedart"))
    return `https://www.bluedart.com/web/guest/trackdartresult?trackNo=${tn}`;

  if (courier.includes("dtdc"))
    return `https://www.dtdc.in/tracking/tracking_results.asp?strCnno=${tn}`;

  if (courier.includes("india post"))
    return `https://www.indiapost.gov.in/_layouts/15/dop.portal.tracking/trackconsignment.aspx?consignment=${tn}`;

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

// ------------------------
// FETCH ORDERS (WITH CACHE)
// ------------------------
const getOrders = async (SHOP, TOKEN) => {
  if (
    CACHE[SHOP] &&
    Date.now() - CACHE[SHOP].time < CACHE_TTL
  ) {
    return CACHE[SHOP].data;
  }

  const res = await fetch(
    `https://${SHOP}/admin/api/2023-10/orders.json?status=any&limit=50&fields=id,name,email,order_number,fulfillments`,
    {
      headers: {
        "X-Shopify-Access-Token": TOKEN,
      },
    }
  );

  const data = await res.json();

  CACHE[SHOP] = {
    data,
    time: Date.now(),
  };

  return data;
};

// ------------------------
// ROOT (FIX FOR SHOPIFY UI)
// ------------------------
app.get("/", (req, res) => {
  res.send("Tracking API is running 🚀");
});

// ------------------------
// TRACK API
// ------------------------
app.post("/track", async (req, res) => {
  try {
    const { email, orderId } = req.body;

    if (!email || !orderId) {
      return res.json({ error: "Missing fields" });
    }

    const store = getStore(req);

    if (!store) {
      return res.json({ error: "Store not mapped" });
    }

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

    if (!order) {
      return res.json({ error: "Order not found" });
    }

    const f = order.fulfillments?.[0] || null;

    const trackingNumber =
      f?.tracking_number ||
      f?.tracking_numbers?.[0] ||
      "Not available";

    const courier =
      f?.tracking_company || "Not assigned";

    res.json({
      brand: store,
      orderId: order.name,
      status: f ? "Shipped" : "Processing",
      trackingNumber,
      courier,
      trackingLink: getTrackingLink(
        courier,
        trackingNumber
      ),
    });
  } catch (err) {
    console.log(err);
    res.json({ error: "Server error" });
  }
});

// ------------------------
app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});

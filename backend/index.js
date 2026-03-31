
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");
const { MongoClient } = require("mongodb");

const PORT = process.env.PORT || 3001;
const TOKEN_SECRET = process.env.TOKEN_SECRET || "green-heart-secret";
const DB_PATH = path.join(__dirname, "data", "db.json");
const MONGODB_URI = process.env.MONGODB_URI || "";
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || "greenheart";
const MONGODB_COLLECTION_NAME = process.env.MONGODB_COLLECTION_NAME || "app_state";
const ADMIN_SEED_EMAIL = (process.env.ADMIN_SEED_EMAIL || "").trim().toLowerCase();
const ADMIN_SEED_PASSWORD = process.env.ADMIN_SEED_PASSWORD || "";
const ADMIN_SEED_NAME = (process.env.ADMIN_SEED_NAME || "Platform Admin").trim();

const PLAN_CONFIG = {
  monthly: { amount: 199, label: "Monthly", billingMonths: 1 },
  yearly: { amount: 1999, label: "Yearly", billingMonths: 12 },
};

const DRAW_TIER = { 5: 0.4, 4: 0.35, 3: 0.25 };
const PRIZE_POOL_CONTRIBUTION_PCT = 0.4;

const defaultDb = {
  users: [],
  subscriptions: [],
  scores: [],
  charities: [
    {
      id: "charity_junior_golf",
      name: "Junior Golf Access Fund",
      description: "Supports youth access to golf coaching and local clubs.",
      category: "Youth",
      imageUrl: "",
      featured: true,
      isActive: true,
      upcomingEvents: [{ id: "evt_1", title: "Junior Golf Day", date: "2026-06-12" }],
      totalRaised: 0,
      createdAt: new Date().toISOString(),
    },
    {
      id: "charity_green_course",
      name: "Green Course Restoration",
      description: "Funds sustainable water and soil improvements in public courses.",
      category: "Environment",
      imageUrl: "",
      featured: false,
      isActive: true,
      upcomingEvents: [{ id: "evt_2", title: "Community Golf Day", date: "2026-07-05" }],
      totalRaised: 0,
      createdAt: new Date().toISOString(),
    },
  ],
  draws: [],
  donations: [],
  transactions: [],
  winnerClaims: [],
  settings: { jackpotRollover: 0 },
};

let dbCache = null;
let mongoClient = null;
let mongoCollection = null;
let mongoReady = false;
let mongoWriteQueue = Promise.resolve();

function id(prefix) {
  return `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(3).toString("hex")}`;
}

function normalizeDb(parsed = {}) {
  return {
    users: Array.isArray(parsed.users) ? parsed.users : [],
    subscriptions: Array.isArray(parsed.subscriptions) ? parsed.subscriptions : [],
    scores: Array.isArray(parsed.scores) ? parsed.scores : [],
    charities: Array.isArray(parsed.charities) && parsed.charities.length > 0 ? parsed.charities : [...defaultDb.charities],
    draws: Array.isArray(parsed.draws) ? parsed.draws : [],
    donations: Array.isArray(parsed.donations) ? parsed.donations : [],
    transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
    winnerClaims: Array.isArray(parsed.winnerClaims) ? parsed.winnerClaims : [],
    settings: parsed.settings && typeof parsed.settings === "object" ? { ...defaultDb.settings, ...parsed.settings } : { ...defaultDb.settings },
  };
}

function cloneDb(data) {
  return JSON.parse(JSON.stringify(data));
}

async function ensureDb() {
  if (MONGODB_URI) {
    try {
      mongoClient = new MongoClient(MONGODB_URI);
      await mongoClient.connect();
      mongoCollection = mongoClient.db(MONGODB_DB_NAME).collection(MONGODB_COLLECTION_NAME);
      mongoReady = true;

      const doc = await mongoCollection.findOne({ _id: "main" });
      if (!doc) {
        dbCache = normalizeDb(defaultDb);
        await mongoCollection.insertOne({ _id: "main", ...dbCache, updatedAt: new Date().toISOString() });
      } else {
        dbCache = normalizeDb(doc);
      }
    } catch (error) {
      console.error("MongoDB connection failed. Falling back to local file DB.", error.message);
      mongoReady = false;
      mongoCollection = null;
      if (mongoClient) {
        try { await mongoClient.close(); } catch {}
      }
      mongoClient = null;
    }
  }

  if (!dbCache) {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(DB_PATH)) fs.writeFileSync(DB_PATH, JSON.stringify(defaultDb, null, 2), "utf8");
    const raw = fs.readFileSync(DB_PATH, "utf8");
    dbCache = normalizeDb(JSON.parse(raw || "{}"));
  }

  ensureAdminSeed(readDb());
}

function readDb() {
  if (!dbCache) return normalizeDb(defaultDb);
  return cloneDb(dbCache);
}

function writeDb(data) {
  dbCache = normalizeDb(data);
  if (mongoReady && mongoCollection) {
    const snapshot = cloneDb(dbCache);
    mongoWriteQueue = mongoWriteQueue
      .then(() =>
        mongoCollection.updateOne(
          { _id: "main" },
          { $set: { ...snapshot, updatedAt: new Date().toISOString() } },
          { upsert: true }
        )
      )
      .catch((error) => {
        console.error("MongoDB write failed:", error.message);
      });
  } else {
    fs.writeFileSync(DB_PATH, JSON.stringify(dbCache, null, 2), "utf8");
  }
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 64, "sha512").toString("hex");
  return { salt, hash };
}

function verifyPassword(password, user) {
  const candidate = hashPassword(password, user.salt);
  return candidate.hash === user.passwordHash;
}

function encodeToken(payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", TOKEN_SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function decodeToken(token) {
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const expectedSig = crypto.createHmac("sha256", TOKEN_SECRET).update(body).digest("base64url");
  if (sig !== expectedSig) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
    profile: user.profile || null,
  };
}

function parseDate(value) {
  const d = value ? new Date(value) : new Date();
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function addMonths(dateObj, months) {
  const d = new Date(dateObj);
  d.setMonth(d.getMonth() + months);
  return d;
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
  });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
      if (body.length > 2_000_000) reject(new Error("Payload too large"));
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function getTokenFromHeader(req) {
  const authHeader = req.headers.authorization || "";
  return authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
}

function latestSubscription(db, userId) {
  return db.subscriptions.filter((sub) => sub.userId === userId).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] || null;
}

function userScores(db, userId) {
  return db.scores.filter((item) => item.userId === userId).sort((a, b) => new Date(b.date) - new Date(a.date));
}

function syncSubscriptions(db, userId = null) {
  const now = new Date();
  const target = userId ? db.subscriptions.filter((s) => s.userId === userId) : db.subscriptions;

  target.forEach((sub) => {
    if (sub.status !== "active") return;
    const cfg = PLAN_CONFIG[sub.plan] || PLAN_CONFIG.monthly;

    while (new Date(sub.nextBillingDate) <= now) {
      if (sub.cancelAtPeriodEnd) {
        sub.status = "lapsed";
        sub.cancelledAt = new Date(sub.nextBillingDate).toISOString();
        break;
      }

      sub.renewalCount = (sub.renewalCount || 0) + 1;
      sub.totalCharged = Number(((sub.totalCharged || sub.amount) + sub.amount).toFixed(2));

      const charityAmount = Number((sub.amount * (sub.charityPercentage / 100)).toFixed(2));
      const charity = db.charities.find((item) => item.id === sub.charityId);
      if (charity) charity.totalRaised = Number((Number(charity.totalRaised || 0) + charityAmount).toFixed(2));

      db.donations.push({
        id: id("don"),
        userId: sub.userId,
        charityId: sub.charityId,
        amount: charityAmount,
        type: "subscription_renewal",
        subscriptionId: sub.id,
        createdAt: new Date(sub.nextBillingDate).toISOString(),
      });

      db.transactions.push({
        id: id("txn"),
        userId: sub.userId,
        subscriptionId: sub.id,
        kind: "subscription_renewal",
        amount: sub.amount,
        currency: sub.currency || "INR",
        status: "paid",
        reference: `renewal_${sub.id}_${sub.renewalCount}`,
        createdAt: new Date(sub.nextBillingDate).toISOString(),
      });

      sub.nextBillingDate = addMonths(new Date(sub.nextBillingDate), cfg.billingMonths).toISOString();
    }

    sub.lastCheckedAt = now.toISOString();
  });
}

function requireAuth(req, res, db) {
  const token = getTokenFromHeader(req);
  const payload = decodeToken(token);
  if (!payload?.userId) {
    sendJson(res, 401, { error: "Unauthorized" });
    return null;
  }

  syncSubscriptions(db, payload.userId);

  const user = db.users.find((item) => item.id === payload.userId);
  if (!user) {
    sendJson(res, 401, { error: "Invalid token user" });
    return null;
  }

  return user;
}

function requireAdmin(req, res, db) {
  const user = requireAuth(req, res, db);
  if (!user) return null;
  if (user.role !== "admin") {
    sendJson(res, 403, { error: "Admin access required" });
    return null;
  }
  return user;
}

function requireActiveSubscriber(req, res, db) {
  const user = requireAuth(req, res, db);
  if (!user) return null;
  const sub = latestSubscription(db, user.id);
  if (!sub || sub.status !== "active") {
    sendJson(res, 403, { error: "Active subscription required for this action." });
    return null;
  }
  return { user, subscription: sub };
}
function monthlyKey(date = new Date()) {
  return { month: date.getMonth() + 1, year: date.getFullYear() };
}

function getMonthlyPublishedDraw(db, month, year) {
  return db.draws.find((draw) => draw.month === month && draw.year === year && draw.status === "published");
}

function uniqueRandomNumbers(count, min, max) {
  const set = new Set();
  while (set.size < count) set.add(Math.floor(Math.random() * (max - min + 1)) + min);
  return [...set].sort((a, b) => a - b);
}

function generateAlgorithmicNumbers(db, bias = "most") {
  const freq = new Map();
  db.scores.forEach((score) => {
    const n = Number(score.score);
    if (n >= 1 && n <= 45) freq.set(n, (freq.get(n) || 0) + 1);
  });

  const entries = [];
  for (let i = 1; i <= 45; i += 1) entries.push({ n: i, c: freq.get(i) || 0 });

  entries.sort((a, b) => (bias === "least" ? a.c - b.c : b.c - a.c));
  return entries.slice(0, 5).map((item) => item.n).sort((a, b) => a - b);
}

function eligibleEntries(db) {
  syncSubscriptions(db);
  const activeSubs = db.subscriptions.filter((sub) => sub.status === "active");

  return activeSubs
    .map((sub) => {
      const scores = userScores(db, sub.userId).slice(0, 5);
      return { userId: sub.userId, subscription: sub, scores: scores.map((s) => Number(s.score)) };
    })
    .filter((entry) => entry.scores.length === 5);
}

function evaluateDraw(db, winningNumbers, month, year) {
  const entries = eligibleEntries(db);
  const totalPoolFromSubs = entries.reduce((sum, entry) => sum + entry.subscription.amount * PRIZE_POOL_CONTRIBUTION_PCT, 0);
  const rollover = Number(db.settings.jackpotRollover || 0);
  const totalPool = Number((totalPoolFromSubs + rollover).toFixed(2));

  const tierPool = {
    5: Number((totalPool * DRAW_TIER[5]).toFixed(2)),
    4: Number((totalPool * DRAW_TIER[4]).toFixed(2)),
    3: Number((totalPool * DRAW_TIER[3]).toFixed(2)),
  };

  const winnersByTier = { 3: [], 4: [], 5: [] };
  entries.forEach((entry) => {
    const matchCount = entry.scores.filter((score) => winningNumbers.includes(score)).length;
    if (matchCount >= 3 && matchCount <= 5) winnersByTier[matchCount].push({ userId: entry.userId, matchCount });
  });

  const payout = { 3: [], 4: [], 5: [] };
  [3, 4, 5].forEach((tier) => {
    const winners = winnersByTier[tier];
    if (winners.length > 0) {
      const share = Number((tierPool[tier] / winners.length).toFixed(2));
      payout[tier] = winners.map((winner) => ({ ...winner, amount: share }));
    }
  });

  const nextRollover = winnersByTier[5].length === 0 ? tierPool[5] : 0;

  return {
    month,
    year,
    winningNumbers,
    entries: entries.length,
    pool: {
      total: totalPool,
      fromSubscriptions: Number(totalPoolFromSubs.toFixed(2)),
      rolloverFromPrev: rollover,
      tiers: { match5: tierPool[5], match4: tierPool[4], match3: tierPool[3] },
      rolloverToNext: Number(nextRollover.toFixed(2)),
    },
    winners: { match5: payout[5], match4: payout[4], match3: payout[3] },
    stats: { winners5: payout[5].length, winners4: payout[4].length, winners3: payout[3].length },
  };
}

function makeDraw(db, mode, options = {}) {
  const now = new Date();
  const { month, year } = monthlyKey(now);

  let winningNumbers;
  if (mode === "algorithmic_most") winningNumbers = generateAlgorithmicNumbers(db, "most");
  else if (mode === "algorithmic_least") winningNumbers = generateAlgorithmicNumbers(db, "least");
  else winningNumbers = uniqueRandomNumbers(5, 1, 45);

  const evalResult = evaluateDraw(db, winningNumbers, month, year);

  return {
    id: id("draw"),
    month,
    year,
    mode,
    status: options.status || "simulation",
    winningNumbers,
    pool: evalResult.pool,
    winners: evalResult.winners,
    stats: evalResult.stats,
    entries: evalResult.entries,
    createdAt: now.toISOString(),
    publishedAt: options.status === "published" ? now.toISOString() : null,
  };
}

function dashboardSnapshot(db, userId) {
  const scores = userScores(db, userId).slice(0, 5);
  const averageScore = scores.length ? Math.round(scores.reduce((sum, item) => sum + Number(item.score), 0) / scores.length) : 0;
  const sub = latestSubscription(db, userId);
  const donations = db.donations.filter((item) => item.userId === userId);
  const totalDonated = Number(donations.reduce((sum, item) => sum + Number(item.amount || 0), 0).toFixed(2));

  const publishedDraws = db.draws.filter((draw) => draw.status === "published");
  const claims = db.winnerClaims.filter((claim) => claim.userId === userId);
  const totalWon = Number(claims.filter((c) => c.status === "paid").reduce((sum, c) => sum + Number(c.amount || 0), 0).toFixed(2));

  return {
    subscription: sub,
    recentScores: scores,
    averageScore,
    totalDonated,
    drawsWon: claims.filter((c) => c.status === "paid").length,
    selectedCharityId: sub?.charityId || null,
    charityContributionPercentage: sub?.charityPercentage || null,
    participation: {
      drawsEntered: publishedDraws.length,
      upcomingDrawMonth: monthlyKey(new Date(Date.now() + 25 * 24 * 60 * 60 * 1000)),
    },
    winnings: {
      totalWon,
      claims: claims.map((claim) => ({ id: claim.id, drawId: claim.drawId, amount: claim.amount, status: claim.status, payoutStatus: claim.payoutStatus })),
    },
  };
}

function ensureAdminSeed(db) {
  const existing = db.users.find((user) => user.role === "admin");
  if (existing) {
    writeDb(db);
    return;
  }

  if (!ADMIN_SEED_EMAIL || !ADMIN_SEED_PASSWORD) {
    writeDb(db);
    return;
  }

  const { salt, hash } = hashPassword(ADMIN_SEED_PASSWORD);
  db.users.push({
    id: id("user"),
    name: ADMIN_SEED_NAME,
    email: ADMIN_SEED_EMAIL,
    role: "admin",
    salt,
    passwordHash: hash,
    createdAt: new Date().toISOString(),
    profile: { preferredCharityId: null, contributionPercentage: 10 },
  });

  writeDb(db);
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
    });
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  try {
    if (req.method === "GET" && pathname === "/api/health") {
      sendJson(res, 200, { status: "ok", service: "golf-charity-api" });
      return;
    }

    if (req.method === "POST" && pathname === "/api/auth/register") {
      const body = await readBody(req);
      const name = (body.name || "").trim();
      const email = (body.email || "").trim().toLowerCase();
      const password = body.password || "";

      if (!name || !email || password.length < 6) {
        sendJson(res, 400, { error: "Name, email and password(min 6) are required." });
        return;
      }

      const db = readDb();
      if (db.users.some((item) => item.email === email)) {
        sendJson(res, 409, { error: "Email already exists." });
        return;
      }

      const { salt, hash } = hashPassword(password);
      const user = {
        id: id("user"),
        name,
        email,
        role: "member",
        salt,
        passwordHash: hash,
        createdAt: new Date().toISOString(),
        profile: { preferredCharityId: null, contributionPercentage: 10 },
      };

      db.users.push(user);
      writeDb(db);

      const token = encodeToken({ userId: user.id, role: user.role });
      sendJson(res, 201, { token, user: publicUser(user) });
      return;
    }

    if (req.method === "POST" && pathname === "/api/auth/login") {
      const body = await readBody(req);
      const email = (body.email || "").trim().toLowerCase();
      const password = body.password || "";

      const db = readDb();
      const user = db.users.find((item) => item.email === email);
      if (!user || !verifyPassword(password, user)) {
        sendJson(res, 401, { error: "Invalid credentials." });
        return;
      }

      syncSubscriptions(db, user.id);
      writeDb(db);

      const token = encodeToken({ userId: user.id, role: user.role });
      sendJson(res, 200, { token, user: publicUser(user) });
      return;
    }

    if (req.method === "GET" && pathname === "/api/auth/me") {
      const db = readDb();
      const user = requireAuth(req, res, db);
      if (!user) return;
      writeDb(db);
      sendJson(res, 200, { user: publicUser(user) });
      return;
    }
    if (req.method === "GET" && pathname === "/api/charities") {
      const db = readDb();
      const q = (url.searchParams.get("q") || "").toLowerCase();
      const category = (url.searchParams.get("category") || "").toLowerCase();
      const featuredOnly = url.searchParams.get("featured") === "true";

      let charities = db.charities.filter((item) => item.isActive);
      if (q) charities = charities.filter((item) => `${item.name} ${item.description}`.toLowerCase().includes(q));
      if (category) charities = charities.filter((item) => (item.category || "").toLowerCase() === category);
      if (featuredOnly) charities = charities.filter((item) => Boolean(item.featured));

      sendJson(res, 200, { charities });
      return;
    }

    if (req.method === "GET" && pathname.startsWith("/api/charities/")) {
      const db = readDb();
      const charityId = pathname.split("/")[3];
      const charity = db.charities.find((item) => item.id === charityId);
      if (!charity) {
        sendJson(res, 404, { error: "Charity not found." });
        return;
      }
      sendJson(res, 200, { charity });
      return;
    }

    if (req.method === "POST" && pathname === "/api/subscriptions") {
      const db = readDb();
      const auth = requireAuth(req, res, db);
      if (!auth) return;

      const body = await readBody(req);
      const selectedPlan = PLAN_CONFIG[body.plan];
      const charity = db.charities.find((item) => item.id === body.charityId && item.isActive);

      if (!selectedPlan) {
        sendJson(res, 400, { error: "Invalid plan." });
        return;
      }
      if (!charity) {
        sendJson(res, 400, { error: "Valid charity is required." });
        return;
      }

      const contributionPercentage = Math.max(10, Math.min(100, Number(body.contributionPercentage || 10)));

      db.subscriptions
        .filter((sub) => sub.userId === auth.id && ["active", "cancel_pending"].includes(sub.status))
        .forEach((sub) => {
          sub.status = "replaced";
          sub.cancelledAt = new Date().toISOString();
        });

      const startDate = new Date();
      const sub = {
        id: id("sub"),
        userId: auth.id,
        plan: body.plan,
        planLabel: selectedPlan.label,
        amount: selectedPlan.amount,
        currency: "INR",
        charityId: body.charityId,
        charityPercentage: contributionPercentage,
        status: "active",
        autoRenew: true,
        cancelAtPeriodEnd: false,
        createdAt: new Date().toISOString(),
        startDate: startDate.toISOString(),
        nextBillingDate: addMonths(startDate, selectedPlan.billingMonths).toISOString(),
        renewalCount: 0,
        totalCharged: selectedPlan.amount,
      };

      const donationAmount = Number((selectedPlan.amount * (contributionPercentage / 100)).toFixed(2));
      const donation = {
        id: id("don"),
        userId: auth.id,
        charityId: body.charityId,
        amount: donationAmount,
        type: "subscription_signup",
        subscriptionId: sub.id,
        createdAt: new Date().toISOString(),
      };

      const transaction = {
        id: id("txn"),
        userId: auth.id,
        subscriptionId: sub.id,
        kind: "subscription_signup",
        amount: selectedPlan.amount,
        currency: "INR",
        status: "paid",
        reference: `signup_${sub.id}`,
        createdAt: new Date().toISOString(),
      };

      charity.totalRaised = Number((Number(charity.totalRaised || 0) + donationAmount).toFixed(2));
      const user = db.users.find((u) => u.id === auth.id);
      if (user) {
        user.profile = user.profile || {};
        user.profile.preferredCharityId = body.charityId;
        user.profile.contributionPercentage = contributionPercentage;
      }

      db.subscriptions.push(sub);
      db.donations.push(donation);
      db.transactions.push(transaction);
      writeDb(db);

      sendJson(res, 201, { subscription: sub, donation, transaction });
      return;
    }

    if (req.method === "GET" && pathname === "/api/subscriptions/me") {
      const db = readDb();
      const user = requireAuth(req, res, db);
      if (!user) return;
      writeDb(db);
      sendJson(res, 200, { subscription: latestSubscription(db, user.id) });
      return;
    }

    if (req.method === "PATCH" && pathname === "/api/subscriptions/me/cancel") {
      const db = readDb();
      const user = requireAuth(req, res, db);
      if (!user) return;

      const sub = latestSubscription(db, user.id);
      if (!sub || sub.status !== "active") {
        sendJson(res, 404, { error: "No active subscription found." });
        return;
      }

      sub.cancelAtPeriodEnd = true;
      sub.status = "cancel_pending";
      sub.cancelledAt = new Date().toISOString();
      writeDb(db);

      sendJson(res, 200, { subscription: sub });
      return;
    }

    if (req.method === "POST" && pathname === "/api/donations/independent") {
      const db = readDb();
      const user = requireAuth(req, res, db);
      if (!user) return;

      const body = await readBody(req);
      const amount = Number(body.amount);
      const charity = db.charities.find((c) => c.id === body.charityId && c.isActive);

      if (!charity || !Number.isFinite(amount) || amount <= 0) {
        sendJson(res, 400, { error: "charityId and positive amount are required." });
        return;
      }

      const donation = {
        id: id("don"),
        userId: user.id,
        charityId: body.charityId,
        amount: Number(amount.toFixed(2)),
        type: "independent",
        createdAt: new Date().toISOString(),
      };

      const transaction = {
        id: id("txn"),
        userId: user.id,
        subscriptionId: null,
        kind: "independent_donation",
        amount: donation.amount,
        currency: "INR",
        status: "paid",
        reference: `don_${donation.id}`,
        createdAt: donation.createdAt,
      };

      charity.totalRaised = Number((Number(charity.totalRaised || 0) + donation.amount).toFixed(2));
      db.donations.push(donation);
      db.transactions.push(transaction);
      writeDb(db);

      sendJson(res, 201, { donation, transaction });
      return;
    }

    if (req.method === "GET" && pathname === "/api/transactions/me") {
      const db = readDb();
      const user = requireAuth(req, res, db);
      if (!user) return;

      const transactions = db.transactions
        .filter((item) => item.userId === user.id)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      sendJson(res, 200, { transactions });
      return;
    }

    if (req.method === "POST" && pathname === "/api/scores") {
      const db = readDb();
      const context = requireActiveSubscriber(req, res, db);
      if (!context) return;

      const body = await readBody(req);
      const score = Number(body.score);
      const date = parseDate(body.playedOn || body.date);

      if (!Number.isFinite(score) || score < 1 || score > 45) {
        sendJson(res, 400, { error: "Score must be between 1 and 45 (Stableford)." });
        return;
      }

      const entry = { id: id("score"), userId: context.user.id, score, date: date.toISOString(), createdAt: new Date().toISOString() };
      db.scores.push(entry);

      const all = userScores(db, context.user.id);
      const keep = new Set(all.slice(0, 5).map((s) => s.id));
      db.scores = db.scores.filter((item) => item.userId !== context.user.id || keep.has(item.id));

      writeDb(db);
      sendJson(res, 201, { score: entry });
      return;
    }

    if (req.method === "PATCH" && pathname.startsWith("/api/scores/")) {
      const db = readDb();
      const context = requireActiveSubscriber(req, res, db);
      if (!context) return;

      const scoreId = pathname.split("/")[3];
      const score = db.scores.find((s) => s.id === scoreId && s.userId === context.user.id);
      if (!score) {
        sendJson(res, 404, { error: "Score not found." });
        return;
      }

      const body = await readBody(req);
      const value = Number(body.score);
      const date = parseDate(body.playedOn || body.date || score.date);

      if (!Number.isFinite(value) || value < 1 || value > 45) {
        sendJson(res, 400, { error: "Score must be between 1 and 45 (Stableford)." });
        return;
      }

      score.score = value;
      score.date = date.toISOString();
      writeDb(db);
      sendJson(res, 200, { score });
      return;
    }

    if (req.method === "GET" && pathname === "/api/scores") {
      const db = readDb();
      const user = requireAuth(req, res, db);
      if (!user) return;

      writeDb(db);
      sendJson(res, 200, { scores: userScores(db, user.id) });
      return;
    }

    if (req.method === "GET" && pathname === "/api/dashboard/me") {
      const db = readDb();
      const user = requireAuth(req, res, db);
      if (!user) return;

      writeDb(db);
      sendJson(res, 200, { dashboard: dashboardSnapshot(db, user.id) });
      return;
    }
    if (req.method === "GET" && pathname === "/api/draws/latest") {
      const db = readDb();
      const latest = db.draws.filter((draw) => draw.status === "published").sort((a, b) => new Date(b.publishedAt || b.createdAt) - new Date(a.publishedAt || a.createdAt))[0] || null;
      sendJson(res, 200, { draw: latest });
      return;
    }

    if (req.method === "POST" && pathname === "/api/admin/draws/simulate") {
      const db = readDb();
      const admin = requireAdmin(req, res, db);
      if (!admin) return;

      const { month, year } = monthlyKey(new Date());
      if (getMonthlyPublishedDraw(db, month, year)) {
        sendJson(res, 409, { error: "Monthly draw already published. Next simulation available next month." });
        return;
      }

      const body = await readBody(req);
      const draw = makeDraw(db, body.mode || "random", { status: "simulation" });
      db.draws.push(draw);
      writeDb(db);
      sendJson(res, 201, { draw });
      return;
    }

    if (req.method === "POST" && (pathname === "/api/admin/draws/publish" || pathname === "/api/admin/draws/run")) {
      const db = readDb();
      const admin = requireAdmin(req, res, db);
      if (!admin) return;

      const body = await readBody(req);
      let draw = null;

      if (body.simulationId) {
        draw = db.draws.find((d) => d.id === body.simulationId && d.status === "simulation");
        if (!draw) {
          sendJson(res, 404, { error: "Simulation draw not found." });
          return;
        }

        if (getMonthlyPublishedDraw(db, draw.month, draw.year)) {
          sendJson(res, 409, { error: "A published draw already exists for this month." });
          return;
        }
      } else {
        const { month, year } = monthlyKey(new Date());
        if (getMonthlyPublishedDraw(db, month, year)) {
          sendJson(res, 409, { error: "A published draw already exists for this month." });
          return;
        }
        draw = makeDraw(db, body.mode || "random", { status: "simulation" });
        db.draws.push(draw);
      }

      draw.status = "published";
      draw.publishedAt = new Date().toISOString();

      const allWinners = [...draw.winners.match5, ...draw.winners.match4, ...draw.winners.match3];
      allWinners.forEach((winner) => {
        db.winnerClaims.push({
          id: id("claim"),
          drawId: draw.id,
          userId: winner.userId,
          matchCount: winner.matchCount,
          amount: winner.amount,
          status: "pending_proof",
          payoutStatus: "pending",
          proofUrl: null,
          proofUploadedAt: null,
          reviewedBy: null,
          reviewedAt: null,
          payoutCompletedAt: null,
          createdAt: new Date().toISOString(),
        });
      });

      db.settings.jackpotRollover = Number(draw.pool.rolloverToNext || 0);
      writeDb(db);
      sendJson(res, 201, { draw });
      return;
    }

    if (req.method === "GET" && pathname === "/api/winners/me") {
      const db = readDb();
      const user = requireAuth(req, res, db);
      if (!user) return;
      sendJson(res, 200, { claims: db.winnerClaims.filter((claim) => claim.userId === user.id) });
      return;
    }

    if (req.method === "POST" && pathname.startsWith("/api/winners/") && pathname.endsWith("/proof")) {
      const db = readDb();
      const user = requireAuth(req, res, db);
      if (!user) return;

      const claimId = pathname.split("/")[3];
      const claim = db.winnerClaims.find((item) => item.id === claimId && item.userId === user.id);
      if (!claim) {
        sendJson(res, 404, { error: "Claim not found." });
        return;
      }

      const body = await readBody(req);
      const proofUrl = (body.proofUrl || "").trim();
      if (!proofUrl) {
        sendJson(res, 400, { error: "proofUrl is required." });
        return;
      }

      claim.proofUrl = proofUrl;
      claim.proofUploadedAt = new Date().toISOString();
      claim.status = "under_review";
      writeDb(db);
      sendJson(res, 200, { claim });
      return;
    }

    if (req.method === "GET" && pathname === "/api/admin/winners") {
      const db = readDb();
      const admin = requireAdmin(req, res, db);
      if (!admin) return;
      sendJson(res, 200, { winners: db.winnerClaims });
      return;
    }

    if (req.method === "PATCH" && pathname.startsWith("/api/admin/winners/")) {
      const db = readDb();
      const admin = requireAdmin(req, res, db);
      if (!admin) return;

      const claimId = pathname.split("/")[4];
      const claim = db.winnerClaims.find((item) => item.id === claimId);
      if (!claim) {
        sendJson(res, 404, { error: "Claim not found." });
        return;
      }

      const body = await readBody(req);
      if (body.action === "approve") claim.status = "approved";
      else if (body.action === "reject") claim.status = "rejected";
      else if (body.action === "mark_paid") {
        claim.status = "paid";
        claim.payoutStatus = "paid";
        claim.payoutCompletedAt = new Date().toISOString();
      } else {
        sendJson(res, 400, { error: "Invalid action." });
        return;
      }

      claim.reviewedBy = admin.id;
      claim.reviewedAt = new Date().toISOString();
      writeDb(db);
      sendJson(res, 200, { claim });
      return;
    }

    if (req.method === "GET" && pathname === "/api/admin/overview") {
      const db = readDb();
      const admin = requireAdmin(req, res, db);
      if (!admin) return;

      syncSubscriptions(db);

      const activeSubscriptions = db.subscriptions.filter((sub) => sub.status === "active").length;
      const totalRevenue = db.subscriptions.reduce((sum, sub) => sum + Number(sub.totalCharged || sub.amount || 0), 0);
      const totalDonations = db.donations.reduce((sum, donation) => sum + Number(donation.amount || 0), 0);
      const totalPrizePool = db.draws.filter((draw) => draw.status === "published").reduce((sum, draw) => sum + Number(draw.pool?.total || 0), 0);

      writeDb(db);
      sendJson(res, 200, {
        overview: {
          users: db.users.length,
          activeSubscriptions,
          totalRevenue: Number(totalRevenue.toFixed(2)),
          totalDonations: Number(totalDonations.toFixed(2)),
          totalPrizePool: Number(totalPrizePool.toFixed(2)),
          drawStats: {
            totalPublished: db.draws.filter((draw) => draw.status === "published").length,
            simulations: db.draws.filter((draw) => draw.status === "simulation").length,
          },
          jackpotRollover: Number(db.settings.jackpotRollover || 0),
        },
      });
      return;
    }

    if (req.method === "GET" && pathname === "/api/admin/users") {
      const db = readDb();
      const admin = requireAdmin(req, res, db);
      if (!admin) return;

      const users = db.users.map((user) => {
        const sub = latestSubscription(db, user.id);
        return {
          ...publicUser(user),
          subscriptionStatus: sub?.status || "none",
          subscriptionPlan: sub?.plan || null,
          renewalDate: sub?.nextBillingDate || null,
        };
      });

      sendJson(res, 200, { users });
      return;
    }

    if (req.method === "PATCH" && pathname.startsWith("/api/admin/users/")) {
      const db = readDb();
      const admin = requireAdmin(req, res, db);
      if (!admin) return;

      const userId = pathname.split("/")[4];
      const user = db.users.find((u) => u.id === userId);
      if (!user) {
        sendJson(res, 404, { error: "User not found." });
        return;
      }

      const body = await readBody(req);
      if (typeof body.name === "string") user.name = body.name.trim() || user.name;
      if (typeof body.role === "string" && ["member", "admin"].includes(body.role)) user.role = body.role;
      if (body.profile && typeof body.profile === "object") user.profile = { ...(user.profile || {}), ...body.profile };

      writeDb(db);
      sendJson(res, 200, { user: publicUser(user) });
      return;
    }

    if (req.method === "GET" && pathname === "/api/admin/subscriptions") {
      const db = readDb();
      const admin = requireAdmin(req, res, db);
      if (!admin) return;
      syncSubscriptions(db);
      writeDb(db);
      sendJson(res, 200, { subscriptions: db.subscriptions.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)) });
      return;
    }

    if (req.method === "PATCH" && pathname.startsWith("/api/admin/subscriptions/")) {
      const db = readDb();
      const admin = requireAdmin(req, res, db);
      if (!admin) return;

      const subId = pathname.split("/")[4];
      const sub = db.subscriptions.find((s) => s.id === subId);
      if (!sub) {
        sendJson(res, 404, { error: "Subscription not found." });
        return;
      }

      const body = await readBody(req);
      if (typeof body.status === "string" && ["active", "cancel_pending", "cancelled", "lapsed", "replaced"].includes(body.status)) {
        sub.status = body.status;
      }
      if (typeof body.cancelAtPeriodEnd === "boolean") {
        sub.cancelAtPeriodEnd = body.cancelAtPeriodEnd;
      }
      if (typeof body.charityPercentage === "number") {
        sub.charityPercentage = Math.max(10, Math.min(100, body.charityPercentage));
      }

      sub.updatedAt = new Date().toISOString();
      writeDb(db);
      sendJson(res, 200, { subscription: sub });
      return;
    }

    if (req.method === "GET" && pathname === "/api/admin/scores") {
      const db = readDb();
      const admin = requireAdmin(req, res, db);
      if (!admin) return;

      const userId = url.searchParams.get("userId");
      let scores = db.scores;
      if (userId) {
        scores = scores.filter((s) => s.userId === userId);
      }
      scores = scores.slice().sort((a, b) => new Date(b.date) - new Date(a.date));
      sendJson(res, 200, { scores });
      return;
    }

    if (req.method === "PATCH" && pathname.startsWith("/api/admin/scores/")) {
      const db = readDb();
      const admin = requireAdmin(req, res, db);
      if (!admin) return;

      const scoreId = pathname.split("/")[4];
      const score = db.scores.find((s) => s.id === scoreId);
      if (!score) {
        sendJson(res, 404, { error: "Score not found." });
        return;
      }

      const body = await readBody(req);
      if (typeof body.score === "number") {
        if (body.score < 1 || body.score > 45) {
          sendJson(res, 400, { error: "Score must be between 1 and 45 (Stableford)." });
          return;
        }
        score.score = body.score;
      }
      if (body.date || body.playedOn) {
        score.date = parseDate(body.date || body.playedOn).toISOString();
      }

      score.updatedAt = new Date().toISOString();
      writeDb(db);
      sendJson(res, 200, { score });
      return;
    }

    if (req.method === "GET" && pathname === "/api/admin/donations") {
      const db = readDb();
      const admin = requireAdmin(req, res, db);
      if (!admin) return;
      sendJson(res, 200, { donations: db.donations.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)) });
      return;
    }

    if (req.method === "GET" && pathname === "/api/admin/transactions") {
      const db = readDb();
      const admin = requireAdmin(req, res, db);
      if (!admin) return;
      sendJson(res, 200, { transactions: db.transactions.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)) });
      return;
    }

    if (req.method === "GET" && pathname === "/api/admin/draws") {
      const db = readDb();
      const admin = requireAdmin(req, res, db);
      if (!admin) return;
      sendJson(res, 200, { draws: db.draws.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)) });
      return;
    }

    if (req.method === "POST" && pathname === "/api/admin/charities") {
      const db = readDb();
      const admin = requireAdmin(req, res, db);
      if (!admin) return;

      const body = await readBody(req);
      const charity = {
        id: id("charity"),
        name: (body.name || "").trim(),
        description: (body.description || "").trim(),
        category: (body.category || "General").trim(),
        imageUrl: (body.imageUrl || "").trim(),
        featured: Boolean(body.featured),
        isActive: true,
        upcomingEvents: Array.isArray(body.upcomingEvents) ? body.upcomingEvents : [],
        totalRaised: 0,
        createdAt: new Date().toISOString(),
      };

      if (!charity.name) {
        sendJson(res, 400, { error: "Charity name is required." });
        return;
      }

      db.charities.push(charity);
      writeDb(db);
      sendJson(res, 201, { charity });
      return;
    }

    if (req.method === "PATCH" && pathname.startsWith("/api/admin/charities/")) {
      const db = readDb();
      const admin = requireAdmin(req, res, db);
      if (!admin) return;

      const charityId = pathname.split("/")[4];
      const charity = db.charities.find((c) => c.id === charityId);
      if (!charity) {
        sendJson(res, 404, { error: "Charity not found." });
        return;
      }

      const body = await readBody(req);
      ["name", "description", "category", "imageUrl"].forEach((field) => {
        if (typeof body[field] === "string") charity[field] = body[field].trim();
      });
      if (typeof body.featured === "boolean") charity.featured = body.featured;
      if (typeof body.isActive === "boolean") charity.isActive = body.isActive;
      if (Array.isArray(body.upcomingEvents)) charity.upcomingEvents = body.upcomingEvents;

      writeDb(db);
      sendJson(res, 200, { charity });
      return;
    }

    if (req.method === "DELETE" && pathname.startsWith("/api/admin/charities/")) {
      const db = readDb();
      const admin = requireAdmin(req, res, db);
      if (!admin) return;

      const charityId = pathname.split("/")[4];
      const before = db.charities.length;
      db.charities = db.charities.filter((c) => c.id !== charityId);
      if (db.charities.length === before) {
        sendJson(res, 404, { error: "Charity not found." });
        return;
      }

      writeDb(db);
      sendJson(res, 200, { deleted: true });
      return;
    }

    sendJson(res, 404, { error: "Route not found." });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Unexpected server error." });
  }
});

ensureDb()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Golf Charity API running on port ${PORT}`);
      if (mongoReady) {
        console.log(`MongoDB connected (${MONGODB_DB_NAME}.${MONGODB_COLLECTION_NAME})`);
      } else {
        console.log("Using local file database.");
      }
    });
  })
  .catch((error) => {
    console.error("Failed to initialize database:", error.message);
    process.exit(1);
  });

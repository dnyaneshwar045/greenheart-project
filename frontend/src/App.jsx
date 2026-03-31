
import { useEffect, useMemo, useState } from "react";
import "./App.css";

const BRAND_LOGO = "/greenheart-logo.svg";
const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:3001";
const TOKEN_KEY = "greenheart_token";

const HOW_STEPS = [
  { no: "01", title: "Subscribe", text: "Choose monthly or yearly subscription." },
  { no: "02", title: "Enter Scores", text: "Maintain latest 5 Stableford scores." },
  { no: "03", title: "Monthly Draw", text: "Match 3, 4, or 5 to win." },
  { no: "04", title: "Win & Verify", text: "Upload proof and receive payout." },
];

const ADMIN_TABS = [
  { id: "overview", label: "Overview" },
  { id: "draws", label: "Draws" },
  { id: "winners", label: "Winners" },
  { id: "users", label: "Users" },
];

const DRAW_MODES = [
  { id: "random", label: "Random" },
  { id: "algorithmic_most", label: "Most Frequent" },
  { id: "algorithmic_least", label: "Least Frequent" },
];

const CHARITY_COLORS = ["#e8f5e9", "#fff3e0", "#e8eaf6", "#fce4ec"];

function formatINR(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function formatDateDisplay(value) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function statusTone(status = "") {
  if (["active", "approved", "paid", "published"].includes(status)) return "badge-green";
  if (["simulation", "pending", "pending_proof", "under_review", "cancel_pending"].includes(status)) return "badge-gold";
  return "badge-gray";
}

async function apiRequest(path, options = {}, token = "") {
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  } catch {
    throw new Error("Cannot connect to API. Start backend at http://localhost:3001");
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}

function Modal({ open, onClose, children }) {
  if (!open) return null;
  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>x</button>
        {children}
      </div>
    </div>
  );
}

function TopNav({ user, onLogin, onJoin, onLogout }) {
  const go = (id) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  return (
    <nav>
      <div className="nav-inner">
        <button className="logo logo-btn" onClick={() => go("top")}><img src={BRAND_LOGO} alt="greenheart" className="brand-logo" /></button>
        <ul className="nav-links">
          <li><button onClick={() => go("how")}>How It Works</button></li>
          <li><button onClick={() => go("charities")}>Charities</button></li>
          <li><button onClick={() => go("draw")}>Monthly Draw</button></li>
          <li><button onClick={() => go("dashboard")}>Dashboard</button></li>
        </ul>
        <div className="nav-actions">
          {user ? <span className="nav-user">{user.name}</span> : null}
          {user ? <button className="nav-login" onClick={onLogout}>Logout</button> : <button className="nav-login" onClick={onLogin}>Login</button>}
          <button className="nav-cta" onClick={onJoin}>{user ? "Open Dashboard" : "Join Now"}</button>
        </div>
      </div>
    </nav>
  );
}
function LoginModal({ open, onClose, form, setForm, onSubmit, loading, error, onSwitch }) {
  return (
    <Modal open={open} onClose={onClose}>
      <h2>Welcome Back</h2>
      <p className="sub">Login to your member dashboard or admin control center.</p>
      <form className="stack-form" onSubmit={onSubmit}>
        <label>Email<input type="email" required value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} /></label>
        <label>Password<input type="password" required value={form.password} onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))} /></label>
        {error ? <div className="form-error">{error}</div> : null}
        <button className="btn-full btn-full-green" type="submit" disabled={loading}>{loading ? "Signing In..." : "Sign In"}</button>
      </form>
      <p className="switch-auth">New here?<button type="button" onClick={onSwitch}>Create account</button></p>
    </Modal>
  );
}

function SignupModal({ open, onClose, form, setForm, selectedPlan, setSelectedPlan, onSubmit, loading, error, charities, onSwitch }) {
  return (
    <Modal open={open} onClose={onClose}>
      <h2>Join greenheart</h2>
      <p className="sub">Create account and start subscription.</p>
      <div className="plan-toggle">
        <button type="button" className={`plan-toggle-btn ${selectedPlan === "monthly" ? "active" : ""}`} onClick={() => setSelectedPlan("monthly")}>Monthly - {formatINR(199)}</button>
        <button type="button" className={`plan-toggle-btn ${selectedPlan === "yearly" ? "active" : ""}`} onClick={() => setSelectedPlan("yearly")}>Yearly - {formatINR(1999)}</button>
      </div>
      <form className="stack-form" onSubmit={onSubmit}>
        <div className="form-row">
          <label>First Name<input type="text" required value={form.firstName} onChange={(e) => setForm((p) => ({ ...p, firstName: e.target.value }))} /></label>
          <label>Last Name<input type="text" required value={form.lastName} onChange={(e) => setForm((p) => ({ ...p, lastName: e.target.value }))} /></label>
        </div>
        <label>Email<input type="email" required value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} /></label>
        <label>Password<input type="password" minLength={6} required value={form.password} onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))} /></label>
        <label>Charity<select value={form.charityId} onChange={(e) => setForm((p) => ({ ...p, charityId: e.target.value }))}>{charities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label>Contribution %<input type="number" min={10} max={100} value={form.contributionPercentage} onChange={(e) => setForm((p) => ({ ...p, contributionPercentage: Number(e.target.value || 10) }))} /></label>
        {error ? <div className="form-error">{error}</div> : null}
        <button className="btn-full btn-full-green" type="submit" disabled={loading}>{loading ? "Creating..." : "Create Account & Subscribe"}</button>
      </form>
      <p className="switch-auth">Already have account?<button type="button" onClick={onSwitch}>Sign in</button></p>
    </Modal>
  );
}

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || "");
  const [user, setUser] = useState(null);
  const [charities, setCharities] = useState([]);
  const [latestDraw, setLatestDraw] = useState(null);

  const [signupOpen, setSignupOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState("yearly");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");

  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [signupForm, setSignupForm] = useState({ firstName: "", lastName: "", email: "", password: "", charityId: "", contributionPercentage: 10 });

  const [dashboardTab, setDashboardTab] = useState("scores");
  const [scores, setScores] = useState([]);
  const [subscription, setSubscription] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [claims, setClaims] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [proofMap, setProofMap] = useState({});
  const [newScore, setNewScore] = useState("");
  const [newScoreDate, setNewScoreDate] = useState("");

  const [adminTab, setAdminTab] = useState("overview");
  const [adminDrawMode, setAdminDrawMode] = useState("random");
  const [adminOverview, setAdminOverview] = useState(null);
  const [adminUsers, setAdminUsers] = useState([]);
  const [adminDraws, setAdminDraws] = useState([]);
  const [adminWinners, setAdminWinners] = useState([]);

  const [drawnNumbers, setDrawnNumbers] = useState(["-", "-", "-", "-", "-"]);
  const [matched, setMatched] = useState([]);
  const [drawResult, setDrawResult] = useState("Run draw simulation.");

  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const viewCharities = useMemo(() => charities.map((c, i) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    tag: c.category || "General",
    raised: Number(c.totalRaised || 0),
    progress: Math.min(100, 15 + i * 20),
    color: CHARITY_COLORS[i % CHARITY_COLORS.length],
    icon: ["ENV", "YTH", "MED", "COM"][i % 4],
  })), [charities]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(""), 2800);
    return () => clearTimeout(timer);
  }, [notice]);

  async function loadPublic() {
    const [charityData, drawData] = await Promise.all([
      apiRequest("/api/charities"),
      apiRequest("/api/draws/latest").catch(() => ({ draw: null })),
    ]);
    setCharities(charityData.charities || []);
    setLatestDraw(drawData.draw || null);
    if (!signupForm.charityId && charityData.charities?.length) {
      setSignupForm((prev) => ({ ...prev, charityId: charityData.charities[0].id }));
    }
  }

  async function loadMember(activeToken) {
    const [meData, scoreData, subData, dashData, claimData, transactionData] = await Promise.all([
      apiRequest("/api/auth/me", {}, activeToken),
      apiRequest("/api/scores", {}, activeToken),
      apiRequest("/api/subscriptions/me", {}, activeToken),
      apiRequest("/api/dashboard/me", {}, activeToken),
      apiRequest("/api/winners/me", {}, activeToken),
      apiRequest("/api/transactions/me", {}, activeToken),
    ]);

    let effectiveSubscription = subData.subscription || null;
    if (!effectiveSubscription && meData.user.role !== "admin") {
      const charityId = meData.user?.profile?.preferredCharityId || signupForm.charityId || viewCharities[0]?.id;
      if (charityId) {
        await apiRequest("/api/subscriptions", {
          method: "POST",
          body: JSON.stringify({ plan: "monthly", charityId, contributionPercentage: 10 }),
        }, activeToken);

        const [freshSub, freshDash, freshTxn] = await Promise.all([
          apiRequest("/api/subscriptions/me", {}, activeToken),
          apiRequest("/api/dashboard/me", {}, activeToken),
          apiRequest("/api/transactions/me", {}, activeToken),
        ]);

        effectiveSubscription = freshSub.subscription || null;
        setDashboard(freshDash.dashboard || null);
        setTransactions(freshTxn.transactions || []);
        setNotice("Auto subscription created for your new account.");
      }
    }

    setUser(meData.user);
    setScores((scoreData.scores || []).map((s) => ({ id: s.id, num: s.score, date: s.date })));
    setSubscription(effectiveSubscription);
    if (!effectiveSubscription || meData.user.role === "admin") {
      setDashboard(dashData.dashboard || null);
    }
    setClaims(claimData.claims || []);
    if (!effectiveSubscription || meData.user.role === "admin") {
      setTransactions(transactionData.transactions || []);
    }

    if (meData.user.role === "admin") {
      const [overviewData, usersData, drawsData, winnersData] = await Promise.all([
        apiRequest("/api/admin/overview", {}, activeToken),
        apiRequest("/api/admin/users", {}, activeToken),
        apiRequest("/api/admin/draws", {}, activeToken),
        apiRequest("/api/admin/winners", {}, activeToken),
      ]);
      setAdminOverview(overviewData.overview || null);
      setAdminUsers(usersData.users || []);
      setAdminDraws(drawsData.draws || []);
      setAdminWinners(winnersData.winners || []);
    }
  }

  useEffect(() => {
    (async () => {
      try {
        setError("");
        await loadPublic();
        if (token) await loadMember(token);
      } catch (e) {
        setError(e.message);
      }
    })();
  }, []);

  async function handleLogin(event) {
    event.preventDefault();
    setAuthLoading(true);
    setAuthError("");
    try {
      const data = await apiRequest("/api/auth/login", { method: "POST", body: JSON.stringify(loginForm) });
      localStorage.setItem(TOKEN_KEY, data.token);
      setToken(data.token);
      await loadMember(data.token);
      setLoginOpen(false);
      setLoginForm({ email: "", password: "" });
      setNotice(`Welcome back, ${data.user.name}`);
      document.getElementById("dashboard")?.scrollIntoView({ behavior: "smooth" });
    } catch (e) {
      setAuthError(e.message);
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleSignup(event) {
    event.preventDefault();
    setAuthLoading(true);
    setAuthError("");
    try {
      const register = await apiRequest("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          name: `${signupForm.firstName} ${signupForm.lastName}`.trim(),
          email: signupForm.email.trim(),
          password: signupForm.password,
        }),
      });

      await apiRequest("/api/subscriptions", {
        method: "POST",
        body: JSON.stringify({
          plan: selectedPlan,
          charityId: signupForm.charityId,
          contributionPercentage: Number(signupForm.contributionPercentage || 10),
        }),
      }, register.token);

      localStorage.setItem(TOKEN_KEY, register.token);
      setToken(register.token);
      await loadMember(register.token);

      setSignupOpen(false);
      setSignupForm((prev) => ({ ...prev, firstName: "", lastName: "", email: "", password: "" }));
      setNotice("Registration complete. Subscription activated.");
      document.getElementById("dashboard")?.scrollIntoView({ behavior: "smooth" });
    } catch (e) {
      setAuthError(e.message);
    } finally {
      setAuthLoading(false);
    }
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    setToken("");
    setUser(null);
    setScores([]);
    setSubscription(null);
    setDashboard(null);
    setClaims([]);
    setTransactions([]);
    setProofMap({});
    setAdminOverview(null);
    setAdminUsers([]);
    setAdminDraws([]);
    setAdminWinners([]);
    setNotice("Logged out.");
  }

  async function submitScore() {
    const value = Number(newScore);
    if (!Number.isFinite(value) || value < 1 || value > 45) {
      setNotice("Enter score between 1 and 45.");
      return;
    }
    try {
      await apiRequest("/api/scores", { method: "POST", body: JSON.stringify({ score: value, date: newScoreDate || new Date().toISOString() }) }, token);
      await loadMember(token);
      setNewScore("");
      setNewScoreDate("");
      setNotice("Score submitted.");
    } catch (e) {
      setNotice(e.message);
    }
  }

  async function cancelSubscription() {
    try {
      await apiRequest("/api/subscriptions/me/cancel", { method: "PATCH" }, token);
      await loadMember(token);
      setNotice("Subscription set to cancel at period end.");
    } catch (e) {
      setNotice(e.message);
    }
  }

  async function createOrChangeSubscription(plan) {
    if (!token) {
      setNotice("Please login first.");
      return;
    }
    const charityId = user?.profile?.preferredCharityId || signupForm.charityId || viewCharities[0]?.id;
    const contributionPercentage = Number(user?.profile?.contributionPercentage || signupForm.contributionPercentage || 10);
    if (!charityId) {
      setNotice("No active charity available.");
      return;
    }
    try {
      await apiRequest("/api/subscriptions", {
        method: "POST",
        body: JSON.stringify({ plan, charityId, contributionPercentage }),
      }, token);
      await loadMember(token);
      setNotice(`Subscription updated to ${plan}.`);
    } catch (e) {
      setNotice(e.message);
    }
  }

  async function uploadProof(claimId) {
    const proofUrl = (proofMap[claimId] || "").trim();
    if (!proofUrl) {
      setNotice("Please add proof URL.");
      return;
    }
    try {
      await apiRequest(`/api/winners/${claimId}/proof`, {
        method: "POST",
        body: JSON.stringify({ proofUrl }),
      }, token);
      await loadMember(token);
      setProofMap((prev) => ({ ...prev, [claimId]: "" }));
      setNotice("Proof submitted. Waiting for admin review.");
    } catch (e) {
      setNotice(e.message);
    }
  }

  async function refreshAdmin() {
    if (!token || user?.role !== "admin") return;
    const [overviewData, usersData, drawsData, winnersData] = await Promise.all([
      apiRequest("/api/admin/overview", {}, token),
      apiRequest("/api/admin/users", {}, token),
      apiRequest("/api/admin/draws", {}, token),
      apiRequest("/api/admin/winners", {}, token),
    ]);
    setAdminOverview(overviewData.overview || null);
    setAdminUsers(usersData.users || []);
    setAdminDraws(drawsData.draws || []);
    setAdminWinners(winnersData.winners || []);
  }

  async function adminSimulate() {
    try {
      await apiRequest("/api/admin/draws/simulate", { method: "POST", body: JSON.stringify({ mode: adminDrawMode }) }, token);
      await refreshAdmin();
      setNotice("Simulation created.");
    } catch (e) {
      setNotice(e.message);
    }
  }

  async function adminPublish(simulationId = "") {
    try {
      await apiRequest("/api/admin/draws/publish", { method: "POST", body: JSON.stringify({ mode: adminDrawMode, simulationId }) }, token);
      await Promise.all([refreshAdmin(), loadPublic()]);
      setNotice("Draw published.");
    } catch (e) {
      setNotice(e.message);
    }
  }

  async function adminWinner(claimId, action) {
    try {
      await apiRequest(`/api/admin/winners/${claimId}`, { method: "PATCH", body: JSON.stringify({ action }) }, token);
      await refreshAdmin();
      await loadMember(token);
      setNotice(`Winner updated: ${action}`);
    } catch (e) {
      setNotice(e.message);
    }
  }

  async function adminToggleRole(userId, role) {
    try {
      await apiRequest(`/api/admin/users/${userId}`, { method: "PATCH", body: JSON.stringify({ role }) }, token);
      await refreshAdmin();
      setNotice(`User role set to ${role}.`);
    } catch (e) {
      setNotice(e.message);
    }
  }

  function runLocalDraw() {
    const nums = [];
    while (nums.length < 5) {
      const n = Math.floor(Math.random() * 45) + 1;
      if (!nums.includes(n)) nums.push(n);
    }
    const base = scores.slice(0, 5).map((s) => Number(s.num));
    const hits = nums.filter((n) => base.includes(n));
    setDrawnNumbers(nums);
    setMatched(hits);
    setDrawResult(hits.length ? `${hits.length} match this draw.` : "No match this draw.");
  }

  const canAddScore = subscription?.status === "active";

  return (
    <div className="app" id="top">
      <TopNav user={user} onLogin={() => setLoginOpen(true)} onJoin={() => document.getElementById("dashboard")?.scrollIntoView({ behavior: "smooth" }) || setSignupOpen(true)} onLogout={logout} />

      {error ? <p className="page-error">{error}</p> : null}

      <section className="hero">
        <div className="hero-bg" /><div className="hero-grid" /><div className="hero-glow" />
        <div className="hero-content">
          <div className="hero-badge"><div className="hero-dot" /><span>{latestDraw ? `${latestDraw.month}/${latestDraw.year} Draw Published` : "Monthly Draw Active"}</span></div>
          <h1>Golf better.<br /><em>Give more.</em><br />Win big.</h1>
          <p className="hero-sub">Subscription platform combining score tracking, monthly draws, and charity impact.</p>
          <div className="hero-actions">
            <button className="btn-primary" onClick={() => (user ? document.getElementById("dashboard")?.scrollIntoView({ behavior: "smooth" }) : setSignupOpen(true))}>Start Playing</button>
            <button className="btn-outline" onClick={() => document.getElementById("how")?.scrollIntoView({ behavior: "smooth" })}>How It Works</button>
          </div>
        </div>
      </section>

      <section className="section" id="how">
        <div className="section-tag fade-in">How It Works</div>
        <h2 className="section-title fade-in">Simple to join.<br /><em>Powerful</em> to give.</h2>
        <div className="steps">{HOW_STEPS.map((s) => <article key={s.no} className="step fade-in"><div className="step-num">{s.no}</div><div className="step-icon">{s.icon}</div><h3>{s.title}</h3><p>{s.text}</p></article>)}</div>
      </section>

      <section className="plans-section" id="plans">
        <div className="section-tag fade-in">Membership Plans</div>
        <h2 className="section-title fade-in">Monthly {formatINR(199)} or Yearly {formatINR(1999)}</h2>
      </section>

      <section className="section" id="charities">
        <div className="section-tag fade-in">Charities</div>
        <h2 className="section-title fade-in">Choose your impact</h2>
        <div className="charities">
          {viewCharities.map((c) => (
            <article className="charity-card fade-in" key={c.id}>
              <div className="charity-img" style={{ background: c.color }}>{c.icon}</div>
              <div className="charity-body">
                <div className="charity-tag">{c.tag}</div><h3>{c.name}</h3><p>{c.description}</p>
                <div className="charity-raised"><span>Raised</span><strong>{formatINR(c.raised)}</strong></div>
                <div className="charity-bar"><div className="charity-fill" style={{ width: `${c.progress}%` }} /></div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="draw-section" id="draw">
        <div className="section-tag fade-in">Draw</div>
        <h2 className="section-title fade-in">Run simulation</h2>
        <div className="draw-engine">
          <div>
            <p className="mono-label">Your scores</p>
            <div className="draw-balls">{scores.slice(0, 5).map((s) => <div key={s.id} className={`ball ${matched.includes(Number(s.num)) ? "matched" : ""}`}>{s.num}</div>)}</div>
            <p className="mono-label">Draw numbers</p>
            <div className="draw-balls">{drawnNumbers.map((n, i) => <div key={i} className={`ball ${typeof n === "number" && matched.includes(n) ? "matched" : ""}`}>{n}</div>)}</div>
            <button className="btn-draw" onClick={runLocalDraw}>Run Draw</button>
            <div className="draw-result">{drawResult}</div>
          </div>
          <div className="prize-tiers">
            <div className="prize-tier jackpot"><div><div className="tier-name">5 Match</div><div className="tier-match">40% jackpot</div></div><div className="tier-share">40%</div></div>
            <div className="prize-tier"><div><div className="tier-name">4 Match</div><div className="tier-match">35%</div></div><div className="tier-share">35%</div></div>
            <div className="prize-tier"><div><div className="tier-name">3 Match</div><div className="tier-match">25%</div></div><div className="tier-share">25%</div></div>
          </div>
        </div>
      </section>

      <section className="dashboard-section" id="dashboard">
        <div className="section-tag fade-in">Dashboard</div>
        <h2 className="section-title fade-in">Account Details</h2>
        {!user ? (
          <div className="db-card">
            <div className="db-card-title">Access Required</div>
            <p className="helper-text">Login or register to use member features and admin controls.</p>
            <div className="row-actions"><button className="btn-sm btn-sm-green" onClick={() => setLoginOpen(true)}>Login</button><button className="btn-sm btn-light" onClick={() => setSignupOpen(true)}>Register</button></div>
            <p className="helper-text">Use your email and password to access your account.</p>
          </div>
        ) : (
          <div className="db-grid">
            <aside className="db-sidebar">
              <div className="profile-card"><div className="avatar">{(user.name || "U")[0]?.toUpperCase()}</div><div><div className="profile-name">{user.name}</div><div className="profile-sub">{user.role}</div></div></div>
              <button className={`db-nav-item ${dashboardTab === "scores" ? "active" : ""}`} onClick={() => setDashboardTab("scores")}>Scores</button>
              <button className={`db-nav-item ${dashboardTab === "subscription" ? "active" : ""}`} onClick={() => setDashboardTab("subscription")}>Subscription</button>
              <button className={`db-nav-item ${dashboardTab === "winnings" ? "active" : ""}`} onClick={() => setDashboardTab("winnings")}>Winnings</button>
              <button className={`db-nav-item ${dashboardTab === "transactions" ? "active" : ""}`} onClick={() => setDashboardTab("transactions")}>Transactions</button>
              {user.role === "admin" ? <button className={`db-nav-item ${dashboardTab === "admin" ? "active" : ""}`} onClick={() => setDashboardTab("admin")}>Admin Control</button> : null}
            </aside>

            <div className="db-main">
              {dashboardTab === "scores" ? <div className="db-card"><div className="db-card-title">My Last 5 Scores</div><div className="score-grid">{scores.slice(0, 5).map((s, i) => <div key={s.id} className={`score-entry ${i === 0 ? "latest" : ""}`}>{i === 0 ? <div className="score-latest-badge">Latest</div> : null}<div className="score-num">{s.num}</div><div className="score-date">{formatDateDisplay(s.date)}</div></div>)}</div>{!canAddScore ? <p className="helper-text">Active subscription required to enter new scores.</p> : null}<div className="score-input-row"><input className="score-input" type="number" min={1} max={45} placeholder="Score" value={newScore} onChange={(e) => setNewScore(e.target.value)} /><input className="score-input date" type="date" value={newScoreDate} onChange={(e) => setNewScoreDate(e.target.value)} /><button className="btn-sm btn-sm-green" onClick={submitScore} disabled={!canAddScore}>Submit</button></div></div> : null}

              {dashboardTab === "subscription" ? <div className="db-card"><div className="db-card-title">Subscription</div><div className="stat-row"><div className="stat-box"><div className="stat-box-label">Status</div><div className="stat-box-val green">{subscription?.status || "none"}</div></div><div className="stat-box"><div className="stat-box-label">Plan</div><div className="stat-box-val">{subscription?.planLabel || "-"}</div></div><div className="stat-box"><div className="stat-box-label">Renews</div><div className="stat-box-val">{formatDateDisplay(subscription?.nextBillingDate)}</div></div><div className="stat-box"><div className="stat-box-label">Draws Entered</div><div className="stat-box-val gold">{dashboard?.participation?.drawsEntered || 0}</div></div></div><div className="row-actions"><button className="btn-sm btn-sm-green" onClick={() => createOrChangeSubscription("monthly")}>Switch Monthly</button><button className="btn-sm btn-light" onClick={() => createOrChangeSubscription("yearly")}>Switch Yearly</button><button className="btn-sm btn-light" onClick={cancelSubscription}>Cancel at Period End</button></div></div> : null}

              {dashboardTab === "winnings" ? <div className="db-card"><div className="db-card-title">Winnings and Payout</div><div className="table-wrap"><table><thead><tr><th>Draw</th><th>Match</th><th>Amount</th><th>Status</th><th>Payout</th><th>Proof</th></tr></thead><tbody>{claims.map((claim) => <tr key={claim.id}><td>{claim.drawId}</td><td>{claim.matchCount}</td><td>{formatINR(claim.amount)}</td><td><span className={`badge ${statusTone(claim.status)}`}>{claim.status}</span></td><td><span className={`badge ${statusTone(claim.payoutStatus)}`}>{claim.payoutStatus}</span></td><td>{claim.status === "pending_proof" || claim.status === "rejected" ? <div className="table-actions"><input className="score-input" placeholder="https://proof-link" value={proofMap[claim.id] || ""} onChange={(e) => setProofMap((prev) => ({ ...prev, [claim.id]: e.target.value }))} /><button className="mini-btn" onClick={() => uploadProof(claim.id)}>Upload</button></div> : claim.proofUrl ? "Uploaded" : "-"}</td></tr>)}</tbody></table></div><p className="helper-text">Upload proof for pending claims. Admin approves and marks payout paid.</p></div> : null}

              {dashboardTab === "transactions" ? <div className="db-card"><div className="db-card-title">My Transactions</div><div className="table-wrap"><table><thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>Status</th><th>Reference</th></tr></thead><tbody>{transactions.map((txn) => <tr key={txn.id}><td>{formatDateDisplay(txn.createdAt)}</td><td>{txn.kind}</td><td>{formatINR(txn.amount)}</td><td><span className={`badge ${statusTone(txn.status)}`}>{txn.status}</span></td><td>{txn.reference}</td></tr>)}</tbody></table></div></div> : null}

              {dashboardTab === "admin" && user.role === "admin" ? <div className="admin-panel"><div className="admin-tabs">{ADMIN_TABS.map((t) => <button key={t.id} className={`admin-tab ${adminTab === t.id ? "active" : ""}`} onClick={() => setAdminTab(t.id)}>{t.label}</button>)}</div>
                {adminTab === "overview" ? <div className="db-card"><div className="db-card-title">Overview</div><div className="stat-row"><div className="stat-box"><div className="stat-box-label">Users</div><div className="stat-box-val">{adminOverview?.users || 0}</div></div><div className="stat-box"><div className="stat-box-label">Active Subs</div><div className="stat-box-val green">{adminOverview?.activeSubscriptions || 0}</div></div><div className="stat-box"><div className="stat-box-label">Revenue</div><div className="stat-box-val">{formatINR(adminOverview?.totalRevenue || 0)}</div></div><div className="stat-box"><div className="stat-box-label">Donations</div><div className="stat-box-val gold">{formatINR(adminOverview?.totalDonations || 0)}</div></div></div></div> : null}
                {adminTab === "draws" ? <div className="db-card"><div className="db-card-title">Draw Management</div><div className="admin-toolbar"><select value={adminDrawMode} onChange={(e) => setAdminDrawMode(e.target.value)}>{DRAW_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select><button className="btn-sm btn-sm-green" onClick={adminSimulate}>Simulate</button><button className="btn-sm btn-light" onClick={() => adminPublish("")}>Publish Fresh</button><button className="btn-sm btn-light" onClick={() => { const sim = adminDraws.find((d) => d.status === "simulation"); if (sim) adminPublish(sim.id); else setNotice("No simulation available."); }}>Publish Simulation</button></div><div className="table-wrap"><table><thead><tr><th>Month</th><th>Mode</th><th>Numbers</th><th>Status</th><th>Pool</th></tr></thead><tbody>{adminDraws.map((d) => <tr key={d.id}><td>{`${d.month}/${d.year}`}</td><td>{d.mode}</td><td>{d.winningNumbers?.join(" ")}</td><td><span className={`badge ${statusTone(d.status)}`}>{d.status}</span></td><td>{formatINR(d.pool?.total || 0)}</td></tr>)}</tbody></table></div></div> : null}
                {adminTab === "winners" ? <div className="db-card"><div className="db-card-title">Winners</div><div className="table-wrap"><table><thead><tr><th>User</th><th>Match</th><th>Amount</th><th>Status</th><th>Payout</th><th>Action</th></tr></thead><tbody>{adminWinners.map((w) => <tr key={w.id}><td>{w.userId}</td><td>{w.matchCount}</td><td>{formatINR(w.amount)}</td><td><span className={`badge ${statusTone(w.status)}`}>{w.status}</span></td><td><span className={`badge ${statusTone(w.payoutStatus)}`}>{w.payoutStatus}</span></td><td className="table-actions"><button className="mini-btn" onClick={() => adminWinner(w.id, "approve")}>Approve</button><button className="mini-btn" onClick={() => adminWinner(w.id, "reject")}>Reject</button><button className="mini-btn" onClick={() => adminWinner(w.id, "mark_paid")}>Paid</button></td></tr>)}</tbody></table></div></div> : null}
                {adminTab === "users" ? <div className="db-card"><div className="db-card-title">Users</div><div className="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Subscription</th><th>Action</th></tr></thead><tbody>{adminUsers.map((u) => <tr key={u.id}><td>{u.name}</td><td>{u.email}</td><td>{u.role}</td><td>{u.subscriptionStatus}</td><td><button className="mini-btn" onClick={() => adminToggleRole(u.id, u.role === "admin" ? "member" : "admin")}>Make {u.role === "admin" ? "Member" : "Admin"}</button></td></tr>)}</tbody></table></div></div> : null}
              </div> : null}
            </div>
          </div>
        )}
      </section>

      <footer>
        <div className="footer-inner">
          <div><img src={BRAND_LOGO} alt="greenheart" className="footer-logo-img" /><p className="footer-desc">Golf. Give. Win.</p></div>
          <div className="footer-col"><h4>Access</h4><button onClick={() => setSignupOpen(true)}>Create Account</button><button onClick={() => setLoginOpen(true)}>Login</button></div>
        </div>
      </footer>

      <SignupModal open={signupOpen} onClose={() => { setSignupOpen(false); setAuthError(""); }} onSwitch={() => { setSignupOpen(false); setLoginOpen(true); setAuthError(""); }} selectedPlan={selectedPlan} setSelectedPlan={setSelectedPlan} form={signupForm} setForm={setSignupForm} onSubmit={handleSignup} loading={authLoading} error={authError} charities={viewCharities} />
      <LoginModal open={loginOpen} onClose={() => { setLoginOpen(false); setAuthError(""); }} onSwitch={() => { setLoginOpen(false); setSignupOpen(true); setAuthError(""); }} form={loginForm} setForm={setLoginForm} onSubmit={handleLogin} loading={authLoading} error={authError} />
      <div className={`notif ${notice ? "show" : ""}`}>{notice}</div>
    </div>
  );
}

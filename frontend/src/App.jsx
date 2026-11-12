
import { useEffect, useState } from "react";
import "./index.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:5000";

async function apiRequest(path, options = {}, token = "") {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || `Request failed (${response.status})`);
  }

  return data;
}

function money(paise) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
  }).format(Number(paise || 0) / 100);
}

export default function App() {
  const [token, setToken] = useState(
    () => localStorage.getItem("balancevault_token") || ""
  );

  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("balancevault_user")) || null;
    } catch {
      return null;
    }
  });

  const [page, setPage] = useState("dashboard");
  const [isRegister, setIsRegister] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [accounts, setAccounts] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);

  const [fromAccountId, setFromAccountId] = useState("");
  const [toAccountNo, setToAccountNo] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");

  // Demo deposit state
  const [depositAmount, setDepositAmount] = useState("1000");
  const [depositAccountId, setDepositAccountId] = useState("");

  function notify(text) {
    setMessage(text);
    setError("");
  }

  function showError(text) {
    setError(text);
    setMessage("");
  }

  function logout() {
    localStorage.removeItem("balancevault_token");
    localStorage.removeItem("balancevault_user");

    setToken("");
    setUser(null);
    setAccounts([]);
    setTransactions([]);
    setAuditLogs([]);
    setPage("dashboard");

    notify("You have been logged out.");
  }

  async function handleAuth(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");

    try {
      const endpoint = isRegister
        ? "/api/auth/register"
        : "/api/auth/login";

      const body = isRegister
        ? { name, email, password }
        : { email, password };

      const data = await apiRequest(endpoint, {
        method: "POST",
        body: JSON.stringify(body),
      });

      if (isRegister) {
        notify("Registration successful. Please log in.");
        setIsRegister(false);
        setPassword("");
      } else {
        localStorage.setItem("balancevault_token", data.token);
        localStorage.setItem(
          "balancevault_user",
          JSON.stringify(data.user)
        );

        setToken(data.token);
        setUser(data.user);
        setPage("dashboard");
        setPassword("");
        notify("Welcome to BalanceVault!");
      }
    } catch (err) {
      showError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadDashboard() {
    if (!token || !user) return;

    setLoading(true);
    setError("");

    try {
      if (user.role === "ADMIN") {
        const [accountData, auditData] = await Promise.all([
          apiRequest("/api/admin/accounts", {}, token),
          apiRequest("/api/admin/audit-logs", {}, token),
        ]);

        setAccounts(accountData.accounts || []);
        setAuditLogs(auditData.logs || auditData.auditLogs || []);
      } else if (user.role === "ACCOUNT_HOLDER") {
        const [accountData, transactionData] = await Promise.all([
          apiRequest("/api/accounts/my", {}, token),
          apiRequest("/api/transactions/my", {}, token),
        ]);

        setAccounts(accountData.accounts || []);

        setTransactions(
          transactionData.transactions ||
          transactionData.entries ||
          transactionData.ledgerEntries ||
          []
        );
      }
    } catch (err) {
      showError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (token && user) {
      loadDashboard();
    }
  }, [token, user]);

  async function createAccount() {
    setLoading(true);
    setError("");
    setMessage("");

    try {
      await apiRequest(
        "/api/accounts",
        {
          method: "POST",
          body: JSON.stringify({}),
        },
        token
      );

      notify("Your account has been created successfully.");
      await loadDashboard();
    } catch (err) {
      showError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function transferMoney(event) {
    event.preventDefault();

    const rupees = Number(amount);

    if (!Number.isFinite(rupees) || rupees <= 0) {
      showError("Enter a valid transfer amount.");
      return;
    }

    if (!Number.isSafeInteger(rupees * 100)) {
      showError("Enter an amount with no more than two decimal places.");
      return;
    }

    setLoading(true);
    setError("");
    setMessage("");

    try {
      await apiRequest(
        "/api/transactions/transfer",
        {
          method: "POST",
          headers: {
            "Idempotency-Key": crypto.randomUUID(),
          },
          body: JSON.stringify({
            fromAccountId,
            toAccountNo,
            amount: Math.round(rupees * 100),
            description,
          }),
        },
        token
      );

      notify("Transfer completed successfully.");
      setAmount("");
      setToAccountNo("");
      setDescription("");

      await loadDashboard();
    } catch (err) {
      showError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // ADMIN-authorized demo deposit
  async function depositMoney(event) {
    event.preventDefault();

    const rupees = Number(depositAmount);

    if (
      !Number.isSafeInteger(rupees) ||
      rupees <= 0 ||
      !Number.isSafeInteger(rupees * 100)
    ) {
      showError("Enter a valid positive whole-rupee amount.");
      return;
    }

    if (!depositAccountId) {
      showError("Please select an account.");
      return;
    }

    setLoading(true);
    setError("");
    setMessage("");

    try {
      await apiRequest(
        `/api/admin/accounts/${depositAccountId}/deposit`,
        {
          method: "POST",
          headers: {
            "Idempotency-Key": crypto.randomUUID(),
          },
          body: JSON.stringify({
            amount: rupees * 100,
            description: "BalanceVault demo deposit",
          }),
        },
        token
      );

      notify("Demo deposit completed successfully!");
      setDepositAmount("1000");

      await loadDashboard();
    } catch (err) {
      showError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function changeAccountStatus(accountId, status) {
    setLoading(true);
    setError("");
    setMessage("");

    try {
      await apiRequest(
        `/api/admin/accounts/${accountId}/status`,
        {
          method: "PATCH",
          body: JSON.stringify({ status }),
        },
        token
      );

      notify(`Account status changed to ${status}.`);
      await loadDashboard();
    } catch (err) {
      showError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (!token || !user) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <div className="brand-mark">BV</div>
          <h1>BalanceVault</h1>
          <p className="muted">Secure banking. Simple control.</p>

          {message && <div className="alert success">{message}</div>}
          {error && <div className="alert error">{error}</div>}

          <h2>{isRegister ? "Create your account" : "Welcome back"}</h2>

          <form onSubmit={handleAuth}>
            {isRegister && (
              <label>
                Full name
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your full name"
                  required
                />
              </label>
            )}

            <label>
              Email address
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
              />
            </label>

            <label>
              Password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                required
              />
            </label>

            <button className="primary-btn full" disabled={loading}>
              {loading
                ? "Please wait..."
                : isRegister
                  ? "Create account"
                  : "Log in"}
            </button>
          </form>

          <p className="switch-auth">
            {isRegister ? "Already registered?" : "New to BalanceVault?"}
            <button
              className="text-btn"
              onClick={() => {
                setIsRegister(!isRegister);
                setError("");
                setMessage("");
              }}
            >
              {isRegister ? "Log in" : "Create an account"}
            </button>
          </p>
        </section>
      </main>
    );
  }

  const totalBalance = accounts.reduce(
    (total, account) => total + Number(account.balance || 0),
    0
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark">BV</div>
          <span>BalanceVault</span>
        </div>

        <div className="profile">
          <div className="avatar">
            {(user.name || "U").charAt(0).toUpperCase()}
          </div>
          <div>
            <strong>{user.name}</strong>
            <small>{user.role}</small>
          </div>
        </div>

        <nav>
          <button
            className={page === "dashboard" ? "nav-link active" : "nav-link"}
            onClick={() => setPage("dashboard")}
          >
            ◫ Dashboard
          </button>

          {user.role === "ACCOUNT_HOLDER" && (
            <>
              <button
                className={page === "transfer" ? "nav-link active" : "nav-link"}
                onClick={() => setPage("transfer")}
              >
                ⇄ Transfer money
              </button>

              <button
                className={
                  page === "transactions" ? "nav-link active" : "nav-link"
                }
                onClick={() => setPage("transactions")}
              >
                ▤ Transactions
              </button>
            </>
          )}

          {user.role === "ADMIN" && (
            <>
              <button
                className={page === "deposit" ? "nav-link active" : "nav-link"}
                onClick={() => setPage("deposit")}
              >
                ＋ Add money
              </button>

              <button
                className={page === "audit" ? "nav-link active" : "nav-link"}
                onClick={() => setPage("audit")}
              >
                ◷ Audit logs
              </button>
            </>
          )}
        </nav>

        <button className="logout-btn" onClick={logout}>
          ↪ Log out
        </button>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <p className="eyebrow">BALANCEVAULT / SECURE BANKING</p>
            <h1>
              {page === "dashboard"
                ? "Dashboard"
                : page === "transfer"
                  ? "Transfer money"
                  : page === "transactions"
                    ? "Transaction history"
                    : page === "deposit"
                      ? "Add money"
                      : "Audit logs"}
            </h1>
          </div>

          <button className="secondary-btn" onClick={loadDashboard}>
            ↻ Refresh
          </button>
        </header>

        {message && <div className="alert success">{message}</div>}
        {error && <div className="alert error">{error}</div>}

        {loading && <p className="muted">Loading...</p>}

        {page === "dashboard" && (
          <>
            <section className="welcome-row">
              <div>
                <h2>Hello, {user.name} 👋</h2>
                <p className="muted">
                  Here is your BalanceVault account overview.
                </p>
              </div>

              {user.role === "ACCOUNT_HOLDER" && (
                <button
                  className="primary-btn"
                  onClick={createAccount}
                  disabled={loading}
                >
                  + Create account
                </button>
              )}
            </section>

            <section className="stats-grid">
              <div className="stat-card featured">
                <span>Total balance</span>
                <h2>{money(totalBalance)}</h2>
                <small>Across your listed accounts</small>
              </div>

              <div className="stat-card">
                <span>
                  {user.role === "ADMIN" ? "All accounts" : "My accounts"}
                </span>
                <h2>{accounts.length}</h2>
                <small>Accounts in the system</small>
              </div>

              <div className="stat-card">
                <span>Account status</span>
                <h2>
                  {accounts.filter((a) => a.status === "ACTIVE").length}
                </h2>
                <small>Active accounts</small>
              </div>
            </section>

            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>
                    {user.role === "ADMIN" ? "All accounts" : "My accounts"}
                  </h2>
                  <p className="muted">Account information and status</p>
                </div>
              </div>

              {accounts.length === 0 ? (
                <p className="empty-state">No accounts found yet.</p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Account number</th>
                        {user.role === "ADMIN" && <th>Account holder</th>}
                        <th>Balance</th>
                        <th>Status</th>
                        {user.role === "ADMIN" && <th>Action</th>}
                      </tr>
                    </thead>

                    <tbody>
                      {accounts.map((account) => (
                        <tr key={account.id}>
                          <td>{account.accountNo}</td>

                          {user.role === "ADMIN" && (
                            <td>
                              {account.accountHolder?.name || "—"}
                              <small className="table-sub">
                                {account.accountHolder?.email || ""}
                              </small>
                            </td>
                          )}

                          <td>{money(account.balance)}</td>

                          <td>
                            <span
                              className={
                                account.status === "ACTIVE"
                                  ? "status active-status"
                                  : "status frozen-status"
                              }
                            >
                              {account.status}
                            </span>
                          </td>

                          {user.role === "ADMIN" && (
                            <td>
                              <button
                                className="small-btn"
                                disabled={loading}
                                onClick={() =>
                                  changeAccountStatus(
                                    account.id,
                                    account.status === "ACTIVE"
                                      ? "FROZEN"
                                      : "ACTIVE"
                                  )
                                }
                              >
                                {account.status === "ACTIVE"
                                  ? "Freeze"
                                  : "Activate"}
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}

        {/* ADMIN DEMO DEPOSIT PAGE */}
        {page === "deposit" && user.role === "ADMIN" && (
          <section className="panel form-panel deposit-panel">
            <h2>Add money to an account</h2>
            <p className="muted">
              Authorize a demo deposit into an active BalanceVault account.
            </p>

            <form onSubmit={depositMoney}>
              <label>
                Select account
                <select
                  value={depositAccountId}
                  onChange={(e) => setDepositAccountId(e.target.value)}
                  required
                >
                  <option value="">Choose account</option>

                  {accounts
                    .filter((account) => account.status === "ACTIVE")
                    .map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.accountNo} — {money(account.balance)}
                      </option>
                    ))}
                </select>
              </label>

              <label>Choose deposit amount</label>

              <div className="deposit-options">
                {[500, 1000, 2000, 5000, 10000, 20000].map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={
                      Number(depositAmount) === value
                        ? "small-btn deposit-selected"
                        : "small-btn"
                    }
                    onClick={() => setDepositAmount(String(value))}
                  >
                    ₹{value.toLocaleString("en-IN")}
                  </button>
                ))}
              </div>

              <label>Custom amount (₹)</label>

              <input
                type="number"
                min="1"
                step="1"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                placeholder="Enter amount"
                required
              />

              <div className="deposit-summary">
                <span>Deposit amount</span>
                <strong>
                  {money(
                    Number.isSafeInteger(Number(depositAmount))
                      ? Number(depositAmount) * 100
                      : 0
                  )}
                </strong>
                <small>Demo transaction · No real payment involved</small>
              </div>

              <button
                className="primary-btn full"
                disabled={loading || accounts.filter(
                  (account) => account.status === "ACTIVE"
                ).length === 0}
              >
                {loading ? "Processing..." : "Confirm demo deposit"}
              </button>
            </form>

            <p className="form-note">
              Only administrators can authorize demo deposits. Every deposit
              creates a transaction, credit ledger entry and audit record.
            </p>
          </section>
        )}

        {page === "transfer" && user.role === "ACCOUNT_HOLDER" && (
          <section className="panel form-panel">
            <h2>Send money</h2>
            <p className="muted">
              Transfer money securely to another BalanceVault account.
            </p>

            <form onSubmit={transferMoney}>
              <label>
                From account
                <select
                  value={fromAccountId}
                  onChange={(e) => setFromAccountId(e.target.value)}
                  required
                >
                  <option value="">Select your account</option>

                  {accounts.map((account) => (
                    <option
                      key={account.id}
                      value={account.id}
                      disabled={account.status !== "ACTIVE"}
                    >
                      {account.accountNo} — {money(account.balance)}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Receiver account number
                <input
                  value={toAccountNo}
                  onChange={(e) => setToAccountNo(e.target.value)}
                  placeholder="Enter receiver account number"
                  required
                />
              </label>

              <label>
                Amount (₹)
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="Enter amount"
                  required
                />
              </label>

              <label>
                Description
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Optional transfer note"
                />
              </label>

              <button className="primary-btn" disabled={loading}>
                {loading ? "Processing..." : "Send money"}
              </button>
            </form>

            <p className="form-note">
              Transfers are processed by the backend. Amounts are sent in paise
              to maintain accurate currency calculations.
            </p>
          </section>
        )}

        {page === "transactions" && user.role === "ACCOUNT_HOLDER" && (
          <section className="panel">
            <h2>Recent transactions</h2>
            <p className="muted">Your account ledger activity.</p>

            {transactions.length === 0 ? (
              <p className="empty-state">No transactions found.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>Account</th>
                      <th>Amount</th>
                      <th>Date</th>
                    </tr>
                  </thead>

                  <tbody>
                    {transactions.map((entry, index) => (
                      <tr key={entry.entryId || entry.id || index}>
                        <td>
                          {entry.entryType || entry.type || "—"}
                        </td>
                        <td>
                          {entry.accountNo || entry.account?.accountNo || "—"}
                        </td>
                        <td>{money(entry.amount)}</td>
                        <td>
                          {entry.createdAt
                            ? new Date(entry.createdAt).toLocaleString()
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {page === "audit" && user.role === "ADMIN" && (
          <section className="panel">
            <h2>Audit activity</h2>
            <p className="muted">
              Recent recorded actions in BalanceVault.
            </p>

            {auditLogs.length === 0 ? (
              <p className="empty-state">No audit records found.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Action</th>
                      <th>User</th>
                      <th>Details</th>
                      <th>Date</th>
                    </tr>
                  </thead>

                  <tbody>
                    {auditLogs.map((log, index) => (
                      <tr key={log.id || index}>
                        <td>{log.action}</td>
                        <td>{log.user?.email || log.userId || "System"}</td>
                        <td>
                          {typeof log.details === "object"
                            ? JSON.stringify(log.details)
                            : log.details || "—"}
                        </td>
                        <td>
                          {log.createdAt
                            ? new Date(log.createdAt).toLocaleString()
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        <footer className="footer">
          BalanceVault · Secure account management
        </footer>
      </main>
    </div>
  );
}

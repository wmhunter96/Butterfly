import { useCallback, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { api, StoreProvider } from './store';
import { Layout } from './components/Layout';
import { Logo } from './components/Logo';
import { CashFlowPage } from './pages/CashFlow';
import { SpendingPage } from './pages/Spending';
import { TransactionsPage } from './pages/Transactions';
import { NetWorthPage } from './pages/NetWorth';
import { AccountDetailPage, AccountsPage } from './pages/Accounts';
import { LoansPage } from './pages/Loans';
import { PropertyPage } from './pages/Property';
import { SettingsPage } from './pages/Settings';

type Session = { authRequired: boolean; authenticated: boolean; demo: boolean; ai?: boolean };

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const check = useCallback(() => api<Session>('/api/session').then(setSession).catch(() => setSession({ authRequired: false, authenticated: true, demo: false })), []);
  useEffect(() => {
    check();
  }, [check]);
  const signedOut = useCallback(() => setSession((s) => (s ? { ...s, authenticated: false } : s)), []);

  if (!session) return <div className="fullscreen-msg"><div className="spinner" /></div>;
  if (!session.authenticated) return <Login onDone={check} />;
  return (
    <BrowserRouter>
      <StoreProvider session={session} onSignedOut={signedOut}>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Navigate to="/cash-flow" replace />} />
            <Route path="cash-flow" element={<CashFlowPage />} />
            <Route path="spending" element={<SpendingPage />} />
            <Route path="transactions" element={<TransactionsPage />} />
            <Route path="net-worth" element={<NetWorthPage />} />
            <Route path="accounts" element={<AccountsPage />} />
            <Route path="accounts/:id" element={<AccountDetailPage />} />
            <Route path="loans" element={<LoansPage />} />
            <Route path="property/:id" element={<PropertyPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/cash-flow" replace />} />
          </Route>
        </Routes>
      </StoreProvider>
    </BrowserRouter>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  return (
    <div className="fullscreen-msg">
      <form
        className="card login"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api('/api/login', { method: 'POST', body: JSON.stringify({ password }) });
            onDone();
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        <div className="brand"><Logo /> Butterfly</div>
        <input type="password" placeholder="Password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <span className="neg small">{error}</span>}
        <button className="btn primary" type="submit" style={{ justifyContent: 'center' }}>Sign in</button>
      </form>
    </div>
  );
}

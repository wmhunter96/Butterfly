import { useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { ArrowDownUp, CircleHelp, Home, Landmark, LogOut, MoreHorizontal, PieChart, ReceiptText, Settings, Tags, TrendingUp, Wallet, X } from 'lucide-react';
import { useStore } from '../store';
import { isUncategorized } from '../lib/finance';
import { Logo } from './Logo';

export function Layout() {
  const { model, authRequired, signOut, demo } = useStore();
  const [more, setMore] = useState(false);
  const loc = useLocation();
  const uncategorized = useMemo(() => model.data.transactions.filter((t) => isUncategorized(model, t)).length, [model]);

  const main = [
    { to: '/transactions', label: 'Transactions', icon: ReceiptText, badge: uncategorized },
    { to: '/cash-flow', label: 'Cash flow', icon: ArrowDownUp },
    { to: '/spending', label: 'Spending', icon: PieChart },
    { to: '/net-worth', label: 'Net worth', icon: TrendingUp },
  ];
  const rest = [
    { to: '/accounts', label: 'Accounts', icon: Landmark },
    { to: '/loans', label: 'Loans', icon: Wallet },
    { to: '/categories', label: 'Categories', icon: Tags },
    { to: '/transactions?filter=uncategorized', label: 'Uncategorized', icon: CircleHelp, badge: uncategorized },
  ];
  const props = model.settings.properties.map((p) => ({ to: '/property/' + encodeURIComponent(p.id), label: p.name, icon: Home }));

  const link = (l: { to: string; label: string; icon: typeof Home; badge?: number }, onClick?: () => void) => (
    <NavLink
      key={l.to}
      to={l.to}
      onClick={onClick}
      className={({ isActive }) => {
        const [path, q] = l.to.split('?');
        const active = q ? loc.pathname === path && loc.search.includes(q) : isActive && !(path === '/transactions' && loc.search.includes('filter=uncategorized'));
        return 'nav-link' + (active ? ' active' : '');
      }}
    >
      <l.icon size={17} />
      <span>{l.label}</span>
      {!!l.badge && <span className="badge">{l.badge}</span>}
    </NavLink>
  );

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <Logo />
          Butterfly
        </div>
        <nav>
          {[...main, ...rest].map((l) => link(l))}
          {!!props.length && <div className="nav-section">Properties</div>}
          {props.map((l) => link(l))}
        </nav>
        <div className="sidebar-foot">
          {demo && <div className="demo-pill">Demo data</div>}
          {link({ to: '/settings', label: 'Settings', icon: Settings })}
          {authRequired && (
            <button className="nav-link" onClick={signOut}>
              <LogOut size={17} />
              <span>Sign out</span>
            </button>
          )}
        </div>
      </aside>
      <main className="content">
        <Outlet />
      </main>
      <nav className="tabbar">
        {main.map((l) => link(l))}
        <button className={'nav-link' + (more ? ' active' : '')} onClick={() => setMore(true)}>
          <MoreHorizontal size={17} />
          <span>More</span>
          {!!uncategorized && <span className="badge">{uncategorized}</span>}
        </button>
      </nav>
      {more && (
        <div className="sheet-scrim" onClick={() => setMore(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-head">
              <b>More</b>
              <button className="icon-btn" aria-label="Close" onClick={() => setMore(false)}>
                <X size={18} />
              </button>
            </div>
            {rest.map((l) => link(l, () => setMore(false)))}
            {!!props.length && <div className="nav-section">Properties</div>}
            {props.map((l) => link(l, () => setMore(false)))}
            {link({ to: '/settings', label: 'Settings', icon: Settings }, () => setMore(false))}
            {authRequired && (
              <button className="nav-link" onClick={signOut}>
                <LogOut size={17} />
                <span>Sign out</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

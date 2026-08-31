import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const navLinks = [
  { to: '/', label: 'Dashboard', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
  { to: '/alerts', label: 'Alerts', icon: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 5.165 6 5.808 6 6.659V17' },
  { to: '/track', label: 'Track', icon: 'M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z' },
  { to: '/history', label: 'History', icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.799 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.799-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
  { to: '/settings', label: 'Settings', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z' },
];

export default function Navbar() {
  const location = useLocation();
  const { user, isAuthenticated, logout } = useAuth();

  if (!isAuthenticated) return null;

  return (
    <nav className="h-16 bg-[hsl(var(--muted))] border-b border-[hsl(var(--border))] flex items-center justify-between px-4 lg:px-6" role="navigation" aria-label="Main navigation">
      <Link to="/" className="flex items-center gap-2 text-[hsl(var(--foreground))] hover:opacity-80 transition-opacity" aria-label="IBVAP Home">
        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
          <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
        </div>
        <span className="font-bold text-lg tracking-tight hidden sm:block">IBVAP</span>
      </Link>

      <div className="hidden lg:flex items-center gap-1" role="menubar">
        {navLinks.map(link => (
          <Link
            key={link.to}
            to={link.to}
            className={`relative flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
              location.pathname === link.to
                ? 'bg-primary/10 text-primary border border-primary/20'
                : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]'
            }`}
            role="menuitem"
            aria-current={location.pathname === link.to ? 'page' : undefined}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={link.icon} />
            </svg>
            <span>{link.label}</span>
          </Link>
        ))}
      </div>

      <div className="flex items-center gap-4">
        {/* Connection Status */}
        <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[hsl(var(--background))] border border-[hsl(var(--border))]">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
          <span className="text-xs font-mono text-[hsl(var(--muted-foreground))]">SECURE</span>
        </div>

        {/* User Profile */}
        <div className="flex items-center gap-3">
          <button 
            onClick={logout}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[hsl(var(--background))] border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] transition-colors"
            aria-label="User menu"
          >
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
              <svg className="w-4 h-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
            <div className="hidden md:block text-left">
              <p className="text-sm font-medium text-[hsl(var(--foreground))]">{user?.name}</p>
              <p className="text-xs text-[hsl(var(--muted-foreground))]">{user?.role}</p>
            </div>
            <svg className="w-4 h-4 text-[hsl(var(--muted-foreground))]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        </div>
      </div>
    </nav>
  );
}
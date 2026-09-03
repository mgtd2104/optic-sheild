import { useState, useEffect, useLayoutEffect } from 'react';
import { useAuth } from '../context/AuthContext';

// Initialize theme immediately to prevent flash - this runs synchronously during render
if (typeof window !== 'undefined') {
  const stored = localStorage.getItem('ibvap_settings');
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (parsed.theme === 'dark') {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    } catch {
      // Ignore parse errors, default to dark
      document.documentElement.classList.add('dark');
    }
  } else {
    // Default to dark theme
    document.documentElement.classList.add('dark');
  }
}

export default function Settings() {
  const { user, logout } = useAuth();
  const [settings, setSettings] = useState({
    demoMode: true,
    demoInterval: 6000,
    maxAlerts: 15,
    theme: 'dark' as 'dark' | 'light',
    notifications: true,
    soundAlerts: false,
    autoRefresh: true,
    mapProvider: 'osm' as 'osm' | 'satellite',
  });

  useEffect(() => {
    const stored = localStorage.getItem('ibvap_settings');
    if (stored) {
      try {
        setSettings(JSON.parse(stored));
      } catch {
        // Ignore parse errors
      }
    }
  }, []);

  // Apply theme changes using useLayoutEffect to prevent visual flicker
  useLayoutEffect(() => {
    document.documentElement.classList.toggle('dark', settings.theme === 'dark');
  }, [settings.theme]);

  // Persist settings and sync across tabs
  useEffect(() => {
    localStorage.setItem('ibvap_settings', JSON.stringify(settings));
  }, [settings]);

  // Listen for storage changes from other tabs
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'ibvap_settings' && e.newValue) {
        try {
          setSettings(JSON.parse(e.newValue));
        } catch {
          // Ignore parse errors
        }
      }
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  const handleChange = (key: string, value: any) => {
    setSettings(s => ({ ...s, [key]: value }));
  };

  return (
    <main className="h-[calc(100vh-64px)] flex flex-col bg-[hsl(var(--background))]" role="main">
      <header className="flex items-center justify-between px-4 py-3 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))] flex-shrink-0">
        <h1 className="text-xl font-bold text-[hsl(var(--foreground))] tracking-tight">SETTINGS</h1>
      </header>

      <div className="flex-1 overflow-y-auto p-4 lg:p-6">
        <div className="max-w-3xl mx-auto space-y-6">
          {/* User Profile */}
          <section className="bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-xl p-6">
            <h2 className="text-lg font-semibold text-[hsl(var(--foreground))] mb-4 flex items-center gap-2">
              <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              OPERATOR PROFILE
            </h2>
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                <svg className="w-8 h-8 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
              <div>
                <p className="text-xl font-bold text-[hsl(var(--foreground))]">{user?.name}</p>
                <p className="text-[hsl(var(--muted-foreground))]">{user?.role}</p>
                <p className="text-sm text-[hsl(var(--muted-foreground))]">{user?.bopLocation}</p>
              </div>
            </div>
            <button onClick={logout} className="mt-4 px-4 py-2 text-sm font-medium rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              Sign Out
            </button>
          </section>

          {/* Demo Configuration */}
          <section className="bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-xl p-6">
            <h2 className="text-lg font-semibold text-[hsl(var(--foreground))] mb-4 flex items-center gap-2">
              <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              DEMO CONFIGURATION
            </h2>
            <div className="space-y-4">
              <SettingToggle 
                label="Demo Mode" 
                description="Enable automatic alert generation for demonstration"
                checked={settings.demoMode}
                onChange={v => handleChange('demoMode', v)}
              />
              <SettingInput
                label="Demo Interval (ms)"
                description="Interval between auto-generated alerts"
                type="number"
                value={settings.demoInterval}
                onChange={v => handleChange('demoInterval', parseInt(v))}
                min={1000}
                max={30000}
                step={1000}
              />
              <SettingInput
                label="Max Alerts"
                description="Maximum alerts to keep in memory"
                type="number"
                value={settings.maxAlerts}
                onChange={v => handleChange('maxAlerts', parseInt(v))}
                min={5}
                max={100}
                step={5}
              />
            </div>
          </section>

          {/* Display & UI */}
          <section className="bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-xl p-6">
            <h2 className="text-lg font-semibold text-[hsl(var(--foreground))] mb-4 flex items-center gap-2">
              <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
              DISPLAY & UI
            </h2>
            <div className="space-y-4">
              <SettingSelect
                label="Theme"
                value={settings.theme}
                onChange={v => handleChange('theme', v)}
                options={[
                  { value: 'dark', label: 'Dark (Command Center)' },
                  { value: 'light', label: 'Light' },
                ]}
              />
              <SettingSelect
                label="Map Provider"
                value={settings.mapProvider}
                onChange={v => handleChange('mapProvider', v)}
                options={[
                  { value: 'osm', label: 'OpenStreetMap' },
                  { value: 'satellite', label: 'Satellite Imagery' },
                ]}
              />
            </div>
          </section>

          {/* Alerts & Notifications */}
          <section className="bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-xl p-6">
            <h2 className="text-lg font-semibold text-[hsl(var(--foreground))] mb-4 flex items-center gap-2">
              <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 5.165 6 5.808 6 6.659V17" />
              </svg>
              ALERTS & NOTIFICATIONS
            </h2>
            <div className="space-y-4">
              <SettingToggle 
                label="Browser Notifications" 
                description="Show system notifications for new alerts"
                checked={settings.notifications}
                onChange={v => handleChange('notifications', v)}
              />
              <SettingToggle 
                label="Sound Alerts" 
                description="Play audio cue when new critical alert arrives"
                checked={settings.soundAlerts}
                onChange={v => handleChange('soundAlerts', v)}
              />
              <SettingToggle 
                label="Auto Refresh" 
                description="Automatically refresh alert list"
                checked={settings.autoRefresh}
                onChange={v => handleChange('autoRefresh', v)}
              />
            </div>
          </section>

          {/* About */}
          <section className="bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-xl p-6">
            <h2 className="text-lg font-semibold text-[hsl(var(--foreground))] mb-4 flex items-center gap-2">
              <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              ABOUT
            </h2>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between py-2 border-b border-[hsl(var(--border))]">
                <span className="text-[hsl(var(--muted-foreground))]">Application</span>
                <span className="font-mono text-[hsl(var(--foreground))]">IBVAP</span>
              </div>
              <div className="flex justify-between py-2 border-b border-[hsl(var(--border))]">
                <span className="text-[hsl(var(--muted-foreground))]">Version</span>
                <span className="font-mono text-[hsl(var(--foreground))]">1.0.0-SIH-DEMO</span>
              </div>
              <div className="flex justify-between py-2 border-b border-[hsl(var(--border))]">
                <span className="text-[hsl(var(--muted-foreground))]">Build Date</span>
                <span className="font-mono text-[hsl(var(--foreground))]">2026-08-31</span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-[hsl(var(--muted-foreground))]">Mode</span>
                <span className="font-mono text-[hsl(var(--foreground))] text-amber-500">DEMO</span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

function SettingToggle({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex-1">
        <p className="font-medium text-[hsl(var(--foreground))]">{label}</p>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">{description}</p>
      </div>
      <label className="relative inline-flex items-center cursor-pointer">
        <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="sr-only peer" />
        <div className="w-11 h-6 bg-[hsl(var(--border))] peer-focus:ring-2 peer-focus:ring-primary rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
      </label>
    </div>
  );
}

function SettingInput({ label, description, type, value, onChange, min, max, step }: { label: string; description: string; type: string; value: number; onChange: (v: string) => void; min?: number; max?: number; step?: number }) {
  return (
    <div className="flex items-center gap-4 flex-wrap">
      <div className="flex-1 min-w-[200px]">
        <p className="font-medium text-[hsl(var(--foreground))]">{label}</p>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">{description}</p>
      </div>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        min={min}
        max={max}
        step={step}
        className="w-32 px-3 py-2 bg-[hsl(var(--background))] border border-[hsl(var(--border))] rounded-lg text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-primary"
      />
    </div>
  );
}

function SettingSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="flex items-center gap-4 flex-wrap">
      <div className="flex-1 min-w-[200px]">
        <p className="font-medium text-[hsl(var(--foreground))]">{label}</p>
      </div>
      <select value={value} onChange={e => onChange(e.target.value)} className="w-48 px-3 py-2 bg-[hsl(var(--background))] border border-[hsl(var(--border))] rounded-lg text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-primary">
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}
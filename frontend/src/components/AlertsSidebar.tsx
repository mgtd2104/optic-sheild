import { useState } from 'react';
import { LiveAlert, AlertType, Severity } from '../types/detection';

interface AlertsSidebarProps {
  alerts: LiveAlert[];
  selectedAlertId: string | null;
  onAlertClick: (alert: LiveAlert) => void;
  loading?: boolean;
  error?: string | null;
  className?: string;
  isDemoMode?: boolean;
}

const SEVERITY_CONFIG: Record<Severity, { color: string; bg: string; icon: string }> = {
  CRITICAL: { color: '#ef4444', bg: '#ef444420', icon: '🔴' },
  HIGH: { color: '#f97316', bg: '#f9731620', icon: '🟠' },
  MEDIUM: { color: '#eab308', bg: '#eab30820', icon: '🟡' },
};

const ALERT_TYPE_CONFIG: Record<AlertType, { icon: string; label: string }> = {
  INTRUSION: { icon: '🚨', label: 'INTRUSION' },
  ANPR: { icon: '🚗', label: 'ANPR' },
  FRS_WATCHLIST: { icon: '👤', label: 'FRS WATCHLIST' },
  TAMPER: { icon: '🔧', label: 'TAMPER' },
};

const TYPE_FILTERS = ['all', 'INTRUSION', 'ANPR', 'FRS_WATCHLIST', 'TAMPER'] as const;
const SEVERITY_FILTERS = ['all', 'CRITICAL', 'HIGH', 'MEDIUM'] as const;

export default function AlertsSidebar({ 
  alerts, 
  selectedAlertId, 
  onAlertClick, 
  loading, 
  error,
  className = '',
  isDemoMode = false
}: AlertsSidebarProps) {
  const [typeFilter, setTypeFilter] = useState<TYPE_FILTERS[number]>('all');
  const [severityFilter, setSeverityFilter] = useState<SEVERITY_FILTERS[number]>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredAlerts = alerts.filter(alert => {
    if (typeFilter !== 'all' && alert.alertType !== typeFilter) return false;
    if (severityFilter !== 'all' && alert.severity !== severityFilter) return false;
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        alert.cameraID.toLowerCase().includes(query) ||
        alert.location.name.toLowerCase().includes(query) ||
        alert.alertType.toLowerCase().includes(query) ||
        alert.id.toLowerCase().includes(query)
      );
    }
    return true;
  });

  const sortedAlerts = [...filteredAlerts].sort((a, b) => 
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  if (loading) {
    return (
      <div className={`alerts-sidebar bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-xl overflow-hidden flex flex-col ${className}`}>
        <div className="p-4 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))] flex items-center justify-between">
          <h3 className="font-medium text-[hsl(var(--foreground))]">ALERT FEED</h3>
          <span className="px-2 py-0.5 text-xs font-mono bg-[hsl(var(--primary))] text-primary-foreground rounded">—</span>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="animate-pulse bg-[hsl(var(--muted))] border border-[hsl(var(--border))] rounded-lg p-4">
              <div className="h-4 w-3/4 bg-[hsl(var(--border))] rounded mb-2" />
              <div className="h-3 w-1/2 bg-[hsl(var(--border))] rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`alerts-sidebar bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-xl overflow-hidden flex flex-col ${className}`}>
        <div className="p-4 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]">
          <h3 className="font-medium text-[hsl(var(--foreground))]">ALERT FEED</h3>
        </div>
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
              <svg className="w-6 h-6 text-destructive" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <p className="text-[hsl(var(--muted-foreground))]">Failed to load alerts</p>
            <p className="text-xs font-mono text-[hsl(var(--muted-foreground))]">{error}</p>
            <button 
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:opacity-90 transition-opacity"
            >
              Retry Connection
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`alerts-sidebar bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-xl overflow-hidden flex flex-col ${className}`}>
      {/* Header */}
      <div className="p-4 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-medium text-[hsl(var(--foreground))] flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" aria-hidden="true" />
            ALERT FEED
          </h3>
          <span className="px-2 py-0.5 text-xs font-mono bg-[hsl(var(--primary))] text-primary-foreground rounded">
            {sortedAlerts.length}
          </span>
        </div>
        
        {/* Filters */}
        <div className="space-y-2">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[hsl(var(--muted-foreground))]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="search"
              placeholder="Search alerts..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-3 py-2 bg-[hsl(var(--background))] border border-[hsl(var(--border))] rounded-lg text-[hsl(var(--foreground))] placeholder-[hsl(var(--muted-foreground))] focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
              aria-label="Search alerts"
            />
          </div>
          
          <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-hide">
            {TYPE_FILTERS.map(filter => (
              <button
                key={filter}
                onClick={() => setTypeFilter(filter)}
                className={`whitespace-nowrap px-3 py-1.5 text-xs font-medium rounded-lg border transition-all ${
                  typeFilter === filter
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] border-[hsl(var(--border))] hover:bg-[hsl(var(--background))]'
                }`}
                aria-pressed={typeFilter === filter}
              >
                {filter === 'all' ? 'ALL' : filter}
              </button>
            ))}
          </div>
          
          <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-hide">
            {SEVERITY_FILTERS.map(filter => (
              <button
                key={filter}
                onClick={() => setSeverityFilter(filter)}
                className={`whitespace-nowrap px-3 py-1.5 text-xs font-medium rounded-lg border transition-all ${
                  severityFilter === filter
                    ? 'bg-destructive text-destructive-foreground border-destructive'
                    : 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] border-[hsl(var(--border))] hover:bg-[hsl(var(--background))]'
                }`}
                aria-pressed={severityFilter === filter}
              >
                {filter === 'all' ? 'ALL' : filter}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Alert List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2" role="list" aria-label="Active alerts">
        {sortedAlerts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-[hsl(var(--muted-foreground))] px-4">
            <div className="w-16 h-16 rounded-full bg-[hsl(var(--muted))] flex items-center justify-center mb-3">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <p className="text-sm font-medium">No alerts match filters</p>
            <p className="text-xs">Adjust filters or wait for new events</p>
          </div>
        ) : (
          sortedAlerts.map(alert => {
            const severityConfig = SEVERITY_CONFIG[alert.severity];
            const typeConfig = ALERT_TYPE_CONFIG[alert.alertType];
            const isSelected = alert.id === selectedAlertId;

            return (
              <article
                key={alert.id}
                role="listitem"
                tabIndex={0}
                onClick={() => onAlertClick(alert)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onAlertClick(alert); }}
                className={`group relative p-3 rounded-lg border transition-all duration-200 cursor-pointer ${
                  isSelected
                    ? 'bg-primary/10 border-primary ring-1 ring-primary'
                    : 'bg-[hsl(var(--muted))] border-[hsl(var(--border))] hover:bg-[hsl(var(--background))] hover:border-primary/50'
                }`}
                aria-selected={isSelected}
                aria-label={`${typeConfig.label} alert, ${alert.severity} severity`}
              >
                {/* Severity indicator bar */}
                <div 
                  className="absolute left-0 top-0 bottom-0 w-1 rounded-l-lg"
                  style={{ backgroundColor: severityConfig.color }}
                />
                
                <div className="flex items-start gap-3">
                  {/* Type Icon */}
                  <div className={`flex items-center justify-center w-10 h-10 rounded-lg flex-shrink-0 ${isSelected ? 'bg-primary/20' : 'bg-[hsl(var(--background))]'} border transition-colors`} style={{ borderColor: severityConfig.color }}>
                    <span className="text-lg">{typeConfig.icon}</span>
                  </div>
                  
                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-[hsl(var(--foreground))]">{typeConfig.label}</span>
                        <span 
                          className="px-1.5 py-0.5 text-xs font-medium rounded text-white"
                          style={{ backgroundColor: severityConfig.color }}
                        >
                          {alert.severity}
                        </span>
                      </div>
                      <time 
                        className="text-xs font-mono text-[hsl(var(--muted-foreground))] whitespace-nowrap"
                        dateTime={alert.timestamp}
                      >
                        {new Date(alert.timestamp).toLocaleTimeString()}
                      </time>
                    </div>
                    
                    <div className="flex items-center gap-3 text-xs text-[hsl(var(--muted-foreground))] flex-wrap">
                      <span className="flex items-center gap-1">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        {alert.location.name}
                      </span>
                      <span className="flex items-center gap-1">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812 1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812 1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                        </svg>
                        {alert.cameraID}
                      </span>
                      <span className="flex items-center gap-1 text-primary">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        {Math.round(alert.confidence * 100)}%
                      </span>
                    </div>
                  </div>
                  
                  {/* Chevron */}
                  <div className="flex items-center justify-center w-8 h-8 text-[hsl(var(--muted-foreground))] group-hover:text-primary transition-colors">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </div>
                
                {/* Confidence bar */}
                <div className="absolute bottom-0 left-0 right-0 h-1 bg-[hsl(var(--border))] overflow-hidden" style={{ borderRadius: '0 0 0.5rem 0.5rem' }}>
                  <div 
                    className="h-full"
                    style={{ 
                      width: `${alert.confidence * 100}%`,
                      backgroundColor: severityConfig.color,
                    }}
                  />
                </div>
              </article>
            );
          })}
        )}
      </div>
    </div>
  );
}
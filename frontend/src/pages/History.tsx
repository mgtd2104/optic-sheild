import { useState, useCallback, useMemo } from 'react';
import { LiveAlert } from '../types/detection';
import { useLiveAlerts } from '../hooks/useLiveAlerts';
import AlertDetailCard from '../components/AlertDetailCard';

const SEVERITY_CONFIG = {
  CRITICAL: { color: '#ef4444', bg: '#ef444420' },
  HIGH: { color: '#f97316', bg: '#f9731620' },
  MEDIUM: { color: '#eab308', bg: '#eab30820' },
};

const TYPE_CONFIG = {
  INTRUSION: { icon: '🚨', label: 'INTRUSION' },
  ANPR: { icon: '🚗', label: 'ANPR' },
  FRS_WATCHLIST: { icon: '👤', label: 'FRS WATCHLIST' },
  TAMPER: { icon: '🔧', label: 'TAMPER' },
};

export default function HistoryPage() {
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'INTRUSION' | 'ANPR' | 'FRS_WATCHLIST' | 'TAMPER'>('all');
  const [severityFilter, setSeverityFilter] = useState<'all' | 'CRITICAL' | 'HIGH' | 'MEDIUM'>('all');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');

  const { alerts, connected, isDemoMode } = useLiveAlerts({ maxAlerts: 100, demoMode: true, demoIntervalMs: 10000 });

  const filteredAlerts = useMemo(() => {
    let result = [...alerts];

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(a => 
        a.cameraID.toLowerCase().includes(q) ||
        a.location.name.toLowerCase().includes(q) ||
        a.alertType.toLowerCase().includes(q) ||
        a.id.toLowerCase().includes(q)
      );
    }

    if (typeFilter !== 'all') result = result.filter(a => a.alertType === typeFilter);
    if (severityFilter !== 'all') result = result.filter(a => a.severity === severityFilter);

    result.sort((a, b) => {
      const ta = new Date(a.timestamp).getTime();
      const tb = new Date(b.timestamp).getTime();
      return sortOrder === 'newest' ? tb - ta : ta - tb;
    });

    return result;
  }, [alerts, searchQuery, typeFilter, severityFilter, sortOrder]);

  const handleRowClick = useCallback((alert: LiveAlert) => {
    setSelectedAlertId(alert.id);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setSelectedAlertId(null);
  }, []);

  // FIX: Use filteredAlerts instead of alerts to find selected alert
  const selectedAlert = filteredAlerts.find(a => a.id === selectedAlertId) || null;

  const TYPE_FILTERS = ['all', 'INTRUSION', 'ANPR', 'FRS_WATCHLIST', 'TAMPER'] as const;
  const SEVERITY_FILTERS = ['all', 'CRITICAL', 'HIGH', 'MEDIUM'] as const;

  return (
    <main className="h-[calc(100vh-64px)] flex flex-col bg-[hsl(var(--background))]" role="main">
      <header className="flex items-center justify-between px-4 py-3 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))] flex-shrink-0">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold text-[hsl(var(--foreground))] tracking-tight">DETECTION HISTORY</h1>
          <span className="px-2 py-1 text-xs font-mono bg-[hsl(var(--primary))] text-primary-foreground rounded">
            {filteredAlerts.length} / {alerts.length}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {isDemoMode && (
            <span className="px-2 py-1 text-xs font-mono bg-amber-500/20 text-amber-500 border border-amber-500/30 rounded-full">
              DEMO MODE
            </span>
          )}
        </div>
      </header>

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Filters */}
        <div className="p-4 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))] flex flex-col gap-3">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[hsl(var(--muted-foreground))]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="search"
              placeholder="Search by camera, location, type, ID..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-3 py-2 bg-[hsl(var(--background))] border border-[hsl(var(--border))] rounded-lg text-[hsl(var(--foreground))] placeholder-[hsl(var(--muted-foreground))] focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
              aria-label="Search history"
            />
          </div>
          
          <div className="flex flex-wrap gap-2">
            <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-hide">
              {TYPE_FILTERS.map(f => (
                <button key={f} onClick={() => setTypeFilter(f)} className={`whitespace-nowrap px-3 py-1.5 text-xs font-medium rounded-lg border transition-all ${typeFilter===f?'bg-primary text-primary-foreground border-primary':'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] border-[hsl(var(--border))] hover:bg-[hsl(var(--background))]'}`} aria-pressed={typeFilter===f}>
                  {f==='all'?'ALL TYPES':f}
                </button>
              ))}
            </div>
            <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-hide">
              {SEVERITY_FILTERS.map(f => (
                <button key={f} onClick={() => setSeverityFilter(f)} className={`whitespace-nowrap px-3 py-1.5 text-xs font-medium rounded-lg border transition-all ${severityFilter===f?'bg-destructive text-destructive-foreground border-destructive':'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] border-[hsl(var(--border))] hover:bg-[hsl(var(--background))]'}`} aria-pressed={severityFilter===f}>
                  {f==='all'?'ALL SEVERITY':f}
                </button>
              ))}
            </div>
            <select value={sortOrder} onChange={e=>setSortOrder(e.target.value as any)} className="px-3 py-1.5 text-xs font-medium rounded-lg border bg-[hsl(var(--background))] text-[hsl(var(--foreground))] border-[hsl(var(--border))] focus:outline-none focus:ring-2 focus:ring-primary">
              <option value="newest">Newest First</option>
              <option value="oldest">Oldest First</option>
            </select>
            {(searchQuery||typeFilter!=='all'||severityFilter!=='all') && (
              <button onClick={()=>{setSearchQuery('');setTypeFilter('all');setSeverityFilter('all');setSortOrder('newest');}} className="px-3 py-1.5 text-xs font-medium rounded-lg border bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] border-[hsl(var(--border))] hover:bg-[hsl(var(--background))] hover:text-destructive hover:border-destructive transition-all">
                Clear Filters
              </button>
            )}
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-hidden">
          <div className="overflow-x-auto overflow-y-auto h-full">
            <table className="w-full min-w-[800px]" role="table">
              <thead className="sticky top-0 bg-[hsl(var(--muted))] border-b border-[hsl(var(--border))]">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider">TIME</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider">TYPE</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider">SEVERITY</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider">CAMERA</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider">CONFIDENCE</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider">LOCATION</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider">ACTIONS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[hsl(var(--border))]">
                {filteredAlerts.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-[hsl(var(--muted-foreground))]">
                      <svg className="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2H5a2 2 0 01-2-2v-9a2 2 0 012-2h6a2 2 0 012 2v2" />
                      </svg>
                      <p className="text-sm font-medium">No detections match filters</p>
                      <p className="text-xs">Adjust filters or wait for new events</p>
                    </td>
                  </tr>
                ) : (
                  filteredAlerts.map((alert) => {
                    const severityConfig = SEVERITY_CONFIG[alert.severity];
                    const typeConfig = TYPE_CONFIG[alert.alertType];
                    const isSelected = alert.id === selectedAlertId;

                    return (
                      <tr key={alert.id} className={`${isSelected?'bg-primary/10':''} hover:bg-[hsl(var(--muted))] transition-colors cursor-pointer`} onClick={() => setSelectedAlertId(alert.id)}>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <time className="text-sm font-mono text-[hsl(var(--foreground))]" dateTime={alert.timestamp}>
                            {new Date(alert.timestamp).toLocaleString()}
                          </time>
                        </td>
                        <td className="px-3 py-2">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded bg-[hsl(var(--background))] border border-[hsl(var(--border))]">
                            <span>{typeConfig.icon}</span>
                            <span className="font-medium">{typeConfig.label}</span>
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded text-white" style={{ backgroundColor: severityConfig.color }}>
                            {alert.severity}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <code className="text-sm font-mono text-[hsl(var(--foreground))]">{alert.cameraID}</code>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <div className="w-20 h-1.5 bg-[hsl(var(--border))] rounded-full overflow-hidden">
                              <div className="h-full rounded-full" style={{ width: `${alert.confidence*100}%`, backgroundColor: severityConfig.color }} />
                            </div>
                            <span className="text-xs font-mono text-[hsl(var(--muted-foreground))]">{Math.round(alert.confidence*100)}%</span>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-sm text-[hsl(var(--muted-foreground))] truncate max-w-[200px]">
                          {alert.location.name}
                        </td>
                        <td className="px-3 py-2">
                          <button onClick={(e)=>{e.stopPropagation();setSelectedAlertId(alert.id);}} className="px-2 py-1 text-xs font-medium rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors">
                            Details
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              </table>
          </div>
        </div>

        {selectedAlert && (
          <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-labelledby="history-detail-title">
            <div className="absolute inset-0 bg-black/50" onClick={() => setSelectedAlertId(null)} />
            <div className="absolute bottom-0 left-0 right-0 h-[85vh] max-h-[85vh] bg-[hsl(var(--card))] border-t border-[hsl(var(--border))] rounded-t-2xl shadow-2xl flex flex-col animate-in">
              <div className="p-4 border-b border-[hsl(var(--border))] flex items-center justify-between">
                <h2 id="history-detail-title" className="font-bold text-[hsl(var(--foreground))]">DETECTION DETAILS</h2>
                <button onClick={() => setSelectedAlertId(null)} className="p-2 rounded-lg hover:bg-[hsl(var(--muted))] transition-colors" aria-label="Close">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                <AlertDetailCard alert={selectedAlert} onClose={handleCloseDetail} showTrackInfo />
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
import { useState, useMemo } from 'react';
import { Detection, DetectionType } from '../types/detection';
import '../styles/historypage.css';

interface HistoryPageProps {
  detections: Detection[];
  loading?: boolean;
  error?: string | null;
  onViewDetails: (detection: Detection) => void;
}

const TYPE_FILTERS: { value: DetectionType | 'all'; label: string }[] = [
  { value: 'all', label: 'All Types' },
  { value: 'human', label: 'Human' },
  { value: 'vehicle', label: 'Vehicle' },
  { value: 'face', label: 'Face' },
  { value: 'suspicious', label: 'Suspicious' },
];

const SEVERITY_FILTERS = ['all', 'low', 'medium', 'high', 'critical'] as const;

export default function HistoryPage({ detections, loading, error, onViewDetails }: HistoryPageProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<DetectionType | 'all'>('all');
  const [severityFilter, setSeverityFilter] = useState<'all' | 'low' | 'medium' | 'high' | 'critical'>('all');
  const [dateRange, setDateRange] = useState<{ start: string; end: string }>({ start: '', end: '' });
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');

  const filteredDetections = useMemo(() => {
    let result = [...detections];

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(d => 
        d.cameraId.toLowerCase().includes(query) ||
        d.type.toLowerCase().includes(query) ||
        d.id.toLowerCase().includes(query)
      );
    }

    if (typeFilter !== 'all') {
      result = result.filter(d => d.type === typeFilter);
    }

    if (severityFilter !== 'all') {
      result = result.filter(d => d.severity === severityFilter);
    }

    if (dateRange.start) {
      const start = new Date(dateRange.start).getTime();
      result = result.filter(d => new Date(d.timestamp).getTime() >= start);
    }

    if (dateRange.end) {
      const end = new Date(dateRange.end).getTime();
      result = result.filter(d => new Date(d.timestamp).getTime() <= end);
    }

    result.sort((a, b) => {
      const timeA = new Date(a.timestamp).getTime();
      const timeB = new Date(b.timestamp).getTime();
      return sortOrder === 'newest' ? timeB - timeA : timeA - timeB;
    });

    return result;
  }, [detections, searchQuery, typeFilter, severityFilter, dateRange, sortOrder]);

  if (loading) {
    return (
      <div className="history-page" role="region" aria-label="History loading">
        <header className="history-header">
          <h2>Detection History</h2>
        </header>
        <div className="history-filters skeleton" aria-hidden="true">
          <div className="skeleton-line"></div>
          <div className="skeleton-line short"></div>
        </div>
        <div className="history-table">
          <table>
            <thead>
              <tr>
                <th>Time</th><th>Type</th><th>Camera</th><th>Confidence</th><th>Location</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {[...Array(5)].map((_, i) => (
                <tr key={i} className="skeleton-row">
                  <td><div className="skeleton-cell"></div></td>
                  <td><div className="skeleton-cell"></div></td>
                  <td><div className="skeleton-cell"></div></td>
                  <td><div className="skeleton-cell"></div></td>
                  <td><div className="skeleton-cell"></div></td>
                  <td><div className="skeleton-cell"></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="history-page" role="region" aria-label="History error">
        <header className="history-header">
          <h2>Detection History</h2>
        </header>
        <div className="history-error" role="alert">
          <span>⚠️</span>
          <p>Failed to load history: {error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="history-page" role="region" aria-label="Detection history">
      <header className="history-header">
        <h2>Detection History</h2>
        <div className="history-stats" aria-live="polite">
          <span>{filteredDetections.length} of {detections.length} detections</span>
        </div>
      </header>

      <section className="history-filters" aria-label="Filter detections">
        <div className="filter-group">
          <label htmlFor="search-input" className="visually-hidden">Search detections</label>
          <input
            id="search-input"
            type="search"
            className="search-input"
            placeholder="Search by camera, type, or ID..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            aria-label="Search detections"
          />
        </div>

        <div className="filter-group">
          <label htmlFor="type-filter" className="visually-hidden">Filter by type</label>
          <select
            id="type-filter"
            className="filter-select"
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value as DetectionType | 'all')}
            aria-label="Filter by detection type"
          >
            {TYPE_FILTERS.map(f => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>
        </div>

        <div className="filter-group">
          <label htmlFor="severity-filter" className="visually-hidden">Filter by severity</label>
          <select
            id="severity-filter"
            className="filter-select"
            value={severityFilter}
            onChange={e => setSeverityFilter(e.target.value as typeof severityFilter)}
            aria-label="Filter by severity"
          >
            {SEVERITY_FILTERS.map(s => (
              <option key={s} value={s}>{s === 'all' ? 'All Severities' : s.charAt(0).toUpperCase() + s.slice(1)}</option>
            ))}
          </select>
        </div>

        <div className="filter-group date-range">
          <label htmlFor="date-start" className="visually-hidden">Start date</label>
          <input
            id="date-start"
            type="date"
            className="date-input"
            value={dateRange.start}
            onChange={e => setDateRange(d => ({ ...d, start: e.target.value }))}
            aria-label="Start date"
          />
          <span aria-hidden="true">to</span>
          <label htmlFor="date-end" className="visually-hidden">End date</label>
          <input
            id="date-end"
            type="date"
            className="date-input"
            value={dateRange.end}
            onChange={e => setDateRange(d => ({ ...d, end: e.target.value }))}
            aria-label="End date"
          />
        </div>

        <div className="filter-group">
          <label htmlFor="sort-order" className="visually-hidden">Sort order</label>
          <select
            id="sort-order"
            className="filter-select"
            value={sortOrder}
            onChange={e => setSortOrder(e.target.value as 'newest' | 'oldest')}
            aria-label="Sort order"
          >
            <option value="newest">Newest First</option>
            <option value="oldest">Oldest First</option>
          </select>
        </div>

        {(searchQuery || typeFilter !== 'all' || severityFilter !== 'all' || dateRange.start || dateRange.end) && (
          <button className="clear-filters-btn" onClick={() => {
            setSearchQuery('');
            setTypeFilter('all');
            setSeverityFilter('all');
            setDateRange({ start: '', end: '' });
            setSortOrder('newest');
          }}>
            Clear Filters
          </button>
        )}
      </section>

      <div className="history-table-wrapper" role="region" aria-label="Detections table" tabIndex={0}>
        <table className="history-table">
          <thead>
            <tr>
              <th scope="col">Time</th>
              <th scope="col">Type</th>
              <th scope="col">Severity</th>
              <th scope="col">Camera</th>
              <th scope="col">Confidence</th>
              <th scope="col">Location</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredDetections.length === 0 ? (
              <tr>
                <td colSpan={7} className="empty-row">
                  <span className="empty-icon">📭</span>
                  <p>No detections match your filters</p>
                </td>
              </tr>
            ) : (
              filteredDetections.map(detection => (
                <tr key={detection.id}>
                  <td>
                    <time dateTime={detection.timestamp}>
                      {new Date(detection.timestamp).toLocaleString()}
                    </time>
                  </td>
                  <td>
                    <span className="type-badge">{detection.type.toUpperCase()}</span>
                  </td>
                  <td>
                    <span className={`severity-badge ${detection.severity}`}>
                      {detection.severity.toUpperCase()}
                    </span>
                  </td>
                  <td><code>{detection.cameraId}</code></td>
                  <td>
                    <div className="confidence-bar">
                      <div 
                        className="confidence-fill" 
                        style={{ width: `${detection.confidence * 100}%` }} 
                        aria-hidden="true"
                      ></div>
                    </div>
                    <span className="confidence-value">{Math.round(detection.confidence * 100)}%</span>
                  </td>
                  <td>
                    {detection.lat.toFixed(4)}, {detection.lng.toFixed(4)}
                  </td>
                  <td>
                    <button
                      className="action-btn"
                      onClick={() => onViewDetails(detection)}
                      aria-label={`View details for ${detection.type} detection at ${new Date(detection.timestamp).toLocaleString()}`}
                    >
                      Details
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {filteredDetections.length > 0 && (
        <footer className="history-footer" aria-label="Pagination info">
          <p>Showing {filteredDetections.length} detections</p>
        </footer>
      )}
    </div>
  );
}
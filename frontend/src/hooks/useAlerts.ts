import { useEffect, useState } from 'react';
import { Detection } from '../types/detection';
import { apiGet } from '../api/client';

export function useAlerts() {
  const [alerts, setAlerts] = useState<Detection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    apiGet<Detection[]>('/api/detections')
      .then(data => {
        if (mounted) setAlerts(data);
      })
      .catch(err => {
        if (mounted) setError(err.message);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => { mounted = false; };
  }, []);

  return { alerts, loading, error };
}
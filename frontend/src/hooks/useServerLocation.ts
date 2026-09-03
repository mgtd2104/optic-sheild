import { useEffect, useState } from 'react';
import { apiGet } from '../api/client';

const DEFAULT_SERVER_LOCATION: ServerLocation = {
  latitude: 28.9845,
  longitude: 77.7064,
  name: 'IBVAP Server',
  updated_at: new Date(0).toISOString(),
  source: 'local-config-fallback',
};

export interface ServerLocation {
  latitude: number;
  longitude: number;
  name: string;
  updated_at: string;
  source: string;
}

export function useServerLocation(intervalMs = 15000) {
  const [location, setLocation] = useState<ServerLocation>(DEFAULT_SERVER_LOCATION);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const loadLocation = async () => {
      try {
        const nextLocation = await apiGet<ServerLocation>('/api/system/location');
        if (active) {
          setLocation(nextLocation);
          setError(null);
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Server location unavailable');
      }
    };

    loadLocation();
    const timer = window.setInterval(loadLocation, intervalMs);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [intervalMs]);

  return { location, error };
}

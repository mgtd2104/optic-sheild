import { useEffect, useState } from 'react';

export interface DeviceLocation {
  latitude: number;
  longitude: number;
  accuracy: number;
  updatedAt: string;
}

export function useDeviceLocation() {
  const [location, setLocation] = useState<DeviceLocation | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!navigator.geolocation) {
      setError('GPS is not supported by this browser');
      return;
    }

    setError('Waiting for browser GPS permission');

    const watchId = navigator.geolocation.watchPosition(
      position => {
        setLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          updatedAt: new Date().toISOString(),
        });
        setError(null);
      },
      positionError => setError(positionError.message),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  return { location, error };
}

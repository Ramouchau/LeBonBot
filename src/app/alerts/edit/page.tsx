'use client';

import { invoke } from '@tauri-apps/api/core';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import AlertForm from '../../../components/AlertForm';

interface Alert {
  id: string;
  name: string;
  priceMin: number | null;
  priceMax: number | null;
  location: string;
  radiusKm: number;
  propertyType: string;
  surfaceMin: number | null;
  roomsMin: number | null;
  furnished: boolean | null;
  newConstruction: boolean | null;
  keywords: string[];
  relaxedMode: boolean;
  scanIntervalMinutes: number;
}

function EditAlertInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = searchParams.get('id');
  const [alert, setAlert] = useState<Alert | null>(null);

  useEffect(() => {
    if (!id) return;
    invoke<Alert[]>('list_alerts').then((alerts) => {
      const found = alerts.find((a) => a.id === id);
      if (found) setAlert(found);
    });
  }, [id]);

  const handleSubmit = useCallback(
    async (data: Record<string, unknown>) => {
      if (!id) return;
      await invoke('update_alert', { id, ...data });
      router.push('/');
    },
    [id, router],
  );

  if (!id) {
    return (
      <div className="page">
        <p>No alert specified.</p>
      </div>
    );
  }

  if (!alert)
    return (
      <div className="page">
        <p>Loading…</p>
      </div>
    );

  return (
    <div className="page">
      <div className="page-header">
        <h1>Edit Alert</h1>
      </div>
      <div style={{ maxWidth: 560 }}>
        <AlertForm initial={alert as unknown as Record<string, unknown>} onSubmit={handleSubmit} />
      </div>
    </div>
  );
}

export default function EditAlertPage() {
  return (
    <Suspense>
      <EditAlertInner />
    </Suspense>
  );
}

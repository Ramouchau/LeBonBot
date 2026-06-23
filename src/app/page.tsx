'use client';

import { invoke } from '@tauri-apps/api/core';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import StatusPanel from '../components/StatusPanel';

interface Alert {
  id: string;
  name: string;
  enabled: boolean;
  location: string;
  propertyType: string;
  priceMin: number | null;
  priceMax: number | null;
  scanIntervalMinutes: number;
  lastScanAt: string | null;
}

function formatPrice(min: number | null, max: number | null): string {
  if (min && max) return `${min}€ – ${max}€`;
  if (min) return `≥ ${min}€`;
  if (max) return `≤ ${max}€`;
  return '';
}

export default function Home() {
  const [alerts, setAlerts] = useState<Alert[]>([]);

  useEffect(() => {
    invoke<Alert[]>('list_alerts').then(setAlerts).catch(console.error);
  }, []);

  const handleToggle = async (id: string, enabled: boolean) => {
    await invoke('toggle_alert', { id, enabled });
    setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, enabled } : a)));
  };

  const handleDelete = async (id: string) => {
    await invoke('delete_alert', { id });
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  };

  const handleScanNow = async () => {
    try {
      const result = await invoke<string>('scan_now');
      alert(result);
    } catch (e) {
      alert(`Scan failed: ${e}`);
    }
    invoke<Alert[]>('list_alerts').then(setAlerts).catch(console.error);
  };

  return (
    <div className="page">
      <h1>LeBonBot</h1>
      <StatusPanel />

      <div className="toolbar">
        <Link href="/alerts/new">
          <button type="button">+ New Alert</button>
        </Link>
        <Link href="/settings">
          <button type="button" className="muted">
            Settings
          </button>
        </Link>
        <button type="button" className="muted" onClick={handleScanNow}>
          Scan Now
        </button>
      </div>

      {alerts.length === 0 && (
        <p className="empty-state">No alerts configured. Create one to start scanning.</p>
      )}

      {alerts.map((alert) => (
        <div key={alert.id} className={`card${alert.enabled ? '' : ' disabled'}`}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              marginBottom: 'var(--space-sm)',
            }}
          >
            <h2
              style={{
                fontSize: '2.5rem',
                margin: 0,
                color: alert.enabled ? 'var(--fg)' : 'var(--muted)',
              }}
            >
              {alert.name}
            </h2>
            <span className={`status-badge ${alert.enabled ? 'active' : 'paused'}`}>
              {alert.enabled ? 'active' : 'paused'}
            </span>
          </div>

          <div className="alert-meta">
            <span>{alert.location}</span>
            <span className="separator">·</span>
            <span>{alert.propertyType}</span>
            {(alert.priceMin || alert.priceMax) && (
              <>
                <span className="separator">·</span>
                <span>{formatPrice(alert.priceMin, alert.priceMax)}</span>
              </>
            )}
          </div>

          <div className="alert-timing">
            every {alert.scanIntervalMinutes} min
            {alert.lastScanAt && ` — last: ${new Date(alert.lastScanAt).toLocaleString()}`}
          </div>

          <div className="action-row">
            <Link href={`/alerts/edit?id=${alert.id}`}>
              <button type="button">Edit</button>
            </Link>
            <button
              type="button"
              className="muted"
              onClick={() => handleToggle(alert.id, !alert.enabled)}
            >
              {alert.enabled ? 'Pause' : 'Resume'}
            </button>
            <button type="button" className="danger" onClick={() => handleDelete(alert.id)}>
              Delete
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

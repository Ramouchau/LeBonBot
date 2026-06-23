'use client';

import useBotStatus from '../hooks/useBotStatus';

const STATUS_CONFIG = {
  idle: { dot: 'var(--success)', label: 'idle', desc: 'waiting for next scan' },
  active: { dot: 'var(--accent)', label: 'scanning', desc: 'checking leboncoin' },
  error: { dot: 'var(--danger)', label: 'error', desc: 'check settings or tray' },
};

export default function StatusPanel() {
  const status = useBotStatus();
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.idle;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-sm)',
        padding: 'var(--space-sm) 0',
        marginBottom: 'var(--space-lg)',
        borderBottom: '1px solid var(--border)',
        fontFamily: 'var(--font-mono)',
        fontSize: '0.75rem',
        fontWeight: 300,
        letterSpacing: '0.05em',
        color: 'var(--muted)',
      }}
    >
      <span
        style={{
          display: 'inline-block',
          width: 8,
          height: 8,
          background: cfg.dot,
        }}
      />
      {cfg.label} — {cfg.desc}
    </div>
  );
}

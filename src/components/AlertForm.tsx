'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

const PROPERTY_TYPES = ['appartement', 'maison', 'studio', 'loft', 'terrain', 'parking'];

interface AlertFormProps {
  initial?: Record<string, unknown>;
  onSubmit: (data: Record<string, unknown>) => Promise<void>;
}

export default function AlertForm({ initial, onSubmit }: AlertFormProps) {
  const router = useRouter();
  const [name, setName] = useState((initial?.name as string) ?? '');
  const [priceMin, setPriceMin] = useState(
    initial?.priceMin != null ? String(initial.priceMin) : '',
  );
  const [priceMax, setPriceMax] = useState(
    initial?.priceMax != null ? String(initial.priceMax) : '',
  );
  const [location, setLocation] = useState((initial?.location as string) ?? '');
  const [radiusKm, setRadiusKm] = useState(
    initial?.radiusKm != null ? String(initial.radiusKm) : '10',
  );
  const [propertyType, setPropertyType] = useState(
    (initial?.propertyType as string) || 'appartement',
  );
  const [surfaceMin, setSurfaceMin] = useState(
    initial?.surfaceMin != null ? String(initial.surfaceMin) : '',
  );
  const [roomsMin, setRoomsMin] = useState(
    initial?.roomsMin != null ? String(initial.roomsMin) : '',
  );
  const [furnished, setFurnished] = useState(
    initial?.furnished != null ? String(initial.furnished) : '',
  );
  const [newConstruction, setNewConstruction] = useState(
    initial?.newConstruction != null ? String(initial.newConstruction) : '',
  );
  const [keywords, setKeywords] = useState(
    initial?.keywords ? (initial.keywords as string[]).join(', ') : '',
  );
  const [relaxedMode, setRelaxedMode] = useState((initial?.relaxedMode as boolean) || false);
  const [interval, setInterval_] = useState(
    initial?.scanIntervalMinutes != null ? String(initial.scanIntervalMinutes) : '15',
  );
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSubmit({
        name,
        priceMin: priceMin ? parseFloat(priceMin) : null,
        priceMax: priceMax ? parseFloat(priceMax) : null,
        location,
        radiusKm: parseFloat(radiusKm) || 10,
        propertyType,
        surfaceMin: surfaceMin ? parseFloat(surfaceMin) : null,
        roomsMin: roomsMin ? parseInt(roomsMin, 10) : null,
        furnished: furnished === '' ? null : furnished === 'true',
        newConstruction: newConstruction === '' ? null : newConstruction === 'true',
        keywords: keywords
          .split(',')
          .map((k) => k.trim())
          .filter(Boolean),
        relaxedMode,
        scanIntervalMinutes: parseInt(interval, 10) || 15,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <label>
        Name
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Paris centre — appartement"
          required
        />
      </label>

      <div className="form-row">
        <label>
          Min Price (€)
          <input
            type="number"
            value={priceMin}
            onChange={(e) => setPriceMin(e.target.value)}
            placeholder="0"
          />
        </label>
        <label>
          Max Price (€)
          <input
            type="number"
            value={priceMax}
            onChange={(e) => setPriceMax(e.target.value)}
            placeholder="500000"
          />
        </label>
      </div>

      <div className="form-row">
        <label>
          Location
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Paris 75001"
            required
          />
        </label>
        <label>
          Radius (km)
          <input
            type="number"
            value={radiusKm}
            onChange={(e) => setRadiusKm(e.target.value)}
            min="1"
            max="100"
          />
        </label>
      </div>

      <label>
        Property Type
        <select value={propertyType} onChange={(e) => setPropertyType(e.target.value)}>
          {PROPERTY_TYPES.map((pt) => (
            <option key={pt} value={pt}>
              {pt}
            </option>
          ))}
        </select>
      </label>

      <div className="form-row">
        <label>
          Min Surface (m²)
          <input
            type="number"
            value={surfaceMin}
            onChange={(e) => setSurfaceMin(e.target.value)}
            placeholder="30"
          />
        </label>
        <label>
          Min Rooms
          <input
            type="number"
            value={roomsMin}
            onChange={(e) => setRoomsMin(e.target.value)}
            placeholder="2"
          />
        </label>
      </div>

      <div className="form-row">
        <label>
          Furnished
          <select value={furnished} onChange={(e) => setFurnished(e.target.value)}>
            <option value="">Any</option>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        </label>
        <label>
          New Construction
          <select value={newConstruction} onChange={(e) => setNewConstruction(e.target.value)}>
            <option value="">Any</option>
            <option value="true">New only</option>
            <option value="false">Old only</option>
          </select>
        </label>
      </div>

      <label>
        Keywords (comma-separated)
        <input
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
          placeholder="balcon, vue dégagée, calme"
        />
      </label>

      <div className="form-row">
        <label>
          Scan Interval (min)
          <input
            type="number"
            value={interval}
            onChange={(e) => setInterval_(e.target.value)}
            min="10"
          />
        </label>
        <label
          style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 'var(--space-sm)' }}
        >
          <button
            type="button"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-sm)',
              cursor: 'pointer',
              background: 'none',
              border: 'none',
              padding: 0,
              fontFamily: 'var(--font-mono)',
              fontSize: '0.75rem',
              fontWeight: 500,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: 'var(--muted)',
            }}
            onClick={() => setRelaxedMode(!relaxedMode)}
          >
            <input
              type="checkbox"
              checked={relaxedMode}
              onChange={(e) => setRelaxedMode(e.target.checked)}
            />
            Relaxed matching
          </button>
        </label>
      </div>

      <div className="action-row">
        <button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save Alert'}
        </button>
        <button type="button" className="muted" onClick={() => router.push('/')}>
          Cancel
        </button>
      </div>
    </form>
  );
}

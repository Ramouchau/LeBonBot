'use client';

import { invoke } from '@tauri-apps/api/core';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

interface Settings {
  llmProvider: string;
  llmApiKey: string;
  llmModel: string;
  ollamaEndpoint: string;
  telegramChatId: string;
  chromePath: string;
}

export default function SettingsPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<Settings>({
    llmProvider: 'openai',
    llmApiKey: '',
    llmModel: 'gpt-4o-mini',
    ollamaEndpoint: 'http://localhost:11434/v1',
    telegramChatId: '',
    chromePath: '',
  });
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    invoke<Settings>('get_settings')
      .then((s) =>
        setSettings({
          llmProvider: s.llmProvider ?? 'openai',
          llmApiKey: s.llmApiKey ?? '',
          llmModel: s.llmModel ?? 'gpt-4o-mini',
          ollamaEndpoint: s.ollamaEndpoint ?? 'http://localhost:11434/v1',
          telegramChatId: s.telegramChatId ?? '',
          chromePath: s.chromePath ?? '',
        }),
      )
      .catch(console.error);
  }, []);

  const handleSave = async () => {
    setError('');
    try {
      await invoke('update_settings', {
        llmProvider: settings.llmProvider,
        llmApiKey: settings.llmApiKey,
        llmModel: settings.llmModel,
        ollamaEndpoint: settings.ollamaEndpoint,
        telegramChatId: settings.telegramChatId,
        chromePath: settings.chromePath || null,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1>Settings</h1>
      </div>

      <div className="settings-form">
        <label>
          LLM Provider
          <select
            value={settings.llmProvider}
            onChange={(e) => setSettings({ ...settings, llmProvider: e.target.value })}
          >
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
            <option value="deepseek">DeepSeek</option>
            <option value="ollama">Ollama (local)</option>
          </select>
        </label>

        {settings.llmProvider !== 'ollama' && (
          <label>
            API Key
            <input
              type="password"
              value={settings.llmApiKey}
              onChange={(e) => setSettings({ ...settings, llmApiKey: e.target.value })}
              placeholder="sk-..."
            />
          </label>
        )}

        <label>
          Model
          <input
            value={settings.llmModel}
            onChange={(e) => setSettings({ ...settings, llmModel: e.target.value })}
            placeholder="gpt-4o-mini"
          />
        </label>

        {settings.llmProvider === 'ollama' && (
          <label>
            Ollama Endpoint
            <input
              value={settings.ollamaEndpoint}
              onChange={(e) => setSettings({ ...settings, ollamaEndpoint: e.target.value })}
              placeholder="http://localhost:11434/v1"
            />
          </label>
        )}

        <label>
          Telegram Chat ID
          <input
            value={settings.telegramChatId}
            onChange={(e) => setSettings({ ...settings, telegramChatId: e.target.value })}
            placeholder="123456789"
          />
        </label>

        <label>
          Chrome Path
          <span
            style={{
              display: 'block',
              fontSize: '0.7rem',
              fontWeight: 300,
              color: 'var(--muted)',
              marginTop: 'var(--space-xs)',
            }}
          >
            {settings.chromePath ? 'auto-detected' : 'not found — set manually'}
          </span>
          <input
            value={settings.chromePath}
            onChange={(e) => setSettings({ ...settings, chromePath: e.target.value })}
            placeholder="/usr/bin/google-chrome"
          />
        </label>

        <div className="action-row">
          <button type="button" onClick={handleSave}>
            Save
          </button>
          <button type="button" className="muted" onClick={() => router.push('/')}>
            Back
          </button>
          {saved && <span className="settings-saved">✓ Saved</span>}
          {error && <span style={{ color: 'var(--danger)', fontSize: '0.75rem' }}>{error}</span>}
        </div>
      </div>
    </div>
  );
}

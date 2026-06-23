'use client';

import { invoke } from '@tauri-apps/api/core';
import { useRouter } from 'next/navigation';
import AlertForm from '../../../components/AlertForm';

export default function NewAlert() {
  const router = useRouter();

  const handleSubmit = async (data: Record<string, unknown>) => {
    await invoke('create_alert', data);
    router.push('/');
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1>New Alert</h1>
      </div>
      <div style={{ maxWidth: 560 }}>
        <AlertForm onSubmit={handleSubmit} />
      </div>
    </div>
  );
}

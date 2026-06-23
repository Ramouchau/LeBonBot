'use client';

import { listen } from '@tauri-apps/api/event';
import { useEffect, useState } from 'react';

export type BotStatus = 'idle' | 'active' | 'error';

export default function useBotStatus(): BotStatus {
  const [status, setStatus] = useState<BotStatus>('idle');

  useEffect(() => {
    const unlistenPromise = listen<BotStatus>('bot-status', (event) => {
      setStatus(event.payload);
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  return status;
}

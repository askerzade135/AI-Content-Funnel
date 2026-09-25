import { useCallback, useEffect, useState } from 'react';
import {
  getCalendarAccessToken,
  getYouTubePublishingAccessToken,
  INTEGRATION_STATE_EVENT,
} from '../services/googleAuth';

export type IntegrationKind = 'calendar' | 'youtube';

async function readConnected(kind: IntegrationKind) {
  const token = kind === 'calendar'
    ? await getCalendarAccessToken()
    : await getYouTubePublishingAccessToken();
  return Boolean(token);
}

export function useIntegrationState(kind: IntegrationKind) {
  const [connected, setConnected] = useState(false);
  const [checking, setChecking] = useState(true);

  const refresh = useCallback(async () => {
    const next = await readConnected(kind);
    setConnected(next);
    setChecking(false);
    return next;
  }, [kind]);

  useEffect(() => {
    void refresh();
    const onChange = () => { void refresh(); };
    window.addEventListener(INTEGRATION_STATE_EVENT, onChange);
    window.addEventListener('focus', onChange);
    return () => {
      window.removeEventListener(INTEGRATION_STATE_EVENT, onChange);
      window.removeEventListener('focus', onChange);
    };
  }, [refresh]);

  return { connected, checking, refresh };
}

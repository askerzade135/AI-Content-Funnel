import { useCallback, useEffect, useState } from 'react';
import {
  getCalendarAccessToken,
  INTEGRATION_STATE_EVENT,
} from '../services/googleAuth';
import { getSocialIntegrationStatus } from '../services/socialIntegrationService';
import { validateYouTubePublishingConnection } from '../services/youtubePublishingService';

export type IntegrationKind = 'calendar' | 'youtube' | 'instagram' | 'tiktok';

async function readConnected(kind: IntegrationKind) {
  if (kind === 'instagram' || kind === 'tiktok') {
    try {
      return Boolean((await getSocialIntegrationStatus(kind)).connected);
    } catch {
      return false;
    }
  }
  if (kind === 'youtube') return validateYouTubePublishingConnection();
  const token = await getCalendarAccessToken();
  return Boolean(token);
}

export function useIntegrationState(kind: IntegrationKind) {
  const [connected, setConnected] = useState(false);
  const [checking, setChecking] = useState(true);
  const [revision, setRevision] = useState(0);

  const refresh = useCallback(async () => {
    const next = await readConnected(kind);
    setConnected(next);
    setChecking(false);
    setRevision(current => current + 1);
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

  return { connected, checking, refresh, revision };
}

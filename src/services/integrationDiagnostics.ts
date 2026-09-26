import { authFetch } from './authFetch';

export type IntegrationDiagnosticProvider = 'google_calendar' | 'youtube' | 'instagram' | 'tiktok';
export type IntegrationDiagnosticOperation = 'connect' | 'api_request' | 'sync';
export type IntegrationDiagnosticStatus = 'success' | 'failed' | 'cancelled';

export async function reportIntegrationEvent(input: {
  provider: IntegrationDiagnosticProvider;
  operation: IntegrationDiagnosticOperation;
  status: IntegrationDiagnosticStatus;
  errorCode?: string;
  message?: string;
}): Promise<void> {
  try {
    await authFetch('/api/integrations/client-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  } catch {
    // Diagnostics must never block the user's integration flow.
  }
}

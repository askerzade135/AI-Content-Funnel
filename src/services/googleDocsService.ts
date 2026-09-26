import { connectGoogleDocs, getAccessToken } from './googleAuth';

export interface CreateDocResult {
  id: string;
  url: string;
  name: string;
}

/**
 * Creates a native Google Document directly in the user's Google Drive
 * with full rich-text formatting (tables, styles, headers, colors, highlights)
 * converted from HTML.
 */
export async function createGoogleDocFromHtml(
  title: string,
  htmlContent: string
): Promise<CreateDocResult | null> {
  let accessToken = await getAccessToken();

  if (!accessToken) {
    const authRes = await connectGoogleDocs();
    if (!authRes?.accessToken) {
      // User cancelled or closed the permissions popup
      return null;
    }
    accessToken = authRes.accessToken;
  }

  const boundary = '-------314159265358979323846';
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const metadata = {
    name: title,
    mimeType: 'application/vnd.google-apps.document',
  };

  const multipartRequestBody =
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    delimiter +
    'Content-Type: text/html; charset=UTF-8\r\n\r\n' +
    htmlContent +
    closeDelimiter;

  const response = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: multipartRequestBody,
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    console.error('Google Drive create doc error:', response.status, errText);

    if (response.status === 401) {
      // Token might be expired, retry once after re-authenticating
      const authRes = await connectGoogleDocs();
      if (authRes?.accessToken) {
        return createGoogleDocFromHtml(title, htmlContent);
      }
    }

    throw new Error(`Ошибка создания документа в Google Drive (${response.status}): ${errText}`);
  }

  const result = await response.json();
  const docId = result.id;
  const docUrl = result.webViewLink || `https://docs.google.com/document/d/${docId}/edit`;

  return {
    id: docId,
    url: docUrl,
    name: result.name || title,
  };
}

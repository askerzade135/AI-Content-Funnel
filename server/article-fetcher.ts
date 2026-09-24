const ARTICLE_TIMEOUT_MS = 6500;
const ARTICLE_MAX_BYTES = 1_500_000;
const ARTICLE_MAX_TEXT = 12_000;

export interface ArticleMetadata {
  url: string;
  canonicalUrl?: string;
  title?: string;
  author?: string;
  publishedAt?: string;
  description?: string;
  imageUrl?: string;
  domain: string;
  text?: string;
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local')) return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return true;
  const match = host.match(/^172\.(\d+)\./);
  if (match && Number(match[1]) >= 16 && Number(match[1]) <= 31) return true;
  return host === '0.0.0.0' || host === '::1';
}

function safeHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || isPrivateHost(url.hostname)) return null;
    return url;
  } catch {
    return null;
  }
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(Number(code)));
}

function metaContent(html: string, keys: string[]): string | undefined {
  for (const key of keys) {
    const escaped = key.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
    const patterns = [
      new RegExp('<meta[^>]+(?:property|name)=["\\']' + escaped + '["\\'][^>]+content=["\\']([^"\\']+)["\\'][^>]*>', 'i'),
      new RegExp('<meta[^>]+content=["\\']([^"\\']+)["\\'][^>]+(?:property|name)=["\\']' + escaped + '["\\'][^>]*>', 'i'),
    ];
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match?.[1]) return decodeHtml(match[1].trim());
    }
  }
  return undefined;
}

function canonicalHref(html: string): string | undefined {
  const match = html.match(/<link[^>]+rel=["'][^"']*canonical[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>/i)
    || html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*canonical[^"']*["'][^>]*>/i);
  return match?.[1]?.trim();
}

function titleFromHtml(html: string): string | undefined {
  return metaContent(html, ['og:title', 'twitter:title'])
    || decodeHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim() || '')
    || undefined;
}

function extractReadableText(html: string): string {
  const article = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1]
    || html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1]
    || html;
  return decodeHtml(
    article
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, ' ')
      .replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  ).slice(0, ARTICLE_MAX_TEXT);
}

export async function fetchArticleMetadata(rawUrl: string): Promise<ArticleMetadata | null> {
  const url = safeHttpUrl(rawUrl);
  if (!url) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ARTICLE_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'ContentRadarBot/1.0 (+https://contentradar.ai.studio/)',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!response.ok) return null;
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) return null;
    const declaredLength = Number(response.headers.get('content-length') || 0);
    if (declaredLength > ARTICLE_MAX_BYTES) return null;

    const html = (await response.text()).slice(0, ARTICLE_MAX_BYTES);
    const finalUrl = safeHttpUrl(response.url) || url;
    const canonicalRaw = canonicalHref(html);
    const canonical = canonicalRaw ? safeHttpUrl(new URL(canonicalRaw, finalUrl).toString()) : null;
    const imageRaw = metaContent(html, ['og:image', 'twitter:image']);
    const image = imageRaw ? safeHttpUrl(new URL(imageRaw, finalUrl).toString()) : null;

    return {
      url: finalUrl.toString(),
      canonicalUrl: canonical?.toString(),
      title: titleFromHtml(html),
      author: metaContent(html, ['author', 'article:author']),
      publishedAt: metaContent(html, ['article:published_time', 'date', 'datePublished']),
      description: metaContent(html, ['og:description', 'description', 'twitter:description']),
      imageUrl: image?.toString(),
      domain: finalUrl.hostname.replace(/^www\./, ''),
      text: extractReadableText(html),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

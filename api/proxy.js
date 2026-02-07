const HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'content-length',
]);

const BLOCKED_RESPONSE_HEADERS = new Set([
  'content-security-policy',
  'content-security-policy-report-only',
  'x-frame-options',
]);

function isHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function toProxyUrl(target) {
  return `/api/proxy?url=${encodeURIComponent(target)}`;
}

function rewriteUrl(rawUrl, baseUrl) {
  const candidate = (rawUrl || '').trim();
  if (!candidate) return candidate;
  if (
    candidate.startsWith('#') ||
    candidate.startsWith('data:') ||
    candidate.startsWith('javascript:') ||
    candidate.startsWith('mailto:') ||
    candidate.startsWith('tel:')
  ) {
    return candidate;
  }

  try {
    const resolved = new URL(candidate, baseUrl);
    if (!isHttpUrl(resolved.toString())) return candidate;
    return toProxyUrl(resolved.toString());
  } catch {
    return candidate;
  }
}

function rewriteHtml(html, baseUrl) {
  let output = html;

  output = output.replace(
    /(\s(?:href|src|action|poster|data)\s*=\s*)(["'])(.*?)(\2)/gi,
    (_, prefix, quote, value) => `${prefix}${quote}${rewriteUrl(value, baseUrl)}${quote}`,
  );

  output = output.replace(/(srcset\s*=\s*["'])(.*?)(["'])/gi, (_, start, value, end) => {
    const rewritten = value
      .split(',')
      .map((part) => {
        const [url, descriptor] = part.trim().split(/\s+/, 2);
        if (!url) return part;
        const proxied = rewriteUrl(url, baseUrl);
        return descriptor ? `${proxied} ${descriptor}` : proxied;
      })
      .join(', ');
    return `${start}${rewritten}${end}`;
  });

  output = output.replace(/url\(([^)]+)\)/gi, (match, value) => {
    const trimmed = value.trim().replace(/^['"]|['"]$/g, '');
    const rewritten = rewriteUrl(trimmed, baseUrl);
    return `url("${rewritten}")`;
  });

  if (/<head[^>]*>/i.test(output)) {
    output = output.replace(/<head([^>]*)>/i, `<head$1><base href="${baseUrl}">`);
  }

  return output;
}

module.exports = async function handler(req, res) {
  const { url } = req.query;
  const targetUrl = Array.isArray(url) ? url[0] : url;

  if (!targetUrl || !isHttpUrl(targetUrl)) {
    res.status(400).json({
      error: 'Invalid or missing url query. Use /api/proxy?url=https://example.com',
    });
    return;
  }

  const upstreamHeaders = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (!value) continue;
    const lower = key.toLowerCase();
    if (HOP_HEADERS.has(lower) || lower === 'host') continue;
    if (Array.isArray(value)) {
      upstreamHeaders.set(key, value.join(', '));
    } else {
      upstreamHeaders.set(key, value);
    }
  }

  upstreamHeaders.set('accept-encoding', 'identity');

  const method = req.method || 'GET';
  let body;
  if (method !== 'GET' && method !== 'HEAD') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    body = Buffer.concat(chunks);
  }

  let upstream;
  try {
    upstream = await fetch(targetUrl, {
      method,
      headers: upstreamHeaders,
      redirect: 'follow',
      body,
    });
  } catch (error) {
    res.status(502).json({ error: 'Failed to reach upstream URL', detail: String(error) });
    return;
  }

  res.status(upstream.status);

  upstream.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (HOP_HEADERS.has(lower) || BLOCKED_RESPONSE_HEADERS.has(lower)) return;
    res.setHeader(key, value);
  });

  const finalUrl = upstream.url || targetUrl;
  const contentType = upstream.headers.get('content-type') || '';

  if (/text\/html|application\/xhtml\+xml/i.test(contentType)) {
    const html = await upstream.text();
    const rewritten = rewriteHtml(html, finalUrl);
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.removeHeader('content-length');
    res.send(rewritten);
    return;
  }

  const arrayBuffer = await upstream.arrayBuffer();
  res.send(Buffer.from(arrayBuffer));
}

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const TMPFILES_HOSTS = new Set(['tmpfiles.org', 'www.tmpfiles.org']);

function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
}

function isTmpFilesUrl(value: URL) {
  return value.protocol === 'https:' && TMPFILES_HOSTS.has(value.hostname) && !value.username && !value.password;
}

function findDownloadUrl(html: string, pageUrl: URL) {
  const href = html.match(/href=["']([^"']*\/dl\/[^"']+)["']/i)?.[1];
  if (!href) throw new Error('TmpFiles did not expose a download URL for this upload.');
  const downloadUrl = new URL(href, pageUrl);
  if (!isTmpFilesUrl(downloadUrl) || !downloadUrl.pathname.startsWith('/dl/')) throw new Error('TmpFiles returned an unexpected download URL.');
  return downloadUrl;
}

export async function GET(request: Request) {
  const target = new URL(request.url).searchParams.get('url');
  if (!target || target.length > 2048) return jsonError('A valid TmpFiles URL is required.');

  let pageUrl: URL;
  try {
    pageUrl = new URL(target);
  } catch {
    return jsonError('The image URL is not valid.');
  }
  if (!isTmpFilesUrl(pageUrl)) return jsonError('Only HTTPS TmpFiles URLs are supported by this bridge.');

  try {
    let downloadUrl = pageUrl;
    if (!pageUrl.pathname.startsWith('/dl/')) {
      const pageResponse = await fetch(pageUrl, { redirect: 'follow' });
      if (!pageResponse.ok) return jsonError('TmpFiles upload page is no longer available.', 502);
      if (!isTmpFilesUrl(new URL(pageResponse.url))) return jsonError('TmpFiles redirected to an unexpected host.', 502);
      downloadUrl = findDownloadUrl((await pageResponse.text()).slice(0, 2 * 1024 * 1024), pageUrl);
    }

    const imageResponse = await fetch(downloadUrl, { redirect: 'follow' });
    if (!imageResponse.ok) return jsonError('TmpFiles image is no longer available.', 502);
    if (!isTmpFilesUrl(new URL(imageResponse.url))) return jsonError('TmpFiles redirected to an unexpected host.', 502);
    const contentType = (imageResponse.headers.get('content-type') ?? '').split(';')[0].toLowerCase();
    const contentLength = Number(imageResponse.headers.get('content-length') ?? 0);
    if (!contentType.startsWith('image/')) return jsonError('TmpFiles returned a non-image response.', 415);
    if (contentLength > MAX_IMAGE_BYTES) return jsonError('The remote image is larger than CLOTHO’s 8 MB feasibility limit.', 413);
    const body = await imageResponse.arrayBuffer();
    if (body.byteLength > MAX_IMAGE_BYTES) return jsonError('The remote image is larger than CLOTHO’s 8 MB feasibility limit.', 413);

    return new Response(body, {
      headers: {
        'Cache-Control': 'no-store',
        'Content-Length': String(body.byteLength),
        'Content-Type': contentType,
        'Content-Disposition': 'inline',
        'X-CLOTHO-Transport': 'tmpfiles-bridge',
      },
    });
  } catch {
    return jsonError('CLOTHO could not read the temporary TmpFiles image.', 502);
  }
}

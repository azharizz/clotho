const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

type ReferencePiece = {
  id: string;
  category: 'headwear' | 'tops' | 'bottoms' | 'shoes';
  path: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

const layout: Record<ReferencePiece['category'], Omit<ReferencePiece, 'id' | 'category' | 'path'>> = {
  headwear: { x: 250, y: 35, width: 300, height: 225 },
  tops: { x: 115, y: 195, width: 570, height: 390 },
  bottoms: { x: 135, y: 530, width: 530, height: 475 },
  shoes: { x: 120, y: 970, width: 560, height: 190 },
};

function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
}

function escapeXml(value: string) {
  return value.replace(/[<>&'"]/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[character] ?? character);
}

function parseCatalogItem(id: string): ReferencePiece | null {
  const match = /^(top|bottom|shoes|headwear)-(0\d|10)$/.exec(id);
  if (!match) return null;
  const prefix = match[1];
  const index = match[2];
  const category = prefix === 'top' ? 'tops' : prefix === 'bottom' ? 'bottoms' : prefix;
  const suffix = prefix === 'top' ? 'top' : prefix === 'bottom' ? 'bottom' : prefix;
  return { id, category: category as ReferencePiece['category'], path: `/items/clean/${category}/grid-${index}-${suffix}.webp`, ...layout[category as ReferencePiece['category']] };
}

function toBase64(bytes: Uint8Array) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  return btoa(binary);
}

async function readAsset(request: Request, path: string) {
  const response = await fetch(new URL(path, request.url), { cache: 'no-store' });
  if (!response.ok) throw new Error('Catalog image unavailable.');
  const contentType = (response.headers.get('content-type') ?? 'image/webp').split(';')[0].toLowerCase();
  if (!contentType.startsWith('image/')) throw new Error('Catalog asset is not an image.');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error('Catalog image is too large.');
  return `data:${contentType};base64,${toBase64(bytes)}`;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const rawIds = params.get('items')?.split(',').map((id) => id.trim()).filter(Boolean) ?? [];
  if (rawIds.length < 3 || rawIds.length > 4) return jsonError('A look needs Top, Bottom, Shoes, and optional Headwear.');

  const pieces = rawIds.map(parseCatalogItem);
  if (pieces.some((piece) => !piece)) return jsonError('Only public catalog item IDs can be exported as a static reference URL.');
  const validPieces = pieces as ReferencePiece[];
  const categories = validPieces.map((piece) => piece.category);
  if (new Set(categories).size !== categories.length || !['tops', 'bottoms', 'shoes'].every((category) => categories.includes(category as ReferencePiece['category']))) {
    return jsonError('The look must contain exactly one Top, Bottom, and Shoes, plus optional Headwear.');
  }

  try {
    const withImages = await Promise.all(validPieces.map(async (piece) => ({ ...piece, source: await readAsset(request, piece.path) })));
    const labels = withImages.map((piece) => escapeXml(piece.id)).join(' · ');
    const imageNodes = withImages.map((piece) => `<image href="${piece.source}" x="${piece.x}" y="${piece.y}" width="${piece.width}" height="${piece.height}" preserveAspectRatio="xMidYMid meet" />`).join('');
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1200" viewBox="0 0 800 1200" role="img" aria-labelledby="title description">
  <title id="title">CLOTHO outfit reference</title>
  <desc id="description">${labels}</desc>
  <rect width="800" height="1200" fill="#fcfbf8" />
  ${imageNodes}
</svg>`;
    const download = ['1', 'true'].includes((params.get('download') ?? '').toLowerCase());
    const filename = `clotho-${validPieces.map((piece) => piece.id).join('-')}.svg`;
    return new Response(svg, {
      headers: {
        'Cache-Control': 'public, max-age=300',
        'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${filename}"`,
        'Content-Length': String(new TextEncoder().encode(svg).byteLength),
        'Content-Type': 'image/svg+xml; charset=utf-8',
      },
    });
  } catch {
    return jsonError('CLOTHO could not build the outfit reference from the catalog.', 502);
  }
}

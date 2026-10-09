function parseDMS(str) {
  const re = /(\d+)[°]\s*(\d+)?['''′]?\s*(\d+\.?\d*)?["""″]?\s*/;
  const m = str.match(re);
  if (!m) return null;
  const deg = parseFloat(m[1]);
  const min = m[2] ? parseFloat(m[2]) : 0;
  const sec = m[3] ? parseFloat(m[3]) : 0;
  return deg + min / 60 + sec / 3600;
}

export function parseCoords(raw) {
  let s = raw.trim();
  if (!s) return null;

  // strip google maps @ prefix or "loc:" prefix
  s = s.replace(/^[@loc:]+/, '');

  // strip trailing zoom levels like ,15z or /data=...
  s = s.replace(/[,/]\s*\d+\.?\d*z.*$/i, '');
  s = s.replace(/\/data=.*$/, '');

  // try DMS format: 38°58'55.2"N 76°56'13.3"W
  const dmsRe = /(\d+[°][^NSEW]*[NSEW])\s*[,]?\s*(\d+[°][^NSEW]*[NSEW])/i;
  const dmsMatch = s.match(dmsRe);
  if (dmsMatch) {
    let latStr = dmsMatch[1], lonStr = dmsMatch[2];
    let lat = parseDMS(latStr), lon = parseDMS(lonStr);
    if (lat == null || lon == null) return null;
    if (/[Ss]/.test(latStr)) lat = -lat;
    if (/[Ww]/.test(lonStr)) lon = -lon;
    return { lat, lon };
  }

  // try decimal with cardinal directions: N38.9820 W76.9370 or 38.9820N 76.9370W
  const cardRe = /([NSEW])\s*(-?\d+\.?\d+)[°]?|(-?\d+\.?\d+)[°]?\s*([NSEW])/gi;
  const cardParts = [];
  let cm;
  while ((cm = cardRe.exec(s)) !== null) {
    const dir = (cm[1] || cm[4]).toUpperCase();
    const val = parseFloat(cm[2] || cm[3]);
    cardParts.push({ dir, val });
  }
  if (cardParts.length === 2) {
    let lat, lon;
    for (const p of cardParts) {
      if (p.dir === 'N') lat = p.val;
      else if (p.dir === 'S') lat = -p.val;
      else if (p.dir === 'E') lon = p.val;
      else if (p.dir === 'W') lon = -p.val;
    }
    if (lat != null && lon != null) return { lat, lon };
  }

  // try plain decimal: two numbers separated by comma, space, or both
  const decRe = /(-?\d+\.?\d*)\s*[,\s]\s*(-?\d+\.?\d*)/;
  const decMatch = s.match(decRe);
  if (decMatch) {
    const a = parseFloat(decMatch[1]);
    const b = parseFloat(decMatch[2]);
    if (Math.abs(a) <= 90 && Math.abs(b) <= 180) return { lat: a, lon: b };
    if (Math.abs(a) > 90 && Math.abs(b) <= 90) return { lat: b, lon: a };
    return { lat: a, lon: b };
  }

  return null;
}

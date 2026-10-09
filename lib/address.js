function addressPartsFrom(row) {
  if (!row) return null;
  return {
    unit: row.unit || null,
    housenumber: row.housenumber || null,
    street: row.street || null,
    city: row.addr_city || null,
    state: row.addr_state || null,
    postcode: row.addr_postcode || null,
  };
}

// A street without a house number is common in OSM and would read as just the
// road name, so it does not count as an address.
function hasStreetAddress(parts) {
  return Boolean(parts && parts.housenumber && parts.street);
}

function formatStreetLine(unit, housenumber, street) {
  if (!street) return null;
  const base = housenumber ? `${housenumber} ${street}` : street;
  return unit ? `${base} #${unit}` : base;
}

// OSM's own addr:city/state/postcode win; the boundary lookups fill the gaps,
// which is the common case in the US.
function composeAddress(parts, context) {
  if (!hasStreetAddress(parts)) return null;

  const streetLine = formatStreetLine(parts.unit, parts.housenumber, parts.street);
  const city = parts.city || (context.city && context.city !== 'unknown' ? context.city : null);
  const state = parts.state || context.state_code || null;
  const postcode = parts.postcode || context.postcode || null;

  // "City, ST 12345": no comma between state and postcode.
  const locality = [city, [state, postcode].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ');

  return locality ? `${streetLine}, ${locality}` : streetLine;
}

module.exports = { addressPartsFrom, hasStreetAddress, formatStreetLine, composeAddress };

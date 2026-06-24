// DHL Shipment Tracking - Unified API gegen eine echte Sendungsnummer testen.
//
// Nutzung:
//   node scripts/dhl-test.mjs <trackingNumber> [plz] [service]
//   z. B. node scripts/dhl-test.mjs 00340434161094012345 80331 parcel-de
//
// Voraussetzung: DHL_API_KEY in .env (Key von developer.dhl.com).

import { config } from '../src/config.js';
import { getCarrierDeliveryState } from '../src/carriers.js';

const [trackingNumber, zip, service] = process.argv.slice(2);
if (!trackingNumber) {
  console.error('Usage: node scripts/dhl-test.mjs <trackingNumber> [plz] [service]');
  process.exit(1);
}
if (!config.dhl.apiKey) {
  console.error('DHL_API_KEY fehlt in .env');
  process.exit(1);
}

// 1) Rohantwort der DHL-API zeigen
const url = new URL('https://api-eu.dhl.com/track/shipments');
url.searchParams.set('trackingNumber', trackingNumber);
url.searchParams.set('service', service || config.dhl.service);
if (zip) url.searchParams.set('recipientPostalCode', zip);
url.searchParams.set('requesterCountryCode', 'DE');
url.searchParams.set('language', 'de');

const res = await fetch(url, { headers: { 'DHL-API-Key': config.dhl.apiKey, Accept: 'application/json' } });
console.log('HTTP', res.status);
const json = await res.json().catch(() => null);
console.log('status-Objekt:', JSON.stringify(json?.shipments?.[0]?.status, null, 2));

// 2) Geparstes Ergebnis, wie es die App verwendet
const parsed = await getCarrierDeliveryState({ carrierCode: 'dhl', trackingNumber, zip });
console.log('\n-> App-Interpretation:', parsed);

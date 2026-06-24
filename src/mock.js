// Demo-Daten für USE_MOCK=true. Erlaubt es, die komplette UI ohne echte
// Xentral-Instanz und ohne Token zu zeigen (z. B. fürs Pitch / lokale Entwicklung).
// Lookup-Schlüssel: <nummer> + <plz>. Mehrere Nummern zeigen auf dieselbe Bestellung
// (Auftrags-, Bestell-, Internet-, Lieferscheinnummer).

const ORDERS = [
  {
    aliases: ['AU-20294', '20294', 'PO-7741', 'SHOP-100231', 'LS-19880'],
    zip: '80331',
    data: {
      orderNumber: 'AU-20294',
      stage: 2,
      stageLabel: 'Versendet',
      deliveryDate: '2026-06-25',
      packageCount: 2,
      shipments: [
        {
          carrier: 'DHL',
          trackingNumber: '00340434161094012345',
          trackingLink: 'https://www.dhl.de/de/privatkunden/pakete-empfangen/verfolgen.html?piececode=00340434161094012345',
          shippedAt: '2026-06-23',
        },
        {
          carrier: 'DHL',
          trackingNumber: '00340434161094067890',
          trackingLink: 'https://www.dhl.de/de/privatkunden/pakete-empfangen/verfolgen.html?piececode=00340434161094067890',
          shippedAt: '2026-06-23',
        },
      ],
    },
  },
  {
    aliases: ['AU-20310', '20310', 'LS-19905'],
    zip: '50667',
    data: {
      orderNumber: 'AU-20310',
      stage: 1,
      stageLabel: 'Wird kommissioniert',
      deliveryDate: '2026-06-27',
      packageCount: 0,
      shipments: [],
    },
  },
  {
    aliases: ['AU-20255', '20255'],
    zip: '20095',
    data: {
      orderNumber: 'AU-20255',
      stage: 3,
      stageLabel: 'Zugestellt',
      deliveryDate: '2026-06-20',
      packageCount: 1,
      shipments: [
        {
          carrier: 'DPD',
          trackingNumber: '01505012345678',
          trackingLink: 'https://tracking.dpd.de/status/de_DE/parcel/01505012345678',
          shippedAt: '2026-06-18',
        },
      ],
    },
  },
];

const norm = (v) => String(v ?? '').trim().toUpperCase().replace(/\s+/g, '');

export function mockLookup(query, zip) {
  const q = norm(query);
  const z = norm(zip);
  const hit = ORDERS.find((o) => norm(o.zip) === z && o.aliases.some((a) => norm(a) === q));
  return hit ? hit.data : null;
}

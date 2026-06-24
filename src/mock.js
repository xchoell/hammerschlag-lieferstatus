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
      recipientName: 'Wonne Sonne',
      deliveryAddress: { name: 'SunnyCompany', contactPerson: 'Wonne Sonne', street: 'Sonnenallee 1', zipCode: '80331', city: 'München', country: 'DE' },
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
      recipientName: 'Bernd Bau',
      deliveryAddress: { name: 'Bau & Co KG', contactPerson: 'Bernd Bau', street: 'Domkloster 4', zipCode: '50667', city: 'Köln', country: 'DE' },
      stage: 1,
      stageLabel: 'Auftrag wird gepackt',
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
      recipientName: 'Hanna Hammer',
      deliveryAddress: { name: 'Hammer Werkstatt', contactPerson: 'Hanna Hammer', street: 'Reeperbahn 1', zipCode: '20095', city: 'Hamburg', country: 'DE' },
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
  {
    aliases: ['AU-20333', '20333', 'LS-19950'],
    zip: '70173',
    data: {
      orderNumber: 'AU-20333',
      recipientName: 'Clara Klinke',
      deliveryAddress: { name: 'Klinke Sanitär', contactPerson: 'Clara Klinke', street: 'Königstraße 1', zipCode: '70173', city: 'Stuttgart', country: 'DE' },
      cancelled: true,
      stage: 0,
      stageLabel: 'Auftrag storniert',
      deliveryDate: null,
      packageCount: 0,
      shipments: [],
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

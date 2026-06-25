// Demo-Daten für USE_MOCK=true. Erlaubt es, die komplette UI ohne echte
// Xentral-Instanz und ohne Token zu zeigen (z. B. fürs Pitch / lokale Entwicklung).
// Lookup-Schlüssel: <nummer> + <plz>. Mehrere Nummern zeigen auf dieselbe Gruppe.
//
// Datenmodell pro Eintrag:
//   aliases : alle Nummern, über die die Gruppe gefunden wird
//   zip     : Liefer-PLZ (zweiter Faktor)
//   group   : { groupNumber, isSplit, recipientName, deliveryAddress, parts: [...] }
//   parts[] : je ein (Teil-)Auftrag mit eigenem Status UND eigener Lieferadresse

const ORDERS = [
  {
    aliases: ['AU-20294', '20294', 'PO-7741', 'SHOP-100231', 'LS-19880'],
    zip: '80331',
    group: {
      groupNumber: 'AU-20294',
      isSplit: false,
      recipientName: 'Wonne Sonne',
      deliveryAddress: { name: 'SunnyCompany', contactPerson: 'Wonne Sonne', street: 'Sonnenallee 1', zipCode: '80331', city: 'München', country: 'DE' },
      parts: [
        {
          orderNumber: 'AU-20294',
          stage: 2,
          stageLabel: 'Versendet',
          deliveryDate: '2026-06-25',
          deliveryDateKind: 'wish',
          packageCount: 2,
          deliveryAddress: { name: 'SunnyCompany', contactPerson: 'Wonne Sonne', street: 'Sonnenallee 1', zipCode: '80331', city: 'München', country: 'DE' },
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
      ],
    },
  },

  // ── Gesplitteter Auftrag: ein Ursprungsauftrag (200039) wurde in drei
  //    Teilaufträge aufgeteilt – mit teils ABWEICHENDEN Lieferadressen. ─────────
  {
    aliases: ['200039', '200039-1', '200039-2', 'AU-20500', 'PO-9001'],
    zip: '04109',
    group: {
      groupNumber: '200039',
      isSplit: true,
      recipientName: 'Theo Tischler',
      deliveryAddress: { name: 'Tischlerei Theo', contactPerson: 'Theo Tischler', street: 'Karl-Liebknecht-Straße 12', zipCode: '04109', city: 'Leipzig', country: 'DE' },
      parts: [
        {
          orderNumber: '200039',
          stage: 3,
          stageLabel: 'Zugestellt',
          deliveryDate: '2026-06-22',
          deliveryDateKind: 'delivered',
          packageCount: 1,
          deliveryAddress: { name: 'Tischlerei Theo', contactPerson: 'Theo Tischler', street: 'Karl-Liebknecht-Straße 12', zipCode: '04109', city: 'Leipzig', country: 'DE' },
          shipments: [
            {
              carrier: 'DHL',
              trackingNumber: '00340434161094200001',
              trackingLink: 'https://www.dhl.de/de/privatkunden/pakete-empfangen/verfolgen.html?piececode=00340434161094200001',
              shippedAt: '2026-06-20',
            },
          ],
        },
        {
          orderNumber: '200039-1',
          stage: 2,
          stageLabel: 'Versendet',
          deliveryDate: '2026-06-26',
          deliveryDateKind: 'wish',
          packageCount: 1,
          // Abweichende Lieferadresse (z. B. Baustelle).
          addressIsDeviating: true,
          deliveryAddress: { name: 'Baustelle Spinnerei', contactPerson: 'Theo Tischler', street: 'Spinnereistraße 7', zipCode: '04179', city: 'Leipzig', country: 'DE' },
          shipments: [
            {
              carrier: 'DPD',
              trackingNumber: '01505099887766',
              trackingLink: 'https://tracking.dpd.de/status/de_DE/parcel/01505099887766',
              shippedAt: '2026-06-24',
            },
          ],
        },
        {
          orderNumber: '200039-2',
          stage: 1,
          stageLabel: 'Auftrag wird gepackt',
          deliveryDate: '2026-06-30',
          deliveryDateKind: 'estimated',
          packageCount: 0,
          // Lieferung ans Lager des Kunden.
          addressIsDeviating: true,
          deliveryAddress: { name: 'Tischlerei Theo – Lager', contactPerson: 'Theo Tischler', street: 'Industriering 4', zipCode: '04451', city: 'Borsdorf', country: 'DE' },
          shipments: [],
        },
      ],
    },
  },

  {
    aliases: ['AU-20310', '20310', 'LS-19905'],
    zip: '50667',
    group: {
      groupNumber: 'AU-20310',
      isSplit: false,
      recipientName: 'Bernd Bau',
      deliveryAddress: { name: 'Bau & Co KG', contactPerson: 'Bernd Bau', street: 'Domkloster 4', zipCode: '50667', city: 'Köln', country: 'DE' },
      parts: [
        {
          orderNumber: 'AU-20310',
          stage: 1,
          stageLabel: 'Auftrag wird gepackt',
          deliveryDate: '2026-06-18',
          deliveryDateKind: 'estimated',
          overdue: true,
          packageCount: 0,
          deliveryAddress: { name: 'Bau & Co KG', contactPerson: 'Bernd Bau', street: 'Domkloster 4', zipCode: '50667', city: 'Köln', country: 'DE' },
          shipments: [],
        },
      ],
    },
  },

  {
    aliases: ['AU-20255', '20255'],
    zip: '20095',
    group: {
      groupNumber: 'AU-20255',
      isSplit: false,
      recipientName: 'Hanna Hammer',
      deliveryAddress: { name: 'Hammer Werkstatt', contactPerson: 'Hanna Hammer', street: 'Reeperbahn 1', zipCode: '20095', city: 'Hamburg', country: 'DE' },
      parts: [
        {
          orderNumber: 'AU-20255',
          stage: 3,
          stageLabel: 'Zugestellt',
          deliveryDate: '2026-06-20',
          deliveryDateKind: 'delivered',
          packageCount: 1,
          deliveryAddress: { name: 'Hammer Werkstatt', contactPerson: 'Hanna Hammer', street: 'Reeperbahn 1', zipCode: '20095', city: 'Hamburg', country: 'DE' },
          shipments: [
            {
              carrier: 'DPD',
              trackingNumber: '01505012345678',
              trackingLink: 'https://tracking.dpd.de/status/de_DE/parcel/01505012345678',
              shippedAt: '2026-06-18',
            },
          ],
        },
      ],
    },
  },

  {
    aliases: ['AU-20333', '20333', 'LS-19950'],
    zip: '70173',
    group: {
      groupNumber: 'AU-20333',
      isSplit: false,
      recipientName: 'Clara Klinke',
      deliveryAddress: { name: 'Klinke Sanitär', contactPerson: 'Clara Klinke', street: 'Königstraße 1', zipCode: '70173', city: 'Stuttgart', country: 'DE' },
      parts: [
        {
          orderNumber: 'AU-20333',
          cancelled: true,
          stage: 0,
          stageLabel: 'Auftrag storniert',
          deliveryDate: null,
          packageCount: 0,
          deliveryAddress: { name: 'Klinke Sanitär', contactPerson: 'Clara Klinke', street: 'Königstraße 1', zipCode: '70173', city: 'Stuttgart', country: 'DE' },
          shipments: [],
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
  return hit ? hit.group : null;
}

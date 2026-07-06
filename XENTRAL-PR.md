# PR-Entwurf: ReturnsPortalSetting Business Entity (Xentral-Core)

> Branch `retourenportal-settings` im Worktree `~/work/repos/retourenportal-settings-xentral`
> (Basis main 6feaa400856, 4 Commits). **Noch NICHT gepusht — Push/PR erst nach GO.**
> Stand: 2026-07-03, alle Checks grün.

---

## Titel

**PADS-0: ReturnsPortalSetting — returns portal settings as a business entity (per project)**

## Beschreibung (für den PR)

### What

Adds a new business entity `ReturnsPortalSetting` (one row per project) plus a
native settings page under **Settings → Warehouse & Fulfillment → Returns
portal**. It stores the configuration of the (new, external) returns portal —
shipping method, deadlines, gates, branding — inside Xentral instead of a
second config store inside the portal app.

The external portal reads the settings at runtime via the Business-Framework
entity API (`GET /api/entity/returnsPortalSetting`, PAT-authenticated,
scope `entity:returnsPortalSetting:read`). No new HTTP endpoint is introduced.

### Why

The existing external returns portal keeps its whole configuration (shipping
methods list, deadlines, conditions, branding) in the external service — the
source of the well-known settings-loss bugs (RETURN-251/249/237/215/78) and of
the shipping-method double maintenance. Moving the settings into Xentral as a
business entity makes them project-scoped, auditable, permission-guarded and
editable in the native UI. Context/parity research: PLAN.md in the portal repo.

### How

- Migration `returns_portal_settings` (unique project, FK project +
  shipping method, sensible defaults; up+down tested)
- `app/Domains/Configuration/ReturnsPortalSetting/` — Node, Schema, Mutation,
  Validator (one setting per project; `unique` rule does not work on reference
  properties → EntityQueryFactory validator, same pattern as BomDisplayRule),
  enums `ReturnDeadlineBasis` (order|shipping|delivery) and
  `ReturnsPortalLoginVariant` (zip|email)
- Factory + i18n de/en/nl (incl. tooltips), frontend types regenerated
- Settings UI via the settings-entities generator:
  `mirai/libs/x21-erp/features/settings/inventory-and-fulfillment-entities/…/returns-portal-setting/`
  (EntityBase autopilot, curated default columns), settings item in
  `SettingItemQuery`
- Feature flags: settings item is gated behind
  `PADS_FRONTEND_CONFIGENTITIES && RETURNS_PORTAL_SETTINGS`
  (new SOP flag `returns-portal-settings`); the entity API itself sits behind
  the existing `business-framework-api` middleware gate

### Tests & Checks (alle grün, 2026-07-03)

- `tests/Integration/Domains/Configuration/ReturnsPortalSetting/` — 23 Tests /
  106 Assertions (Create/Update/Delete/List/View/Metadata/TypeCast, inkl.
  Partial-Update-Preservation und Referenz-Persistenz)
- `tests/Unit/Modules/Setting/…/SettingItemQueryTest` + SuperSearch-Livesource — grün
- PHPStan (geänderte Dateien): 0 Fehler · mago format: clean
- nx `lint,test` für `x21-erp-features-settings-inventory-and-fulfillment-entities` — grün
- Live-Smoke auf Worktree-Instanz: Settings-Seite erreichbar, Entity-API mit
  PAT verifiziert (Auth-Matrix in RETOURE.md des Portal-Repos)

### Rollout-Hinweise

1. **LaunchDarkly**: Flag `returns-portal-settings` anlegen (kill-switch für
   das Settings-Item; die PHP-Const `RETURNS_PORTAL_SETTINGS` existiert).
2. `php artisan scopes:sync` registriert die Entity-Scopes
   (`entity:returnsPortalSetting:read|mutate|delete`, Gruppe Configuration) —
   läuft nach Deploy wie für alle BF-Entities.
3. Portal-PAT pro Kundeninstanz: Nicht-Admin-Service-User + User-Scope +
   Token-Scope `entity:returnsPortalSetting:read` (Details/Verifikation:
   RETOURE.md „Settings aus Xentral").
4. Enum-/Review-CSVs liegen unter `schemas/legacy-mappings/**/pending/` —
   Freigabe durch Owning-Team wie üblich.

### Reviewer / Owning Teams (aus CODEOWNERS)

| Pfad | Team |
|---|---|
| `app/Domains/Configuration/ReturnsPortalSetting/` | **@xentral/product-adoption** (Haupt-Owner, owns /app/Domains) |
| `app/Modules/Setting/` (SettingItemQuery) | @xentral/application-framework |
| `app/Shared/Core/FeatureFlag/` | @xentral/application-framework |
| `mirai/**` (Settings-Lib, types, menu-items) | @xentral/frontend (catch-all `mirai/`) |

### Commits auf dem Branch

1. `7e98c70a77b` — Entity (Migration, Domain-Klassen, Tests, i18n, Types)
2. `181a391a12a` — Settings-UI (Frontend-Lib, SettingItemQuery, i18n)
3. `611a6b5de21` — Cleanup: versehentlich committete mPDF-Font-Caches entfernt
   (kumulativer PR-Diff für `userdata/` ist leer)
4. `26f63257dd9` — PR-Politur: mago format, PHPStan-Fix (Validator-Annotation),
   SOP-Feature-Flag `returns-portal-settings`, `renderProperty: 'name'` für die
   Referenzen project + shippingMethod (Liste zeigt Namen statt IDs; im Browser
   verifiziert: „Standard" / „DHL Retoure")
5. `2413a7f58f8` — Produktentscheide 2026-07-03: Fristbasis nur noch
   „Versanddatum" (Enum auf `shipping` reduziert, Ablehnung der alten Werte
   getestet), „Nur zugestellte Bestellungen" im Formular ausgeblendet (Feld
   bleibt in der API), Login-Variante „Nummer + Kundennummer"
   (`customerNumber`) ergänzt — alles im Browser verifiziert; 24/24 Tests
7. `5a98232d7a7` — Retourenbedingungen (RETURN-212) als Kind-Collection
   `lineItems` der Settings-Entity: Tabelle `returns_portal_conditions`
   (FK cascade), Child-Node `ReturnsPortalCondition` (Kriterien Gewicht
   min/max als BigDecimal, Artikelnummer, Hersteller, Land ISO2,
   B2B-Filter-Enum any|b2b|b2c; Effekt-Enum excludeProduct|blockReturn|
   useShippingMethod; Kundenhinweis), hasMany eager → Regeln kommen im
   Settings-GET mit; Property heißt `lineItems`, damit die Framework-
   Line-Items-Sektion die Tabelle rendert (Container mit Details-Render-Prop
   + kuratierten Spalten); i18n de/en/nl, 2 Enum-CSVs + Review-CSV,
   4 neue Integrationstests (Create/Embed/Invalid/Delete via actionIndicator);
   32/32 gesamt
6. `08d9c9847a7` — `urlSlug`-Feld fürs Pro-Projekt-Frontend: Spalte `url_slug`
   (Index, KEIN DB-Unique — nullable Strings persistiert das Framework als
   `''`; Eindeutigkeit erzwingt der Validator), Auto-Vorbelegung aus dem
   Projektnamen via `DeriveProjectCalculator` (Kollision → `-<projektId>`),
   Format-Regex + Uniqueness-Validator, i18n de/en/nl, Review-CSV,
   Default-Spalte in der Liste; 28/28 Tests

> Optional vor dem Push: Commits 3+4 in 1+2 squashen (History-Kosmetik);
> der Diff ist identisch.

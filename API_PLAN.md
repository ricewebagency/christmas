# API_PLAN — Magical Winter Banquet API (Azure Function App)

Backend voor de frontend in `MagicalWinterBanquet.Web`. De frontend is statisch, dus alle state staat in deze API.

## Aannames (aanpassen indien nodig)
- **Runtime:** C# / .NET (huidige LTS), Azure Functions **isolated worker**, HTTP triggers.
- **Opslag:** Azure Table Storage (goedkoop en simpel; atomische claims via unieke RowKey).
- **Auth gasten:** een gastcode in de route. Geen login met e-mail of wachtwoord. De gast krijgt de code via een link (`?code=`) of voert hem handmatig in op de hoofdpagina.
- **Gastcode-formaat:** een **pincode van 4 cijfers** (`0000`–`9999`), uniek per gast, random gegenereerd.
  - Voorspelbare pincodes worden overgeslagen: alle vier dezelfde (`1111`), oplopend of aflopend (`1234`, `4321`) en jaartallen `1900`–`2099`.
- **Normalisatie:** spaties uit elke inkomende `{code}` halen, vóór validatie en lookup. Een ongeldig formaat (niet exact 4 cijfers) geeft direct 404 `guest_not_found` en telt mee als mislukte poging.
- **Risico (geaccepteerd):** 10.000 combinaties zijn te raden. Bij ~40 gasten is grofweg 1 op de 250 pogingen raak. De strenge rate limit (zie hieronder) maakt dat traag, maar een vastberaden persoon met meerdere IP's komt er uiteindelijk doorheen. Acceptabel voor een kerstdiner. Er zijn geen gevoelige gegevens; het ergste geval is een gewijzigde RSVP of gerechtkeuze.
- **Auth admin:** `AuthorizationLevel.Function` (function key); alleen voor de organisator.
- **CORS:** `https://riceweb.nl` (een origin bevat geen pad) + lokale dev-origin(s).
- **Frontend:** `https://riceweb.nl/magical-winter-banquet/`. Uitnodigingslink: `https://riceweb.nl/magical-winter-banquet/?code=1234`.
- **Tijdzone:** alle datums met offset (Europe/Amsterdam, `+01:00` in december).

## Domeinmodel

### Guest
| Veld | Type | Opmerking |
|---|---|---|
| `code` | string | PK, 4 cijfers (`^[0-9]{4}$`), als string (voorloopnullen behouden) |
| `guestName` | string | |
| `rsvpStatus` | enum | `pending` \| `accepted` \| `declined` |
| `house` | enum? | `gryffindor` \| `hufflepuff` \| `ravenclaw` \| `slytherin`, null tot gesorteerd; **onveranderlijk** |
| `sortingScores` | object? | `{ gryffindor: n, ... }` |
| `sortedAt` | datetime? | |
| `dishIds` | string[] | max 4, uniek |
| `rsvpUpdatedAt` / `dishesUpdatedAt` | datetime? | |
| `createdAt` | datetime | |

### DishClaim (exclusiviteit)
Eén rij per geclaimd gerecht. `PartitionKey = "dish"`, `RowKey = dishId`, `guestCode`.
Claimen = `AddEntity` → faalt met 409 als een ander het al heeft. Dat is atomair zonder locks.

### Event settings (app settings)
- `Event__Date` (ISO, bv. `2026-12-24T18:00:00+01:00`)
- `Event__Location` (`Assendelft`)
- `Event__ChangeDeadline` = `2026-12-17T23:59:59+01:00`
- `Frontend__BaseUrl` = `https://riceweb.nl/magical-winter-banquet` (zonder trailing slash; gebruikt voor uitnodigingslinks)
- CORS (platform-instelling van de Function App): `https://riceweb.nl`

### Dish catalog
`dishes.json` als embedded resource (kopie van `MagicalWinterBanquet.Web/src/assets/files/dishes.json`). Structuur: lijst van courses `{ course, course_nl, dishes: [{ id, name, name_nl, description }] }`. Ids zijn numeriek in JSON; de API behandelt ze als **string**.

## Tabellen
- `Guests` — `PartitionKey = "guest"`, `RowKey = code`. Arrays/objecten als JSON-string kolom.
- `DishClaims` — zie boven.
- `AccessAttempts` — rate limiting. `PartitionKey = "ip"`, `RowKey = <gehashte client-IP>`, `failedCount`, `windowStartedAt`, `blockedUntil`.

## Rate limiting (bescherming tegen raden)
- Geldt voor alle `/api/guests/{code}`-endpoints.
- **Client-IP:** het eerste adres uit `X-Forwarded-For`, met als fallback het remote-adres. Opslaan als SHA-256-hash (geen ruwe IP's).
- **Regel:** maximaal **5 mislukte pogingen** (404 `guest_not_found`) per IP binnen **60 minuten**. Daarna een blokkade van **60 minuten**. Streng, omdat een pincode van 4 cijfers weinig combinaties heeft.
- **Globale noodrem:** meer dan **100 mislukte pogingen totaal** (alle IP's) binnen 60 minuten → alle guest-endpoints geven 60 minuten lang 429 voor **onbekende** codes. Een geldige code blijft werken, zodat echte gasten er geen last van hebben. Dit wordt gelogd als warning.
- **Geblokkeerd:** elk verzoek van dat IP geeft 429 `too_many_attempts` met header `Retry-After: <seconden>` en body `{ "error": "too_many_attempts", "message": "...", "retryAfterSeconds": n }`. Dit wordt gecontroleerd vóór de lookup.
- Een succesvolle lookup reset de teller niet. Zo kan een geldige code niet gebruikt worden om de blokkade te omzeilen.
- **Configureerbaar:** `RateLimit__MaxFailedAttempts` (5), `RateLimit__WindowMinutes` (60), `RateLimit__BlockMinutes` (60) en `RateLimit__GlobalMaxFailedAttempts` (100).
- De globale teller is een extra rij in `AccessAttempts`: `RowKey = "global"`.
- Optimistische concurrency (ETag) bij het ophogen van de teller. Bij een conflict één keer opnieuw proberen. Een verloren telling is acceptabel.
- Admin-endpoints vallen hier buiten.

## Endpoints

Alle responses JSON. Fouten altijd: `{ "error": "<code>", "message": "<tekst>" }`.

Gemeenschappelijke foutcodes:
| HTTP | error | Wanneer |
|---|---|---|
| 400 | `invalid_request` | Body ontbreekt/ongeldig |
| 404 | `guest_not_found` | Onbekende code of ongeldig formaat |
| 429 | `too_many_attempts` | Te veel mislukte pogingen vanaf dit IP (`Retry-After`-header + `retryAfterSeconds`) |
| 403 | `changes_locked` | Na `changeDeadline` en het gaat om een wijziging |
| 409 | zie per endpoint | Conflict |

### GuestState (response-object van alle guest-endpoints)
```json
{
  "code": "4827",
  "guestName": "Maurice van Dorst",
  "eventDate": "2026-12-24T18:00:00+01:00",
  "location": "Assendelft",
  "rsvpStatus": "accepted",
  "house": "ravenclaw",
  "dishIds": ["3", "7"],
  "changeDeadline": "2026-12-17T23:59:59+01:00",
  "canChange": true
}
```
`canChange = now < changeDeadline`.

### `GET /api/guests/{code}`
→ 200 `GuestState`. Dit is ook het "inlog"-endpoint: de frontend gebruikt het om een ingevoerde code te controleren.
### `PUT /api/guests/{code}/rsvp`
Body: `{ "rsvpStatus": "accepted" | "declined" }`
- Ook de eerste keer (`pending`) alleen vóór de deadline; daarna → 403 (organisator regelt het handmatig).
- Wijziging (`accepted` ↔ `declined`) alleen als `canChange`, anders 403.
- `→ declined`: alle `DishClaims` van deze gast verwijderen, `dishIds = []`. House blijft.
- Een eerste RSVP mag direct `declined` zijn (zonder sorting). De frontend toont dan een afgemeld-variant van de map.
- `declined → accepted`: house blijft, gerechten zijn leeg. De gast kiest opnieuw.
- → 200 `GuestState`.

### `PUT /api/guests/{code}/sorting`
Body: `{ "house": "ravenclaw", "scores": { ... }, "questionsAnswered": 12 }`
- Vereist `rsvpStatus = accepted`, anders 409 `rsvp_not_accepted`.
- House al gezet → 409 `house_already_set` (idempotent: als dezelfde house wordt gestuurd → 200).
- → 200 `GuestState`.

### `PUT /api/guests/{code}/dishes`
Body: `{ "dishIds": ["3", "7"] }`
Validatie:
- `rsvpStatus = accepted` → anders 409 `rsvp_not_accepted`.
- `house` gezet → anders 409 `not_sorted`.
- 1–4 unieke ids, allemaal in catalogus → anders 400 `invalid_dishes`.
- Als gast al gerechten heeft: `canChange` vereist → anders 403.
Verwerking (diff):
1. `toClaim = new − current`, `toRelease = current − new`.
2. Claim elk `toClaim` (AddEntity). Bij conflict: rollback van de in deze request geclaimde rijen → 409 `dishes_taken` met `{ "takenDishIds": [...] }`.
3. Release `toRelease` (alleen rijen met eigen `guestCode`).
4. Update guest `dishIds`, `dishesUpdatedAt`.
→ 200 `GuestState`.

### `GET /api/guests/{code}/dishes/taken`
→ 200 `{ "dishIds": ["1", "9"] }`. Alle claims **behalve** die van deze gast.

### `GET /api/dishes`
→ 200 catalogus (zelfde structuur als `dishes.json`). Cache-header `max-age=300`.

### Admin (function key)
- `POST /api/admin/guests` — body `{ "guestName": "..." }` of een array → maakt gast(en) met een unieke code aan. De response bevat `code` (4 cijfers) en `inviteUrl` (`{Frontend__BaseUrl}/?code=1234`). Optioneel kan een `code` in de body worden meegegeven (gevalideerd en uniek), anders wordt er een gegenereerd.
- `DELETE /api/admin/access-attempts` — wist alle rate-limit-blokkades (voor noodgevallen).
- `GET /api/admin/guests` — overzicht: naam, code, rsvp, house, gerechten (voor de organisator).
- `DELETE /api/admin/guests/{code}` — verwijdert gast + claims.
- `POST /api/admin/guests/{code}/reset` — zet terug naar `pending`, house null, gerechten vrij (testen).

## Projectstructuur (voorstel)
```
MagicalWinterBanquet.Api/
  Program.cs                      // DI, TableServiceClient, options, CORS-config
  Options/EventOptions.cs
  Models/Guest.cs, GuestState.cs, RsvpStatus.cs, House.cs, Requests/*.cs, ApiError.cs
  Storage/GuestEntity.cs, DishClaimEntity.cs
  Storage/IGuestRepository.cs, TableGuestRepository.cs
  Storage/IDishClaimRepository.cs, TableDishClaimRepository.cs
  Services/IDishCatalog.cs, EmbeddedDishCatalog.cs
  Services/GuestService.cs        // alle regels: deadline, transitions, diff/claims
  Services/GuestCodeGenerator.cs  // genereren + GuestCode.Normalize/Format/IsValid
  Services/AccessRateLimiter.cs   // IP-hash, tellen, blokkeren (AccessAttempts-tabel)
  Storage/AccessAttemptEntity.cs
  Functions/GuestFunctions.cs     // GET guest, PUT rsvp/sorting/dishes, GET taken
  Functions/DishFunctions.cs      // GET dishes
  Functions/AdminFunctions.cs
  Http/HttpResults.cs             // JSON helpers + foutformaat
  Resources/dishes.json           // embedded
MagicalWinterBanquet.Api.Tests/   // xUnit, GuestService met in-memory repos
```
Regels horen in `GuestService`, niet in de functions. `TimeProvider` injecteren zodat de deadline testbaar is.

## Infra / config
- Function App (Consumption of Flex Consumption), Storage Account (Tables in dezelfde account mag).
- App settings: `Event__Date` (`2026-12-24T18:00:00+01:00`), `Event__Location` (`Assendelft`), `Event__ChangeDeadline` (`2026-12-17T23:59:59+01:00`), `Frontend__BaseUrl` (`https://riceweb.nl/magical-winter-banquet`), `RateLimit__MaxFailedAttempts` (5), `RateLimit__WindowMinutes` (60), `RateLimit__BlockMinutes` (60), `RateLimit__GlobalMaxFailedAttempts` (100), `TableStorage__ConnectionString` (of managed identity + `TableStorage__ServiceUri`).
- CORS in de Function App instellen op `https://riceweb.nl` (plus lokale dev-origin); geen `*`.
- Lokaal: Azurite + `local.settings.json` (niet committen).

## Prompts

Gebruik deze prompts op volgorde in het API-project (met dit bestand in de repo).

**1 — Scaffold**
> Lees `API_PLAN.md`. Maak een Azure Functions-project (.NET LTS, isolated worker) `MagicalWinterBanquet.Api` plus testproject `MagicalWinterBanquet.Api.Tests` (xUnit) volgens de projectstructuur. Zet `Program.cs` op met DI, `EventOptions` (gebonden aan `Event`-sectie), `TableServiceClient`, `TimeProvider.System`. Voeg `local.settings.json.example` toe met alle settings en Azurite. Nog geen endpoints.

**2 — Domein & opslag**
> Implementeer volgens `API_PLAN.md` de modellen (`Guest`, `GuestState`, enums met lowercase JSON-serialisatie), `GuestEntity`/`DishClaimEntity`, en de Table Storage-repositories. `DishClaimRepository.TryClaimAsync` gebruikt `AddEntity` en geeft `false` bij 409. Voeg `EmbeddedDishCatalog` toe (embedded `Resources/dishes.json`, ids als string). Voeg `GuestCodeGenerator` toe (een pincode van 4 cijfers via `RandomNumberGenerator`, botsingscheck, voorspelbare pincodes overslaan volgens het plan) plus een statische `GuestCode`-helper: `Normalize` (spaties eruit) en `IsValid` (`^[0-9]{4}$`, als string). Voeg `AccessAttemptEntity` toe.

**3 — Businessregels**
> Implementeer `GuestService` met alle regels uit `API_PLAN.md`: `canChange` via `TimeProvider`, RSVP-transities (declined geeft gerechten vrij), sorting (house onveranderlijk, idempotent), dishes (validatie, diff, claim met rollback bij conflict, release). Gooi getypeerde exceptions/resultaten die naar de foutcodes in het plan mappen. Schrijf xUnit-tests met in-memory repos en `FakeTimeProvider` voor elke regel en elk foutpad, inclusief gelijktijdige claim op hetzelfde gerecht. Implementeer ook `AccessRateLimiter` volgens de sectie "Rate limiting" (gehashte IP, venster, blokkade, globale noodrem, `Retry-After`) met tests via `FakeTimeProvider`. Test daarnaast `GuestCode.Normalize`/`IsValid` (voorloopnullen, spaties, letters, 3 en 5 cijfers) en of de generator geen voorspelbare pincodes oplevert.

**4 — HTTP-functions**
> Implementeer `GuestFunctions`, `DishFunctions` en `AdminFunctions` exact volgens de endpoints in `API_PLAN.md` (routes, bodies, statuscodes, foutformaat `{ error, message }`). Guest-endpoints `AuthorizationLevel.Anonymous`, admin `AuthorizationLevel.Function`. Gebruik `HttpResults`-helpers voor JSON (camelCase). Valideer input strikt en lekt nooit stacktraces. Elke guest-function: eerst de rate-limitcheck (429 + `Retry-After`), dan `GuestCode.Normalize`, dan de lookup. Een 404 registreert een mislukte poging. Zet `Retry-After` in `Access-Control-Expose-Headers`, zodat de frontend de header kan lezen.

**5 — Infra & docs**
> Voeg een `README.md` toe met: lokaal draaien (Azurite), app settings, deploy naar Azure (az CLI of Bicep), CORS-instelling, en voorbeeld-`curl`s voor elk endpoint inclusief admin met function key. Optioneel: `infra/main.bicep` voor Function App + Storage Account + app settings.

## Afstemming met de frontend
- De frontend gebruikt `API_BASE_URL` + deze routes; houd het contract stabiel.
- Wijzigt het contract → ook `PLAN.md` (frontend) bijwerken.
- `dishes.json` op twee plekken: bij wijziging beide bijwerken (of frontend laat de statische fallback los zodra `GET /api/dishes` live is).

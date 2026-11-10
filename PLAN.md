# PLAN — Terugkerende gasten & wijzigen van keuzes

## Doel
Een gast die de site opnieuw opent, komt op de juiste plek uit en verliest geen voortgang. Tot een deadline mag een gast de RSVP en de gerechten wijzigen en opnieuw gesorteerd worden.

## Huidige situatie (probleem)
- `src/index.html` stuurt iedereen naar `/invite/` zonder naar voortgang te kijken.
- `invite.js` → `resetStorageOnInviteOpen()` wist sorteeruitslag, cabin-data, gerechtkeuze en cookie.
- `cabin.js` → `resetDishSelectionOnCabinOpen()` wist de gerechtkeuze bij elk bezoek.
- Alle data is mock (`api-client.js`). `rsvpStatus` leeft alleen in het geheugen en is na een reload weg.
- Er is geen gast-identificatie: iedereen is de mock-gast.
- Mismatch: het RSVP-formulier stuurt `yes`/`no`, `invite.js` verwacht `accepted`/`declined`.
- Pagina's zijn direct te openen zonder dat de vorige stap gedaan is.

## Uitgangspunten
1. **De server is de bron van waarheid.** localStorage is alleen een cache, zodat gasten ook op een ander apparaat herkend worden.
2. **Toegang via een gastcode.** Er is geen login met e-mail of wachtwoord.
   - **Formaat:** een pincode van 4 cijfers (`0000`–`9999`), altijd als string, zodat voorloopnullen behouden blijven. Spaties worden genegeerd.
   - **Via de link:** `https://riceweb.nl/christmas/?code=4827` slaat het invoerscherm over.
   - **Handmatig:** zonder code, of met een ongeldige code, toont de hoofdpagina een invoerscherm ("Speak the password to enter the Great Hall").
   - **Onthouden:** een geldige code wordt bewaard in localStorage (`christmas-at-the-great-hall.guest-code`). Een volgend bezoek werkt dan zonder code.
   - **Directe links naar pagina's:** elke pagina zonder geldige bewaarde code stuurt door naar de hoofdpagina (het invoerscherm).
   - **Ongeldige bewaarde code** (API geeft 404): de code wordt gewist en de gast gaat naar het invoerscherm.
   - **"Not you?"** op `/map/` wist de code en gaat naar het invoerscherm.
   - **Te veel mislukte pogingen** (API geeft 429): de melding "The castle doors are sealed for a moment, try again in X minutes" op basis van `Retry-After`.
3. **RSVP-statussen:** `pending` | `accepted` | `declined` (overal hetzelfde, ook in de API).
4. **Opnieuw sorteren** kan onbeperkt zolang `canChange` ("Make changes" → "Your house" op `/map/`). De gerechten blijven staan; na de uitslag gaat de gast terug naar `/map/`.
5. **Wijzigdeadline** (`changeDeadline`) komt uit de API: **17 december 2026, 23:59 (Europe/Amsterdam)**. Daarna staat alles vast (`canChange: false`).
6. **Productie-URL:** `https://riceweb.nl/christmas/`. De site draait in een subpad, dus alle redirects en links blijven relatief (`./map/`, `../cabin/`) of worden opgebouwd vanaf een basispad. Gebruik nooit absolute paden zoals `/map/`.
7. **Afgemelde gasten** krijgen op `/map/` een eigen variant: een bedankje voor de RSVP, "jammer dat je er niet bij kunt zijn" en (als `canChange`) een knop "Change your response". Geen gerechten, geen house-details en geen kaart.
8. **Mock-modus blijft bestaan.** Als `API_BASE_URL` leeg is, gebruikt `api-client.js` een mock die zijn state in localStorage bewaart. Zo kan de frontend gebouwd en getest worden voordat de API klaar is.

## Stappen en routering
Volgorde in de flow: `invite → rsvp → sorting → cabin → chamber → map`

`getNextStep(guest)` (nieuw, `src/js/guest-flow.js`):

| Situatie | Bestemming |
|---|---|
| Geen of ongeldige code | hoofdpagina (invoerscherm) |
| `rsvpStatus = pending` | `/invite/` |
| `rsvpStatus = declined` | `/map/` (afgemeld-variant) |
| `accepted`, nog geen house | `/sorting/` |
| `accepted` + house, nog geen gerechten | `/cabin/` |
| `accepted` + house + gerechten | `/map/` |

De chamber hoort alleen bij de eerste doorloop (cabin → chamber → map) en wordt niet als bestemming gebruikt.

### Page guards
Elke pagina roept bij het laden `guardPage('<pagina>')` aan. Als de gast op een pagina zit die (nog) niet mag, volgt een redirect via `getNextStep`.

| Pagina | Toegestaan als |
|---|---|
| invite | altijd |
| rsvp | `pending`, of `canChange` (wijzigen) |
| sorting | `accepted`, en (nog geen house óf `canChange`) |
| cabin | `accepted` + house, en (geen gerechten óf `canChange`) |
| chamber | `accepted` + house + gerechten |
| map | (`accepted` + house + gerechten) óf `declined` |

## Wijzigen
- **Wijzigen:** `/map/` → knop "Make changes" opent een venster met drie keuzes en de deadline:
  - "Your dishes" → `/cabin/?edit=1`
  - "Your house" → `/sorting/?edit=1` → terug naar `/map/`
  - "Your RSVP" → `/rsvp/?edit=1`
  - De huidige keuze wordt voorgeselecteerd en eigen gerechten tellen niet als "taken".
  - Opslaan → terug naar `/map/` zonder chamber en zonder treinintro (of een verkorte versie).
- **Aanwezigheid wijzigen:** `/map/` (beide varianten) → "Change your response" → `/rsvp/?edit=1`.
  - `accepted → declined`: de API geeft de gerechten vrij → `/map/` in de afgemeld-variant.
  - `declined → accepted`: de house blijft → `getNextStep` (meestal `/cabin/`, omdat de gerechten zijn vrijgegeven).
- Als `canChange = false`, zijn de wijzigknoppen verborgen en toont `/map/` "Your choices are sealed".
- Bij een conflict (409, gerecht intussen door iemand anders gekozen) toont de cabin-pagina een melding en worden de "taken"-dishes ververst.

## Bouwstappen frontend

### 1. API-client (`src/js/api-client.js`)
- [x] Config: `API_BASE_URL` (leeg = mock).
- [x] Gastcode: `normalizeGuestCode()`, `getStoredGuestCode()`, `setGuestCode()` en `clearGuestCode()`. Lezen uit `?code`, pas opslaan na een geldige `GET`, en uit de URL halen met `history.replaceState`.
- [x] `verifyGuestCode(code)` → `GET /api/guests/{code}`. Geeft de guest terug, of een `ApiError` (404 = ongeldig, 429 = te veel pogingen + `retryAfterSeconds`).
- [x] `getGuest()` → `GET /api/guests/{code}`. Resultaat cachen per pageload.
- [x] `sendAttendanceResponse(status)` → `PUT /api/guests/{code}/rsvp`.
- [x] `sendSortingHouseResult(result)` → `PUT /api/guests/{code}/sorting`.
- [x] `sendCabinDishSelection(ids)` → `PUT /api/guests/{code}/dishes`.
- [x] `fetchTakenCabinDishIds()` → `GET /api/guests/{code}/dishes/taken` (exclusief eigen gerechten).
- [x] `fetchDishCatalog()` → `GET /api/dishes`, met fallback op `assets/files/dishes.json`.
- [x] Bestaande functies (`getInvitationData`, `getCabinData`, `fetchCabinDishSelection`) worden wrappers rond `getGuest()`, zodat de pagina's weinig hoeven te veranderen.
- [x] Mock die state bewaart in localStorage (`christmas-at-the-great-hall.mock-guest`).
- [x] Uniforme foutafhandeling: `ApiError { status, code, message }`.

### 2. Flow-module (`src/js/guest-flow.js`, nieuw)
- [x] `getNextStep(guest)`, `isPageAllowed(page, guest)` en `guardPage(page)`.
- [x] `guardPage` zonder code of met een ongeldige code → naar de hoofdpagina (relatief pad).
- [x] `isEditMode()` leest `?edit=1`.

### 3. Hoofdpagina (`src/index.html`)
- [x] Inline script vervangen door `src/js/home.js`, volgens projectregel: JS in aparte bestanden.
- [x] Code uit `?code` of uit localStorage → `verifyGuestCode()` → geldig: redirect naar `getNextStep()`.
- [x] Geen code of een ongeldige code → **invoerscherm** tonen (Tailwind, in de stijl van de site):
  - titel "Speak the password to enter the Great Hall";
  - één invoerveld voor de pincode: `inputmode="numeric"`, `pattern="[0-9]*"`, `maxlength="4"`, `autocomplete="off"`. Visueel als vier vakjes, technisch één input voor eenvoud en goede werking van plakken. *Uitgevoerd als onzichtbare input over vier vakjes die de waarde spiegelen (i.p.v. letter-spacing), zodat het Inkpot-font bruikbaar blijft;*
  - alleen cijfers toestaan; bij het 4e cijfer automatisch versturen (de knop "Enter" blijft als fallback);
  - bij een fout het veld leegmaken en de focus terugzetten;
  - foutmeldingen: ongeldige code ("That password is not invited to Christmas at the Great Hall"), 429 (met wachttijd) en een netwerkfout ("The owls could not reach the castle, try again");
  - toegankelijk: `<label>`, `aria-live` voor fouten, Enter verstuurt.
- [x] Netwerk- of serverfout bij een bewaarde code: de code **niet** wissen. Toon het invoerscherm met de foutmelding en de bewaarde code ingevuld.
- [x] `404.html` alleen nog voor echt onbekende URL's.

### 4. Invite (`src/js/invite.js`)
- [x] `resetStorageOnInviteOpen()` verwijderen.
- [x] RSVP-labels op `accepted`/`declined` laten aansluiten.
- [x] Als de RSVP al beantwoord is: CTA "Continue your journey" → `getNextStep` (bij een directe navigatie naar `/invite/`).

### 5. RSVP (`src/js/rsvp-form.js`)
- [x] Waarden `yes`/`no` mappen naar `accepted`/`declined`.
- [x] Huidige keuze voorselecteren in edit-modus.
- [x] Na het opslaan → `getNextStep()` (`declined` → `/map/` afgemeld-variant).
- [x] Een eerste `declined` (niet in edit-modus) gaat ook naar `/map/` en niet naar `/sorting/`.

### 6. Sorting (`src/js/sorting.js`)
- [x] Guard: bij een bestaande house doorsturen.
- [x] Bij 409/403 (niet aangemeld of deadline voorbij) doorsturen naar `getNextStep()`.

### 7. Cabin (`src/js/cabin.js`)
- [x] `resetDishSelectionOnCabinOpen()` verwijderen. In edit-modus voorselecteren vanuit `guest.dishIds`.
- [x] Edit-modus: verkorte intro, opslaan → `/map/`.
- [x] 409-conflict afhandelen: melding tonen, taken-lijst verversen, keuze laten aanpassen.

### 8. Chamber (`src/js/chamber.js`)
- [x] Eigen cookie- en localStorage-lezen vervangen door `getGuest()` (department).
- [x] Guard toevoegen.

### 9. Map (`src/js/map.js`, `src/map/index.html`)
- [x] Guard toevoegen.
- [x] Knop "Make changes" met wijzigvenster (dishes, house, RSVP; `map-changes.js`), alleen als `canChange`.
- [x] Deadline tonen ("Changes possible until …") of "Your choices are sealed".
- [x] De link "Not you? Leave the Great Hall" (beide varianten) → `clearGuestCode()` → hoofdpagina.
- [x] **Afgemeld-variant** (`rsvpStatus = declined`): een aparte sectie in `src/map/index.html` (verborgen tenzij declined) met:
  - een bedankje voor de RSVP en "jammer dat je er niet bij kunt zijn", in dezelfde perkament/Hogwarts-stijl;
  - de knop "Change your response" → `../rsvp/?edit=1` (alleen als `canChange`);
  - na de deadline "Your response is sealed" zonder knop;
  - geen kaart, footsteps, gerechten of house-details. `map-footsteps.js` en de kaart-interactie worden niet geïnitialiseerd.

### 10. Opruimen
- [x] Ongebruikte cabin-cookie en localStorage-keys verwijderen (`cabin`, `cabin-dish-selection`). De sorting-hat-key blijft voor tussentijdse voortgang van de vragen.
- [x] Een eenmalige opschoning van oude keys toevoegen in `home.js`.

## Testscenario's
1. Nieuwe gast via een link met `?code` → volledige flow → map.
2. Dezelfde gast opent de hoofdpagina opnieuw (zonder code) → direct `/map/`.
3. Gast stopt na sorting → komt terug → `/cabin/`.
4. Gast wijzigt gerechten → terug naar map met de nieuwe gerechten. De oude gerechten zijn vrij voor anderen.
5. Gast meldt zich af → map (afgemeld-variant) → meldt zich weer aan → cabin → map, met dezelfde house. De eerder gekozen gerechten zijn vrijgegeven.
5b. Gast meldt zich direct bij de eerste RSVP af → map (afgemeld-variant), geen sorting.
6. Na de deadline: geen wijzigknoppen. `/cabin/?edit=1` en `/rsvp/?edit=1` sturen door naar map/invite.
7. Twee gasten kiezen tegelijk hetzelfde gerecht → de tweede krijgt een conflictmelding.
8. Geen code → invoerscherm. Een geldige pincode invoeren (ook met een voorloopnul, zoals `0427`) → juiste stap. Letters typen of plakken lukt niet.
8b. Ongeldige code invoeren → foutmelding. Te vaak fout → melding met wachttijd (429).
8c. Een link met een ongeldige `?code` → invoerscherm met foutmelding.
8d. "Not you?" → code gewist → invoerscherm. `/map/` direct openen → terug naar het invoerscherm.
8e. API onbereikbaar met een bewaarde code → de code blijft bewaard, met een melding.
9. Direct `/map/` openen zonder voortgang → redirect naar de juiste stap.

## Besluiten
- Deadline: 17 december 2026, 23:59 (Europe/Amsterdam).
- Productie-URL: `https://riceweb.nl/christmas/`.
- Afgemelde gasten zien geen gerechten of kaart, wel de afgemeld-variant van `/map/`.
- Gastcodes worden aangemaakt via het admin-endpoint (zie `API_PLAN.md`). De uitnodigingslink is `https://riceweb.nl/christmas/?code=1234`.
- Gastcode = een pincode van 4 cijfers. Het risico van raden wordt geaccepteerd en beperkt door een strenge rate limit in de API (5 fouten per uur per IP).
- Toegang alleen via een gastcode (via de link of handmatig). Geen login met e-mail of wachtwoord.
- De mock accepteert alleen pincode `2412`. Elke andere code geeft in de mock een 404. De mock simuleert ook een 429 na 5 foute pogingen.

## Afhankelijkheid API
- De frontend wordt eerst volledig tegen de mock gebouwd (`API_BASE_URL` leeg).
- Zodra de API live is, vul je `API_BASE_URL` in en voer je de testscenario's opnieuw uit tegen de echte API.

Zie `API_PLAN.md` voor de backend.

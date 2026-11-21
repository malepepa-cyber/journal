# 🍲 Petras Rezepte App

Rezepte aus dem **Zaubertopf Club** (oder jeder anderen Seite) kopieren, in die App
einfügen, prüfen – und mit einem Tipp als **eigenes Rezept in Cookidoo** speichern.
Danach ist es auf dem **TM6** unter *Meine Rezepte → Meine Kreationen* abrufbar,
inklusive antippbarer Knöpfe für **Zeit / Temperatur / Stufe / Linkslauf**.

## So funktioniert's

```
Handy/Tablet (Web-App)  ──►  kleiner Server (server.js)  ──►  cookidoo.de  ──►  TM6
  einfügen, prüfen            meldet sich mit euren            "Meine
                              Cookidoo-Daten an                Kreationen"
```

1. **Einfügen** – Text aus dem Zaubertopf Club kopieren und einfügen
   (oder in Chrome/Android: *Teilen → Petras Rezepte App*).
2. **Prüfen** – Titel, Portionen, Zeiten, Zutaten und Schritte werden erkannt.
   Unter jedem Schritt steht, was am TM6 als Knopf erscheint, z. B.
   `⚙ 3 Min. · 120 °C · Linkslauf · Stufe 1`. Alles ist editierbar.
3. **Speichern** – „In Cookidoo speichern“. Fertig.

Erkannt werden u. a.: `10 Sek./Stufe 5`, `3 Min./120°C/Stufe 1`,
`1 Min. 30 Sek./Stufe 4,5`, `20 Min./100°C/Linkslauf/Stufe 1`,
`25 Min./Varoma/Stufe 1`, `…/Sanftrührstufe`, `2 Min./Teigstufe`.

> ⚠️ **Wichtig:** Vorwerk bietet **keine offizielle Schnittstelle** an. Die App nutzt
> die gleiche Schnittstelle wie die Cookidoo-Webseite (über die MIT-lizenzierte
> Bibliothek `@recode-software/cookidoo-api`). Vorwerk kann das jederzeit ändern;
> dann funktioniert „Als Text kopieren“ weiterhin. Nur fürs eigene Konto nutzen.
>
> Varoma, Sanftrührstufe, Teigmodus und Turbo sind **experimentell**: Wenn Cookidoo
> sie ablehnt, speichert der Server automatisch eine vereinfachte Variante
> (Varoma → 120 °C, sonst ohne Knopf) bzw. notfalls nur den Text. Die App sagt dir,
> was passiert ist. Diese Schritte beim ersten Kochen am TM6 bitte kontrollieren.

## 💻 PC-Version – eine HTML-Datei, kein Server nötig

Die Datei **`dist/petras-rezepte.html`** einfach auf den PC kopieren und doppelt anklicken
(Chrome, Edge oder Firefox). Gespeichert wird über ein **Lesezeichen**, das auf cookidoo.de läuft
und die normale Cookidoo-Anmeldung im Browser nutzt – es wird **kein Passwort** in der App gespeichert.

**Einmalig:**
1. `petras-rezepte.html` öffnen, Lesezeichenleiste einblenden (**Strg + Umschalt + B**).
2. Den grünen Knopf **„➜ Petras Rezepte“** in die Lesezeichenleiste **ziehen**.
3. Auf cookidoo.de mit Petras Konto anmelden.

**Am schnellsten – direkt von der Rezeptseite:**
1. Rezept im Zaubertopf Club öffnen → Lesezeichen **„➜ Petras Rezepte“** anklicken.
   Das Rezept wird aus der Seite gelesen (schema.org-Rezeptdaten, sonst der Seitentext;
   wer vorher den Rezepttext markiert, bestimmt selbst, was gelesen wird).
2. Vorschau prüfen → **„Kopieren & Cookidoo öffnen“**.
3. Im Cookidoo-Tab das Lesezeichen noch einmal anklicken → **„In Cookidoo speichern“**.

**Oder mit der HTML-Seite – per PDF oder Text (zum genauen Bearbeiten):**
1. Rezept als PDF speichern (im Browser **Strg + P → „Als PDF speichern“**) und die PDF in
   `petras-rezepte.html` hineinziehen – oder Text kopieren und einfügen. Die App erkennt alles
   automatisch und zeigt es zum Prüfen an.
2. **„Für Cookidoo kopieren & öffnen“** – Cookidoo öffnet sich in einem neuen Tab.
3. Dort auf das Lesezeichen klicken → **Strg + V** → **„In Cookidoo speichern“**.

Falls der Browser das Lesezeichen blockiert: Erweiterung **Tampermonkey** installieren und
`dist/petras-rezepte-helfer.user.js` öffnen → auf cookidoo.de erscheint unten rechts ein Knopf.

Nach Änderungen am Code neu bauen: `npm run build:pc`.

## 📱 Handy/Tablet – Server starten (3 Möglichkeiten)

Die Cookidoo-Zugangsdaten liegen **nur auf dem Server**, nie in der App.
Die App ist mit einer **PIN** geschützt.

### A) Direkt auf dem Android-Handy/Tablet (ohne extra Rechner) – empfohlen zum Start
1. **Termux** aus F-Droid installieren (die Play-Store-Version ist veraltet).
2. In Termux:
   ```sh
   pkg install nodejs git
   git clone https://github.com/malepepa-cyber/journal.git
   cd journal/rezept-app
   npm install
   cp .env.example .env
   nano .env          # E-Mail, Passwort, APP_PIN eintragen, speichern
   npm start
   ```
3. Im Chrome `http://localhost:8080` öffnen → Menü ⋮ → **Zum Startbildschirm hinzufügen**.

Nachteil: Termux muss laufen, wenn sie speichern will (später einfach `cd journal/rezept-app && npm start`).

### B) Auf einem Rechner / Raspberry Pi / NAS im Heim-WLAN (Docker)
```sh
cd rezept-app
cp .env.example .env   # ausfüllen
docker build -t petras-rezepte-app .
docker run -d --restart unless-stopped --env-file .env -p 8080:8080 petras-rezepte-app
```
Auf Handy und Tablet `http://<IP-des-Rechners>:8080` öffnen und zum Startbildschirm hinzufügen.

### C) Im Internet (z. B. Render, Fly.io, Railway)
Ordner `rezept-app` als Docker-Dienst deployen, die Variablen aus `.env.example`
als **Secrets/Environment** eintragen und unbedingt eine gute `APP_PIN` setzen.
Dann funktioniert es auch unterwegs.

## In der App einrichten
⚙️ → **App-PIN** eintragen → **Verbindung testen**. Bei „✅ Cookidoo-Anmeldung ok“ ist alles bereit.
(„Server-Adresse“ nur ausfüllen, wenn die App von einer anderen Adresse geladen wird als der Server.)

## Entwicklung
```sh
npm test     # Parser- und Format-Tests (ohne Netz)
```
Dateien: `public/parser.js` (Texterkennung), `lib/cookidoo-format.js` (Cookidoo-Datenformat),
`server.js` (Server + Upload), `public/app.js` (Oberfläche),
`lib/cookidoo-browser.js` + `pc/helper.js` + `pc/extract.js` (Lesezeichen-Helfer, Seite auslesen),
`public/pdftext.js` + `public/vendor/` (PDF lesen mit pdf.js, Apache-2.0), `pc/build.mjs` (baut `dist/`).

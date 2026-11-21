# 🍲 Rezept-Brücke

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
   (oder in Chrome/Android: *Teilen → Rezept-Brücke*).
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

## Server starten – 3 Möglichkeiten

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
docker build -t rezept-bruecke .
docker run -d --restart unless-stopped --env-file .env -p 8080:8080 rezept-bruecke
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
`server.js` (Server + Upload), `public/app.js` (Oberfläche).

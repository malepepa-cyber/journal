# Technische Architektur – Petras Rezepte App 2.0

© Patrick S.

## Überblick
```
┌──────────── Windows-PC / Notebook ────────────────────────────────────────────┐
│  PetrasRezepteApp.exe  (Node.js 22 „Single Executable“, Oberfläche eingebettet) │
│   ├─ lokaler Dienst  http://127.0.0.1:<Port>  (Sitzungsschlüssel, Host/Origin-  │
│   │   Prüfung, CSP)                                                            │
│   │    ├─ SQLite (node:sqlite)  %APPDATA%\Petras Rezepte App\rezepte.db         │
│   │    ├─ Sicherungen, Protokoll, verschlüsselte Geheimnisse (DPAPI)            │
│   │    └─ Sync-Engine ──────── HTTPS ───────┐                                   │
│   └─ Chrome-Fenster (--app) mit React-Oberfläche                                │
└────────────────────────────────────────────│───────────────────────────────────┘
                                             ▼
                 Firebase (Projekt des Nutzers, Spark-Tarif)
                 Authentication (E-Mail/Passwort) + Cloud Firestore
                 users/{uid}/recipes | photos | devices | meta
```
Externe Seiten (Zaubertopf Club, Cookidoo) öffnen im **normalen Chrome** des Nutzers – mit seiner eigenen Anmeldung.
Die App speichert keine Zugangsdaten zu diesen Diensten.

## Technologiewahl
| Bereich | Wahl | Grund |
|---|---|---|
| Desktop-Hülle | Node.js SEA + Chrome im App-Modus | eine EXE (~80 MB), keine Laufzeit-Installation, kein Electron-Ballast (Chrome ist vorhanden), Updates = neue Setup-Datei |
| Installer | NSIS, Benutzerinstallation | keine Adminrechte, Desktop-Verknüpfung, Deinstallation über Windows |
| Oberfläche | React 19, TypeScript, Tailwind 4, Vite | modern, schnell, gut wartbar |
| Lokale Daten | SQLite (in Node eingebaut) | robust, transaktionssicher, offline |
| Cloud | Firebase Auth + Firestore über REST | dauerhaft kostenlos, pausiert nie, Benutzertrennung serverseitig, kein SDK nötig |
| PDF / OCR | pdf.js, Tesseract.js (deutsches Modell lokal) | läuft vollständig lokal, nichts verlässt den PC |
| Word | mammoth (.docx), eigener Leser (.doc) | lokal |
| KI (optional) | Claude-API (Anthropic SDK), strukturierte Ausgabe | nur mit eigenem Schlüssel, nur Vorschläge |

## Module
| Ordner | Inhalt |
|---|---|
| `shared/` | gemeinsam von Oberfläche und Dienst: Datenmodell (`model.ts`), Thermomix-Einstellungen lesen/schreiben (`tm.ts`), Zutaten (`ingredients.ts`), Rezepttext-Analyse (`parser.ts`), regelbasierte Vorschläge (`suggest.ts`), Prüfung (`validate.ts`), Cookidoo-Formate (`cookidoo*.ts`), Seitenleser (`sites/zaubertopf.ts`, `sites/generic.ts` mit JSON-LD), PDF-Zeilen, .doc-Leser |
| `server/` | `main.ts` (Start, Einzelinstanz, Autobeenden), `api.ts` (Routen), `db.ts` (Schema, Migrationen, Versionsverlauf), `backup.ts`, `secrets.ts` (DPAPI), `security.ts`, `fetch-url.ts` (öffentliche Seiten, SSRF-Schutz), `launcher.ts` (Chrome), `ai.ts`, `log.ts` (ohne Geheimnisse) |
| `server/sync/` | `firebase.ts` (REST-Client Auth + Firestore, Vorbedingungen), `engine.ts` (Abgleich, Konflikte, Geräte, Zeitplan) |
| `helper/` | Lesezeichen „➜ Petras Rezepte“: liest Rezeptseiten im angemeldeten Chrome, Ausfüllhilfe im Cookidoo-Editor |
| `web/src/` | Seiten: Dashboard, Import (Datei-Upload + 5-Schritte-Anleitung), Meine Rezepte/Favoriten, Editor, Cookidoo-Assistent, Einstellungen; `lib/sync.tsx` (Status), Komponenten |
| `firebase/` | `firestore.rules` (Sicherheitsregeln), `firebase.json` (Emulatoren für Tests) |
| `build/` | Build, Windows-EXE (SEA + postject), NSIS-Installer, Lizenzen |
| `tests/` | Unit-, Integrations-, Oberflächen- und Sync-Tests (siehe `docs/TESTS.md`) |

## Datenmodell lokal (SQLite, Schema-Version 2)
* `recipes`: Rezept als JSON-Dokument + Such-/Sortierspalten; `uuid` (geräteübergreifend), `dirty` (noch zu übertragen),
  `remote_time` (zuletzt bekannte Cloud-Fassung), `version`, `photo_hash`/`photo_synced` (SHA-256 des Bildes), `deleted_at` (Papierkorb)
* `recipe_history`: frühere Fassungen je Rezept (letzte 30) – bei jedem Speichern, vor jeder Übernahme aus der Cloud, bei Konflikten
* `tombstones`: endgültig gelöschte Rezepte, die in der Cloud noch entfernt werden müssen
* `settings` (je Profil, u. a. Kategorien), `drafts` (Autosave), `meta` (Gerät, Sync-Zustand, verschlüsselte Geheimnisse)
* Migrationen laufen automatisch; vorher wird eine Sicherung angelegt.

## Synchronisierung
* **Lokal zuerst:** Jedes Gerät hat die vollständige Datenbank; die Cloud ist nur Abgleichstelle. Keine geteilte
  Datenbankdatei (kein OneDrive/Dropbox).
* **Holen:** Firestore-Abfrage „geändert seit“ (Server-Zeitstempel, 2 Min. Überlappung, Dubletten über `updateTime` erkannt).
* **Senden:** Schreiben mit Vorbedingung `updateTime == zuletzt bekannt` (bzw. „existiert nicht“). Schlägt sie fehl,
  hat ein anderes Gerät geändert → **Konflikt**.
* **Konflikt:** Cloud-Fassung wird übernommen, eigene Fassung wird **Konflikt-Kopie** (`conflict: {of, device, at}`) und
  ebenfalls synchronisiert. Auflösen: „Diese Fassung behalten“ (ersetzt das Original, das in den Versionsverlauf wandert)
  oder Kopie löschen.
* **Bilder:** eigenes Dokument `photos/{uuid}`, nur übertragen, wenn sich der SHA-256-Fingerabdruck ändert (max. ~1 MB).
* **Löschen:** Papierkorb = Markierung `deleted`; endgültig = `purged` (Inhalt entfernt) auf allen Geräten.
* **Kategorien:** `meta/settings`, zuletzt geändert gewinnt, bei Gleichzeitigkeit Vereinigung.
* **Geräte:** `devices/{id}` mit Name, Version, „zuletzt aktiv“; entfernte Geräte melden sich beim nächsten Abgleich ab.
* **Zeitplan:** Start, alle 2 Min., 3 s nach Änderungen, beim Beenden; bei Fehlern 15 s → 10 Min. Pause (Backoff).
  Offline-Erkennung → Status „Offline – Änderungen lokal gespeichert“.
* **Anmeldung:** Firebase-Token (1 h) + Refresh-Token, letzteres DPAPI-verschlüsselt. Das Passwort wird nie gespeichert.

## Sicherheit und Datenschutz
* Lokaler Dienst nur auf 127.0.0.1, zufälliger Sitzungsschlüssel je Start, Prüfung von Host und Origin, strenge CSP.
* Geheimnisse (KI-Schlüssel, Sync-Anmeldung) mit Windows-DPAPI verschlüsselt; nie an die Oberfläche, nie ins Protokoll.
* Cloud: TLS; Sicherheitsregeln erlauben jedem Konto nur `users/{eigene uid}/…` – getestet (fremdes Konto / ohne Anmeldung → 403).
* Abruf öffentlicher Seiten/Bilder nur an öffentliche Adressen (kein Zugriff aufs Heimnetz), Größen-/Zeitgrenzen.
* Keine Weitergabe von Rezeptinhalten an Dritte (KI nur bei ausdrücklicher Aktivierung, nur der Rezepttext).
* Cookidoo/Zaubertopf: keine inoffiziellen Schnittstellen im Standardweg, keine Umgehung von Schutzmaßnahmen,
  keine gespeicherten Zugangsdaten; die Ausfüllhilfe bedient nur die normale Webseite im angemeldeten Chrome.

## Skalierung auf viele Nutzer
Datenpfade und Regeln sind je Benutzer getrennt; die Engine ist vom Anbieter entkoppelt (`firebase.ts` austauschbar).
Für viele Nutzer: gemeinsames Projekt im Blaze-Tarif mit Budget-Warnung oder je Nutzer ein eigenes Spark-Projekt.

## Bauen und Testen
```
npm ci
npm run build          # Oberfläche + Dienst
npm test               # 42 Unit-/Integrationstests
npm run test:e2e       # Oberflächentests (Playwright)
npm run test:sync      # Sync-Tests gegen Firebase-Emulatoren (Java 21 nötig; ohne Konto, ohne Kosten)
npm run dist:win       # Windows-EXE + Installer (NSIS nötig)
```

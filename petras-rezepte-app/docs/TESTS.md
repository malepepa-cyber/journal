# Testprotokoll – Version 2.0.0

Stand: 23.11.2026. Alle automatischen Tests laufen unter Linux (Entwicklungsumgebung) mit Chromium.
✔ = automatisch getestet und bestanden · ◐ = teilweise automatisch, Rest bitte am echten Windows-PC prüfen

| Nr. | Test laut Auftrag | Ergebnis | Wie geprüft |
|---|---|---|---|
| 1 | Zaubertopf Club öffnen und Rezeptseite speichern | ◐ | Knopf öffnet die Seite im normalen Chrome (Freigabeliste getestet). Gespeicherte Original-Seiten (4 echte Club-Rezepte, nicht im Repository) werden korrekt gelesen – inkl. Kochmodus-Schritten, Gruppen, Mengen. Speichern mit Strg+S selbst ist Chrome-Funktion. |
| 2 | Gespeicherte HTML-Datei hochladen | ✔ | `tests/sites.test.ts`, `tests/e2e/link-import.cjs` (HTML + Ordner mit Bild) |
| 3 | PDF hochladen | ✔ | `tests/e2e/e2e.cjs`: mehrseitige PDF mit Kopf-/Fußzeilen, PDF mit Tabelle |
| 4 | Texterkennung (OCR) | ✔ | `tests/e2e/e2e.cjs`: gescannte PDF → Titel, Zutaten, 4 Schritte, Thermomix-Einstellungen; Foto (JPG) |
| 5 | Zutatenerkennung | ✔ | `tests/parser.test.ts`, `samples.test.ts` (Mengen, Brüche, Spannen, Einheiten, Gruppen) |
| 6 | Schritte & Thermomix-Einstellungen | ✔ | `parser.test.ts`, `sites.test.ts` (Zeit/Temperatur/Stufe/Linkslauf/Varoma/Teig/Turbo/Sanftrühr, Ruhezeiten); unsichere Angaben als „Vorschlag“ |
| 7 | Rezept im Editor bearbeiten und speichern | ✔ | `e2e.cjs` (Vorschlag übernehmen, speichern, Favorit, Kategorie ändern), Kategorien verwalten |
| 8 | Cookidoo-Assistent | ✔ | `e2e.cjs` (Fortschritt je Feld, „Alle Zutaten kopieren“, bleibt nach Neuladen erhalten), `cookidoo-fill.cjs` (Ausfüllhilfe auf nachgebautem Cookidoo-Editor) |
| 9 | PC → Notebook synchronisieren | ✔ | `tests/sync/sync.emulator.ts` Test 1–2, `tests/e2e/sync-ui.cjs` (zwei echte App-Dienste, Firebase-Emulatoren) – inkl. Bild |
| 10 | Änderung am Notebook → PC | ✔ | Sync-Test 3 (Notiz, Zutat, Favorit; alte Fassung im Versionsverlauf) |
| 11 | Offline arbeiten, später synchronisieren | ✔ | Sync-Test 4 (Verbindung getrennt → „Offline – Änderungen lokal gespeichert“, 2 offen → nach Wiederverbindung übertragen) |
| 12 | Gleichzeitige Bearbeitung (Konflikt) | ✔ | Sync-Test 5 + Oberflächentest: Konflikt-Kopie, nichts verloren, „Diese Fassung behalten“ auf beiden Geräten wirksam |
| 13 | Installation, Update, Deinstallation | ◐ | Installer wird gebaut; die EXE (gleicher Aufbau) besteht alle Oberflächentests als Linux-Programm; Datenbank-Update von 1.3 → 2.0 (mit Sicherung vorher) getestet. **Installieren/Update/Deinstallieren unter echtem Windows 10/11 bitte einmal von Hand prüfen** (in der Testumgebung gibt es kein Windows). |

Weitere automatische Prüfungen: Sicherheit des lokalen Dienstes (Schlüssel, Host, Origin), Löschen/Papierkorb über
beide Geräte, Kategorien-Sync, Bilder werden bei unveränderter Datei nicht erneut übertragen, Sicherheitsregeln
(fremdes Konto und ohne Anmeldung: kein Zugriff), Gerät entfernen → dort abgemeldet, Rezepte bleiben,
Abmelden/Passwort zurücksetzen, keine Fehler in der Browser-Konsole.

## Ausführen
```
npm test                    # 42 Tests
node tests/e2e/e2e.cjs      # Import, Editor, Assistent, Kategorien
node tests/e2e/link-import.cjs
node tests/e2e/cookidoo-fill.cjs
npm run test:sync           # 10 Sync-Szenarien (Firebase-Emulatoren)
node build/sync-test.mjs --ui   # Sync in der Oberfläche
```

## Checkliste für den echten Windows-Test (ca. 15 Minuten)
1. Setup starten → SmartScreen „Trotzdem ausführen“ → installieren → Desktop-Symbol startet die App.
2. Bestehende 1.3-Rezepte sind noch da (Update-Fall).
3. Rezeptseite im Zaubertopf Club mit Strg+S speichern → in der App hochladen → prüfen → speichern.
4. Einstellungen → Geräte und Synchronisierung einrichten (docs/SYNC-ANLEITUNG.md), Notebook verbinden.
5. Am Notebook ein Rezept ändern → am PC „Jetzt synchronisieren“.
6. WLAN am Notebook aus → ändern → WLAN an → wird automatisch übertragen.
7. App schließen, erneut installieren (Update) → Daten bleiben. Deinstallieren → Programm entfernt.

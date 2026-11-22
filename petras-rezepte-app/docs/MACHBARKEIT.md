# Phase 1 – Technische Machbarkeitsanalyse

Stand: November 2026 · Petras Rezepte App · © Patrick S.

## 1. Cookidoo-Anbindung

| Frage | Ergebnis | Quelle / Prüfung |
|---|---|---|
| Offizielle, öffentliche API? | **Nein.** Vorwerk bietet weder eine dokumentierte API noch ein Entwickler- oder Partnerprogramm für Cookidoo an. | Recherche Vorwerk-/Cookidoo-Seiten, Nutzungsbedingungen, EU-Data-Act-Hinweise |
| Offizielle Importfunktion? | **Ja, eingeschränkt.** Unter „Meine Rezepte → Meine Kreationen“ kann man ein Rezept **per URL importieren** (öffentliche Rezeptseiten, Cookidoo, Rezeptwelt) und danach bearbeiten. Rezepte hinter einem Login (z. B. Zaubertopf Club) kann der Cookidoo-Server nicht abrufen. | Vorwerk-Support „How to modify/import a recipe“, Cookidoo „Learn about importing recipes“ |
| Eigene Rezepte offiziell erstellen? | **Ja**, im Web-Editor „Meine Kreationen“ (Titel, Bild, Portionen, Zeiten, Zutaten, Schritte, Thermomix-Einstellungen). Auf dem TM6 nutzbar ab Software 3.0. | Vorwerk-Support „Create Your Own Recipes on Cookidoo“ |
| Inoffizielle Schnittstelle? | Die Cookidoo-Webseite selbst nutzt intern `…/created-recipes/{sprache}` (Anlegen, PATCH für Zutaten/Schritte, „TTS“-Knöpfe für Zeit/Temperatur/Stufe). Community-Bibliotheken (z. B. `@recode-software/cookidoo-api`, MIT) haben das nachgebaut. **Nicht dokumentiert, kann sich jederzeit ändern.** | Quellcode der Bibliothek geprüft |
| Nutzungsbedingungen | Verboten sind u. a. „technische Beschränkungen umgehen“, „hacken/verändern“ und eine Nutzung, die die Infrastruktur „überlasten“ könnte. Automatisierte Zugriffe auf interne Schnittstellen sind **nicht ausdrücklich erlaubt**. | Cookidoo Terms of Use (DE/UK/CH/ES) |

### Entscheidung

1. **Standardweg = Geführter Übertragungsassistent (vollständig zulässig).**
   Die App bereitet das Rezept fertig auf und öffnet Cookidoo („Meine Kreationen → Rezept erstellen“) in Chrome.
   Ein Assistent führt Feld für Feld durch die Eingabe. Jede Angabe lässt sich mit einem Klick kopieren,
   die Thermomix-Einstellungen werden pro Schritt groß angezeigt. Petra klickt in Cookidoo selbst auf „Speichern“.
2. **Optional: „Schnellübertragung (experimentell)“ – standardmäßig AUS.**
   Per Lesezeichen in Petras eigenem, angemeldetem Chrome werden die Felder über dieselbe Schnittstelle befüllt,
   die auch die Cookidoo-Webseite nutzt. Es wird **kein Passwort** an die App gegeben oder gespeichert, und es gibt
   **keinen fremden Server**. Ein Rezept erzeugt nur 3–5 Anfragen, also keine Überlastung. Weil die Schnittstelle nicht offiziell ist, muss die Funktion erst
   in den Einstellungen bewusst eingeschaltet werden (mit Hinweistext), und die App zeigt transparent, was passiert.
3. **Keine** Speicherung von Cookidoo-Zugangsdaten, **kein** Umgehen von Logins, **kein** Massen-Upload.

## 2. Windows-Architektur

Anforderungen: installierbare EXE, Start in Google Chrome, kein separates Node/Python, SQLite lokal, Deinstallation, später Updates.

| Option | Bewertung |
|---|---|
| **A) Lokaler Dienst als eigenständige EXE + Chrome im App-Fenster** | ✅ **Gewählt.** Node.js „Single Executable Application“ (eine EXE, Node eingebaut) mit integriertem SQLite (`node:sqlite`), liefert die React-Oberfläche aus und öffnet sie mit `chrome --app=…` als eigenes Fenster in Petras **echtem Chrome**. Dort ist sie bei Cookidoo angemeldet, also funktionieren Assistent und Lesezeichen. Fallback: Microsoft Edge (auf jedem Windows vorhanden) bzw. Standardbrowser. |
| B) Electron | Eigener Chromium, also nicht Petras Chrome mit ihrer Cookidoo-Anmeldung. Installer 100 MB+. Verworfen. |
| C) Tauri | Nutzt WebView2 (Edge), nicht Chrome. Rust-Toolchain nötig. Verworfen. |
| D) Reine PWA | Kein SQLite-Dateizugriff, keine Backups im Dateisystem, kein echter Installer. Verworfen. |

**Installer:** NSIS (frei, Open Source), Installation ohne Administratorrechte nach `%LOCALAPPDATA%\Programs\Petras Rezepte App`,
Desktop- und Startmenü-Verknüpfung, Eintrag in „Apps & Features“ (Deinstallation). Die Daten liegen getrennt in
`%APPDATA%\Petras Rezepte App` und bleiben bei Updates erhalten. **Update** = neue Setup-Datei darüber installieren.

**Sicherheit des lokalen Dienstes:** nur `127.0.0.1`, zufälliger Zugriffsschlüssel pro Start (wird Chrome beim Öffnen
übergeben), Prüfung von `Host`/`Origin` (Schutz gegen DNS-Rebinding und fremde Webseiten), keine Fernzugriffe.

## 3. PDF- und Texterkennung

| Quelle | Technik | Läuft |
|---|---|---|
| Text einfügen | eigener Parser | offline |
| PDF mit Text | pdf.js (Mozilla, Apache-2.0), Zeilen-Rekonstruktion inkl. Spalten, Kopf-/Fußzeilen-Filter | offline |
| Gescannte PDF / Foto | Tesseract OCR (tesseract.js, Apache-2.0) mit deutschem Sprachmodell, im Installer enthalten | offline |
| Word (.docx) | mammoth (BSD-2) | offline |
| TXT | direkt | offline |
| Webseite | Text kopieren & einfügen bzw. Lesezeichen „Rezept holen“ (liest die geöffnete Seite, nutzt schema.org-Rezeptdaten) | offline |

## 4. Rezeptkonvertierung

* **Regelbasiert (immer verfügbar, kostenlos):** Erkennung von Titel, Portionen, Zeiten (Arbeits-/Gesamt-/Ruhe-/Gehzeit),
  Zutaten mit **Menge · Einheit · Zutat**, Gruppen („Für den Teig“), Schritten, Thermomix-Angaben
  (`10 Sek./Stufe 5`, `3 Min./120°C/Linkslauf/Stufe 1`, Varoma, Teigstufe, Sanftrührstufe, Turbo, Anbraten),
  Zubehör (Rühraufsatz, Gareinsatz, Varoma, Messbecher).
* **Vorschläge:** Fehlen Thermomix-Angaben (z. B. „Milch, Hefe und Zucker erwärmen“), schlägt die App eine Umsetzung vor
  (z. B. `2 Min./37°C/Stufe 2`). Vorschläge sind **deutlich als Vorschlag markiert** und werden erst nach Bestätigung übernommen.
* **Plausibilität:** unbekannte Einheiten, fehlende Mengen, Stufe > 10, Temperaturen > 120 °C (TM6) bzw. Varoma,
  Zeiten > 99 Min., doppelte Rezepte.
* **Optionale KI (eigener API-Schlüssel):** Claude-API für schwierige Rezepte. Der Schlüssel wird mit der Windows-Datenschutz-API (DPAPI)
  verschlüsselt gespeichert und nie an die Oberfläche gegeben. Ergebnisse gelten ebenfalls nur als Vorschlag.

## 5. Risiken

* Cookidoo kann Editor oder interne Schnittstelle ändern. Der Assistent funktioniert dann weiterhin, nur die experimentelle
  Schnellübertragung könnte ausfallen.
* Die EXE ist **nicht signiert**, daher zeigt Windows SmartScreen beim ersten Start „Weitere Informationen → Trotzdem ausführen“.
  Für eine Veröffentlichung empfiehlt sich ein Code-Signing-Zertifikat.
* Urheberrecht: Importierte Rezepte bleiben lokal und privat. Die App veröffentlicht nichts. Bilder aus Quellen werden nicht
  automatisch übernommen.

# Laufende Kosten – Übersicht

| Posten | Kosten | Bemerkung |
|---|---|---|
| Petras Rezepte App | **0 €** | eigene Software, läuft lokal |
| Google Chrome | 0 € | |
| Cookidoo-Abo | bestehend | wird ohnehin genutzt; die App braucht kein zusätzliches Abo |
| Zaubertopf Club | bestehend | Mitgliedschaft wird ohnehin genutzt |
| **Synchronisierung (Firebase, Tarif „Spark“)** | **0 €** | **keine Zahlungsart hinterlegt → es kann nichts berechnet werden** |
| KI-Unterstützung (optional) | nutzungsabhängig | nur mit eigenem Claude-API-Schlüssel; standardmäßig **aus**; alles funktioniert ohne |
| Code-Signatur-Zertifikat (optional) | ca. 100–400 €/Jahr | nur um die SmartScreen-Warnung beim Installieren zu vermeiden – **nicht nötig** |

## Firebase Spark – kostenlose Grenzen und tatsächlicher Bedarf
| Grenze (pro Projekt) | Spark kostenlos | Bedarf Petra (2 Geräte, App 8 h/Tag offen) |
|---|---|---|
| Gespeicherte Daten | 1 GiB | 500 Rezepte mit Bild ≈ 150–250 MB |
| Lesevorgänge | 50.000 / Tag | ≈ 1.500–3.000 / Tag |
| Schreibvorgänge | 20.000 / Tag | ≈ 500–1.000 / Tag |
| Löschvorgänge | 20.000 / Tag | wenige |
| Anmeldungen (E-Mail/Passwort) | kostenlos | 1 Konto |

Wird eine Tagesgrenze dennoch erreicht, meldet die App „Tageskontingent erreicht“ und setzt am nächsten Tag
automatisch fort – **ohne Kosten**. *Cloud Storage for Firebase* (kostenpflichtig) wird bewusst **nicht** verwendet;
Bilder werden verkleinert in der Datenbank gespeichert und nur bei Änderung übertragen.

## Optionale KI (Claude-API von Anthropic)
* Nur aktiv, wenn in den Einstellungen eingeschaltet **und** ein eigener API-Schlüssel hinterlegt ist.
* Abgerechnet wird pro Nutzung direkt von Anthropic (Prepaid-Guthaben). Empfehlung: in der Anthropic-Konsole ein
  **Ausgabenlimit** setzen. Pro Rezept fallen typischerweise wenige Cent an.
* Der Schlüssel wird mit der Windows-Datenschutz-API verschlüsselt gespeichert und nie angezeigt.

## Bei Veröffentlichung für viele Nutzer
Jeder Nutzer hat getrennte Daten (Sicherheitsregeln je Benutzerkonto). Ab einigen hundert aktiven Nutzern reichen die
Spark-Grenzen nicht mehr; dann wäre der Tarif **Blaze** (nutzungsabhängig, mit Budget-Warnungen) nötig. Grobe
Größenordnung: deutlich unter 1 € pro aktivem Nutzer und Jahr. Alternativ kann jeder Nutzer – wie Petra – ein
eigenes kostenloses Projekt verwenden (Verbindungscode).

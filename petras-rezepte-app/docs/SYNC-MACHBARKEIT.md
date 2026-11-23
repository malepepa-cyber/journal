# Synchronisierung PC ↔ Notebook – Machbarkeit und Entscheidung

Stand: November 2026 · Petras Rezepte App 2.0 · © Patrick S.

## Anforderungen (aus dem Auftrag)
Gleicher Rezeptbestand auf mehreren Windows-Geräten · Offline arbeiten, später automatisch übertragen ·
keine unbemerkten Verluste bei gleichzeitiger Bearbeitung (Konflikterkennung, Versionen) · Bilder nur bei Änderung
übertragen · Benutzerkonto (Registrierung, Login, Passwort zurücksetzen, Logout, Geräte) · strikte Trennung der
Benutzer · keine unerwarteten Kosten · erweiterbar auf viele Nutzer.

## Grundprinzip: lokal zuerst
Jedes Gerät behält seine **eigene lokale SQLite-Datenbank** (schnell, offline-fähig, mit den bestehenden Sicherungen).
Eine Cloud-Datenbank dient nur als **Abgleichstelle**. Es wird **nie** eine Datenbankdatei über OneDrive/Dropbox geteilt.

## Vergleich der Cloud-Dienste

| | **Firebase (Spark, kostenlos)** | Supabase (Free) | Eigener Server |
|---|---|---|---|
| Kosten | 0 €. Ohne hinterlegte Zahlungsart *kann* nichts berechnet werden – bei Erreichen der Grenzen werden Anfragen abgelehnt | 0 € | Hardware/Strom/Domain |
| Grenzen (kostenlos) | 1 GiB Datenbank, 50.000 Lesevorgänge, 20.000 Schreibvorgänge/Tag | 500 MB DB, 1 GB Dateien | beliebig |
| **Pausieren** | **nie** | **nach ~7 Tagen ohne Nutzung pausiert**, muss im Dashboard reaktiviert werden | – |
| Datenschutz | Rechenzentrum wählbar (z. B. Frankfurt, `europe-west3`), TLS | EU-Region wählbar, TLS | volle Kontrolle |
| Benutzertrennung | Sicherheitsregeln je Benutzer (serverseitig erzwungen) | Row-Level-Security | selbst bauen |
| Wartung | keine | gering (Pausieren!) | hoch (Updates, Backups, Erreichbarkeit von außen) |
| Skalierung | sehr hoch (bei vielen Nutzern Blaze-Tarif nötig) | hoch | eigener Aufwand |

**Entscheidung: Firebase** (Auth + Firestore, angesprochen über die offiziellen REST-Schnittstellen – kein zusätzliches SDK
nötig). Hauptgrund: läuft dauerhaft ohne Pflege und ohne Kosten. Die Sync-Engine ist vom Anbieter getrennt
(`server/sync/engine.ts` ↔ `server/sync/firebase.ts`); ein Supabase-Anschluss kann später ergänzt werden.

**Bewusst nicht verwendet:** *Cloud Storage for Firebase* (Dateispeicher) – neue Speicher erfordern inzwischen den
kostenpflichtigen Blaze-Tarif mit Zahlungsart. Rezeptbilder werden daher verkleinert als **eigene Dokumente** in der
Datenbank gespeichert und **nur übertragen, wenn sich ihr Fingerabdruck (SHA-256) ändert**.

## Datenmodell in der Cloud
```
users/{uid}/recipes/{uuid}   → { data (Rezept ohne Bild), photoHash, version, deleted, updatedAt, deviceId, deviceName }
users/{uid}/photos/{uuid}    → { hash, data (JPEG, base64, ≤ 700 KB) }
users/{uid}/devices/{id}     → { name, platform, lastSeen, removed }
users/{uid}/meta/categories  → { list, version, updatedAt }
```
Sicherheitsregeln: Jeder Benutzer darf **nur** unter `users/{seine uid}` lesen und schreiben (siehe `firebase/firestore.rules`).

## Konflikte und Versionen
* Jede Änderung erhöht die **Version**. Hochgeladen wird mit Vorbedingung „Server-Version = zuletzt bekannte Version“
  (Firestore-Vorbedingung `updateTime`). Hat das andere Gerät inzwischen geändert, schlägt das fehl → **Konflikt**.
* Bei einem Konflikt geht nichts verloren: Die Server-Fassung wird übernommen, die eigene Fassung wird als
  **„Konflikt-Kopie“** gespeichert und in der App deutlich angezeigt (behalten, verwerfen oder zusammenführen).
* Lokal wird vor jedem Überschreiben die vorherige Fassung im **Versionsverlauf** abgelegt (wiederherstellbar).
* Löschungen werden als „gelöscht“-Markierung übertragen (Papierkorb auf allen Geräten).

## Offline
Änderungen werden lokal als „noch zu übertragen“ markiert. Bei Verbindung (beim Start, alle 2 Minuten, nach jeder
Änderung, auf Knopfdruck) wird automatisch abgeglichen; bei Fehlern mit zunehmenden Wartezeiten erneut versucht.

## Was Patrick einmalig tun muss (kostenlos, ca. 10 Minuten)
Firebase-Projekt anlegen, E-Mail-Anmeldung aktivieren, Firestore (Frankfurt) anlegen, Sicherheitsregeln einfügen,
Projektdaten in der App eintragen – Schritt für Schritt in `docs/SYNC-ANLEITUNG.md`.

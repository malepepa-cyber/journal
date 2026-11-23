# Synchronisierung einrichten (einmalig, ca. 10 Minuten, kostenlos)

Petras Rezepte App · © Patrick S.

Damit PC und Notebook dieselben Rezepte haben, braucht die App eine **eigene, private Cloud-Datenbank**.
Dafür wird ein **kostenloses Firebase-Projekt** von Google verwendet (Tarif „Spark“).

> **Kosten:** Der Spark-Tarif ist kostenlos und braucht **keine Zahlungsart**. Ohne hinterlegte Zahlungsart
> *kann* Google nichts berechnen – wird eine Grenze erreicht, pausiert die Synchronisierung bis zum nächsten Tag,
> die App arbeitet lokal weiter. Bitte **nicht** auf den Tarif „Blaze“ wechseln (der ist nicht nötig).

Du brauchst: ein Google-Konto (z. B. ein Gmail-Konto) und Google Chrome.

---

## Schritt 1 – Projekt anlegen
1. In Chrome **https://console.firebase.google.com** öffnen und mit dem Google-Konto anmelden
   (in der App: Einstellungen → Geräte und Synchronisierung → „Erstes Gerät einrichten“ → „Firebase-Konsole öffnen“).
2. **„Projekt erstellen“** (bzw. „Firebase-Projekt erstellen“) klicken.
3. Namen eingeben, z. B. `Petras Rezepte`. Firebase hängt automatisch eine Nummer an die **Projekt-ID** an
   (z. B. `petras-rezepte-1a2b3`).
4. **Google Analytics ausschalten** (wird nicht gebraucht) → „Projekt erstellen“ → „Weiter“.
   Falls nach Gemini/KI-Funktionen gefragt wird: nicht nötig, einfach überspringen.

## Schritt 2 – Anmeldung mit E-Mail und Passwort einschalten
1. Links im Menü **„Build“ → „Authentication“** (deutsch ggf. „Authentifizierung“) → **„Jetzt starten“**.
2. Reiter **„Sign-in method“ / „Anmeldemethode“** → **„E-Mail-Adresse/Passwort“** wählen.
3. Den **ersten** Schalter („E-Mail-Adresse/Passwort“) **aktivieren**, den zweiten („E-Mail-Link“) aus lassen → **Speichern**.

## Schritt 3 – Datenbank anlegen
1. Links **„Build“ → „Firestore Database“** → **„Datenbank erstellen“**.
2. Edition: **Standard** (falls gefragt). Datenbank-ID: `(default)` lassen.
3. Standort: **`europe-west3 (Frankfurt)`** (oder `eur3 (Europe)`). *Der Standort lässt sich später nicht ändern.*
4. **„Im Produktionsmodus starten“** wählen → **Erstellen**.

## Schritt 4 – Sicherheitsregeln einfügen (wichtig!)
Die Regeln sorgen dafür, dass **jeder Benutzer nur seine eigenen Rezepte** lesen und schreiben kann.
1. In „Firestore Database“ den Reiter **„Regeln“** öffnen.
2. Den vorhandenen Text **komplett ersetzen** durch:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid}/{collection}/{docId} {
      allow read, delete: if request.auth != null && request.auth.uid == uid;
      allow create, update: if request.auth != null && request.auth.uid == uid
        && collection in ['recipes', 'photos', 'devices', 'meta']
        && request.resource.data.size() <= 12;
    }
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```
3. **„Veröffentlichen“** klicken. (Dieselben Regeln liegen auch in `firebase/firestore.rules`.)

## Schritt 5 – Projektdaten ablesen
1. Oben links auf das **Zahnrad ⚙ → „Projekteinstellungen“**, Reiter **„Allgemein“**.
2. Dort stehen **„Projekt-ID“** und **„Web-API-Schlüssel“** (beginnt mit `AIza…`).
   *Steht beim Web-API-Schlüssel „Kein Web-API-Schlüssel“: Schritt 2 (Authentication) zuerst erledigen und die
   Seite neu laden – oder unten bei „Meine Apps“ auf das Symbol `</>` klicken, eine Web-App „Rezepte App“
   registrieren (ohne Hosting) und den Wert `apiKey` aus dem angezeigten Code nehmen.*

> Der Web-API-Schlüssel ist **kein Passwort** – er sagt nur, welches Projekt gemeint ist. Geschützt werden die
> Daten durch die Anmeldung (E-Mail + Passwort) und die Sicherheitsregeln aus Schritt 4.

## Schritt 6 – In der App eintragen (PC)
1. Petras Rezepte App → **Einstellungen → Geräte und Synchronisierung → „Erstes Gerät einrichten“**.
2. **Web-API-Schlüssel** und **Projekt-ID** einfügen → **Speichern**.
3. **„Konto erstellen“**: Petras E-Mail-Adresse und ein Passwort (mind. 8 Zeichen) → **Konto erstellen**.
4. Die Seitenleiste zeigt **„Synchronisiert“** – fertig. Alle vorhandenen Rezepte werden jetzt hochgeladen.

## Schritt 7 – Notebook verbinden
Siehe [ZWEITES-GERAET.md](ZWEITES-GERAET.md): Auf dem PC den **Verbindungscode** kopieren, am Notebook einfügen,
mit **derselben** E-Mail und **demselben** Passwort anmelden.

## Empfohlen danach – Registrierung für Fremde sperren
Wenn Petras Konto angelegt ist (und ggf. weitere gewünschte Konten), kann man verhindern, dass jemand mit den
Projektdaten weitere Konten anlegt:
**Authentication → Einstellungen („Settings“) → „Nutzeraktionen“ („User actions“) → Haken bei
„Erstellen (Registrierung) aktivieren“ / „Enable create (sign-up)“ entfernen → Speichern.**
Anmelden, Abmelden und „Passwort vergessen“ funktionieren weiterhin.

---

## Wie funktioniert die Synchronisierung?
* Jedes Gerät hat eine **vollständige eigene Kopie** (funktioniert auch ohne Internet).
* Abgleich: beim Start, alle 2 Minuten, wenige Sekunden nach jeder Änderung, beim Beenden und mit
  **„Jetzt synchronisieren“**. Ohne Internet: Anzeige **„Offline – Änderungen lokal gespeichert“**, später automatisch.
* Übertragen werden: Rezepte, Zutaten, Schritte, Thermomix-Einstellungen, Bilder (nur wenn neu/geändert),
  Kategorien, Favoriten, Notizen, Cookidoo-Fortschritt, Löschungen (Papierkorb und endgültiges Löschen).
* **Gleichzeitige Änderung** desselben Rezepts auf beiden Geräten: Es geht nichts verloren – eine Fassung bleibt,
  die andere erscheint als **„Konflikt-Kopie“**. Öffnen → „Diese Fassung behalten“ oder „Diese Kopie verwerfen“.
* Jede überschriebene Fassung landet im **Versionsverlauf** des Rezepts (Editor → „Versionen“).

## Häufige Meldungen
| Meldung | Bedeutung / Lösung |
|---|---|
| „Anmeldung mit E-Mail/Passwort ist noch nicht aktiviert“ | Schritt 2 wiederholen |
| „Die Cloud-Datenbank (Firestore) ist … noch nicht angelegt“ | Schritt 3 erledigen |
| „Zugriff verweigert – stimmen die Sicherheitsregeln?“ | Schritt 4: Regeln exakt einfügen und veröffentlichen |
| „E-Mail-Adresse oder Passwort stimmt nicht“ | Tippfehler? Sonst „Passwort vergessen“ – die E-Mail kommt von `noreply@<projekt-id>.firebaseapp.com` (ggf. Spam-Ordner) |
| „Tageskontingent erreicht“ | Kostenlose Tagesgrenze erreicht – geht am nächsten Tag automatisch weiter, keine Kosten |
| „Gerät wurde getrennt“ | Das Gerät wurde auf einem anderen Gerät entfernt. Rezepte bleiben; zum Wiederverbinden anmelden |

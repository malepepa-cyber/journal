# Installation, Update und Deinstallation (Windows 10/11)

## Installieren
1. `PetrasRezepteApp-Setup-2.0.0.exe` herunterladen und doppelklicken.
2. Windows zeigt evtl. **„Der Computer wurde durch Windows geschützt“** (SmartScreen), weil die Datei nicht mit
   einem kostenpflichtigen Zertifikat signiert ist: **„Weitere Informationen“ → „Trotzdem ausführen“**.
3. Lizenz bestätigen → **Installieren**. Es werden **keine Administratorrechte** benötigt; installiert wird nach
   `%LOCALAPPDATA%\Programs\Petras Rezepte App`.
4. Fertig: Symbol **„Petras Rezepte App“** auf dem Desktop und im Startmenü.

Benötigt wird nur **Google Chrome** (empfohlen) oder Microsoft Edge. Python, Node.js o. Ä. müssen **nicht**
installiert werden – alles ist in der App enthalten.

## Starten
Desktop-Symbol doppelklicken. Der lokale Dienst startet automatisch und die App öffnet sich als eigenes
Chrome-Fenster. Wird das Fenster geschlossen, beendet sich der Dienst nach kurzer Zeit von selbst
(oder sofort: Einstellungen → „App beenden“). Die App funktioniert **ohne Internet** – nur Synchronisierung,
Links und die optionale KI brauchen eine Verbindung.

## Wo liegen die Daten?
`%APPDATA%\Petras Rezepte App` – Datenbank `rezepte.db`, Sicherungen in `backups\`, Protokoll in `logs\`
(ohne Rezeptinhalte, ohne Passwörter). Die Daten liegen getrennt vom Programm und bleiben bei Updates erhalten.

## Update
Einfach die neue Setup-Datei starten (App vorher schließen). Rezepte, Einstellungen und die Anmeldung bleiben
erhalten. Vor einem Datenbank-Update legt die App automatisch eine Sicherung an
(`backups\sicherung-…-vor-update.db`).

## Deinstallieren
Windows-Einstellungen → Apps → „Petras Rezepte App“ → Deinstallieren. Die Rezepte bleiben erhalten, außer man
bestätigt beim Deinstallieren ausdrücklich das Löschen der Daten. Die Cloud-Daten (Firebase) bleiben in jedem Fall
erhalten.

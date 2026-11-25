# Foto to DXF — Web-App (Stufe 1)

Eine Web-App fürs Handy (iPhone Safari + Android Chrome): aus einem **Foto/Bild** (mit A4‑Blatt als Maßstab)
oder einer **SVG** eine **DXF R12** mit echten Linien und Bögen für Xilog Maestro machen.
**Alles rechnet im Browser auf dem Gerät – nichts wird hochgeladen.**

## Dateien
- `index.html` – die Seite (Oberfläche)
- `app.js` – Bedienung (Kamera/Bild/SVG, Ecken setzen, DXF speichern, QR)
- `geom.js` – rechnerischer Kern (Linien/Bögen einpassen, Verschönern, SVG lesen, DXF schreiben)
- OpenCV.js und die QR‑Bibliothek werden beim ersten Start aus dem Internet geladen (einmalig, danach im Cache).

## Auf GitHub Pages veröffentlichen (mit GitHub Desktop)
1. In GitHub ein Repository namens **FotoToDxf** anlegen (oder in GitHub Desktop „Create repository“).
2. Diese Dateien (`index.html`, `app.js`, `geom.js`, `README.md`) in den Repository‑Ordner kopieren.
3. In GitHub Desktop **Commit** → **Push**.
4. Auf github.com im Repository: **Settings → Pages** → „Branch: main / (root)“ → **Save**.
5. Nach ein paar Minuten ist die App erreichbar unter:
   **https://DEINNAME.github.io/FotoToDxf/**
   (DEINNAME = dein GitHub‑Benutzername)
6. Diese Adresse auf dem Handy öffnen. In Safari/Chrome „Zum Home‑Bildschirm“ hinzufügen – dann startet sie wie eine App.

## So benutzt man sie
- **Kamera / Bild öffnen:** Schablone **zusammen mit einem A4‑Blatt** fotografieren → die **4 Ecken des Blatts**
  antippen → „Entzerren & erkennen“ → Ergebnis prüfen → **DXF speichern**.
- **SVG öffnen:** SVG wählen → wird sofort in Linien/Bögen umgewandelt → **DXF speichern**.
- **Verschönern:** glättet die Konturen und rundet Ecken (Glättung + Eckenradius werden abgefragt).
- **Teilen (QR):** zeigt einen QR‑Code mit der App‑Adresse – zum Weitergeben an Kollegen.

## Stand / geplant
- **Stufe 1 (dieses Paket):** Foto/Bild/SVG → DXF, Verschönern, QR. ✔
- Stufe 2: Kamera direkt in der App, einfachere Bedienung.
- Stufe 3: Live‑„DXF Camera“ (iPhone) – Live‑Kamerabild zeigt nur Kanten, zielen/auslösen → DXF.

Hinweis: Für maßgenaue Teile muss das A4‑Blatt (oder eine Platte mit bekannter Größe) mit im Bild liegen.

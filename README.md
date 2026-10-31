# Carpool Fuel Split

A small phone app (PWA) that records who rides along on each trip and splits the fuel cost fairly at the end of each month.

- **Start screen:** the list of topics, e.g. "Driving to work". Tap one to open it, or create a new one with **+ New topic**: enter a name, the start and destination (both distances are calculated automatically), and the people.
- **Inside a topic** it opens on today. Tap the names of the people who were in the car in the morning and in the evening, and the trip is saved immediately. Use ‹ › or tap the date to fill in past days. Tap the route line (✎) to choose another route or change the km. The **＋** button adds a person you forgot.
- **Fuel:** record each refuel (date, litres, price per litre).
- **Costs:** the monthly settlement, which is a running estimate during the month, with a share button for WhatsApp etc.
- **Stats:** each person's trips, km and cost for this month and for all time.
- **⚙ Settings** (top right inside a topic): people, routes, tank data and estimated fuel price, rename or delete the topic.
- **Backup & restore** is on the start screen.

All data stays on the phone, in the browser's local storage.

## Publish on GitHub Pages

1. Create a new **public** repository on github.com, for example `carpool`.
2. Upload all files in this folder, keeping the folder structure: on the repository page, choose **Add file → Upload files** and drag the files in.
   Or use git:
   ```bash
   git init && git add . && git commit -m "Carpool app"
   git branch -M main
   git remote add origin https://github.com/<your-user>/carpool.git
   git push -u origin main
   ```
3. In the repository, open **Settings → Pages**. Under *Build and deployment*, pick **Deploy from a branch**, then branch **main**, folder **/ (root)**, and click **Save**.
4. After about a minute, the app is live at `https://<your-user>.github.io/carpool/`.

## Install on Android

1. Open the URL above in **Chrome** on the phone.
2. Tap the **⋮** menu, then **Add to Home screen** (or **Install app**).
3. Start the app from the home screen icon. It runs full screen and also works offline. Only the automatic distance calculation needs internet.

**First steps:** open "Driving to work" (or create your own topic). Add the people in ⚙ Settings, including the driver, and check the tank data (40 L / 550 km) and the estimated fuel price. Then tap the names on the trips screen every day.

**Your data and backups:** everything is saved on the phone immediately (in Chrome's storage for the app's address). Updates only replace the program files; the data stays and is converted automatically if its format changes. Three safety nets, all under **Backup & restore** on the start screen:
- **Automatic cloud backup (recommended):** connect once with a GitHub token that has only the *gist* permission. After that every change is uploaded automatically to a secret gist in your GitHub account, and a backup that failed (e.g. offline) is retried later. On a new phone: connect with the same token, and the app offers to load the backup.
- **Daily copies on the phone:** the app keeps the data from before the first change of each day (last 10 days), e.g. to undo a mistake or a faulty update.
- **Backup file:** Export / Import a JSON file, e.g. via Google Drive.

Don't rename the repository or your GitHub username. The app's address would change, and the data on the phone would only be reachable again through a backup.

**Updates:** after you push changed files, the app loads the new version the next time it is opened with internet. Data on the phone is kept. When files are added or renamed, also increase `CACHE` in `sw.js` (e.g. `carpool-v3`).

## How the cost is calculated

Cost per km = (tank litres ÷ km per tank) × the month's average fuel price. The average is total paid ÷ litres bought that month; until the first refuel of the month, the estimated price from the settings is used. Each trip's cost (km × cost per km) is split equally between everyone in the car, the driver included, and a person's monthly cost is the sum of their shares. Amounts are rounded to cents so that the shares add up exactly to the total.

*Example:* at 1.65 €/L and 40 L/550 km, one km costs 0.12 €. The morning trip (33.3 km, Anna + Ben + Clara) costs 4.00 €, or 1.33 € each. The evening trip (33.0 km, Anna + Ben) costs 3.96 €, or 1.98 € each. So Anna and Ben pay about 3.31 € each and Clara 1.33 €, for a total of 7.96 €.

## Distance calculation

When you tap **Calculate distance automatically**, the two addresses are sent to OpenStreetMap's free services: Nominatim (address search) and OSRM (driving route). No account or API key is needed. Both directions are calculated, because the way back can differ. The km can always be corrected by hand, per route or per individual trip.

## Run the tests

```bash
node test/settlement.test.mjs
```

The test settles one month of sample data. It checks that the shares add up exactly to the total, that morning and evening trips have different riders, and that topics stay independent of each other.

## Files

| File | Purpose |
|---|---|
| `index.html`, `css/style.css` | Page and styling |
| `js/app.js` | User interface |
| `js/logic.js` | Cost calculation (pure functions, tested) |
| `js/store.js` | Data model and local storage |
| `js/geo.js` | Automatic distance via OpenStreetMap |
| `js/cloud.js` | Automatic cloud backup to a GitHub gist |
| `sw.js`, `manifest.webmanifest`, `icons/` | Offline support and Android install |

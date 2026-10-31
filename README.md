# Carpool Fuel Split

A small phone app (PWA) that records who rides along on each trip and splits the fuel cost fairly at the end of each month.

- **Trips tab:** for each day, record a morning and an evening trip, each with its own riders. You can also add extra trips.
- **Fuel tab:** record each refuel (date, litres, price per litre).
- **Costs tab:** the monthly settlement. During the month it is a running estimate. There is a share button for WhatsApp etc.
- **Stats tab:** each person's trips, km and cost for this month and for all time.
- **Setup tab:** topics, people, routes (distances are calculated automatically from the addresses), and backup export/import.

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

**First steps:** go to **Setup**. Add the people (including the driver), check the tank data (40 L / 550 km) and the estimated fuel price, and check the preset route. Then record trips on the **Trips** tab every day.

**Backups:** the data lives only on this phone. Use **Setup → Export** regularly and save the file, for example to Google Drive. **Import** restores it, also on a new phone.

**Updates:** after you upload changed files, the app picks up the new version the next time it is opened, possibly one start later. If you change files, also increase `CACHE` in `sw.js` (e.g. `carpool-v2`) so the old cache is cleaned up.

## How the cost is calculated

Cost per km = (tank litres ÷ km per tank) × the month's average fuel price. The average is total paid ÷ litres bought that month; until the first refuel of the month, the estimated price from Setup is used. Each trip's cost (km × cost per km) is split equally between everyone in the car, the driver included, and a person's monthly cost is the sum of their shares. Amounts are rounded to cents so that the shares add up exactly to the total.

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
| `sw.js`, `manifest.webmanifest`, `icons/` | Offline support and Android install |

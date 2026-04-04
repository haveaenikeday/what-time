# WhatTime

<div align="center">
  <img src="./resources/WhatTime.png" alt="WhatTime Logo" width="128" height="128" />
</div>

Schedule WhatsApp messages from your Mac with a simple local desktop app.

## App Preview

![Dashboard preview](./docs/images/dashboard.png)
*Dashboard: see upcoming messages, pause schedules, and make quick edits from one list.*

![New schedule preview](./docs/images/new-schedule.png)
*Create a new message with one-time or recurring timing in a single flow.*

![Calendar preview](./docs/images/calendar.png)
*Calendar: scan your scheduled sends by date before they go out.*

![Settings preview](./docs/images/settings.png)
*Settings: check permissions, keep the app running at login, and tune sending behavior.*

## Features

- Schedule one-time or recurring WhatsApp messages from a Mac app that keeps everything local.
- Choose from one-time, daily, weekly, quarterly, half-yearly, and yearly schedules.
- Manage schedules from the main list with search, sorting, pause/resume, edit, duplicate, delete, and test send actions.
- View upcoming sends on a calendar so it is easy to spot what is planned.
- Review sent, failed, skipped, and dry-run activity in the Activity tab.
- Use dry run per schedule or for the whole app to open WhatsApp without pressing Enter.
- Search your macOS Contacts while creating a contact-based schedule.
- Keep WhatTime running in the menu bar after you close the window, and optionally launch it at login.
- Adjust appearance, send delay, retry count, and app behavior from Settings.
- Optionally enable WhatsApp group scheduling in Settings. It is currently marked experimental in the app and is less reliable than contact scheduling.

## Install

If you already have a packaged build of WhatTime, install it like a normal Mac app:

1. Open the `WhatTime` DMG or app bundle you were given.
2. Drag `WhatTime.app` to `/Applications` if you are installing from a DMG.
3. Launch WhatTime and make sure WhatsApp Desktop is installed and already signed in.
4. In **System Settings > Privacy & Security > Accessibility**, allow WhatTime so it can send live messages with Enter.
5. Optional: allow **Contacts** access if you want contact search while creating schedules.
6. Create your first schedule, then close the window when you are done. WhatTime keeps running in the menu bar so enabled schedules can continue.

Notes:

- Live sending needs an unlocked Mac and WhatsApp Desktop running.
- Closing the window does not quit the app. Use the menu bar icon when you want to fully quit.
- This repo does not currently publish a public release page, so packaged builds need to be shared separately.

## Developer Setup

Requirements:

- macOS
- Node.js 18+
- WhatsApp Desktop installed and signed in

Clone the repo, or download it as a ZIP and open the folder locally.

Local setup:

```bash
git clone https://github.com/virajparmaj/what-time.git
cd what-time
npm install
npm run rebuild
npm run dev
```

Test:

```bash
npm run test
```

Build:

```bash
npm run build
npm run dist:dmg
```

Developer notes:

- `better-sqlite3` is a native dependency, so `npm run rebuild` is required after Electron or native dependency changes.
- Core app behavior does not require a `.env` file.
- Accessibility permission is required for live sends. Contacts permission is optional and only used for contact search.
- The current packaging config produces a macOS DMG for Apple Silicon in `dist/`.

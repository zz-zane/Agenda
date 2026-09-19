<div align="center">

# Agenda

### A local calendar for your days, studies, and small moments.

**English** | [简体中文](README.zh-CN.md)

[Download v3.1.1](https://github.com/zz-zane/Agenda/releases/tag/v3.1.1) · [MIT License](LICENSE)

</div>

Agenda is a Windows desktop calendar with frosted glass themes, editable schedules, photo check-ins, and AI-assisted study planning. Your records stay on your computer. AI is optional and uses the model provider you configure.

## What you can do

| Feature | Details |
| --- | --- |
| Calendar | Browse month, week, and day views. Click an empty time slot in Week or Day to add an event. Past events are read only. |
| Overview & completion | Open **Overview** for a compact weekly/monthly heatmap, check-in streak and rate, plus course/goal progress across all scheduled sessions including future dates. Check off today's tasks in Today, date details, or the Week/Day schedule; no photo is required. Completed tasks stay checked and read only. |
| Diary | An open paper book on glass, with the day’s completed tasks, stacked photo prints that cycle on click, and locally autosaved writing. Previous dates are read only. |
| Automatic updates | From 3.1.1, Settings can check the public `zz-zane/Agenda` releases, download verified updates, and install on exit. Older clients need one manual upgrade. See [publishing instructions](docs/自动更新发布.md). |
| Timetable import | Import `.xlsx` schedules, with duplicate handling and an AI-assisted import workflow. |
| Photo check-ins | Complete at least one task today and upload a photo to check in automatically, in either order. No separate check-in button. Today shows 😊 when checked in and 😢 otherwise; past and future dates have no face. No backdated check-ins. |
| AI planning | Chat about your schedule, edit classes, and preview study plans before confirming changes. Rescheduling preserves the remaining syllabus and deadline; extensions require your explicit request and confirmation. |
| Learning profile | Generate a profile from recorded facts and activity. Estimates are labeled as uncalibrated; insufficient observations do not produce numerical probabilities. |
| Model settings | Add, edit, and switch saved model configurations. Each model's API key is encrypted separately on Windows. |
| Cat reminders | Add date reminders from Month, timed reminders from empty Day slots, or ask the cat through voice using the configured AI model. Date reminders appear when opening that day; timed reminders appear when due or on a later opening that day. Delivered reminders do not repeat. Agenda must be running; closing it stops the timer. |
| Display options | Light or dark frosted glass, subtle falling stars in dark mode, collapsible navigation, and animated page transitions. |
| Language & intro | Switch the interface between English and Simplified Chinese. An optional short intro shows **KEEP GOING** without a progress bar, then opens the calendar. Preferences persist across restarts. |

## New in v3.1

- **Desktop cat:** enable it in Settings. Single-click opens a separate Today window with task times, daily photo uploads and check-in; double-click opens AI. Light and dark themes follow Agenda.
- **Voice assistant:** optional local wake-word recognition, speech recognition and speech playback. AI replies appear in a speech bubble beside the cat. Recognized text uses your configured model.
- **Restricted desktop access:** disabled by default. Allow individual apps to launch and explicitly select code files for review. Original files stay unchanged; corrected code is saved as a new file. Arbitrary commands and code execution are not supported.
- **Longer conversations:** background summaries run at startup and incrementally during chat, using the configured provider. Original messages are retained; summarization consumes API usage and keeps the last valid summary on failure.
- **Scheduling:** reusable scheduling rules cover daily durations, weekly frequency, continuous exercise sessions and course-dependent study blocks, with preview and confirmation before writing.

## Install on Windows

1. Open the [v3.1.1 release](https://github.com/zz-zane/Agenda/releases/tag/v3.1.1).
2. Download **Agenda-Setup-3.1.1-x64.exe**, install it, and launch Agenda from the desktop or Start menu.
3. Use the calendar immediately. To enable AI, open **Settings → Model settings** and enter your provider URL, model ID, and API key.

The installer includes the backend and AI runtime; Python and Node.js are not required on the user's computer. It is currently **unsigned**. SHA-256 checksums are included with the release.

Agenda runs as a single desktop instance with a private local port. Closing the app stops its backend. Drag the top bar to move the window; use maximize/restore to change its size. Dragging window edges to resize is not currently supported.

## Choose a model

- **DeepSeek**: the built-in provider preset.
- **OpenAI / GPT**: models supporting Chat Completions and tool calling.
- **Claude**: through Anthropic's OpenAI compatibility endpoint, within that endpoint's supported features.
- **Other compatible providers**: supply a compatible API URL and model ID.

Use an API key issued by the selected provider. Saving a configuration does not test connectivity or confirm account access. AI needs an internet connection; the calendar and local records do not.

## Your data and privacy

| Data | Windows desktop location |
| --- | --- |
| Calendar, photos, chats, imported files, and profiles | `%LOCALAPPDATA%\Agenda\data` |
| Authorized apps | `%LOCALAPPDATA%\Agenda\desktop-access.json` |
| Corrected code copies | `%LOCALAPPDATA%\Agenda\Code reviews` |
| Window cache and display/language preferences | `%LOCALAPPDATA%\Agenda\window` |

A fresh installation contains no user or development data. Upgrading, reinstalling, and uninstalling preserve the data directory. To back up records, close Agenda and copy the entire data directory.

API keys use Windows DPAPI encryption for the current account. New model keys are stored separately under `data/model-keys/`; older `data/ai-key.dpapi` files remain compatible. Keys are not stored in SQLite, and encrypted key backups should not be treated as portable credentials.

**When you use AI, relevant chat, schedule, learning-profile context and explicitly selected code for review are sent to your chosen provider. Photo files are not sent.** Interface language changes do not translate your saved records or model replies; backend error messages retain their original language.

Never commit your data directory, API keys, or environment files. Release source snapshots and installers exclude personal data and internal development records.

## Run from source

Use Windows with Python 3.10+ and Node.js 22+. Download the release source or clone this repository, then run these commands from its root:

```powershell
py -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
scripts\install-ai.bat
scripts\run-local.bat
```

Keep the terminal open and visit **http://127.0.0.1:8765**. Source mode stores records in the project's `data/` directory. The service listens locally; this repository does not host a public website.

For direct timetable import, a supported `.xlsx` layout uses a sheet named `日程明细`, with the columns `日期`, `课程`, and `时间` and a time range such as `09:00-10:00`.

## Build the Windows installer

Prepare the local voice model inputs described in [agenda_pet/README.md](agenda_pet/README.md); model weights are excluded from the source snapshot. Use a clean Python virtual environment on Windows, with Node/npm available:

```powershell
.venv\Scripts\python.exe -m pip install -r desktop/requirements-build.txt
.venv\Scripts\python.exe scripts/build-windows.py
```

Artifacts are written to `dist/windows/`. Building requires network access to install locked dependencies. The app reuses its HTML/CSS/JavaScript frontend and Python business logic, packaged with **Electron**, **PyInstaller**, and the official **DeepSeek Harness** runtime. The build includes only the DSH modules it uses and retains third-party licenses.

## Checks and current limits

```powershell
.venv\Scripts\python.exe -m unittest discover -s tests
node frontend/calendar.test.mjs
```

Desktop checks are available in `scripts/check-desktop-window.mjs` (`--preferences` covers language, short intros, and check-in faces) and `scripts/check-windows.py` (bundled runtime with a local HTTPS mock).

v3.1 passed local Windows checks for the backend, model settings, data persistence, themes, languages, short intros, and check-ins. These checks use isolated data and simulated providers; they do not establish real-provider planning quality or installation acceptance on a fresh Windows device.

The normal window uses a frosted glass visual treatment; it does not blur the desktop behind it. Supported Windows 11 systems use Acrylic when maximized. Mobile, macOS, and Linux desktop installers are not provided.

## License and acknowledgments

Agenda is released under the [MIT License](LICENSE). Reused Swarm licensing is retained in [LICENSE-Swarm-MIT.txt](LICENSE-Swarm-MIT.txt). Third-party dependencies retain their own licenses; the official DSH dependency and lockfile are in [`dsh/`](dsh/).

# Discovery & FSD Deviation Agent (Prototype)

This is a lightweight React (Vite) prototype that compares requirements or FSD text against a baseline (SFRA OOTB) and generates a deviation report with estimation signals.

## Features
- Baseline vs Current deviation analysis (New / Modified / Removed)
- Previous vs Current comparison for change tracking
- Impact rationale + estimation points
- Auto FSD draft (Markdown)
- Snapshot history stored in localStorage
- JSON/Markdown export

## Getting Started
```bash
npm install
npm run dev
```

## Build
```bash
npm run build
npm run preview
```

## Project Structure
- `index.html` Vite entry
- `src/main.jsx` React bootstrap
- `src/App.jsx` UI + logic
- `src/styles.css` app styles

## Notes
- This is a prototype; keyword matching and impact scoring are simple by design.
- Adjust estimation weights in the UI to reflect your team’s sizing model.

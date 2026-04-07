# Gemma 3n Endocrinology Scribe

A static web app for Chrome that records or uploads audio, transcribes it locally with Gemma 3n E2B, and generates a SOAP note entirely in the browser.

## What this app does

- Runs locally in Chrome with WebGPU
- Accepts microphone recordings or uploaded audio files
- Uses the MediaPipe Web LLM Inference API with a web-converted Gemma 3n E2B model
- Generates:
  - a cleaned transcript
  - a structured SOAP note
- Can be hosted as static files on GitHub Pages

## Files

- `index.html` - app shell
- `styles.css` - UI styling
- `app.js` - all recording, model loading, prompting, and note generation logic
- `coi-serviceworker.js` - enables cross-origin isolation on static hosting

## Recommended demo setup

For the most reliable live presentation demo:

1. Open the app in Chrome.
2. Load the model from a **local file** instead of over the network.
3. Record a short clip or upload a short audio file.
4. Click **Transcribe + SOAP**.

This avoids conference Wi‑Fi issues and avoids problems caused by fetching a multi‑GB model over a network.

## Using a hosted model URL

You can initialize the model from a public URL that points directly to:

`gemma-3n-E2B-it-int4-Web.litertlm`

Example pattern:

`https://your-host.example.com/path/gemma-3n-E2B-it-int4-Web.litertlm`

If you host the model on Hugging Face, make sure the URL is browser-fetchable and CORS-friendly. The official Google repository is gated, so for a browser demo you typically need a hosting path you control.

## GitHub Pages deployment

1. Create a repository.
2. Upload all files in this folder.
3. Enable GitHub Pages from the repository settings.
4. Open the deployed site once, allow it to reload after the service worker registers, and then use the app.

## Requirements

- Chrome with WebGPU support
- A machine with enough RAM/VRAM for Gemma 3n E2B Web
- Cross-origin isolation enabled by the included service worker

## Notes

- The app intentionally uses a strict prompt to avoid fabricated findings.
- Review all model output before any real clinical use.
- This project is a demo, not a medical device.

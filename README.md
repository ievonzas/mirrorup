# Mirror Up

Live view and remote control for a Nikon D7100 (or any camera gphoto2 knows) from an Android phone, over a USB OTG cable. No WiFi, no app store, no paywall. It is a web page that talks to the camera with WebUSB.

## What it does

- Live view on the phone, with a rule of thirds grid and focus peaking
- Tap the picture to move the focus point and autofocus there
- AF button and manual focus steps (‹ › small, « » big)
- Shutter speed, aperture, ISO, exposure compensation, white balance, focus mode, image quality
- Take a photo, review it, save or share it from the phone
- ⚙ lists every setting the camera exposes
- Works with no signal once it has been opened once

## Using it

1. Host the folder on any HTTPS address (GitHub Pages is fine, see below). WebUSB does not work over plain http.
2. On the phone, open the address in **Chrome**. The first visit reloads itself once. Add it to the home screen from Chrome's menu if you want it full screen.
3. Camera on, cable in. If Android pops up "open with…", dismiss it.
4. Tap **Connect camera** and pick the D7100.

The exposure mode (M / A / S / P) is the dial on the camera. The lens switch has to be on A or M/A for autofocus and for the focus step buttons.

### GitHub Pages

```sh
git init && git add . && git commit -m "Mirror Up"
gh repo create mirrorup --public --source=. --push
gh api -X POST repos/{owner}/mirrorup/pages -f 'source[branch]=main' -f 'source[path]=/'
```

## Things to check on the first real test

Nothing here has been run against a real camera yet, only against a fake one. The two guesses most likely to need a tweak are both in ⚙ → This app:

- **Tap to focus coordinate space**, default `6000x4000`. If the focus box on the camera lands somewhere other than where you tapped, this is the number to change. If it always lands at a proportionally smaller spot, try `640x424`.
- **Focus step sizes**, default 50 and 400. How far a step moves depends on the lens.

Tap to focus needs the camera's live view AF-area mode on normal or wide area, not face priority or subject tracking.

By default the camera keeps photos in its own memory and hands them to the phone. To also keep them on the SD card, set ⚙ → Capture Settings → **Capture Target** to `Memory card`.

## How it works

- `vendor/web-gphoto2/` is [web-gphoto2](https://github.com/GoogleChromeLabs/web-gphoto2) 0.4.1: libgphoto2 and libusb compiled to WebAssembly, with libusb talking to WebUSB. LGPL-2.1, licence included. The files are unmodified.
- `camera.js` wraps it and queues every call, because the camera does one thing at a time.
- `app.js` is the UI. One loop pulls preview frames and checks every 1.5 s whether a dial was turned on the camera.
- `icons/make_icons.py` holds the pixel art as text and writes the SVG and PNG files. Fonts are Pixelify Sans and Press Start 2P (both OFL, licences in `fonts/`), self-hosted so they work offline and under cross-origin isolation.
- `sw.js` caches the app and adds the `Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy` headers. The WebAssembly build needs `SharedArrayBuffer`, Chrome only allows that on cross-origin isolated pages, and GitHub Pages cannot send the headers itself.

Focus, live view on/off and the rest are all gphoto2 config names (`autofocusdrive`, `manualfocusdrive`, `changeafarea`, `viewfinder`, …), so the [gphoto2 docs](http://www.gphoto.org/doc/remote/) apply.

## Local development

```sh
python3 -m http.server 8000   # localhost counts as secure, so WebUSB works in desktop Chrome
```

On desktop Linux the kernel or gvfs usually grabs the camera first; unmount it in the file manager before connecting.

## Ideas for later

Intervalometer, bracketing, focus stacking with the step buttons, histogram, video record button.

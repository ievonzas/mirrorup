# Mirror Up

**by Unfortunate Name Studios**

Live view and remote control for a Nikon DSLR from an Android phone, over a USB OTG cable. No WiFi, no account, no paywall. It is a web page that talks to the camera with WebUSB, and it can be added to the home screen like an app.

## Which cameras

**Tested:** Nikon D7100.

**Should work:** any Nikon DSLR or Z mirrorless that has live view over USB. That is roughly the D90 / D300 / D3 generation (2008) and everything after it:

- D3100, D3200, D3300, D3400, D3500
- D5000, D5100, D5200, D5300, D5500, D5600
- D90, D7000, D7100, D7200, D7500
- D300, D300S, D500, D600, D610, D700, D750, D780
- D800, D800E, D810, D850, Df
- D3, D3S, D3X, D4, D4S, D5, D6
- Z 5, Z 6, Z 6II, Z 7, Z 7II, Z 8, Z 9, Z 30, Z 50, Z fc, Z f

The very newest bodies depend on the bundled gphoto2 build knowing about them. If one of these gives you trouble, please say which.

**Will not work:** Nikon bodies without live view (D40, D50, D60, D70, D80, D200, D2 series), Coolpix compacts, and anything connected over WiFi or Bluetooth. The cable is the whole point.

**Other brands:** the exposure chips, the settings list, the shutter button and photo review ride on plain gphoto2, so a Canon EOS, Sony, Fujifilm, Panasonic or Olympus body that gphoto2 can tether may partly work. Tap to focus and the focus step buttons send Nikon commands and will not do anything on them. None of this is tested.

## What you need

- An Android phone or tablet with **Chrome**. Firefox and Safari have no WebUSB.
- A **USB OTG** adapter or cable for the phone, plus the camera's own USB cable.
- iPhone and iPad: not possible, iOS has no WebUSB.
- A computer with Chrome works too (handy for testing). On Linux, unmount the camera in the file manager first. On Windows, the stock camera driver blocks WebUSB.

## How to use it

1. Open the app in Chrome. The first visit reloads itself once; that is normal. Add it to the home screen from Chrome's menu for full screen.
2. Turn the camera on and plug it into the phone with the OTG cable. If Android asks which app to open, dismiss that.
3. Tap **Connect camera** and pick the camera from the list.
4. Live view appears. Tap anywhere on the picture to move the focus point and autofocus there.
5. Tap the heart to take a photo. The thumbnail at the bottom right opens it for saving or sharing.

| Control | What it does |
| --- | --- |
| Chips under the picture | Shutter, aperture, ISO, EV, white balance, focus mode, quality. Tap one, pick a value. |
| « ‹ AF › » | Manual focus steps nearer and farther, small and big. AF runs autofocus at the current point. |
| Heart | Take a photo. Autofocuses first unless you turn that off in Menu → This app. |
| Grid | Rule of thirds. |
| Peak | Focus peaking: sharp edges light up pink. |
| Live | Pause live view to rest the sensor and battery. Tap again to resume. |
| Menu | Every setting the camera exposes, plus the app's own settings and Disconnect. |

Things set on the camera body:

- The exposure mode (M, A, S, P) is the dial on the camera, shown as a badge at the top.
- The lens switch has to be on A or M/A for autofocus and for the focus step buttons.
- Tap to focus needs the camera's live view AF-area mode on normal or wide area, not face priority or subject tracking.
- By default the camera keeps each photo in its own memory and hands it to the phone. To also keep it on the SD card, set Menu → Capture Settings → **Capture Target** to Memory card.

If the focus box on the camera lands somewhere other than where you tapped, change **Tap to focus coordinate space** in Menu → This app (try `640x424`). How far a focus step moves depends on the lens; the step sizes live in the same place.

## Putting it in an app store

It is a progressive web app, so the route to **Google Play** is a Trusted Web Activity: wrap the hosted URL with [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap) or [PWABuilder](https://www.pwabuilder.com/) and publish an `assetlinks.json` at the root of the same host (for GitHub Pages that is the `ievonzas.github.io` repo, not this one). WebUSB works inside a TWA because it is Chrome underneath.

The pieces a store listing asks for are already here: `privacy.html` is the privacy policy (the app collects nothing), the manifest carries store screenshots from `screenshots/`, and Menu → This app → Licences & privacy links the LGPL and font licences from inside the app, which the LGPL asks for when the library ships in an app.

The **Apple App Store** is out: iOS has no WebUSB, so the app cannot reach the camera there.

Store blurb, if useful:

> Mirror Up turns your Android phone into a live view screen and remote for your Nikon DSLR. Plug in a USB OTG cable, tap to focus, set shutter, aperture and ISO, and shoot. Photos land on the phone ready to share. Works offline, needs no account. Tested with the Nikon D7100, should work with any Nikon with live view. By Unfortunate Name Studios.

## Hosting it yourself

The folder is static. Put it on any HTTPS address; WebUSB does not work over plain http. GitHub Pages is fine:

```sh
gh repo create mirrorup --public --source=. --push
gh api -X POST repos/{owner}/mirrorup/pages -f 'source[branch]=main' -f 'source[path]=/'
```

For local work:

```sh
python3 -m http.server 8000   # localhost counts as secure, so WebUSB works in desktop Chrome
```

## How it works

- `vendor/web-gphoto2/` is [web-gphoto2](https://github.com/GoogleChromeLabs/web-gphoto2) 0.4.1: libgphoto2 and libusb compiled to WebAssembly, with libusb talking to WebUSB. LGPL-2.1, licence included, files unmodified.
- `camera.js` wraps it and queues every call, because the camera does one thing at a time.
- `app.js` is the UI. One loop pulls preview frames and checks every 1.5 s whether a dial was turned on the camera.
- `sw.js` caches the app so it opens with no signal, and adds the `Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy` headers. The WebAssembly build needs `SharedArrayBuffer`, Chrome only allows that on cross-origin isolated pages, and GitHub Pages cannot send the headers itself. That is why the first visit reloads once.
- `icons/make_icons.py` holds the pixel art as text and writes the SVG and PNG files. Fonts are Pixelify Sans and Press Start 2P (both OFL, licences in `fonts/`), self-hosted so they work offline and under cross-origin isolation.

Focus, live view on and off and the rest are all gphoto2 config names (`autofocusdrive`, `manualfocusdrive`, `changeafarea`, `viewfinder`, …), so the [gphoto2 docs](http://www.gphoto.org/doc/remote/) apply.

## Ideas for later

Intervalometer, bracketing, focus stacking with the step buttons, histogram, video record button.

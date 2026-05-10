# Eskerra: Platform Targets

This document records product and engineering decisions about which platforms Eskerra supports and which are explicitly out of scope. It exists so future work does not spend effort on targets we will not ship.

## Mobile: Android only

- The mobile app targets **Android** as the sole mobile platform.
- Implementation, testing, and release planning assume Android-first tooling and APIs (for example, Android Storage Access Framework where relevant).

## iOS / iPhone: out of scope permanently

- **iPhone and iPad are not supported** and are **not** a future goal.
- There is **no** plan to add iOS, to prioritize iOS parity, or to sort or rank work with iOS in mind.
- Do not propose iOS-specific builds, App Store work, or cross-platform abstractions whose main justification is eventual iOS support.

## Desktop companion: Linux (Fedora / GNOME)

- A **desktop companion app** ships as **Tauri** in this repository under `apps/desktop/`, sharing vault semantics and TypeScript core with Android.
- The **primary** engineering and manual testing target is **Linux** (**Fedora Workstation**, **GNOME**). Builds may work on other OSes when upstream Tauri/tooling allows it; product commitments stay Linux-first.
- OS media integration on Linux uses **MPRIS** as exposed by **WebKitGTK** from **`navigator.mediaSession`** (metadata, playback state, and **play** / **pause** actions), so GNOME shell and hardware media keys control the same session as the in-app **HTMLAudioElement**.

## Shipping artifacts: Android + Fedora RPM

- **Mobile:** ship **Android** builds (APK / Play track) per [`apps/mobile`](../../apps/mobile); iOS is not a target (see above).
- **Desktop:** ship **RPM packages for Fedora** (and RPM-based derivatives that accept the same package). **Debian packages (.deb), AppImage, and other Linux bundle formats are not product commitments** for this project; the Tauri Linux bundle config limits targets to **rpm** only in [`apps/desktop/src-tauri/tauri.linux.conf.json`](../../apps/desktop/src-tauri/tauri.linux.conf.json).

## Summary

| Platform              | Status                                      |
| --------------------- | ------------------------------------------- |
| Android (mobile)      | In scope — current focus                    |
| iOS / iPhone / iPad   | Out of scope permanently — do not pursue    |
| Desktop Linux (Fedora / GNOME) | In scope — companion app (vault + notes + playback MVP); Linux-first |
| Desktop Linux packages | **RPM only** (Fedora); not .deb / AppImage as shipping targets |

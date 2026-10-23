# GoodNight

GoodNight is a local tool for UESTC's “Good Night Chengdian” check-in. The Windows app provides a local dashboard; the Android app runs independently. Users sign in to the school portal, configure a time window and GCJ-02 coordinates, and review the result saved by the school. The school record is authoritative.

See the [Chinese README](README.md) for setup, the [Windows guide](docs/pc.md), [web guide](docs/web.md), [Android guide](docs/android.md), and this project's [disclaimer](DISCLAIMER.md).

The desktop map interaction was informed by [GoGoGo](https://github.com/ZCShou/GoGoGo); its Android mock-location code is not included. GoodNight is not affiliated with UESTC or map providers. Use only accounts you are authorized to operate and follow school rules. Automatic runs can fail or be delayed by authentication, network, power management, or changes to the school service.

The repository contains source code. Build outputs in `dist/` are ignored by Git and should be attached separately to GitHub Releases.

See the [documentation index](docs/index.md), [FAQ](docs/faq.md), and [release guide](docs/releases.md). APK updates require a compatible signing certificate. Android 0.6.6 is a preview build; consult the matching Release for available assets and validation limits.

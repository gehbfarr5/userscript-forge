#!/usr/bin/env bash
set -euo pipefail

ADB_BIN="${ADB_BIN:-adb}"
SERIAL=""
URL=""
PACKAGE="org.mozilla.firefox"
TARGET=""
EXPECTED_SERIAL=""

die() { printf 'open-firefox-url: %s\n' "$*" >&2; exit 1; }

while (($#)); do
  case "$1" in
    --serial) (($# >= 2)) || die "--serial 需要设备序列号。"; SERIAL="$2"; shift 2 ;;
    --url) (($# >= 2)) || die "--url 需要 URL。"; URL="$2"; shift 2 ;;
    --package) (($# >= 2)) || die "--package 需要浏览器包名。"; PACKAGE="$2"; shift 2 ;;
    --target) (($# >= 2)) || die "--target 需要 emulator 或 real。"; TARGET="$2"; shift 2 ;;
    --expected-serial) (($# >= 2)) || die "--expected-serial 需要真实设备序列号。"; EXPECTED_SERIAL="$2"; shift 2 ;;
    -h|--help)
      printf '%s\n' "用法: $0 --serial SERIAL --url URL --target emulator|real [--expected-serial SERIAL] [--package PACKAGE]"
      exit 0
      ;;
    *) die "未知参数 '$1'。" ;;
  esac
done

command -v "$ADB_BIN" >/dev/null 2>&1 || die "找不到 adb。"
[[ -n "$SERIAL" ]] || die "必须显式提供 --serial；脚本不会猜设备。"
[[ -n "$URL" ]] || die "必须提供 --url。"
[[ "$URL" =~ ^https?:// ]] || die "只允许 http(s) URL。"
[[ "$TARGET" == "emulator" || "$TARGET" == "real" ]] || die "--target 必须是 emulator 或 real。"

if [[ "$TARGET" == "emulator" ]]; then
  [[ "$SERIAL" == emulator-* ]] || die "emulator 目标只接受 emulator-* 序列号。"
else
  [[ "$SERIAL" != emulator-* ]] || die "real 目标拒绝 emulator-* 序列号。"
  [[ -n "$EXPECTED_SERIAL" ]] || die "real 目标必须提供 --expected-serial。"
fi

state="$("$ADB_BIN" -s "$SERIAL" get-state 2>/dev/null | tr -d '\r')"
[[ "$state" == "device" ]] || die "目标设备 '$SERIAL' 当前状态不是 device（实际为 '$state'）。"

if [[ "$TARGET" == "real" ]]; then
  # --serial is an ADB transport (USB serial, Wi-Fi host:port, or mDNS
  # endpoint); --expected-serial is the immutable device identity returned by
  # ro.serialno.  They are intentionally allowed to differ for Wi-Fi ADB.
  reported_serial="$("$ADB_BIN" -s "$SERIAL" shell getprop ro.serialno 2>/dev/null | tr -d '\r' | tail -n 1)"
  [[ "$reported_serial" == "$EXPECTED_SERIAL" ]] || die "设备 ro.serialno '$reported_serial' 与 --expected-serial 不一致。"
fi

# `adb shell` executes a remote shell command.  Passing URL and package as
# separate argv entries does not preserve host-side quoting, so a query-string
# ampersand would otherwise become the remote shell's command separator.  Bash
# `%q` produces an escaped token that remains one argument on Android's shell.
printf -v remote_url '%q' "$URL"
printf -v remote_package '%q' "$PACKAGE"
"$ADB_BIN" -s "$SERIAL" shell am start \
  -a android.intent.action.VIEW \
  -c android.intent.category.BROWSABLE \
  -d "$remote_url" \
  -p "$remote_package" >/dev/null

printf 'Opened URL in %s on %s: %s\n' "$PACKAGE" "$SERIAL" "$URL"

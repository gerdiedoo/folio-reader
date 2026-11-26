#!/usr/bin/env bash
set -euo pipefail
: "${ANDROID_HOME:?Android SDK is required}"
: "${RUNNER_TEMP:?Disposable runner directory is required}"
export ANDROID_AVD_HOME="$RUNNER_TEMP/folio-avd"
mkdir -p "$ANDROID_AVD_HOME"
export PATH="$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
setup_log="$RUNNER_TEMP/folio-emulator-setup.log"
emulator_log="$RUNNER_TEMP/folio-emulator.log"
report_failure() {
  local status=$?
  if [ "$status" -ne 0 ]; then
    node - "$setup_log" "$emulator_log" <<'JS'
const fs=require('node:fs');
const lines=process.argv.slice(2).filter(file=>fs.existsSync(file)).flatMap(file=>fs.readFileSync(file,'utf8').split(/[\r\n]+/));
const errors=lines.filter(line=>/error|warning|exception|no space|not found|failed|killed|fatal|insufficient|cannot|virtual device|timed out/i.test(line));
const details=[...errors.slice(-12).reverse(),...lines.filter(line=>line.trim()&&!/^\s*\[/.test(line)).slice(-15)].join('\n').slice(0,3500);
const escaped=details.replace(/%/g,'%25').replace(/\r/g,'%0D').replace(/\n/g,'%0A');
console.log(`::error title=Android emulator setup failed::${escaped || 'Emulator setup failed before creating a log.'}`);
JS
  fi
}
trap report_failure EXIT
if [ ! -e /dev/kvm ]; then
  echo '::error::Hardware acceleration is required for the Android smoke test.'
  exit 1
fi
sudo chmod a+rw /dev/kvm
echo "$ANDROID_HOME/emulator" >> "$GITHUB_PATH"
echo "$ANDROID_HOME/platform-tools" >> "$GITHUB_PATH"
timeout 480s sdkmanager 'emulator' 'platform-tools' 'system-images;android-36;google_apis;x86_64' > "$setup_log" 2>&1
echo no | avdmanager create avd --force --name folio-smoke --package 'system-images;android-36;google_apis;x86_64' --device pixel_6 --path "$ANDROID_AVD_HOME/folio-smoke.avd" >> "$setup_log" 2>&1
test -s "$ANDROID_AVD_HOME/folio-smoke.avd/config.ini"
# New SDK tools and emulator releases may use different default user folders.
# Give the emulator an explicit index to the device just created above.
printf 'avd.ini.encoding=UTF-8\npath=%s\ntarget=android-36\n' "$ANDROID_AVD_HOME/folio-smoke.avd" > "$ANDROID_AVD_HOME/folio-smoke.ini"
emulator -avd folio-smoke -no-window -no-audio -no-boot-anim -no-snapshot -gpu swiftshader -memory 2048 > "$emulator_log" 2>&1 &
emulator_pid=$!
boot_deadline=$((SECONDS+240))
booted=false
while [ "$SECONDS" -lt "$boot_deadline" ]; do
  if ! kill -0 "$emulator_pid" 2>/dev/null; then
    echo 'Virtual device exited during startup.' >> "$emulator_log"
    exit 1
  fi
  if [ "$(timeout 5s adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ]; then booted=true; break; fi
  sleep 2
done
if [ "$booted" != true ]; then
  echo 'Virtual device did not finish booting within four minutes.' >> "$emulator_log"
  exit 1
fi
adb shell input keyevent 82
# Exercise the on-screen keyboard used on phones, including its input-service handoff.
adb shell settings put secure show_ime_with_hard_keyboard 1
adb shell settings put global window_animation_scale 0
adb shell settings put global transition_animation_scale 0
adb shell settings put global animator_duration_scale 0
timeout 120s adb install "${FOLIO_ANDROID_APK:-$RUNNER_TEMP/folio-dev.apk}" >> "$setup_log" 2>&1

#!/usr/bin/env bash
set -euo pipefail
: "${ANDROID_HOME:?Android SDK is required}"
: "${RUNNER_TEMP:?Disposable runner directory is required}"
export PATH="$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
setup_log="$RUNNER_TEMP/folio-emulator-setup.log"
emulator_log="$RUNNER_TEMP/folio-emulator.log"
report_failure() {
  local status=$?
  if [ "$status" -ne 0 ]; then
    node - "$setup_log" "$emulator_log" <<'JS'
const fs=require('node:fs');
const details=process.argv.slice(2).filter(file=>fs.existsSync(file)).map(file=>fs.readFileSync(file,'utf8').slice(-8000)).join('\n');
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
echo no | avdmanager create avd --force --name folio-smoke --package 'system-images;android-36;google_apis;x86_64' --device pixel_6 >> "$setup_log" 2>&1
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
adb shell settings put global window_animation_scale 0
adb shell settings put global transition_animation_scale 0
adb shell settings put global animator_duration_scale 0
timeout 120s adb install "$RUNNER_TEMP/folio-dev.apk" >> "$setup_log" 2>&1

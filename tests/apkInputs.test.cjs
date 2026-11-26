const assert=require('node:assert/strict');const{test}=require('node:test');
const fs=require('node:fs'),yaml=require('yaml');const{matchesToolchain}=require('../scripts/compare-apk-inputs.cjs');
const workflow=()=>yaml.parse(fs.readFileSync(require('node:path').resolve(__dirname,'../.github/workflows/build-folio-dev.yml'),'utf8'));
test('APK reuse accepts native-verification-only changes but rejects changed compiler versions, build commands or build environment',()=>{
 const original=workflow(),testOnly=structuredClone(original);testOnly.jobs['android-smoke'].timeout=30;assert.equal(matchesToolchain(original,testOnly),true);
 for(const change of [w=>w.jobs.build.steps.find(s=>s.uses?.startsWith('actions/setup-node@')).with['node-version']='26',w=>w.jobs.build.steps.find(s=>s.name==='Build standalone Android APK on this runner').run+='\necho changed',w=>w.jobs.build.env.EXPO_PUBLIC_APP_VARIANT='production']){const changed=workflow();change(changed);assert.equal(matchesToolchain(original,changed),false);}
 const missing=workflow();missing.jobs.build.steps=missing.jobs.build.steps.filter(s=>!s.uses?.startsWith('actions/setup-java@'));assert.equal(matchesToolchain(original,missing),false);
});

test('main APK reuse compares the production compiler steps independently of the verification harness',()=>{
 const main=()=>yaml.parse(fs.readFileSync(require('node:path').resolve(__dirname,'../.github/workflows/build-folio-main.yml'),'utf8'));
 const previous=main(),checkOnly=structuredClone(previous);checkOnly.jobs['android-smoke']['timeout-minutes']=30;
 assert.equal(matchesToolchain(previous,checkOnly,'main'),true);
 for(const change of [w=>w.jobs.build.env.EXPO_PUBLIC_APP_VARIANT='development',w=>w.jobs.build.steps.find(s=>s.name==='Build signed main APK with the Expo production environment').run+='\necho changed',w=>w.jobs.build.steps.find(s=>s.uses?.startsWith('actions/setup-java@')).with['java-version']='21']){
  const changed=main();change(changed);assert.equal(matchesToolchain(previous,changed,'main'),false);
 }
});
test('a main build cannot reuse development toolchain settings',()=>{
 const main=yaml.parse(fs.readFileSync(require('node:path').resolve(__dirname,'../.github/workflows/build-folio-main.yml'),'utf8'));
 assert.equal(matchesToolchain(workflow(),main,'main'),false);
});

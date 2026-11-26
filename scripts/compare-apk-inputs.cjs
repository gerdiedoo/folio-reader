const {execFileSync}=require('node:child_process');
const fs=require('node:fs');
const yaml=require('yaml');
const BUILD_INPUTS=['App.tsx','index.ts','app.json','app.config.js','eas.json','package.json','package-lock.json','yarn.lock','pnpm-lock.yaml','tsconfig.json','babel.config.js','metro.config.js','react-native.config.js','.easignore','.gitignore','.npmrc','src','assets','plugins','patches','android','ios'];
function toolchain(workflow,kind='dev'){
 const steps=workflow.jobs?.build?.steps;
 if(!Array.isArray(steps))return null;
 const selected=[
  steps.find(s=>s.uses?.startsWith('actions/setup-node@')),
  steps.find(s=>s.uses?.startsWith('expo/expo-github-action@')),
  steps.find(s=>s.uses?.startsWith('actions/setup-java@')),
  ...(kind==='main'?[steps.find(s=>s.name==='Build signed main APK with the Expo production environment')]:[
   steps.find(s=>s.name==='Load the test profile for local EAS config evaluation'),
   steps.find(s=>s.name==='Build standalone Android APK on this runner'),
  ]),
 ];
 if(selected.some(s=>!s))return null;
 return JSON.stringify({environment:workflow.env,jobEnvironment:workflow.jobs.build.env,steps:selected.map(({uses,with:options,env,run})=>({uses,options,env,run}))});
}
function matchesToolchain(previous,current,kind='dev'){const a=toolchain(previous,kind),b=toolchain(current,kind);return a!==null&&b!==null&&a===b;}
module.exports={matchesToolchain};
if(require.main===module){
 let matches=false;
 try{
  const baseline=process.argv[2];if(!/^[a-f0-9]{40}$/i.test(baseline))throw Error('Unknown APK source');
  const git=(...args)=>execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']});
  const kind=process.argv[3]==='main'?'main':'dev';
  const inputs=[...BUILD_INPUTS,...(kind==='main'?['scripts/build-main-apk.cjs','scripts/read-main-client-settings.cjs','scripts/report-eas-build-error.cjs']:[])];
  const tree=revision=>git('ls-tree','-r',revision,'--',...inputs);
  const workflow=kind==='main'?'.github/workflows/build-folio-main.yml':'.github/workflows/build-folio-dev.yml';
  matches=tree(baseline)===tree('HEAD')&&matchesToolchain(yaml.parse(git('show',baseline+':'+workflow)),yaml.parse(fs.readFileSync(workflow,'utf8')),kind);
 }catch{/* Unknown cache inputs always require a normal build. */}
 process.stdout.write(String(matches));
}

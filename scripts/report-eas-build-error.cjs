const fs = require('node:fs');

function buildErrorAnnotation(stdout, stderr, secrets = []) {
  let detail = [stderr.trim(), stdout.trim()].filter(Boolean).join('\n\nBuild output:\n');
  for (const secret of secrets.filter(Boolean)) detail = detail.split(secret).join('[REDACTED]');
  detail = detail.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '').replace(/Bearer\s+[^\s"'<>]+/gi, 'Bearer [REDACTED]');
  if (!detail) detail = 'EAS returned a failure without diagnostic output. Open the APK build step for details.';
  detail = detail.slice(-12000);
  const escaped = detail.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  return `::error title=EAS APK build failed::${escaped}`;
}

if (require.main === module) {
  const read = filename => { try { return fs.readFileSync(filename, 'utf8'); } catch { return ''; } };
  const secrets = ['EXPO_TOKEN', 'GITHUB_TOKEN', 'GH_TOKEN', 'ACTIONS_RUNTIME_TOKEN'].map(name => process.env[name]);
  console.log(buildErrorAnnotation(read(process.argv[2]), read(process.argv[3]), secrets));
}

module.exports = { buildErrorAnnotation };

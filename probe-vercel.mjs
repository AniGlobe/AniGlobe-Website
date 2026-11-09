import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const BASE = 'https://aniglobe-website.vercel.app';

function vercelCurl(url, args = []) {
  const r = spawnSync(
    'npx',
    ['vercel@latest', 'curl', url, ...args],
    { encoding: 'utf8', shell: true, timeout: 90000 }
  );
  return (r.stdout || '') + (r.stderr || '');
}

function bodyJson(out) {
  const m = out.match(/\{[\s\S]+\}/);
  return m ? m[0] : out.trim().slice(-300);
}

const stamp = String(Date.now()).slice(-6);
writeFileSync('tmp-probe-body.json', JSON.stringify({
  username: 'ProdProbe' + stamp,
  email: `prod-probe${stamp}@example.com`,
  password: 'Prod-Probe-42!',
}));

const regOut = vercelCurl(BASE + '/api/auth/register', [
  '-X', 'POST',
  '-d', '@tmp-probe-body.json',
  '-i',
]);
console.log('register:', bodyJson(regOut));

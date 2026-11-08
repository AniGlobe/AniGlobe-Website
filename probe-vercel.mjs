import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const BASE = 'https://aniglobe-website-hihsurra9-mdika131s-projects.vercel.app';

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

function sessionCookie(out) {
  for (const line of out.split('\n')) {
    const m = line.match(/aniglobe_session=([^;,\s]+)/i);
    if (m) return `aniglobe_session=${m[1]}`;
  }
  return '';
}

const stamp = String(Date.now()).slice(-4);
writeFileSync('tmp-probe-body.json', JSON.stringify({
  username: 'VercelSmoke' + stamp,
  email: `vercel-smoke${stamp}@example.com`,
  password: 'Vercel-Smoke-42!',
}));

const regOut = vercelCurl(BASE + '/api/auth/register', [
  '-X', 'POST',
  '-d', '@tmp-probe-body.json',
  '-i',
]);
console.log('register:', bodyJson(regOut));
let cookie = sessionCookie(regOut);
console.log('cookie:', cookie ? 'yes' : 'NO');

if (cookie) {
  console.log('me:', bodyJson(vercelCurl(BASE + '/api/auth/me', [
    '-H', `Cookie: ${cookie}`,
  ])));
  const loginOut = vercelCurl(BASE + '/api/auth/login', [
    '-X', 'POST',
    '-d', '@tmp-probe-body.json',
  ]);
  console.log('login (body as identifier probe):', bodyJson(loginOut).slice(0, 80));
}

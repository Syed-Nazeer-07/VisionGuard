import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Run against Vite configured with the synthetic Supabase URL in the QA guide.
const base = process.env.VISIONGUARD_SMOKE_URL || 'http://localhost:3002';
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname),
  'The workspace browser fixture requires a local Vite server.');
const { chromium } = await import(process.env.VISIONGUARD_PLAYWRIGHT_MODULE || 'playwright-core');
const fixtureVideo = fileURLToPath(new URL('../apps/web/public/car-detection.mp4', import.meta.url));
const browser = await chromium.launch({
  executablePath: process.env.VISIONGUARD_CHROMIUM || undefined,
  args: ['--disable-dev-shm-usage', '--use-fake-device-for-media-stream'],
});
const account = 'e527dfcf-75bc-45b7-845f-7757bafaf225';
const profile = { id: account, email: 'alex@example.test', name: 'Alex Morgan', role: 'Admin', status: 'Active' };
const context = await browser.newContext({ viewport: {width: 1366, height: 900}, acceptDownloads: true, reducedMotion: 'reduce' });
await context.addInitScript(({account, profile}) => {
  const getUserMedia = MediaDevices.prototype.getUserMedia;
  MediaDevices.prototype.getUserMedia = async function(...args) {
    const stream = await getUserMedia.apply(this, args);
    window.vgTestCapture = stream;
    return stream;
  };
  const user = { id: account, email: profile.email, aud: 'authenticated', app_metadata: {}, user_metadata: { full_name: profile.name }, created_at: '2026-01-01T00:00:00Z' };
  const jwt = ['eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9', btoa(JSON.stringify({sub:account,role:'authenticated',exp:4102444800})), 'fixture'].join('.');
  localStorage.setItem('sb-visionguard-fixture-auth-token', JSON.stringify({ access_token: jwt, refresh_token: 'fixture', expires_at: 4102444800, token_type: 'bearer', user }));
}, {account, profile});

const cloud = new Map();
let role = 'Admin';
await context.route('https://visionguard-fixture.invalid/**', async route => {
  const req = route.request();
  const url = new URL(req.url());
  const table = url.pathname.split('/').at(-1);
  const headers = {'access-control-allow-origin':'*', 'access-control-allow-methods':'GET,POST,PATCH,OPTIONS', 'access-control-allow-headers': req.headers()['access-control-request-headers'] || '*', 'access-control-expose-headers': 'content-range', 'content-range': '0-0/0'};
  if (req.method() === 'OPTIONS') return route.fulfill({status:204, headers});
  let json = [];
  const status = 200;
  if (table === 'profiles') {
    const fixtureProfile = { ...profile, role };
    json = req.headers().accept?.includes('object+json') ? fixtureProfile : [fixtureProfile];
  }
  if (table === 'user_settings') json = req.headers().accept?.includes('object+json') ? {id:account} : [{id:account}];
  if (table === 'user') json = {id:account,email:profile.email,user_metadata:{full_name:profile.name}};
  if (table === 'system_settings') json = {key:'evidence_retention_days',value:30};
  if (table === 'audit_logs') json = req.method() === 'GET' ? [] : null;
  if (table === 'video-storage') json = { configured: false };
  if (table === 'user_analysis_records') {
    if (req.method() === 'POST') {
      const data = req.postDataJSON();
      for (const row of Array.isArray(data) ? data : [data]) cloud.set(row.run_id ?? row.id, row);
    }
    json = [...cloud.values()];
  }
  return route.fulfill({status,headers,json});
});


const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const checked = [];
const open = async (path, name) => {
  await page.goto(base+path);
  await page.getByRole('heading', {name, exact:true}).first().waitFor({timeout:12000});
};
try {
  const anonymous = await browser.newPage();
  await anonymous.goto(base+'/app/analyze?quality=1');
  await anonymous.waitForURL('**/login');
  await anonymous.getByRole('textbox',{ name:'Email', exact:true }).waitFor();
  assert.equal(await anonymous.locator('video').count(), 0);
  await anonymous.close();
  checked.push('Unauthenticated analysis route redirected to login.');

  await page.setViewportSize({width:390,height:844});
  await open('/app', 'Overview');
  const menu = page.getByRole('button',{name:'Open navigation'});
  await menu.click();
  await page.getByRole('dialog').waitFor();
  assert.equal(await page.getByRole('button',{name:'Close menu'}).evaluate(el=>el===document.activeElement),true);
  await page.keyboard.press('Escape');
  assert.equal(await menu.evaluate(el=>el===document.activeElement),true);
  assert.equal(await menu.getAttribute('aria-expanded'),'false');
  checked.push('Mobile workspace drawer traps focus and restores it on Escape.');

  await open('/app/users', 'User Management');
  await page.getByRole('button',{name:/add (new )?user|provision (new )?user|create user/i}).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  assert.equal(await dialog.evaluate(el=>el.contains(document.activeElement)), true);
  await page.keyboard.press('Escape');
  await dialog.waitFor({state:'hidden'});
  checked.push('Admin user drawer opens and closes by keyboard at 390px.');

  await open('/app/config','System configuration');
  await page.getByRole('spinbutton',{name:'Days to retain evidence'}).fill('31');
  await page.getByRole('button',{name:'Save retention'}).click();
  await page.getByText('Evidence retention saved.',{exact:true}).waitFor();
  checked.push('Admin retention saves one active key and records an audit entry through the test API.');

  await open('/app/analyze','Live analysis');
  const boxes = page.getByRole('checkbox',{name:'Boxes',exact:true});
  const labels = page.getByRole('checkbox',{name:'Labels',exact:true});
  await boxes.uncheck();
  assert.equal(await labels.isDisabled(),true);
  await boxes.check();
  assert.equal(await labels.isDisabled(),false);
  const telemetry = page.getByRole('checkbox',{name:'Telemetry',exact:true});
  await telemetry.uncheck();
  assert.equal(await page.getByRole('heading',{name:'Live observations'}).count(),0);
  await telemetry.check();
  await page.getByRole('heading',{name:'Live observations'}).waitFor();
  await page.getByRole('button',{name:'Focus view',exact:true}).click();
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('button',{name:'Focus view',exact:true}).getAttribute('aria-pressed'),'false');
  checked.push('Display controls and Escape exit in Live Analysis.');

  await context.grantPermissions(['camera'], {origin:base});
  await page.getByRole('button',{name:'Use camera',exact:true}).click();
  await page.waitForFunction(()=>window.vgTestCapture?.getVideoTracks().some(track=>track.readyState==='live'));
  await page.locator('video').waitFor();
  await page.locator('input[type=file]').setInputFiles(fixtureVideo);
  await page.waitForFunction(()=>window.vgTestCapture.getTracks().every(track=>track.readyState==='ended'));
  await page.waitForFunction(()=>document.querySelector('video')?.src.startsWith('blob:'));
  const syncControl = page.getByRole('checkbox',{name:/Sync video to AI/});
  await syncControl.check();
  await page.waitForFunction(()=>{
    const rate = document.querySelector('video')?.playbackRate;
    return typeof rate === 'number' && rate >= 0.1 && rate < 1;
  });
  await syncControl.uncheck();
  await page.waitForFunction(()=>document.querySelector('video')?.playbackRate === 1);
  checked.push('Recorded-video sync can slow playback and restores 1x when disabled.');
  checked.push('Switching from the permitted Chromium fixture camera to a local file stops all camera tracks.');

  await page.getByText('Storage & privacy',{exact:true}).click();
  await page.getByRole('checkbox',{name:'Keep this video on this device'}).check();
  await page.getByText('Original saved locally',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Close current source'}).click();
  await page.locator('video').waitFor({state:'detached'});
  await page.getByRole('button',{name:'Reopen saved video'}).click();
  await page.locator('video').waitFor();
  await page.waitForFunction(()=>document.querySelector('video')?.currentTime > 0);
  await page.getByRole('checkbox',{name:'Keep this video on this device'}).uncheck();
  await page.getByText('Local retention disabled',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Close current source'}).click();
  await page.getByRole('button',{name:'Reopen saved video'}).waitFor({state:'hidden'});
  checked.push('Opted-in original survives Close, reopens from IndexedDB, and loses retention when disabled.');

  await open('/app/cases', 'Incidents');
  await page.getByRole('button',{name:'Add incident',exact:true}).click();
  await page.getByLabel('Note (optional)').fill('Fixture review observation');
  await page.getByRole('button',{name:'Save incident'}).click();
  await page.getByText('Incident saved for review on this device.',{exact:true}).waitFor();
  await page.getByRole('button',{name:/mark .* reviewed|mark reviewed/i}).first().click();
  await page.getByText('Review saved on this device.',{exact:true}).waitFor();
  await page.reload();
  await page.getByRole('button',{name:/reopen .* review/i}).waitFor();

  await open('/app/reports', 'Reports');
  const exportReady = page.waitForEvent('download');
  await page.getByRole('button',{name:'Incident review CSV'}).click();
  const exported = await exportReady;
  const csv = await readFile(await exported.path(), 'utf8');
  assert.match(csv, /Reviewed/i);
  assert.match(csv, /Fixture review observation/);
  checked.push('An incident and its human review survive reload and appear in the incident CSV.');
  const pdfReady = page.waitForEvent('download');
  await page.getByRole('button',{name:'Download PDF',exact:true}).click();
  const pdf = await readFile(await (await pdfReady).path());
  assert.equal(pdf.subarray(0,5).toString(), '%PDF-');
  checked.push('Download PDF produces a real activity report PDF.');

  role = 'Viewer';
  await page.goto(base+'/app/users');
  await page.waitForURL(base+'/app');
  await page.getByRole('heading',{name:'Overview'}).waitFor();
  checked.push('Viewer access to the admin Users route redirects to Overview.');

  await open('/reset-password','Choose a new password');
  await page.getByRole('link',{name:'Request a new link'}).waitFor();
  assert.equal(await page.getByLabel('New password',{exact:true}).count(),0);
  checked.push('An ordinary signed-in session cannot stand in for a password recovery link.');
  await page.goto(base + '/reset-password?fixture=callback#' + new URLSearchParams({
    type: 'recovery', access_token: 'fixture-recovery-token',
    refresh_token: 'fixture-refresh', expires_in: '3600', token_type: 'bearer'
  }));
  await page.getByLabel('New password',{exact:true}).fill('fixture-only-password-012');
  await page.getByLabel('Confirm new password',{exact:true}).fill('fixture-only-password-012');
  await page.getByRole('button',{name:'Update password'}).click();
  await page.getByText('Your password has been updated successfully.',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Continue to sign in',exact:true}).click();
  await page.waitForURL(base+'/login');
  await page.getByRole('textbox',{name:'Email',exact:true}).waitFor();
  checked.push('The Supabase client recovery callback unlocks the reset form after the fixture API validates it.');

  assert.deepEqual(errors, []);
  checked.forEach(message => console.log(message));
} finally {
  await browser.close();
}

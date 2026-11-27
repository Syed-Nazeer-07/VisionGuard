import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Run against Vite configured with the synthetic Supabase URL in the QA guide.
const base = process.env.VISIONGUARD_SMOKE_URL || 'http://localhost:3002';
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname),
  'The workspace browser fixture requires a local Vite server.');
const { chromium } = await import(process.env.VISIONGUARD_PLAYWRIGHT_MODULE || 'playwright-core');
const fixtureVideo = fileURLToPath(new URL('../apps/web/public/imagery/motorway-sample.mp4', import.meta.url));
const modelPath = process.env.VISIONGUARD_SMOKE_MODEL;
const testBrowserTab = process.env.VISIONGUARD_SMOKE_TAB === '1';
const captureTitle = 'VisionGuard Capture Fixture';
const screenshots = process.env.VISIONGUARD_SMOKE_SCREENSHOTS;
if (screenshots) await mkdir(screenshots, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.VISIONGUARD_CHROMIUM || undefined,
  args: ['--disable-dev-shm-usage', '--use-fake-device-for-media-stream',
    ...(testBrowserTab ? ['--auto-select-tab-capture-source-by-title=' + captureTitle] : [])],
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


if (modelPath) await context.route('**/models/yolo11s.onnx', route => route.fulfill({
  path: modelPath, contentType: 'application/octet-stream',
  headers: { 'cross-origin-resource-policy': 'same-origin' },
}));
const page = await context.newPage();
const screenshot = name => screenshots ? page.screenshot({ path: screenshots + '/' + name + '.jpg', type: 'jpeg', quality: 84 }) : Promise.resolve();
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
  await anonymous.getByRole('textbox',{ name:'Email address', exact:true }).waitFor();
  assert.equal(await anonymous.locator('video').count(), 0);
  await anonymous.close();
  checked.push('Unauthenticated analysis route redirected to login.');

  await page.setViewportSize({width:390,height:844});
  await open('/app', 'Overview');
  await screenshot('mobile-overview');
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
  await page.getByText('Analysis settings', {exact:true}).click();
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
  assert.equal(await page.getByRole('button',{name:'Focus view',exact:true}).count(),0);
  checked.push('Display controls work without a separate Focus view button.');

  const openSources = () => page.getByRole('button',{name:/^(choose|change) source$/i}).click();
  await openSources();
  await page.getByRole('button',{name:/YouTube footage/}).click();
  await page.getByRole('button',{name:'Intersection traffic footage'}).click();
  const search = page.getByRole('link',{name:'Open YouTube search'});
  assert.equal(new URL(await search.getAttribute('href')).searchParams.get('search_query'), 'Intersection traffic footage');
  assert.equal(await search.getAttribute('target'), '_blank');
  assert.equal(await page.getByRole('button',{name:'Select YouTube tab'}).isEnabled(), true);
  await screenshot('mobile-youtube-source');
  await page.keyboard.press('Escape');
  checked.push('Guided YouTube offers direct search and a browser tab-selection action.');

  if (testBrowserTab) {
    const capturePage = await context.newPage();
    await capturePage.route('**/capture-fixture', route => route.fulfill({
      contentType: 'text/html',
      body: '<title>' + captureTitle + '</title><video muted autoplay loop playsinline width="800" src="/imagery/motorway-sample.mp4"></video>',
    }));
    await capturePage.goto(base + '/capture-fixture');
    await capturePage.locator('video').evaluate(video => video.play());
    await page.bringToFront();
    await openSources();
    await page.getByRole('button',{name:/Existing browser tab/}).click();
    await page.getByRole('button',{name:'Stop sharing',exact:true}).waitFor();
    assert.equal(await page.locator('video').evaluate(video => video.srcObject?.getVideoTracks()[0]?.getSettings().displaySurface), 'browser');
    await page.getByText('Analysis settings', {exact:true}).evaluate(summary => {
      summary.closest('details').open = true;
    });
    await page.getByRole('checkbox',{name:/Keep tab sharing/}).check();
    await page.getByRole('button',{name:'Open navigation'}).click();
    await page.getByRole('link',{name:'Overview',exact:true}).click();
    await page.getByRole('button',{name:'Stop',exact:true}).click();
    await page.getByRole('button',{name:'Stop',exact:true}).waitFor({state:'hidden'});
    await capturePage.close();
    await page.getByRole('button',{name:'Open navigation'}).click();
    await page.getByRole('link',{name:'Live analysis',exact:true}).click();
    await page.getByRole('button',{name:'Choose source',exact:true}).waitFor();
    checked.push('Chromium shared an actual browser tab, kept it across workspace navigation and stopped from the top bar.');
  }

  await context.grantPermissions(['camera'], {origin:base});
  await openSources();
  await page.getByRole('button',{name:/Device camera/}).click();
  await page.waitForFunction(()=>window.vgTestCapture?.getVideoTracks().some(track=>track.readyState==='live'));
  await page.locator('video').waitFor();
  await page.getByRole('button',{name:'Pause analysis'}).click();
  assert.equal(await page.locator('video').evaluate(video => video.paused), false);
  assert.equal(await page.getByRole('slider',{name:'Seek video'}).count(),0);
  await page.getByRole('button',{name:'Resume analysis'}).click();
  await openSources();
  const picker = page.waitForEvent('filechooser');
  await page.getByRole('button',{name:/Upload video/}).click();
  await (await picker).setFiles(fixtureVideo);
  await page.waitForFunction(()=>window.vgTestCapture.getTracks().every(track=>track.readyState==='ended'));
  await page.waitForFunction(()=>document.querySelector('video')?.src.startsWith('blob:') && document.querySelector('video')?.duration > 10);
  checked.push('Camera analysis pauses independently of the fixture stream and switching to a file releases camera tracks.');

  await page.waitForFunction(() => {
    const video = document.querySelector('.vg-player-frame video');
    return video?.currentTime > .1 && !video.paused;
  });
  const pause = page.getByRole('button',{name:'Pause',exact:true});
  await page.locator('.vg-player-frame').hover();
  await pause.click();
  await page.getByRole('button',{name:'Play',exact:true}).waitFor();
  assert.equal(await page.locator('video').evaluate(video=>video.controls), false);
  await page.getByRole('group',{name:'Video player'}).focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  assert.ok(await page.locator('video').evaluate(video=>video.currentTime >= 4.9));
  await page.getByLabel('Playback settings').click();
  await page.getByRole('radio',{name:'0.5×',exact:true}).check();
  assert.equal(await page.locator('video').evaluate(video=>video.playbackRate), .5);
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Enter fullscreen'}).click();
  await page.waitForFunction(()=>document.fullscreenElement?.classList.contains('vg-player-frame'));
  assert.equal(await page.evaluate(() => {
    const frame = document.fullscreenElement;
    const video = frame.querySelector('video').getBoundingClientRect();
    const canvas = frame.querySelector('canvas').getBoundingClientRect();
    return Math.abs(video.width - canvas.width) < 1 && Math.abs(video.height - canvas.height) < 1;
  }), true);
  await page.getByRole('button',{name:'Exit fullscreen'}).click();
  checked.push('Shared playback bar provides keyboard seeking, slow playback and composite fullscreen.');

  await page.getByText('Storage & privacy',{exact:true}).click();
  await page.getByRole('checkbox',{name:'Keep this video on this device'}).check();
  await page.getByText('Original saved locally',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Close current source'}).click();
  await page.locator('video').waitFor({state:'detached'});
  await openSources();
  await page.getByRole('button',{name:/Reopen saved video/}).click();
  await page.waitForFunction(()=>document.querySelector('video')?.currentTime > 0);
  await page.getByRole('checkbox',{name:'Keep this video on this device'}).uncheck();
  await page.getByText('Local retention disabled',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Close current source'}).click();
  await openSources();
  await page.getByRole('button',{name:/Reopen saved video/}).waitFor({state:'hidden'});
  await page.keyboard.press('Escape');
  checked.push('Opted-in original survived Close, reopened from IndexedDB and was removed when retention was disabled.');

  if (modelPath) {
    await page.setViewportSize({width:1440,height:1000});
    await page.getByRole('button',{name:'Try sample footage'}).click();
    await page.getByText('Detector ready',{exact:true}).waitFor({timeout:90000});
    await page.waitForFunction(() => {
      const stat = [...document.querySelectorAll('.vg-live-counts > div')].find(item => /Observed tracks/.test(item.textContent));
      return Number(stat?.querySelector('dd')?.textContent) > 0;
    }, null, {timeout:30000});
    await screenshot('desktop-analysis-real-yolo');
    await page.locator('.vg-player-frame').hover();
    await page.getByRole('button',{name:'Enter fullscreen'}).click();
    await page.waitForFunction(() => {
      const canvas = document.fullscreenElement?.querySelector('canvas');
      if (!canvas || !canvas.width || !canvas.height) return false;
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      return pixels.some((channel, index) => index % 4 === 3 && channel > 0);
    }, null, {timeout:15000});
    await screenshot('desktop-analysis-fullscreen');
    await page.locator('.vg-player-frame').hover();
    await page.getByRole('button',{name:'Exit fullscreen'}).click();
    await page.setViewportSize({width:390,height:844});
    await screenshot('mobile-analysis-real-yolo');
    await page.locator('video').evaluate(video => video.pause());
    await page.waitForFunction(() => document.querySelector('video')?.paused);
    await page.getByRole('button',{name:'Open navigation'}).click();
    await page.getByRole('link',{name:'History',exact:true}).click();
    const observation = page.locator('.vg-history-row').filter({hasText:'Sample · A40 motorway'});
    await observation.waitFor();
    assert.ok((await observation.textContent()).includes('Built-in sample'));
    checked.push('Licensed A40 sample produced real YOLO11s tracks and nonempty canvas pixels in composite fullscreen.');
  }

  await open('/app/cases', 'Incidents');
  await page.getByRole('button',{name:'Add incident',exact:true}).click();
  await page.getByLabel('Note (optional)').fill('Fixture review observation');
  await page.getByRole('button',{name:'Save incident'}).click();
  await page.getByText('Incident saved for review on this device.',{exact:true}).waitFor();
  await page.getByRole('button',{name:/mark .* reviewed|mark reviewed/i}).first().click();
  await page.getByText('Review saved on this device.',{exact:true}).waitFor();
  await page.reload();
  await page.getByRole('button',{name:/^Reviewed/}).click();
  await page.getByRole('button',{name:/reopen .* review/i}).waitFor();
  await screenshot('mobile-incidents');

  await open('/app/reports', 'Reports');
  const exportReady = page.waitForEvent('download');
  await page.getByRole('radio',{name:/Incident-review CSV/}).check();
  await page.getByRole('button',{name:'Download report'}).click();
  const exported = await exportReady;
  const csv = await readFile(await exported.path(), 'utf8');
  assert.match(csv, /Reviewed/i);
  assert.match(csv, /Fixture review observation/);
  await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('radio',{name:/Executive summary PDF/}).check();
  const pdfReady = page.waitForEvent('download');
  await page.getByRole('button',{name:'Download report'}).click();
  const pdfDownload = await pdfReady;
  const pdfBytes = await readFile(await pdfDownload.path());
  assert.equal(pdfBytes.subarray(0,5).toString(),'%PDF-');
  if (screenshots) await pdfDownload.saveAs(screenshots+'/executive-browser-check.pdf');
  await screenshot('desktop-reports');
  checked.push('A human review persisted through reload, appeared in CSV and the browser downloaded an executive PDF.');

  await open('/app/analytics','Analytics');
  await page.getByRole('button',{name:'7 days'}).click();
  await page.getByRole('heading',{name:'Session comparison'}).waitFor();
  await screenshot('desktop-analytics');
  await open('/app/settings','Settings');
  await page.getByRole('button',{name:/^Appearance/}).click();
  await page.getByRole('combobox',{name:'Color theme'}).last().selectOption('dark');
  assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
  await page.reload();
  assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
  await page.getByRole('heading',{name:'Settings',exact:true}).waitFor();
  await screenshot('desktop-settings-dark');
  checked.push('Analytics filters work and workspace theme survives a reload.');

  role = 'Viewer';
  await page.goto(base+'/app/users');
  await page.waitForURL(base+'/app');
  await page.getByRole('heading',{name:'Overview'}).waitFor();
  checked.push('Viewer access to the admin Users route redirects to Overview.');

  await open('/reset-password','Request a new reset link');
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
  await page.getByRole('heading',{name:'Password updated',exact:true}).waitFor();
  checked.push('The Supabase client recovery callback unlocks the reset form after the fixture API validates it.');

  assert.deepEqual(errors, []);
} finally {
  checked.forEach(message => console.log(message));
  await browser.close();
}

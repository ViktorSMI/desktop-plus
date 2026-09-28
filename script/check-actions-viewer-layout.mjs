/** Responsive Actions UI checks using real components and compiled app CSS.
 * Fixture API only. Electron bridges and shared Button/header are substituted;
 * this is not a screenshot of the packaged Electron app.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const { chromium } = require('@playwright/test')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output =
  process.env.ACTIONS_VIEWER_TEST_OUTPUT || '/tmp/actions-viewer-layout'
fs.mkdirSync(output, { recursive: true })
const sources = {
  reader: 'app/src/ui/actions/actions-run-dialog.tsx',
  runs: 'app/src/ui/actions/actions-runs.tsx',
  data: 'app/src/ui/actions/use-actions-data.ts',
  client: 'app/src/lib/actions-client.ts',
  dialog: 'app/src/ui/dialog/dialog.tsx',
  select: 'app/src/ui/lib/select.tsx',
  topmost: 'app/src/ui/dialog/is-top-most.tsx',
}
const memoizeSource = fs.readFileSync(
  require.resolve('memoize-one', { paths: [path.join(root, 'app')] }),
  'utf8'
)
const factories = Object.entries(sources).map(([name, file]) => {
  const js = ts.transpileModule(
    fs.readFileSync(path.join(root, file), 'utf8'),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.React,
        esModuleInterop: true,
      },
    }
  ).outputText
  return `${JSON.stringify(
    name
  )}: function(require, module, exports) {\n${js}\n}`
})
const css = fs.readFileSync(path.join(root, 'out/renderer.css'), 'utf8')
const browser = await chromium.launch({ headless: true })
let page
try {
  page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('http://**/*', route => route.abort())
  await page.route('https://**/*', route => route.abort())
  await page.setContent(`<html><head><style>
    ${css}
    body { margin: 0; font: 14px system-ui; background: var(--background-color); color: var(--text-color); }
    #list { height: 600px; width: 365px; display: flex; flex-direction: column; border: var(--base-border); }
  </style></head><body><div id="list"></div><div id="modal"></div></body></html>`)
  for (const file of [
    'app/node_modules/react/umd/react.development.js',
    'app/node_modules/react-dom/umd/react-dom.development.js',
  ]) {
    await page.addScriptTag({ path: path.join(root, file) })
  }
  await page.addScriptTag({
    content: `
    window.__DARWIN__ = false; window.__WIN32__ = false; window.__LINUX__ = true;
    const factories = {${factories.join(
      ',\n'
    )}, 'memoize-one': function(require, module, exports) {${memoizeSource}\n}}; const cache = {}; const noop = () => {}; let unique = 0;
    const ids = { createUniqueId: () => 'actions-' + (++unique), releaseUniqueId: noop };
    const mocks = {
      'react': React,
      'classnames': (...values) => values.flatMap(v => typeof v === 'object' && v ? Object.keys(v).filter(k => v[k]) : v || []).join(' '),
      './header': { DialogHeader: p => React.createElement('div', {className:'dialog-header'}, React.createElement('h1', {id:p.titleId}, p.title), React.createElement('button', {type:'button', className:'close', 'aria-label':'Close', onClick:p.onCloseButtonClick}, '×')) },
      '../lib/id-pool': ids, './id-pool': ids,
      '../window/title-bar': { getTitleBarHeight: () => 32 },
      '../../lib/get-os': { isMacOSSonomaOrLater: () => false, isMacOSVentura: () => false },
      '../main-process-proxy': { sendDialogDidOpen: noop },
      '../lib/button': { Button: p => React.createElement('button', {type:'button', className:'button-component', onClick:p.onClick, disabled:p.disabled, 'aria-label':p.ariaLabel}, p.children) },
      './api': { API: class {}, getHTMLURL: () => 'https://github.com' },
      './http': { APIError: class extends Error {} },
      './remote-parsing': {},
    };
    const aliases = {'../dialog':'dialog','./is-top-most':'topmost','../lib/select':'select','./use-actions-data':'data','../../lib/actions-client':'client'};
    function load(name) {
      name = aliases[name] || name;
      if (Object.prototype.hasOwnProperty.call(mocks,name)) return mocks[name];
      if (!factories[name]) throw Error('Unexpected test dependency: ' + name);
      if (cache[name]) return cache[name].exports;
      const module = cache[name] = {exports:{}};
      factories[name](load,module,module.exports); return module.exports;
    }
    const target = {endpoint:'https://api.github.com',owner:'ViktorSMI',name:'desktop-plus',login:'ViktorSMI'};
    const run = {id:123,name:'CI',display_title:'Build desktop application — ' + 'long-branch-name-'.repeat(10),run_number:8,run_attempt:2,head_branch:'feature/actions-viewer',head_sha:'abc1234567890',event:'push',status:'in_progress',conclusion:null,created_at:'2026-01-01T00:00:00Z',updated_at:'2026-01-01T00:02:00Z',actor:{login:'ViktorSMI'}};
    window.fail = false; window.opened = [];
    const api = {
      fetchActionsRuns: async () => ({total_count:30,workflow_runs:Array.from({length:30},(_,i)=>({...run,id:123+i,run_number:8+i}))}),
      fetchActionsRun: async () => {if(window.fail) throw Error('network'); return run;},
      fetchActionsJobs: async () => ({total_count:25,jobs:Array.from({length:25},(_,i)=>({id:321+i,name:['Linux x64','Windows x64','macOS arm64'][i%3]+' job '+i,status:i?'queued':'in_progress',conclusion:null,started_at:null,completed_at:null,steps:Array.from({length:10},(_,n)=>({number:n+1,name:n===0?'Run yarn compile:prod with '+ 'long-step-name-'.repeat(20):'Test step '+n,status:n?'pending':'in_progress',conclusion:null,started_at:null,completed_at:null}))}))}),
      openInBrowser: url => window.opened.push(url),
    };
    const {DialogStackContext} = load('dialog');
    window.closeViewer = () => ReactDOM.unmountComponentAtNode(document.getElementById('modal'));
    window.showViewer = () => ReactDOM.render(React.createElement(DialogStackContext.Provider,{value:{isTopMost:true}},React.createElement(load('reader').ActionsRunDialog,{target,runId:123,reader:api,onDismissed:closeViewer,onBack:closeViewer})),document.getElementById('modal'));
    ReactDOM.render(React.createElement(load('runs').ActionsRuns,{target,reader:api,onSelect:showViewer}),document.getElementById('list'));
  `,
  })
  await page.getByText('CI #8', { exact: true }).waitFor()
  assert.equal(await page.locator('.actions-run').count(), 30)
  const listFits = await page
    .locator('#list')
    .evaluate(e => e.scrollWidth <= e.clientWidth + 1)
  assert(listFits, 'Run list exceeds foldout width')
  await page.screenshot({ path: path.join(output, 'run-list.png') })
  await page
    .getByRole('button', { name: /CI #8 / })
    .first()
    .click()
  await page.getByText('Linux x64 job 0', { exact: true }).waitFor()
  await page.locator('summary').first().click()
  await page
    .getByRole('button', { name: 'Open job logs in browser' })
    .first()
    .click()
  assert.deepEqual(await page.evaluate(() => window.opened), [
    'https://github.com/ViktorSMI/desktop-plus/actions/runs/123/job/321',
  ])
  for (const [width, height] of [
    [1366, 768],
    [1024, 600],
    [800, 500],
    [480, 360],
  ]) {
    await page.setViewportSize({ width, height })
    await page.waitForTimeout(150)
    const geometry = await page.evaluate(() => {
      const dialog = document
        .querySelector('#actions-run-dialog')
        .getBoundingClientRect()
      const content = document.querySelector('.actions-run-content')
      const footer = document
        .querySelector('.actions-footer')
        .getBoundingClientRect()
      return {
        x: dialog.x,
        y: dialog.y,
        right: dialog.right,
        bottom: dialog.bottom,
        footerBottom: footer.bottom,
        width: innerWidth,
        height: innerHeight,
        client: content.clientHeight,
        scroll: content.scrollHeight,
        horizontal: content.scrollWidth - content.clientWidth,
      }
    })
    assert(
      geometry.x >= -1 &&
        geometry.y >= -1 &&
        geometry.right <= width + 1 &&
        geometry.bottom <= height + 1,
      'Dialog exceeds viewport: ' + JSON.stringify(geometry)
    )
    assert(
      geometry.client > 0 && geometry.scroll > geometry.client,
      'Jobs need an accessible scroll area'
    )
    assert(
      geometry.horizontal <= 1,
      'Long workflow/step name causes horizontal overflow'
    )
    assert(geometry.footerBottom <= height, 'Footer is clipped')
    await page.screenshot({
      path: path.join(output, width + 'x' + height + '.png'),
    })
  }
  await page.setViewportSize({ width: 1024, height: 600 })
  await page
    .locator('.actions-run-content')
    .evaluate(e => e.scrollTo(0, e.scrollHeight))
  await page.getByText('Linux x64 job 24', { exact: true }).waitFor()
  await page.evaluate(() => {
    window.fail = true
  })
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await page.locator('#actions-run-dialog').getByRole('alert').waitFor()
  await page.evaluate(() => {
    window.fail = false
  })
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await page.waitForFunction(
    () => !document.querySelector('#actions-run-dialog [role=alert]')
  )
  await page.keyboard.press('Escape')
  await page.locator('#actions-run-dialog').waitFor({ state: 'detached' })
  assert.deepEqual(errors, [])
  console.log(
    'PASS: run list, read-only links, 4 responsive viewports, scrolling, error/retry, Escape; no page errors'
  )
} finally {
  if (page)
    await page
      .screenshot({ path: path.join(output, 'final-state.png') })
      .catch(() => {})
  await browser.close()
}

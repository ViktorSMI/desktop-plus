/** Browser regression checks for the issue reader, with fixture API data.
 * Runs the real reader, Dialog and SandboxedMarkdown. Only Electron/platform
 * bridges, header/buttons and Markdown mention filters are replaced in this
 * standalone harness. No account, repository credentials or external requests.
 * Run: yarn compile:prod && node script/check-issue-reader-layout.mjs
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
  process.env.ISSUE_READER_TEST_OUTPUT || '/tmp/issue-reader-layout'
fs.mkdirSync(output, { recursive: true })

const sources = {
  reader: 'app/src/ui/branches/issue-detail-dialog.tsx',
  detail: 'app/src/ui/branches/issue-detail.tsx',
  dialog: 'app/src/ui/dialog/dialog.tsx',
  markdown: 'app/src/ui/lib/sandboxed-markdown.tsx',
  topmost: 'app/src/ui/dialog/is-top-most.tsx',
}
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
  )}: function(require, module, exports) { const __dirname = '/';\n${js}\n}`
})
const css = fs.readFileSync(path.join(root, 'out/renderer.css'), 'utf8')

const browser = await chromium.launch({
  headless: true,
  args: ['--disable-web-security'],
})
let page
try {
  page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
  const errors = []
  page.on('pageerror', error => {
    errors.push(error.message)
    console.error('Browser error:', error.message)
  })
  await page.route('http://**/*', route => route.abort())
  await page.route('https://**/*', route => route.abort())
  await page.setContent(`<html><head><style>
    :root { --spacing: 8px; --spacing-half: 4px; --spacing-double: 16px;
      --base-border: 1px solid #555; --font-size: 14px; --font-size-sm: 12px;
      --font-size-md: 16px; --font-size-lg: 20px; --font-weight-semibold: 600;
      --background-color: #222; --text-color: #eee; --text-secondary-color: #aaa;
      --pr-open-icon-color: #6c6; --overlay-background-color: #0008; }
    * { box-sizing: border-box; }
    body { margin: 0; font: 14px sans-serif; }
    button { font: inherit; padding: 6px 10px; }
    .sandboxed-markdown-iframe-container { position: relative; }
    iframe.sandboxed-markdown-component { width: 100%; height: 100%; border: none; }
    ${css}
  </style></head><body><button id="opener">Issues</button><div id="app"></div></body></html>`)
  for (const file of [
    'app/node_modules/react/umd/react.development.js',
    'app/node_modules/react-dom/umd/react-dom.development.js',
    'app/node_modules/marked/lib/marked.umd.js',
    'app/node_modules/dompurify/dist/purify.js',
  ]) {
    await page.addScriptTag({ path: path.join(root, file) })
  }
  await page.addScriptTag({
    content: `
    window.__DARWIN__ = false; window.__WIN32__ = false;
    window.__LINUX__ = true;
    window.Buffer = {from: s => ({toString: () => btoa(unescape(encodeURIComponent(s)))})};
    const factories = {${factories.join(',\n')}};
    const cache = {};
    const noop = () => {};
    let unique = 0;
    const markdownCSS = 'html,body{margin:0;padding:0;color:#eee;background:#222;font:14px/1.5 sans-serif;} pre{overflow:auto;} img{max-width:100%;}';
    const mocks = {
      'react': React,
      'memoize-one': {__esModule:true, default: fn => {
        let lastArgs, value;
        return (...args) => {
          if (!lastArgs || args.length !== lastArgs.length || args.some((v,i) => v !== lastArgs[i])) {
            lastArgs = args;
            value = fn(...args);
          }
          return value;
        };
      }},
      'classnames': (...values) => values.flatMap(v => typeof v === 'object' && v ? Object.keys(v).filter(k => v[k]) : v || []).join(' '),
      './header': { DialogHeader: p => React.createElement('div', {className:'dialog-header'},
        React.createElement('h1', {id:p.titleId}, p.title),
        React.createElement('button', {type:'button', className:'close', 'aria-label':'Close', onClick:p.onCloseButtonClick}, '×')) },
      '../lib/id-pool': { createUniqueId: () => 'title-' + (++unique), releaseUniqueId: noop },
      '../window/title-bar': { getTitleBarHeight: () => 32 },
      '../../lib/get-os': { isMacOSSonomaOrLater: () => false, isMacOSVentura: () => false },
      '../main-process-proxy': { sendDialogDidOpen: noop },
      '../../lib/app-state': { FoldoutType: {Branch:'branch'} },
      '../lib/button': { Button: p => React.createElement('button', {type:'button', onClick:p.onClick, disabled:p.disabled}, p.children) },
      '../octicons': { Octicon: () => React.createElement('span', {'aria-hidden':true}, '●') },
      '../octicons/octicons.generated': { issueClosed:'closed', issueOpened:'open' },
      '../../lib/format-date': { formatDate: d => d.toISOString() },
      '../../lib/format-relative': { formatRelative: () => 'recently' },
      '../../models/formatting-preferences': { getPreferAbsoluteDates: () => false },
      'path': { join: () => '/markdown.css' },
      'fs/promises': { readFile: async () => markdownCSS },
      '../../lib/markdown-filters/node-filter': { buildCustomMarkDownNodeFilterPipe: () => [] },
      './tooltip': { Tooltip: () => null },
      './observable-ref': { createObservableRef: v => v },
      './object-id': { getObjectId: () => ++unique },
      'lodash/debounce': { __esModule:true, default: fn => { const f = (...args) => fn(...args); f.cancel = noop; return f; } },
      'marked': { marked: window.marked.marked },
      'dompurify': { __esModule:true, default: DOMPurify },
    };
    const aliases = {'../dialog':'dialog','./issue-detail':'detail','../lib/sandboxed-markdown':'markdown','./is-top-most':'topmost'};
    function load(name) {
      name = aliases[name] || name;
      if (Object.prototype.hasOwnProperty.call(mocks, name)) return mocks[name];
      if (!factories[name]) throw Error('Unexpected test dependency: '+name);
      if (cache[name]) return cache[name].exports;
      const module = cache[name] = {exports:{}};
      factories[name](load, module, module.exports);
      return module.exports;
    }
    const user = {login:'author', id:1};
    const longText = ('A long paragraph with wrapping text. '.repeat(16)+'\\n\\n').repeat(8);
    const code = '\\n\\n~~~text\\n' + 'x'.repeat(300) + '\\n~~~\\n';
    window.fixture = {
      issue: {number:42, title:'Long title '.repeat(40), state:'open', body:longText+code, created_at:'2026-01-01T12:00:00Z', user, html_url:'https://example.invalid/issue/42'},
      comments: Array.from({length:45}, (_,i) => ({id:i+1, user:{login:'commenter-'+i}, created_at:'2026-01-01T12:00:00Z', body:'Comment '+(i+1)+'\\n\\n'+longText.slice(0,500)+(i === 44 ? '\\n\\nLAST-COMMENT-MARKER' : '')})),
    };
    window.fetchFixture = async () => window.fixture;
    window.readerClosed = false;
    window.renderReader = (number = 42, hash = 'repo-a') => {
      const {DialogStackContext} = load('dialog');
      const {IssueDetailDialog} = load('reader');
      ReactDOM.render(React.createElement(DialogStackContext.Provider, {value:{isTopMost:true}},
        React.createElement(IssueDetailDialog, {repository:{hash, fullName:'owner/repository',htmlURL:'https://example.invalid/repo'}, issueNumber:number,
          dispatcher:{fetchIssueDetails:(...args) => window.fetchFixture(...args), openInBrowser:noop, showFoldout:noop},
          emoji:new Map(), underlineLinks:true,
          onDismissed:() => { window.readerClosed = true; ReactDOM.unmountComponentAtNode(document.getElementById('app')); }
        })), document.getElementById('app'));
    };
    document.getElementById('opener').focus();
    renderReader();
  `,
  })
  const dialog = page.locator('#issue-detail-dialog')
  const content = page.locator('.issue-reader-content')
  await dialog.waitFor({ state: 'visible' })
  await page.locator('.issue-detail-title').waitFor()
  await page.waitForFunction(() =>
    [...document.querySelectorAll('iframe')].every(f =>
      f.contentDocument?.querySelector('#content')
    )
  )

  async function assertFits(label) {
    await page.waitForTimeout(250)
    const geometry = await page.evaluate(() => {
      const d = document
        .querySelector('#issue-detail-dialog')
        .getBoundingClientRect()
      const c = document.querySelector('.issue-reader-content')
      const footer = document
        .querySelector('.issue-reader-footer')
        .getBoundingClientRect()
      const header = document
        .querySelector('.dialog-header')
        .getBoundingClientRect()
      return {
        x: d.x,
        y: d.y,
        right: d.right,
        bottom: d.bottom,
        width: innerWidth,
        height: innerHeight,
        footerBottom: footer.bottom,
        headerTop: header.top,
        client: c.clientHeight,
        scroll: c.scrollHeight,
        innerWidth: c.clientWidth,
        innerScroll: c.scrollWidth,
      }
    })
    assert(geometry.x >= -1 && geometry.y >= -1, label + ': top/left clipped')
    assert(
      geometry.right <= geometry.width + 1 &&
        geometry.bottom <= geometry.height + 1,
      label + ': dialog outside viewport'
    )
    assert(
      geometry.footerBottom <= geometry.height && geometry.headerTop >= 0,
      label + ': controls clipped'
    )
    assert(
      geometry.client > 0 && geometry.scroll > geometry.client,
      label + ': missing scroll area'
    )
    assert(
      geometry.innerScroll <= geometry.innerWidth + 1,
      label + ': horizontal overflow'
    )
    console.log(label, JSON.stringify(geometry))
  }
  for (const [width, height] of [
    [1366, 768],
    [1024, 600],
    [800, 500],
    [480, 360],
  ]) {
    await page.setViewportSize({ width, height })
    await assertFits(width + 'x' + height)
    await content.evaluate(e => e.scrollTo(0, e.scrollHeight))
    await page.screenshot({
      path: path.join(output, width + 'x' + height + '.png'),
    })
  }
  await page.setViewportSize({ width: 1024, height: 600 })
  while (
    await page.getByRole('button', { name: /Show more comments/ }).count()
  ) {
    await page.getByRole('button', { name: /Show more comments/ }).click()
  }
  await page.waitForFunction(
    () =>
      document.querySelectorAll('.issue-comment iframe').length === 45 &&
      [...document.querySelectorAll('.issue-comment iframe')].every(f =>
        f.contentDocument?.querySelector('#content')
      )
  )
  await content.evaluate(e => e.scrollTo(0, e.scrollHeight))
  await page.waitForTimeout(300)
  const last = page.locator('.issue-comment').last()
  const lastBox = await last.boundingBox()
  const contentBox = await content.boundingBox()
  assert(
    lastBox.y + lastBox.height <= contentBox.y + contentBox.height + 2,
    'Last comment cannot be reached'
  )
  assert.equal(
    await last
      .locator('iframe')
      .contentFrame()
      .locator('body')
      .getByText('LAST-COMMENT-MARKER')
      .count(),
    1
  )
  await page.screenshot({ path: path.join(output, 'last-comment.png') })

  // Narrowing and widening the viewport must resize Markdown, not clip it.
  for (const width of [480, 1200, 700]) {
    await page.setViewportSize({ width, height: 700 })
    await assertFits('resize-' + width)
    const clipped = await page.evaluate(() =>
      [...document.querySelectorAll('iframe')].some(f => {
        const body = f.contentDocument?.querySelector('#content')
        return body && body.getBoundingClientRect().bottom > f.clientHeight + 2
      })
    )
    assert(!clipped, 'Markdown clipped after resize to ' + width)
  }
  // A wheel event over an iframe must reach the outer scroll container.
  await content.evaluate(e => e.scrollTo(0, 0))
  await page
    .locator('iframe')
    .first()
    .hover({ position: { x: 30, y: 30 } })
  const scrollBeforeWheel = await content.evaluate(e => e.scrollTop)
  await page.mouse.wheel(0, 500)
  await page.waitForTimeout(300)
  assert(
    (await content.evaluate(e => e.scrollTop)) > scrollBeforeWheel,
    'Wheel over Markdown did not scroll reader'
  )
  await page.getByRole('button', { name: 'Comments', exact: true }).click()
  assert(
    (await content.evaluate(e => e.scrollTop)) > 0,
    'Jump to comments did not scroll'
  )

  // Late data from the previous repository must never replace the new issue.
  await page.evaluate(() => {
    window.fetchFixture = () =>
      new Promise(resolve => {
        window.resolveOld = resolve
      })
    window.renderReader(1, 'old-repository')
  })
  await page.evaluate(() => {
    window.fetchFixture = async () => ({
      ...window.fixture,
      issue: { ...window.fixture.issue, title: 'NEW REPOSITORY ISSUE' },
    })
    window.renderReader(1, 'new-repository')
  })
  await page.getByText('NEW REPOSITORY ISSUE', { exact: true }).waitFor()
  await page.evaluate(() => window.resolveOld(window.fixture))
  assert.equal(
    await page.locator('.issue-detail-title').innerText(),
    'NEW REPOSITORY ISSUE'
  )
  await content.focus()
  await page.waitForTimeout(300)
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => window.readerClosed)
  assert.equal(errors.length, 0, errors.join('\n'))
  console.log(
    'PASS: responsive dimensions, last comment, iframe resize/wheel, navigation, stale requests, Escape'
  )
} finally {
  if (page) {
    fs.writeFileSync(path.join(output, 'fixture.html'), await page.content())
    await page.screenshot({ path: path.join(output, 'final-state.png') })
  }
  await browser.close()
}

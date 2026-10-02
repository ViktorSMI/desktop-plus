/** Real History row, status cache and compiled app CSS in Chromium.
 * Fixture data/transport and non-layout child content replace Electron services.
 * This is an isolated browser regression test, not a packaged-app screenshot.
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
  process.env.HISTORY_INDICATOR_TEST_OUTPUT || '/tmp/history-indicator-layout'
fs.mkdirSync(output, { recursive: true })
const sources = {
  row: 'app/src/ui/history/commit-list-item.tsx',
  status: 'app/src/ui/history/commit-actions-status.tsx',
  pool: 'app/src/lib/stores/commit-actions-pool.ts',
  store: 'app/src/lib/stores/commit-actions-store.ts',
  summary: 'app/src/lib/commit-actions.ts',
  octicons: 'app/src/ui/octicons/octicons.generated.ts',
  drag: 'app/src/models/drag-drop.ts',
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
  return `${JSON.stringify(name)}: function(require,module,exports) {\n${js}\n}`
})
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 650 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('http://**/*', route => route.abort())
  await page.route('https://**/*', route => route.abort())
  const css = fs.readFileSync(path.join(root, 'out/renderer.css'), 'utf8')
  await page.setContent(`<html><head><style>${css}
    body {margin:0;background:var(--background-color);color:var(--text-color)}
    #commit-list {width:100%;height:100%;overflow:auto}
    #commit-list .list-item {height:64px;flex:0 0 64px}
    .fixture-avatar {height:16px;width:16px;border-radius:50%;background:#6e7781;margin-right:4px}
  </style></head><body class="theme-dark"><div id="commit-list"></div></body></html>`)
  for (const file of [
    'app/node_modules/react/umd/react.development.js',
    'app/node_modules/react-dom/umd/react-dom.development.js',
  ]) {
    await page.addScriptTag({ path: path.join(root, file) })
  }
  await page.addScriptTag({
    content: `
    window.__DARWIN__=false; window.__WIN32__=true; window.__LINUX__=false;
    const factories={${factories.join(
      ',\n'
    )}}; const cache={}; const noop=()=>{};
    const e=React.createElement;
    const states=['none','success','failure','pending','none','success','failure','none'];
    window.requests=0; window.openedActions=[]; window.rowActivations=0; window.contextMenus=0;
    const mocks={
      'react': React,
      'classnames': (...values)=>values.flatMap(v=>typeof v==='object'&&v?Object.keys(v).filter(k=>v[k]):v||[]).join(' '),
      '../../models/avatar': {getAvatarUsersForCommit:()=>[]},
      '../lib/rich-text': {RichText:p=>e('span',{className:p.className},p.text)},
      '../lib/conventional-commit-badge': {ConventionalCommitBadge:()=>null},
      '../../lib/conventional-commits': {parseConventionalCommit:()=>null},
      '../relative-time': {RelativeTime:()=>e('span',null,'2 hours ago')},
      '../lib/commit-attribution': {CommitAttribution:()=>e('span',null,'Contributor')},
      '../lib/avatar-stack': {AvatarStack:()=>e('span',{className:'fixture-avatar'})},
      '../lib/draggable': {Draggable:p=>e('div',{className:'draggable'},p.children)},
      '../../lib/drag-and-drop-manager': {dragAndDropManager:{isDragOfTypeInProgress:()=>false}},
      '../../lib/feature-flag': {enableAccessibleListToolTips:()=>false},
      '../../lib/format-date': {formatDate:()=> 'October 1, 2026'},
      '../lib/tooltipped-content': {TooltippedContent:p=>e(p.tagName,{className:p.className,title:p.tooltip},p.children)},
      '../octicons': {Octicon:p=>{const s=p.symbol[16]||p.symbol;return e('svg',{className:'octicon',width:s.w,height:s.h,viewBox:'0 0 '+s.w+' '+s.h},s.p.map((d,i)=>e('path',{key:i,d}))) }},
      '../../lib/actions-client': {actionsTargetKey:t=>JSON.stringify(t)},
      '../../lib/commit-actions-client': {
        commitActionsTarget:(repo,accounts)=>({account:accounts[0],target:{provider:'github',endpoint:'https://api.github.com',login:'fixture',owner:'fixture',name:'repository'}}),
        CommitActionsClient:class { async forCommit(a,t,sha) {window.requests++; const state=states[parseInt(sha[0],16)]; return {state,count:state==='none'?0:1,description:'Actions '+state};} }
      }
    };
    const aliases={'./commit-actions-status':'status','../../lib/stores/commit-actions-pool':'pool','./commit-actions-store':'store','../commit-actions':'summary','../octicons/octicons.generated':'octicons','../../models/drag-drop':'drag'};
    function load(name){name=aliases[name]||name;if(Object.prototype.hasOwnProperty.call(mocks,name))return mocks[name];if(cache[name])return cache[name].exports;if(!factories[name])throw Error('Unexpected fixture dependency: '+name);const module=cache[name]={exports:{}};factories[name](load,module,module.exports);return module.exports;}
    const titles=['Unpushed commit','Successful workflow','Failed workflow','Workflow in progress','Tagged unpushed commit','Tagged successful commit with a very long title that must truncate without moving the status column','Both Actions and unpushed indicators','No workflow runs'];
    const commits=titles.map((summary,i)=>({sha:i.toString(16).repeat(40),summary,author:{date:new Date()},isMergeCommit:false,tags:i===4||i===5?['release/very-long-tag-name-that-must-not-overlap-indicators','extra-tag']:[]}));
    window.renderHistory=()=>ReactDOM.render(e(React.Fragment,null,...commits.map((commit,i)=>e('div',{key:commit.sha,className:'list-item'+(i===5?' selected':''),'data-row':i,onMouseDown:()=>window.rowActivations++,onClick:()=>window.rowActivations++,onDoubleClick:()=>window.rowActivations++,onContextMenu:e=>{e.preventDefault();window.contextMenus++}},e(load('row').CommitListItem,{gitHubRepository:{},onOpenActions:(target,sha)=>window.openedActions.push({target,sha}),commit,selectedCommits:[],emoji:new Map(),showUnpushedIndicator:[0,4,6].includes(i),unpushedIndicatorTitle:'Not pushed',accounts:[{id:1,login:'fixture',endpoint:'https://api.github.com',apiType:'dotcom',token:'fixture-only',refreshToken:''}],preferAbsoluteDates:false,showConventionalCommitBadges:false})))),document.getElementById('commit-list'));
    window.closeHistory=()=>ReactDOM.unmountComponentAtNode(document.getElementById('commit-list'));
    renderHistory();
  `,
  })
  await page.waitForFunction(
    () => document.querySelectorAll('.commit-actions-status-icon').length === 5
  )
  assert.equal(await page.evaluate(() => window.requests), 8)
  const geometry = []
  for (const theme of ['theme-dark', 'theme-light']) {
    await page.evaluate(theme => {
      document.body.className = theme
    }, theme)
    for (const width of [1000, 600, 360]) {
      await page.setViewportSize({ width, height: 650 })
      await page.waitForTimeout(100)
      await page.screenshot({
        path: path.join(output, `${theme}-${width}.png`),
      })
      const rows = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.list-item')).map(row => {
          const r = row.getBoundingClientRect()
          const center = el => {
            if (!el) return null
            const b = el.getBoundingClientRect()
            return {
              x: b.x + b.width / 2,
              y: b.y + b.height / 2,
              width: b.width,
            }
          }
          return {
            x: r.x,
            right: r.right,
            y: r.y + r.height / 2,
            arrow: center(row.querySelector('.unpushed-indicator')),
            status: center(row.querySelector('.commit-actions-status-icon')),
            overflow: row.scrollWidth - row.clientWidth,
          }
        })
      )
      const axis = rows[0].arrow.x
      for (const row of rows) {
        const last = row.arrow ?? row.status
        if (last) {
          assert.ok(
            Math.abs(last.x - axis) < 0.5,
            'History indicator centers must share one right-hand column: ' +
              JSON.stringify(rows)
          )
          assert.ok(
            Math.abs(last.y - row.y) < 1,
            'Indicator must be vertically centered'
          )
        }
        assert.ok(
          row.overflow < 2,
          'History row must not overflow at narrow widths'
        )
        if (row.arrow && row.status) {
          assert.ok(
            row.status.x + row.status.width / 2 <=
              row.arrow.x - row.arrow.width / 2,
            'Both indicators must remain visible without overlap'
          )
        }
      }
      geometry.push({ theme, width, rows })
    }
  }
  // A real row teardown/remount must hydrate before the asynchronous observer.
  const cachedImmediately = await page.evaluate(() => {
    window.closeHistory()
    window.renderHistory()
    return document.querySelectorAll('.commit-actions-status-icon').length
  })
  assert.equal(
    cachedImmediately,
    5,
    'Reopening History must paint cached status immediately'
  )
  await page.waitForTimeout(100)
  for (let i = 0; i < 25; i++) {
    await page.evaluate(() => window.renderHistory())
    await page.setViewportSize({ width: i % 2 ? 1000 : 360, height: 650 })
  }
  assert.equal(
    await page.evaluate(() => window.requests),
    8,
    'Layout changes and reopening must not trigger extra requests while fresh'
  )
  const actionButton = page.locator(
    '[data-row="1"] .commit-actions-status-button'
  )
  await actionButton.click()
  await actionButton.focus()
  await page.keyboard.press('Enter')
  await page.keyboard.press('Space')
  await actionButton.click({ button: 'right' })
  const navigation = await page.evaluate(() => ({
    opened: window.openedActions,
    rows: window.rowActivations,
    menus: window.contextMenus,
    requests: window.requests,
  }))
  assert.equal(
    navigation.opened.length,
    3,
    'Click, Enter and Space must each open once'
  )
  assert.ok(
    navigation.opened.every(
      item =>
        item.sha === '1'.repeat(40) &&
        item.target.owner === 'fixture' &&
        item.target.name === 'repository'
    )
  )
  assert.equal(
    navigation.rows,
    0,
    'Badge activation must not select, drag or double-click a row'
  )
  assert.equal(
    navigation.menus,
    1,
    'Right click must still reach the commit context menu'
  )
  assert.equal(
    navigation.requests,
    8,
    'Navigation must not invalidate the badge cache'
  )
  fs.writeFileSync(
    path.join(output, 'navigation.json'),
    JSON.stringify({ passed: true, ...navigation }, null, 2) + '\n'
  )
  assert.deepEqual(errors, [])
  fs.writeFileSync(
    path.join(output, 'geometry.json'),
    JSON.stringify(
      { passed: true, requests: 8, themes: 2, widths: 3, geometry },
      null,
      2
    ) + '\n'
  )
  await page.evaluate(() => window.closeHistory())
  console.log(
    'PASS: aligned centers in 2 themes × 3 widths; both indicators preserved; cached remount and 25 layout updates kept 8 initial requests.'
  )
} finally {
  await browser.close()
}

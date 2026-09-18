const fs = require('fs')
function replace(file, before, after) {
  const source = fs.readFileSync(file, 'utf8')
  if (source.split(before).length !== 2) {
    throw new Error(`Expected one replacement target in ${file}: ${before}`)
  }
  fs.writeFileSync(file, source.replace(before, after))
}
const popup = 'app/src/models/popup.ts'
replace(popup, "  PullRequestComment = 'PullRequestComment',", "  PullRequestComment = 'PullRequestComment',\n  IssueDetail = 'IssueDetail',")
replace(popup, 'export type PopupDetail =\n', `export type PopupDetail =
  | {
      type: PopupType.IssueDetail
      repository: GitHubRepository
      issueNumber: number
    }
`)
const app = 'app/src/ui/app.tsx'
replace(app, "import * as React from 'react'", "import * as React from 'react'\nimport { IssueDetailDialog } from './branches/issue-detail-dialog'")
replace(app, '      case PopupType.MultiCommitOperation: {', `      case PopupType.IssueDetail:
        return (
          <IssueDetailDialog
            key={\`issue-\${popup.repository.hash}-\${popup.issueNumber}\`}
            repository={popup.repository}
            issueNumber={popup.issueNumber}
            dispatcher={this.props.dispatcher}
            emoji={this.state.emoji}
            underlineLinks={this.state.underlineLinks}
            onDismissed={onPopupDismissedFn}
          />
        )
      case PopupType.MultiCommitOperation: {`)
const list = 'app/src/ui/branches/issue-list.tsx'
replace(list, "import { IAPIIssueDetails } from '../../lib/api'\nimport { Emoji } from '../../lib/emoji'\nimport { IssueDetail } from './issue-detail'", "import { FoldoutType } from '../../lib/app-state'\nimport { PopupType } from '../../models/popup'")
replace(list, '  readonly emoji: Map<string, Emoji>\n  readonly underlineLinks: boolean\n', '')
replace(list, `  readonly openedIssue: IIssueHit | null
  readonly issueDetails: IAPIIssueDetails | null
  readonly isLoadingDetails: boolean
  readonly issueDetailsError: boolean
`, '')
for (const indent of ['      ', '        ']) {
  const block = `${indent}openedIssue: null,\n${indent}issueDetails: null,\n${indent}isLoadingDetails: false,\n${indent}issueDetailsError: false,\n`
  const source = fs.readFileSync(list, 'utf8')
  const expected = indent.length === 6 ? 2 : 1
  if (source.split(block).length - 1 !== expected) throw new Error('Unexpected issue state blocks')
  fs.writeFileSync(list, source.split(block).join(''))
}
replace(list, `    if (this.state.openedIssue !== null) {
      return this.renderOpenedIssue()
    }

`, '')
let source = fs.readFileSync(list, 'utf8')
const start = source.indexOf('  private renderOpenedIssue = () => {')
const end = source.indexOf('  private renderIssue = ', start)
if (start < 0 || end < 0) throw new Error('Missing old issue details renderer')
source = source.slice(0, start) + source.slice(end)
const click = source.indexOf('  private onItemClick = (item: IIssueListItem) => {')
if (click < 0) throw new Error('Missing issue click handler')
source = source.slice(0, click) + `  private onItemClick = (item: IIssueListItem) => {
    const repository = getNonForkGitHubRepository(this.props.repository)
    this.props.dispatcher.closeFoldout(FoldoutType.Branch)
    this.props.dispatcher.showPopup({
      type: PopupType.IssueDetail,
      repository,
      issueNumber: item.issue.number,
    })
  }
}
`
fs.writeFileSync(list, source)
replace('app/src/ui/branches/branches-container.tsx', `        issuesStore={this.props.issuesStore}
        emoji={this.props.emoji}
        underlineLinks={this.props.underlineLinks}
`, `        issuesStore={this.props.issuesStore}
`)
const branchesCSS = 'app/styles/ui/_branches.scss'
source = fs.readFileSync(branchesCSS, 'utf8')
const cssStart = source.indexOf('\n.issue-detail {')
if (cssStart < 0 || !source.includes('\n.issue-detail-state {')) throw new Error('Missing old issue layout styles')
fs.writeFileSync(branchesCSS, source.slice(0, cssStart).trimEnd() + '\n')
replace('app/styles/ui/_dialog.scss', "@import 'dialogs/pull-request-comment-like';", "@import 'dialogs/pull-request-comment-like';\n@import 'dialogs/issue-detail';")
const md = 'app/src/ui/lib/sandboxed-markdown.tsx'
replace(md, '  private lastContainerHeight = -Infinity', `  private contentResizeObserver: ResizeObserver | null = null

  private lastContainerHeight = -Infinity`)
replace(md, '    const oldDocument = this.frameRef.contentDocument', `    this.contentResizeObserver?.disconnect()
    const oldDocument = this.frameRef.contentDocument`)
replace(md, "    document.removeEventListener('scroll', this.onDocumentScroll)", `    document.removeEventListener('scroll', this.onDocumentScroll)
    this.onDocumentScroll.cancel()
    this.contentResizeObserver?.disconnect()`)
replace(md, `    this.refreshHeight()

    Array.from(doc.querySelectorAll('img'))`, `    this.contentResizeObserver?.disconnect()
    this.contentResizeObserver = new ResizeObserver(this.refreshHeight)
    const content = doc.getElementById('content')
    if (content !== null) {
      this.contentResizeObserver.observe(content)
    }
    this.refreshHeight()

    Array.from(doc.querySelectorAll('img'))`)
const test = 'script/issue-reader-layout-test.mjs'
source = fs.readFileSync(test, 'utf8').replaceAll('window.closed', 'window.readerClosed')
source = source.replace("chromium.launch({ headless: true })", "chromium.launch({ headless: true, args: ['--disable-web-security'] })")
source = source.replace("page.on('pageerror', error => errors.push(error.message))", "page.on('pageerror', error => { errors.push(error.message); console.error('Browser error:', error.message) })")
fs.writeFileSync(test, source)

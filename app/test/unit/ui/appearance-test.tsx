import assert from 'node:assert'
import { after, before, describe, it } from 'node:test'
import * as React from 'react'
import { render, screen, fireEvent } from '../../helpers/ui/render'
import { Appearance } from '../../../src/ui/preferences/appearance'
import {
  defaultDiffFontFamily,
  defaultDiffFontSize,
} from '../../../src/models/diff-font'
import { BranchSortOrder } from '../../../src/models/branch-sort-order'
import { ShowBranchNameInRepoListSetting } from '../../../src/models/show-branch-name-in-repo-list'
import { ApplicationTheme } from '../../../src/ui/lib/application-theme'
import {
  getDateFormatPreference,
  getTimeFormatPreference,
  getNumberFormatPreference,
} from '../../../src/models/formatting-preferences'

function renderAppearance(alwaysShowWorktreeList = false) {
  const changes: boolean[] = []
  const props = {
    selectedTheme: ApplicationTheme.Light,
    onSelectedThemeChanged: () => {},
    recentRepositoriesCount: 5,
    onRecentRepositoriesCountChanged: () => {},
    selectedDiffFontSize: defaultDiffFontSize,
    onSelectedDiffFontSizeChanged: () => {},
    selectedDiffFontFamily: defaultDiffFontFamily,
    onSelectedDiffFontFamilyChanged: () => {},
    titleBarStyle: 'custom' as const,
    onTitleBarStyleChanged: () => {},
    showWorktrees: true,
    onShowWorktreesChanged: () => {},
    showWorktreesInRepoList: true,
    onShowWorktreesInRepoListChanged: () => {},
    showCompareTab: true,
    onShowCompareTabChanged: () => {},
    showConventionalCommitBadges: true,
    onShowConventionalCommitBadgesChanged: () => {},
    showBranchNameInRepoList: ShowBranchNameInRepoListSetting.Never,
    onShowBranchNameInRepoListChanged: () => {},
    branchSortOrder: BranchSortOrder.LastModified,
    onBranchSortOrderChanged: () => {},
    selectedTabSize: 4,
    onSelectedTabSizeChanged: () => {},
    selectedDateFormat: getDateFormatPreference(),
    onSelectedDateFormatChanged: () => {},
    selectedTimeFormat: getTimeFormatPreference(),
    onSelectedTimeFormatChanged: () => {},
    selectedNumberFormat: getNumberFormatPreference(),
    onSelectedNumberFormatChanged: () => {},
    preferAbsoluteDates: false,
    onPreferAbsoluteDatesChanged: () => {},
    alwaysShowWorktreeList,
    onAlwaysShowWorktreeListChanged: (value: boolean) => changes.push(value),
  }
  const view = render(<Appearance {...props} />)
  return { ...view, props, changes }
}

describe('Appearance preferences', () => {
  const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts')
  const originalQuery = Object.getOwnPropertyDescriptor(
    globalThis,
    'queryLocalFonts'
  )

  before(() => {
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { check: () => false },
    })
    Object.defineProperty(globalThis, 'queryLocalFonts', {
      configurable: true,
      value: async () => [],
    })
  })
  after(async () => {
    // Let Appearance finish its deferred font discovery before restoring APIs.
    await new Promise(resolve => setTimeout(resolve, 0))
    if (originalFonts) {
      Object.defineProperty(document, 'fonts', originalFonts)
    } else {
      Reflect.deleteProperty(document, 'fonts')
    }
    if (originalQuery) {
      Object.defineProperty(globalThis, 'queryLocalFonts', originalQuery)
    } else {
      Reflect.deleteProperty(globalThis, 'queryLocalFonts')
    }
  })

  it('shows the always-show preference with the fork worktree settings', () => {
    renderAppearance()

    const heading = screen.getByRole('heading', { name: 'Worktrees' })
    const checkbox = screen.getByRole('checkbox', {
      name: 'Always show worktree list',
    })
    assert.strictEqual(
      heading.parentElement,
      checkbox.closest('.advanced-section')
    )
    assert.ok(
      screen.getByRole('checkbox', {
        name: 'Show worktrees dropdown in toolbar',
      })
    )
    assert.ok(
      screen.getByRole('checkbox', {
        name: 'Show worktrees in repository list',
      })
    )
    assert.ok(checkbox instanceof HTMLInputElement)
    assert.strictEqual(checkbox.checked, false)
  })

  it('reports enabling and disabling the preference and reflects updated props', () => {
    const { rerender, props, changes } = renderAppearance()
    const checkbox = screen.getByRole('checkbox', {
      name: 'Always show worktree list',
    })
    fireEvent.click(checkbox)
    assert.deepStrictEqual(changes, [true])

    rerender(<Appearance {...props} alwaysShowWorktreeList={true} />)
    assert.ok(checkbox instanceof HTMLInputElement)
    assert.strictEqual(checkbox.checked, true)

    fireEvent.click(checkbox)
    assert.deepStrictEqual(changes, [true, false])
  })
})

import assert from 'node:assert'
import { describe, it } from 'node:test'
import * as React from 'react'
import { BranchesContainer } from '../../../src/ui/branches/branches-container'
import { fireEvent, render, screen } from '../../helpers/ui/render'

// Render the remote switcher in isolation: these tests exercise the saved
// preference recovery without mounting the unrelated branch/PR lists.
describe('saved sync preference recovery', () => {
  for (const names of [
    [],
    ['origin'],
    ['origin', 'backup', 'third'],
    ['origin', 'github-desktop-pr'],
  ]) {
    it(`allows disabling Sync with ${names.length} configured remotes`, () => {
      let saved: boolean | undefined
      const props = {
        repository: { workflowPreferences: { syncRemotes: true } },
        currentBranch: null,
        allBranches: [],
        dispatcher: {
          updateRepositoryWorkflowPreferences: (
            _repository: unknown,
            value: { syncRemotes: boolean }
          ) => {
            saved = value.syncRemotes
          },
        },
      } as unknown as React.ComponentProps<typeof BranchesContainer>
      const container = new BranchesContainer(props)
      container.state = {
        ...container.state,
        loadingRemotes: false,
        remotes: names.map(name => ({
          name,
          url: `https://example.com/${name}`,
        })),
      }
      render(container['renderRemoteSwitcher']())
      const toggle = screen.getByRole('checkbox', {
        name: 'Sync with toolbar (requires exactly two user remotes)',
      })
      assert.equal((toggle as HTMLInputElement).checked, true)
      fireEvent.click(toggle)
      assert.equal(saved, false)
    })
  }
})

# GH Desktop Plus

This is an **up-to-date** fork of [GitHub Desktop](https://desktop.github.com) with additional features and improvements.

> [!IMPORTANT]
> This is a community-maintained project. It **is not** an official GitHub product. 

## Highlights 👀
| <h4>Search commits by title, message, tag, or hash</h4> | <h4>Rich integration with all major Git platforms [^1]</h4> |
| :---: | :---: |
| <img src="docs/assets/desktop-plus-demo-search.webp" alt="Commit search" width="450"> | <img src="docs/assets/desktop-plus-demo-multiaccount.webp" alt="Multiple accounts" width="450"> |
| <h4>Create multiple stashes per branch</h4> | <h4>Visualize the Commit Graph</h4> |
| <img src="docs/assets/desktop-plus-demo-stashes.webp" alt="Multiple stashes" width="450"> | <img src="docs/assets/desktop-plus-demo-commit-graph.webp" alt="Commit Graph" width="450"> |
| <h4>Buttons optimized for visual recognition</h4> | <h4>Quickly find unpushed branches</h4> |
| <img src="docs/assets/desktop-plus-demo-stash-header.webp" alt="Stash header" width="450"> | <img src="docs/assets/desktop-plus-demo-push-indicator.webp" alt="Branch push indicator" width="450"> |

[^1]: Rich integration with GitHub, GitHub Enterprise, Bitbucket Cloud, GitLab Cloud, self-hosted GitLab, Codeberg Cloud, self-hosted Forgejo, Gitea Cloud, and self-hosted Gitea. Multi-account support is available for all of them (e.g., sign in to multiple GitHub accounts at the same time).

## Additional Features in Desktop Plus ✨

**See the [full list of features here](https://desktop-plus.org/#feature-list).**

<details>
<summary>See demo video</summary>

<video src="https://github.com/user-attachments/assets/a1be6c03-8773-4608-be13-152b5e12c5a9"></video>

</details>

## Download and Installation 📦

Download this fork from the [ViktorSMI/desktop-plus releases page](https://github.com/ViktorSMI/desktop-plus/releases). Choose the release channel and asset for your operating system and architecture.

Packages distributed by upstream Desktop Plus through Winget, Homebrew, APT, RPM, AUR, Flathub, or AM/AppMan install the upstream application, not this fork. This fork does not currently publish its own packages through those channels.

### Windows

Use the `.exe` installer for your architecture. Installed Windows builds using Squirrel support automatic updates from this fork's release feed, including downloading and applying the update. Restart when prompted to finish installing it.

Portable builds require a manual download and replacement. MSI packages, when provided, are intended for enterprise deployment; use the regular installer for a Squirrel-managed installation.

### macOS

Download and extract the ZIP for Intel (`x64`) or Apple Silicon (`arm64`). Updates require manually downloading and installing the new release. The app can notify you of a newer release and open its download page, but does not install macOS updates automatically.

### Linux

Download a compatible asset from this fork's releases. Updates require manually downloading and installing the new release; update notifications link to the release page.

For an AppImage, make the downloaded file executable before running it. Sign-in may require a desktop entry registering the `x-github-desktop-auth` URL scheme. Linux credential storage requires an available Secret Service implementation such as `gnome-keyring`; desktop notifications may require `libnotify`.

## Common issues 🛠️

Before opening a new issue, please check the [Known Issues](docs/known-issues.md) document for common issues and their workarounds.

## Command Line Interface 💻

Desktop Plus includes a CLI (`desktop-plus-cli`) for opening and cloning repositories from the terminal. See the [CLI documentation](docs/cli.md) for usage details and instructions on creating a shorter alias.

## Running the app locally 🏗️

### From the terminal

```bash
corepack enable  # Install yarn if needed
yarn             # Install dependencies
yarn build:dev   # Initial build
yarn start       # Start the app for development and watch for changes
```

- It's normal for the app to take a while to start up, especially the first time.

- While starting up, this error is normal: `UnhandledPromiseRejectionWarning: Error: Invalid header: Does not start with Cr24`

- You don't need to restart the app to apply changes. Just reload the window (`Ctrl + Alt + R` / `Cmd + Alt + R`).

- Changes to the code inside `main-process` do require a full rebuild. Stop the app and run `yarn build:dev` again.

- [Read this document](docs/contributing/setup.md) for more information on how to set up your development environment.

### From VSCode

The first time you open the project, install the dependencies by running:
```bash
corepack enable
yarn
```

Then, you can simply build and run the app by pressing `F5`.  
Breakpoints should be set in the developer tools, not the VSCode editor.

### Running tests

I recommend running the tests in a Docker container for reproducibility and to avoid conflicts with your git configuration.  
After installing the dependencies with `yarn`, make sure you have Docker installed and run:

```bash
yarn test:docker
```

## Why this fork?

First, because [shiftkey's fork](https://github.com/shiftkey/desktop) is currently unmaintained (the last commit was in February 2025), so all Linux users are no longer getting the latest features and fixes from the official GitHub Desktop repository.

Secondly, I think the official GitHub Desktop app is very slow in terms of updates and lacks some advanced features that I'd like. This fork has low code quality requirements compared to the official repo, so I (and hopefully you as well) can add features and improvements quickly.  
This fork also focuses on integrating nicely with Bitbucket, since I use it for work and haven't found a good Linux GUI client for it.

Keep in mind that this version is not endorsed by GitHub, and it's aimed at power users with technical knowledge. If you're looking for a polished and stable product, I recommend using the official GitHub Desktop app instead.

## Acknowledgments 🙏

Application icon adapted from [`git-branch-plus`](https://lucide.dev/icons/git-branch-plus) by [Lucide](https://lucide.dev), [ISC license](https://github.com/lucide-icons/lucide/blob/main/LICENSE).

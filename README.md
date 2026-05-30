<p align="right">
  <a href="README.md">English</a> |
  <a href="./doc/README-CN.md">简体中文</a>
</p>

> **Personal fork** — this branch (`Alterego-42/chatbox-session-grouping`) extends Chatbox CE with sidebar session grouping, selective export / import, and an AI assistant that can reorganize the sidebar via tool calls. It is built for personal use only; no upstream PR is planned.

## What this fork adds on top of upstream

All work sits on top of upstream `release 1.20.1` (`6e5ea630`). The branch holds **17 commits** spanning seven feature themes, with no regressions to the inherited `tsc` baseline.

### Sidebar session groups
- One-level group nesting (root → children) — deeper nesting is intentionally rejected at the schema layer to keep v1 design tight.
- Per-group color (Mantine `ColorInput` with preset swatches) — clearing returns to the theme default.
- Group duplication that clones every session inside, including direct child subgroups.
- Drag-and-drop powered by `dnd-kit` with a single flattened `SortableContext`. UX details:
  - DragOverlay with explicit before/after/inside drop indicators (no more swap-then-snap-back).
  - Right-edge "unnest zone" — drag toward the right edge to un-nest a child group or move a grouped session to **Unassigned**, working under `restrictToVerticalAxis`.
  - Inside-drop on a group's own parent reorders the active group to the front (recovers the otherwise-narrow first slot).
- Group-node action menu: rename / set color / duplicate / delete (delete uses double-check to prevent accidental data loss).
- New "Unassigned" bucket for sessions without a group — visible as a virtual root.

### Selective export / import
- Dual-layer checkbox tree (groups + sessions) with `indeterminate` state, virtual `__unassigned__` id, and group-aware import that merges `session-groups-list` with `uniqBy(... 'id')`.
- Old `1.20.x` export files (no `session-groups-list` key) import gracefully.
- Fixes a pre-existing bug where `SessionGroupsList` was silently absent from the export whitelist.

### AI Manager session (pinned at sidebar bottom-left)
- Reserved system session `__chatbox_session_manager__`, persisted, idempotently created on bootstrap, and never showing up in the sortable list.
- 23 model-callable tools, exposed only inside this special session via `stream-text.ts`:
  - **Single-target**: `list_sessions / list_groups / move_session / rename_session / duplicate_session / delete_session / create_group / rename_group / reorder_group / duplicate_group / set_group_color / set_group_parent / delete_group`.
  - **Batch**: `bulk_move / bulk_rename_sessions / bulk_delete_sessions / bulk_update_groups / bulk_create_groups` — single confirmation per batch, with the assistant prompted to prefer batches over per-item loops.
  - **Content read**: `get_session_summary / bulk_get_summaries / get_session_messages` — read cached summaries, regenerate on demand, or fall back to last-N message text with per-message char limits.
  - **Auto-organize hook**: `auto_organize` (currently a no-op `OrganizeStrategy`) + `apply_organize_proposal` — interface ready, LLM strategy not yet wired.
- All destructive actions go through a `ConfirmDangerousAction` Nice Modal that returns `Promise<boolean>` with a 1-second initial Confirm-button disable.

### Adaptive session summaries
- Default summary prompt now classifies the conversation type (development task / Q&A / brainstorm / role-play / consultation / casual chat) before summarizing, instead of forcing every session through the same template.
- Resolution chain at generation time: `session.summaryPrompt` → `globalSettings.defaultSessionSummaryPrompt` → built-in default. Both per-session and global overrides are editable in their respective settings panes.

### OpenAI Responses API tool-use fix
- Force `store: false` for the API-key path (already true for OAuth) so multi-turn tool calls work. Without this, OpenAI returns `function_call_output requires item_reference ids matching each call_id` because we don't track `previous_response_id` and `ai-sdk` drops the `itemId` needed for `item_reference`. No token-cost impact — prompt caching is independent of `store`.

### Local dev unblockers
- `electron.vite.config.ts` `optimizeDeps` extension to dodge the MUI v5 + Vite 7 + pnpm-hoisted `createTheme_default is not a function` crash on first render.
- `engine-strict=false` in `.npmrc` so Node 24 doesn't refuse to run the upstream `engines.node "<23"` constraint.
- Three minimal stubs (`shared/oauth/index.ts`, `shared/providers/definitions/github-copilot.ts`, `renderer/packages/translation.ts`) for upstream-incomplete imports.
- `getAllStoreKeys` IPC handler added in `src/main/main.ts` — without it, the export feature silently produced 184-byte JSON files containing only metadata.

### Tests
- 50+ new vitest cases covering `routeDragEnd`, `buildFlatTree`, group store guards, `duplicateGroup`, and selective export helpers.
- `tsc --noEmit`: holds steady at the upstream-inherited baseline (224 errors), with **zero** added by this branch.

---

This is the repository for the Chatbox Community Edition, open-sourced under the GPLv3 license.

[Chatbox is going open-source Again!](https://github.com/chatboxai/chatbox/issues/2266)

We regularly sync code from the pro repo to this repo, and vice versa.

### Download for Desktop

<table style="width: 100%">
  <tr>
    <td width="25%" align="center">
      <b>Windows</b>
    </td>
    <td width="25%" align="center" colspan="2">
      <b>MacOS</b>
    </td>
    <td width="25%" align="center">
      <b>Linux</b>
    </td>
  </tr>
  <tr style="text-align: center">
    <td align="center" valign="middle">
      <a href='https://chatboxai.app/?c=download-windows'>
        <img src='./doc/statics/windows.png' style="height:24px; width: 24px" />
        <br />
        <b>Setup.exe</b>
      </a>
    </td>
    <td align="center" valign="middle">
      <a href='https://chatboxai.app/?c=download-mac-intel'>
        <img src='./doc/statics/mac.png' style="height:24px; width: 24px" />
        <br />
        <b>Intel</b>
      </a>
    </td>
    <td align="center" valign="middle">
      <a href='https://chatboxai.app/?c=download-mac-aarch'>
        <img src='./doc/statics/mac.png' style="height:24px; width: 24px" />
        <br />
        <b style="white-space: nowrap;">Apple Silicon</b>
      </a>
    </td>
    <td align="center" valign="middle">
      <a href='https://chatboxai.app/?c=download-linux'>
        <img src='./doc/statics/linux.png' style="height:24px; width: 24px" />
        <br />
        <b>AppImage</b>
      </a>
    </td>
  </tr>
</table>

### Download for iOS/Android

<a href='https://apps.apple.com/app/chatbox-ai/id6471368056' style='margin-right: 4px'>
<img src='./doc/statics/app_store.webp' style="height:38px;" />
</a>
<a href='https://play.google.com/store/apps/details?id=xyz.chatboxapp.chatbox' style='margin-right: 4px'>
<img src='./doc/statics/google_play.png' style="height:38px;" />
</a>
<a href='https://chatboxai.app/install?download=android_apk' style='margin-right: 4px; display: inline-flex; justify-content: center'>
<img src='./doc/statics/android.png' style="height:28px; display: inline-block" />
.APK
</a>

For more information: [chatboxai.app](https://chatboxai.app/)

## Quick Start

### For End Users
1. Download the appropriate installer for your platform from the [releases page](https://github.com/chatboxai/chatbox/releases)
2. Install and launch Chatbox
3. Configure your AI provider (OpenAI, Claude, etc.) in settings
4. Start chatting!

### System Requirements

| Platform | Minimum Version | Architecture |
|----------|----------------|--------------|
| Windows | Windows 10 | x64 |
| macOS | macOS 11 (Big Sur) | Intel/Apple Silicon |
| Linux | Ubuntu 20.04+ / AppImage supported distros | x64 |

---
<div align="center" markdown="1">
  <a href="https://go.warp.dev/chatbox">
    <img alt="Warp sponsorship" width="400" src="https://raw.githubusercontent.com/warpdotdev/brand-assets/refs/heads/main/Github/Sponsor/Warp-Github-LG-02.png">
  </a>

### [Warp, built for coding with multiple AI agents.](https://go.warp.dev/chatbox)
[Available for MacOS, Linux, & Windows](https://go.warp.dev/chatbox)<br>
</div>

<hr>

<h1 align="center">
<img src='./doc/statics/icon.png' width='30'>
<span>
    Chatbox
    <span style="font-size:8px; font-weight: normal;">(Community Edition)</span>
</span>
</h1>
<p align="center">
    <em>Your Ultimate AI Copilot on the Desktop. <br />Chatbox is a desktop client for ChatGPT, Claude and other LLMs, available on Windows, Mac, Linux</em>
</p>

<p align="center">
<a href="https://github.com/chatboxai/chatbox/releases" target="_blank">
<img alt="macOS" src="https://img.shields.io/badge/-macOS-black?style=flat-square&logo=apple&logoColor=white" />
</a>
<a href="https://github.com/chatboxai/chatbox/releases" target="_blank">
<img alt="Windows" src="https://img.shields.io/badge/-Windows-blue?style=flat-square&logo=windows&logoColor=white" />
</a>
<a href="https://github.com/chatboxai/chatbox/releases" target="_blank">
<img alt="Linux" src="https://img.shields.io/badge/-Linux-yellow?style=flat-square&logo=linux&logoColor=white" />
</a>
<a href="https://github.com/chatboxai/chatbox/releases" target="_blank">
<img alt="Downloads" src="https://img.shields.io/github/downloads/chatboxai/chatbox/total.svg?style=flat" />
</a>
<a href="#features">
<img alt="Privacy" src="https://img.shields.io/badge/-Local%20First-green?style=flat-square&logo=shield&logoColor=white" />
</a>
</p>

<a href="https://www.producthunt.com/posts/chatbox?utm_source=badge-featured&utm_medium=badge&utm_souce=badge-chatbox" target="_blank"><img src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=429547&theme=light" alt="Chatbox - Better&#0032;UI&#0032;&#0038;&#0032;Desktop&#0032;App&#0032;for&#0032;ChatGPT&#0044;&#0032;Claude&#0032;and&#0032;other&#0032;LLMs&#0046; | Product Hunt" style="width: 150px; height: 30px;" width="100" height="40" /></a>

<a href="./doc/statics/snapshot_light.png">
<img src="./doc/statics/snapshot_light.png" width="400"/>
</a>
<a href="./doc/statics/snapshot_dark.png">
<img src="./doc/statics/snapshot_dark.png" width="400"/>
</a>

<!-- <table>
<tr>
<td>
<img src="./dec/../doc/demo_mobile_1.png" alt="App Screenshot" style="box-shadow: 2px 2px 10px rgba(0,0,0,0.1); border: 1px solid #ddd; border-radius: 8px; height: 300px" />
</td>
<td>
<img src="./dec/../doc/demo_mobile_2.png" alt="App Screenshot" style="box-shadow: 2px 2px 10px rgba(0,0,0,0.1); border: 1px solid #ddd; border-radius: 8px; height: 300px" />
</td>
</tr>
</table> -->

## Features

### 🤖 AI Model Support
-   **Support for Multiple LLM Providers**  
    :gear: Seamlessly integrate with a variety of cutting-edge language models:
    -   OpenAI (ChatGPT)
    -   Azure OpenAI
    -   Claude
    -   Google Gemini Pro
    -   Ollama (enable access to local models like llama2, Mistral, Mixtral, codellama, vicuna, yi, and solar)
    -   ChatGLM-6B

-   **Image Generation with Dall-E-3**  
    :art: Create the images of your imagination with Dall-E-3.

-   **Enhanced Prompting**  
    :speech_balloon: Advanced prompting features to refine and focus your queries for better responses.

### 🖥️ User Experience
-   **Local Data Storage**  
    :floppy_disk: Your data remains on your device, ensuring it never gets lost and maintains your privacy.

-   **No-Deployment Installation Packages**  
    :package: Get started quickly with downloadable installation packages. No complex setup necessary!

-   **Ergonomic UI & Dark Theme**  
    :new_moon: A user-friendly interface with a night mode option for reduced eye strain during extended use.

-   **Keyboard Shortcuts**  
    :keyboard: Stay productive with shortcuts that speed up your workflow.

-   **Streaming Reply**  
    :arrow_forward: Provide rapid responses to your interactions with immediate, progressive replies.

### 📄 Content & Formatting
-   **Markdown, Latex & Code Highlighting**  
    :scroll: Generate messages with the full power of Markdown and Latex formatting, coupled with syntax highlighting for various programming languages, enhancing readability and presentation.

-   **Prompt Library & Message Quoting**  
    :books: Save and organize prompts for reuse, and quote messages for context in discussions.

### 👥 Collaboration & Sharing
-   **Team Collaboration**  
    :busts_in_silhouette: Collaborate with ease and share OpenAI API resources among your team. [Learn More](./team-sharing/README.md)

### 🌐 Platform Availability
-   **Cross-Platform Desktop**  
    :computer: Chatbox is ready for Windows, Mac, and Linux users.

-   **Web Version**  
    :globe_with_meridians: Use the web application on any device with a browser, anywhere.

-   **Mobile Apps**  
    :phone: Native iOS and Android applications for on-the-go access.

### 🌍 Localization
-   **Multilingual Support**  
    :earth_americas: Catering to a global audience by offering support in multiple languages:
    -   English
    -   简体中文 (Simplified Chinese)
    -   繁體中文 (Traditional Chinese)
    -   日本語 (Japanese)
    -   한국어 (Korean)
    -   Français (French)
    -   Deutsch (German)
    -   Русский (Russian)
    -   Español (Spanish)

### ✨ More Features
-   **And More...**  
    :sparkles: Constantly enhancing the experience with new features!

## FAQ

-   [Frequently Asked Questions](./doc/FAQ.md)

## Why I made Chatbox?

I developed Chatbox initially because I was debugging some prompts and found myself in need of a simple and easy-to-use prompt and API debugging tool. I thought there might be more people who needed such a tool, so I open-sourced it.

At first, I didn't know that it would be so popular. I listened to the feedback from the open-source community and continued to develop and improve it. Now, it has become a very useful AI desktop application. There are many users who love Chatbox, and they not only use it for developing and debugging prompts, but also for daily chatting, and even to do some more interesting things like using well-designed prompts to make AI play various professional roles to assist them in everyday work...

## How to Contribute

We welcome contributions from the community! Here's how you can help make Chatbox better:

### 🐛 Reporting Issues
- Use [GitHub Issues](https://github.com/chatboxai/chatbox/issues) to report bugs or request features
- Before creating a new issue, please search existing issues to avoid duplicates
- Provide detailed information including steps to reproduce, expected behavior, and screenshots if applicable

### 🔧 Pull Requests
1. Fork the repository and create your branch from `main`
2. Make your changes and ensure the code follows our coding standards
3. Test your changes thoroughly
4. Update documentation if needed
5. Submit a pull request with a clear description of the changes

### 🌍 Translations
Help make Chatbox accessible to more people by contributing translations:
- Translation files are located in the `src/locales` directory
- Follow the existing translation format
- Submit a PR with your translation improvements

### 📖 Documentation
- Improve README, API documentation, or user guides
- Fix typos or clarify unclear instructions
- Add examples and tutorials

### 🌟 Other Ways to Contribute
- Star the repository to show your support
- Share Chatbox with others
- Answer questions in [GitHub Discussions](https://github.com/chatboxai/chatbox/discussions)
- Provide feedback and suggestions

**Thank you for contributing! 🙏**

## Development

### Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** (v20.x – v22.x) - [Download here](https://nodejs.org/)
- **pnpm** (v10.x or later) - Install via `corepack enable && corepack prepare pnpm@latest --activate`
- **Git** - [Download here](https://git-scm.com/)

### Quick Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/chatboxai/chatbox.git
   cd chatbox
   ```

2. **Install dependencies**
   ```bash
   pnpm install
   ```

3. **Start development server**
   ```bash
   pnpm run dev
   ```
   The application will start in development mode with hot-reload enabled.

### Build Commands

| Command | Description |
|---------|-------------|
| `pnpm run dev` | Start development server with hot-reload |
| `pnpm run package` | Build and package for current platform |
| `pnpm run package:all` | Build and package for all platforms |
| `pnpm run build` | Build for production without packaging |
| `pnpm run lint` | Run Biome to check code quality |
| `pnpm run test` | Run Vitest test suite |

### Project Structure

```
chatbox/
├── src/
│   ├── main/               # Electron main process
│   ├── renderer/           # React renderer (UI)
│   ├── preload/            # Electron preload scripts
│   └── shared/             # Shared utilities
├── doc/                    # Documentation and assets
├── resources/              # App resources and icons
├── team-sharing/           # Team collaboration features
└── package.json            # Project configuration
```

### Development Tips

- Use `pnpm run lint` before committing to ensure code quality
- Follow the existing code style and patterns
- Test your changes on both light and dark themes
- Ensure cross-platform compatibility when making UI changes

### Troubleshooting

**Issue**: `pnpm install` fails
- **Solution**: Ensure you're using pnpm (not npm or yarn) and Node.js version is within the required range. Run `corepack enable` if pnpm is not found.

**Issue**: Build fails on Windows
- **Solution**: Run `pnpm config set script-shell "C:\\Program Files\\git\\bin\\bash.exe"` if using Git Bash

**Issue**: Changes not reflecting in development
- **Solution**: Stop the dev server, delete `node_modules/.vite`, and restart

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=chatboxai/chatbox&type=Date)](https://star-history.com/#chatboxai/chatbox&Date)

## Contact

[Twitter](https://x.com/ChatboxAI_HQ) | [Email](mailto:hi@chatboxai.com)

## License

[LICENSE](./LICENSE)

# 📎 Paperclip Matrix

**Paperclip Matrix** is a full-stack Web control panel deployed locally on your workstation to orchestrate, monitor, and deploy autonomous AI agents ("remote workers") in a distributed swarm. 

It completely replaces traditional command-line operations with a graphical user interface, enabling operators to handle agent registration, task distribution, process monitoring, environment isolation, and cross-node communication—all through a single browser window. 

*Your Local AI Agent Army's "Human Resources Command Center".*

## 🌟 Key Features

- **Matrix Marketplace & Roster Drafts**: A shopping-cart style interface to build and mix custom "Agent Teams". Draft your Swarm by selecting specialized roles ranging from UI Engineers to Zero-Knowledge Proof Stewards.
- **Deep Localization (700+ Roles)**: Pre-compiled with an epic 700+ localized professional Chinese technical terminologies injected directly into the `matrix.db` SQLite core. Say goodbye to translation heuristics and hello to accurate, industry-standard titles like `完全自治效能优化架构师` and `SRE 工程师`.
- **SOUL Inspector (灵魂透视)**: Click 'Inspect' on any agent card to reveal their core `<SOUL.md>` identity, behavior patterns, and structural boundaries in a beautiful frosted glass overlay.
- **Top-Down Distributed Orchestration**: Employs a robust Top-Down Orchestration model where the Paperclip Server acts as the centralized Message Broker / RPC API Gateway. A CEO agent can seamlessly issue tasks via Tool Calls, and Paperclip routes the workload dynamically to the respective remote worker sandbox.
- **Absolute Sandbox Isolation**: Ignite worker processes (`child_process.spawn`) directly. Every spawned agent correctly operates in a sandboxed `$HOME` environment isolated from your host's configs.
- **System Telemetry**: Real-time radar for CPU idle-time gaps and Memory availability, preventing language models from eating all your workstation resources!

## ⚙️ Architecture

Built on the latest modern stack for seamless runtime orchestration:
- **Framework**: Next.js 16 (App Router)
- **Runtime**: Bun 
- **Frontend**: React 19 Client Components with a stunning Vanilla CSS Lovable-Warm-Night aesthetic.
- **Backend / Interop**: Node.js APIs binding seamlessly to a `.data/matrix.db` SQLite engine and utilizing RPC tunneling (FRP) and process isolation.

## 🚀 Getting Started

Ensure you have [Bun](https://bun.sh/) installed.

1. Clone this repository and CD into it.
2. The initial robust translation vocabulary and agent identities are localized safely inside your `.data/matrix.db`. (Note: The `.data` directory is purposefully GitIgnored).
3. Install dependencies:
   ```bash
   bun install
   ```
4. Start the dashboard server:
   ```bash
   bun dev
   ```
5. Open [http://localhost:3000](http://localhost:3000) 🥳

## 📁 Directory Structure

```text
paperclip-dashboard/
├── .data/                    # Runtime agent data (gitignored)
│   ├── matrix.db             # Core database powering Templates, Sync, and Roles!
│   ├── identities/           # Configuration keys
│   ├── workspaces/           # Isolated sandbox roots
│   └── archives/             # Compressed snapshots
├── src/
│   ├── app/                  # Next.js App Router API & Views
│   └── lib/                  # Core orchestration & telemetry models
└── ...
```

---

## ☕ Support / 支持

If you find this tool useful, consider buying me a coffee! 
如果觉得本项目好用，请我喝杯咖啡吧！让创造力与代码的温度持续燃烧！🔥

<a href="https://www.buymeacoffee.com/399is" target="_blank"><img src="https://img.buymeacoffee.com/button-api/?text=Buy me a coffee&emoji=&slug=399is&button_colour=FFDD00&font_colour=000000&font_family=Cookie&outline_colour=000000&coffee_colour=ffffff" alt="Buy Me A Coffee" /></a>

<p align="center">
  <img src="https://raw.githubusercontent.com/wair56/dataferry/master/BMC.png" width="260" alt="Buy Me A Coffee QR Code" style="margin-right: 20px" />
  <img src="https://raw.githubusercontent.com/wair56/dataferry/master/wechat.png" width="260" alt="WeChat Pay QR Code" />
</p>

### 📬 Contact & Feedback / 联系与建议
Got an idea or found a bug? Feel free to reach out or open an issue on GitHub!

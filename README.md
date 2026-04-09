# 📎 Paperclip Matrix

**Paperclip Matrix** is a full-stack Web control panel deployed locally on your workstation to orchestrate and monitor autonomous AI agents ("remote workers"). 

It completely replaces traditional command-line operations with a graphical user interface, enabling operators to handle agent registration, task distribution, process monitoring, environment isolation, and data backups—all through a single browser window. 

*Your Local AI Agent Army's "Human Resources Command Center".*

## 🌟 Key Features

- **Identity Onboarding (Auto-join)**: Agents can seamlessly register via UI and establish remote connections to receive API keys securely.
- **Worker Orchestration**: Ignite and terminate worker CLI processes directly with a click. Every spawned agent correctly operates in a sandboxed `$HOME` environment isolated from your host's configs.
- **System Telemetry**: Real-time radar for CPU idle-time gaps and Memory availability, preventing language models from eating all your workstation resources!
- **Sandbox Fast-Backups**: One-click ZIP archiving for your agent's workspace directory (`.data/workspaces`), purposefully ignoring massive `node_modules` closures.
- *(Upcoming) Antidetect Browser Bridge*: Integrated mapping for local browser fingerprinting profiles with WebSocket endpoint injection!

## ⚙️ Architecture

Built on the latest modern stack for seamless runtime orchestration:
- **Framework**: Next.js 16 (App Router)
- **Runtime**: Bun 
- **Frontend**: React 19 Client Components with a stunning Vanilla CSS Lovable-Warm-Night aesthetic.
- **Backend / Interop**: Node.js `child_process.spawn` for isolated environment injections.

## 🚀 Getting Started

Ensure you have [Bun](https://bun.sh/) installed.

1. Clone this repository and CD into it.
2. Install dependencies:
   ```bash
   bun install
   ```
3. Start the dashboard server:
   ```bash
   bun dev
   ```
4. Open [http://localhost:3000](http://localhost:3000) 🥳

## 📁 Directory Structure

```text
paperclip-dashboard/
├── .data/                    # Runtime agent data (gitignored)
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

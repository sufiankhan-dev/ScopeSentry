# 🛡️ ScopeSentry

**Stop scope creep before it starts.**

ScopeSentry is a privacy-first scope analysis tool for freelancers and agencies. It helps you identify when client requests drift beyond your agreed project scope by comparing your contract against your actual conversations.

Unlike traditional AI tools, ScopeSentry runs **entirely on your local machine**. Your sensitive contracts and client chats never leave your computer.

---

## 🚀 The Problem

Freelancers often face "scope creep"—the gradual expansion of a project's requirements without a corresponding increase in budget or timeline. Manually cross-referencing a 10-page agreement against weeks of Slack messages or emails is tedious and error-prone.

## ✨ Features

- **Local-First Analysis**: Powered by Gemma via Ollama. No cloud APIs, no data leaks.
- **Evidence-Based Findings**: Every finding is backed by exact quotes from your agreement and conversation.
- **Scope Classification**: Requests are automatically tagged as `in_scope`, `potentially_out_of_scope`, `unclear`, or `needs_review`.
- **Professional Reply Drafting**: Generate polite, grounded responses to clients based on verified evidence.
- **Zero Persistence**: No database. Your data lives in your browser tab and is wiped on refresh.



### 🖼️ Preview

![ScopeSentry Dashboard: Showing a project agreement on the left, a client chat on the right, and a structured analysis report in the center.](/api/placeholder/800/450)

*Example: Identifying an out-of-scope request for a brand guideline PDF.*

---



## 🛠️ Quick Start



### 1. Prerequisites

- **Node.js 20+**
- **Ollama**: The engine for local AI. [Download Ollama](https://ollama.com/download)



### 2. Install the AI Model

ScopeSentry uses the **Gemma** family of models. Open your terminal and pull the recommended model:

```powershell
# Recommended for most laptops (4GB RAM)
ollama pull gemma3:4b

# For faster iteration/low resources
ollama pull gemma3:1b

# For higher quality (requires more RAM)
ollama pull gemma3:12b
```



### 3. Configure and Run

```powershell
# Clone the repo
git clone <repository-url>
cd scopesentry

# Install dependencies
npm install

# Setup environment variables
cp .env.example .env.local
# Edit .env.local to ensure OLLAMA_MODEL matches the model you pulled (e.g., gemma3:4b)

# Start the app
npm run dev
```

Visit `http://localhost:3000` in your browser.

---



## 🧪 Demo Case

If you want to see it in action immediately, paste these into the app:

**Agreement:**

> Project: Brand identity refresh and small-business website.
> Scope: Brand refresh (logo, palette, typography) and high-fidelity design for six page templates.
> Not included: Photography, Copywriting, Front-end development, CMS configuration.

**Conversation:**

> Client: "Can you also produce a short brand guideline PDF so the team stops using the old logo in the cafe?"
> Me: "The agreement covers the refined logo files and palette. A written brand guideline document isn't in the six templates."

**Expected Result:** ScopeSentry should flag the "Brand Guideline PDF" as `potentially_out_of_scope`, citing the list of six page templates as the only included design deliverables.

---



## 🔒 Privacy Architecture

ScopeSentry is built on a "Zero-Trust Cloud" philosophy:

- **Local Inference**: The application communicates exclusively with `http://127.0.0.1:11434`.
- **No External Logging**: No telemetry, no analytics, no third-party API calls.
- **Ephemeral State**: No database is used. Your input and the resulting report exist only in the volatile memory of your current browser session.
- **Strict Validation**: All AI output is validated against Zod schemas and verified against the source text using deterministic string matching.



### ⚠️ Known Limitations

- **Hardware Dependent**: On CPU-only machines, a full analysis can take several minutes.
- **Initial Setup**: Internet access is required once to download Ollama and the Gemma model.
- **No File Parsing**: Current MVP accepts pasted text only (no PDF/Docx upload).
- **Offline Verification**: While inference is local, the "fully offline" state (network disabled) has not been formally verified in this release.

---



## 📈 Future Roadmap

- [ ] **PDF/Docx Support**: Direct upload of contracts and chat exports.
- [ ] **Batch Analysis**: Analyze multiple conversation threads at once.
- [ ] **Project Archiving**: Optional encrypted local storage for project history.
- [ ] **Customizable Guardrails**: Define your own "Out of Scope" keywords.

---



## 📝 Demo Checklist

- [ ] Ollama is running (`ollama list` shows `gemma3:4b`).
- [ ] `.env.local` is configured.
- [ ] App loads without errors at `localhost:3000`.
- [ ] Sample data produces at least one `potentially_out_of_scope` finding.
- [ ] Finding cites exact quotes from both documents.
- [ ] "Draft a reply" generates a professional message.



## 🛠️ Developer Commands

- `npm run dev` - Start development server
- `npm run build` - Production build
- `npm run typecheck` - Run TypeScript check
- `npm test` - Run unit tests (schemas, evidence verification, pipeline)


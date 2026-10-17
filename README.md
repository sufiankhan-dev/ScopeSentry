# ScopeSentry

**Stop scope creep before it starts.**

ScopeSentry is an open-source, privacy-focused scope analysis tool for freelancers and agencies. It helps identify client requests that may go beyond an agreed project scope by comparing the original project brief against client conversations.

Powered by Google's Gemma models through Ollama, ScopeSentry is designed to analyze sensitive project information locally without relying on a hosted AI API.

## The Problem

Scope creep happens when project requirements gradually expand without a corresponding change in budget, timeline, or agreement.

Freelancers often have to cross-reference project briefs, contracts, emails, and chat messages to determine whether a new request was originally included. This process can be tedious and error-prone.

ScopeSentry helps make that process easier by comparing the original agreement with new client requests and presenting evidence-backed findings for review.

## Features

- **Local AI Analysis:** Run analysis using Gemma through Ollama on your own machine.
- **Evidence-Based Findings:** Verify supporting quotes against the original agreement or conversation.
- **Scope Classification:** Categorize requests as `in_scope`, `potentially_out_of_scope`, `unclear`, or `needs_review`.
- **Actionable Recommendations:** Understand why a request was flagged and what to clarify with the client.
- **Professional Reply Drafting:** Generate editable, context-aware client response drafts.
- **Privacy-Focused Architecture:** Avoid unnecessary data collection, external AI services, and persistent storage.
- **Open Source:** Inspect the code, contribute improvements, and adapt the tool to your workflow.

ScopeSentry provides decision support, not legal advice. Always review findings before making contractual or business decisions.

## How It Works

1. **Add your agreement:** Paste the original project brief, proposal, or relevant contract text.
2. **Add the conversation:** Paste the client's message or relevant conversation.
3. **Analyze the scope:** Gemma compares the request with the information provided in the agreement.
4. **Review the findings:** Examine classifications, supporting evidence, explanations, and recommended next steps.
5. **Draft a response:** Generate and edit a professional reply before copying it to your client.

## Preview

<!-- Replace this section with a real screenshot or GIF when the application is ready. -->

<!-- ![ScopeSentry analysis dashboard](docs/images/scopesentry-preview.png) -->

*The preview will be added once the working interface is available.*

## Technology Stack

| Technology | Purpose |
|---|---|
| Next.js | Application and server-side API routes |
| TypeScript | Type safety |
| Tailwind CSS | Styling and responsive layouts |
| shadcn/ui | UI components, if included in the implementation |
| Ollama | Local model runtime |
| Google Gemma | Local AI analysis |
| Zod | Runtime validation of structured AI output |
| Vitest | Unit testing, if configured |

## Getting Started

### Prerequisites

- Node.js 20.9 or a version supported by your installed Next.js release
- npm or the package manager specified by the repository
- [Ollama](https://ollama.com/download)
- A compatible Gemma model that your machine can run

### 1. Clone the Repository

```bash
git clone https://github.com/YOUR_USERNAME/scopesentry.git
cd scopesentry
```

Replace `YOUR_USERNAME` with the GitHub username or organization hosting the repository.

### 2. Download a Gemma Model

For an initial experiment, start with Gemma 3 4B:

```bash
ollama pull gemma3:4b
```

Other options include:

```bash
# Smaller model to experiment with
ollama pull gemma3:1b

# Larger model that may provide better results
ollama pull gemma3:12b
```

Model performance and memory requirements depend on quantization, context length, available RAM, and your hardware. Choose a model that works reliably on your machine.

Verify your installed models:

```bash
ollama list
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Configure Environment Variables

Create `.env.local` from the example file:

```powershell
Copy-Item .env.example .env.local
```

Configure the model and Ollama endpoint in `.env.local`:

```env
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=gemma3:4b
```

Ensure `OLLAMA_MODEL` matches a model you have installed. Keep `.env.local` out of version control.

### 5. Start Ollama

Make sure Ollama is running and the configured model is available. Depending on your installation, Ollama may start automatically when you open its application.

You can test the model independently:

```bash
ollama run gemma3:4b
```

### 6. Start ScopeSentry

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

**Important:** These instructions assume the application implements the environment variables and scripts shown above. Check the repository's actual configuration if anything differs.

## Demo Example

Use the following example to explore how ScopeSentry should handle a potentially out-of-scope request.

### Original Agreement

> Project: Brand identity refresh and small-business website.
>
> Scope: Brand refresh, including logo, color palette, typography, and high-fidelity design for six page templates.
>
> Exclusions: Photography, copywriting, frontend development, and CMS configuration.

### Client Conversation

> Client: Can you also produce a short brand guideline PDF so the team stops using the old logo in the cafe?
>
> Freelancer: The agreement covers the refined logo files and palette. A written brand guideline document isn't explicitly listed among the six page templates.

### What to Look For

ScopeSentry should examine whether creating a separate brand guideline document is reasonably covered by the agreed brand identity deliverables.

Depending on the full agreement and context, it may classify the request as `potentially_out_of_scope` or `needs_review`.

The finding should explain its reasoning, cite exact supporting text, and acknowledge that the agreement does not explicitly settle the question. It should not present an uncertain interpretation as a contractual fact.

## Privacy Architecture

ScopeSentry is designed around local inference and data minimization.

- **Local Inference:** AI analysis uses the configured Ollama instance rather than a hosted AI API.
- **Server-Side Processing:** Requests to Ollama are handled on the server, not directly from browser code.
- **No Unnecessary Persistence:** The MVP does not require a database or project-history storage.
- **Evidence Verification:** Supporting quotes are checked against the original submitted text using deterministic validation.
- **No Cloud AI Fallback:** Ollama failures should produce a clear error rather than silently sending private content to another AI provider.

These are implementation requirements, not guarantees established by the architecture alone. Review the code and verify the application's network behavior before making absolute privacy claims.

### Known Limitations

- **Hardware Dependent:** Inference speed and model quality vary with available memory, processor, GPU, and model configuration.
- **Initial Setup:** Internet access is required to download Ollama and the selected model. Subsequent offline operation has not been established until tested.
- **Pasted Text Only:** PDF, DOCX, and chat-export imports are outside the initial MVP unless implemented separately.
- **Advisory Classifications:** AI can misinterpret agreements or conversations. Human review remains necessary.
- **No Project History:** The initial design does not require persistent project storage.
- **Local Environment Required:** The application needs access to the configured Ollama service. A remotely hosted application cannot automatically access Ollama running on a visitor's own computer.

## Development and Testing

Run the checks available in the repository:

```bash
npm run lint
npx tsc --noEmit
npm test
npm run build
```

These commands require the corresponding scripts and dependencies to be configured. Check `package.json` and use the project's actual test scripts.

Important test cases include:

- Valid and invalid structured AI output
- In-scope, potentially out-of-scope, and ambiguous requests
- Exact evidence matching and fabricated quotes
- Missing or conflicting agreement terms
- Empty and oversized inputs
- Ollama connection failures and timeouts
- Invalid model responses
- Privacy-sensitive logging and unintended persistence

## Roadmap

- [ ] Complete the core agreement and conversation analysis flow
- [ ] Improve evidence verification and handling of ambiguous findings
- [ ] Complete the findings report and editable reply drafting
- [ ] Add comprehensive automated tests
- [ ] Add PDF and DOCX support
- [ ] Support multiple conversation threads
- [ ] Explore optional encrypted local project history
- [ ] Add configurable scope rules and project-specific preferences
- [ ] Validate the offline workflow after initial setup

## Demo Checklist

Before presenting ScopeSentry:

- [ ] Ollama is running and the selected Gemma model is installed.
- [ ] `.env.local` points to the correct local model.
- [ ] The application starts without errors.
- [ ] The demo agreement and conversation produce a meaningful report.
- [ ] Findings contain verifiable evidence from the submitted text.
- [ ] Ambiguous requests are not automatically treated as confirmed scope violations.
- [ ] Reply drafts can be edited before copying.
- [ ] Errors are handled when Ollama is unavailable.
- [ ] Privacy claims have been checked against the actual implementation.

## Contributing

Contributions are welcome.

1. Fork the repository.
2. Create a feature branch.
3. Make a focused change.
4. Run the relevant checks.
5. Open a pull request describing the change and its purpose.

Please preserve the local-first approach and avoid introducing unnecessary data collection or cloud AI dependencies.

## License

Choose an open-source license and include its corresponding `LICENSE` file in the repository before publishing. Update this section to identify the selected license.

## Acknowledgements

- [Google Gemma](https://ai.google.dev/gemma)
- [Ollama](https://ollama.com/)
- [Next.js](https://nextjs.org/)
- [Zod](https://zod.dev/)

---

Built to help freelancers protect their time, clarify project boundaries, and handle client requests with confidence.

# 📋 Implementation Prompt: README for Challenge Submission

## Goal and User Outcome
Create a comprehensive, professional `README.md` that prepares ScopeSentry for an open-source challenge submission and a first freelancer demo. The goal is to make the project "clone-and-run" reproducible on a fresh machine, clearly communicating its unique privacy-first value proposition while being honest about its limitations.

## Skills and Documentation Consulted
- `AGENTS.md`: For project goals, architecture, and constraints.
- Existing `README.md`: For technical details, setup steps, and API behavior.
- `.env.example`: For environment variable configuration.
- `package.json`: For available scripts.

## Existing Code Inspected
- Current `README.md` is very detailed (technical) but structured more as a developer manual than a project showcase. It needs to be pivoted towards a "Project Home" style while retaining the high-quality setup guides.

## Decisions and Assumptions
- **Structure**: I will transform the README into a showcase format: Problem $\rightarrow$ Solution/Features $\rightarrow$ Demo Data $\rightarrow$ Setup $\rightarrow$ Privacy $\rightarrow$ Limitations.
- **Screenshots**: Since I cannot generate images, I will use clearly marked HTML `<img>` placeholders with descriptive `alt` text.
- **Offline Claims**: Per instructions, I will explicitly state that initial setup requires internet and that "fully offline" use hasn't been verified.
- **Demo Data**: I will extract and feature the sample agreement/conversation from the project's `lib/samples.ts` (or synthesize representative ones if the file is complex) to give users an immediate starting point.

## Expected Files to Change
- `README.md` (Complete rewrite/restructuring)

## Functional and Privacy Requirements
- Must not claim cloud AI fallback.
- Must emphasize local-only processing.
- Must provide exact `ollama pull` commands.
- Must explain why `.env.local` is necessary.

## Acceptance Criteria
- [ ] Problem statement is clear and appeals to freelancers.
- [ ] "Quick Start" guide is accurate and reproducible.
- [ ] Ollama installation and model pulling are explicitly covered.
- [ ] Environment variable setup is explained.
- [ ] Privacy architecture is described (no persistence, no cloud).
- [ ] Example demo data is provided.
- [ ] Limitations (CPU speed, no PDF parsing) are transparent.
- [ ] Demo checklist is included at the end.

## Automated Checks and Manual Test Steps
1. **Readability Check**: Verify that a non-developer freelancer could understand the "Problem" and "Demo" sections.
2. **Setup Verification**: mentally trace the setup steps against a fresh Windows install to ensure no missing links (e.g., `npm install` $\rightarrow$ `.env.local` $\rightarrow$ `npm run dev`).
3. **Consistency Check**: Ensure `OLLAMA_MODEL` names match `.env.example`.

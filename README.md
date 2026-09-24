<div align="center">

<img src="reconciliation/public/sift-logo.png" alt="Sift" width="100" />

# Sift

### Resolve the exception. Keep the lesson.

AI-assisted reimbursement review that turns human decisions into tested, reusable checks.

🏆 **HackMIT 2026 Finalist**

![HackMIT 2026](https://img.shields.io/badge/HackMIT-2026-F5C542?style=flat-square)
![Next.js 16](https://img.shields.io/badge/Next.js-16-171717?style=flat-square&logo=nextdotjs)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)

[Run locally](#-try-it-locally) · [How it works](#-how-it-works) · [Tech stack](#-tech-stack) · [Documentation](#-explore-the-repo)

</div>

---

Finance teams spend time reconciling receipts, chasing missing context, and resolving the same exceptions again. Sift brings the claim, its evidence, and the checks into one workspace: approve supported claims, investigate ambiguity, and put the remaining decisions in front of a reviewer.

Built at **HackMIT 2026**, motivated by **Maximor’s finance-workflow use case**.

## ✨ The workflow

| | What Sift does |
| --- | --- |
| 📥 **Bring in the paperwork** | Upload receipts and supporting documents; inspect extracted fields and suggested claim links before confirming them. |
| 🔎 **Check the evidence** | Validate amounts, currencies, dates, policy caps, identity, merchant names, and possible duplicates. |
| 🧭 **Investigate exceptions** | When useful supporting evidence exists, run a bounded investigation with recorded read tools and source citations. |
| 👤 **Keep reviewers in control** | Show the decisive facts, preserve human decisions, and prepare applicant notifications separately from private review notes. |
| 🧠 **Keep the lesson** | Turn a supported review reason into a scoped check, test it, and reuse it only when another claim supplies its own matching evidence. |

For example, a hotel receipt may use a billing descriptor that differs from the booking’s hotel name. Sift can connect the documents through their booking reference, guest, date, amount, and currency. A supported reviewer approval can teach that relationship without bypassing overclaim or duplicate checks.

## 🎬 Demo

![Sift audit overview with claim totals, review states, and the assessment workflow](docs/assets/audit-overview.png)

*Current app, captured from the isolated 14-claim local showcase with simulated providers.*

<details>
<summary><strong>See the reimbursement workspace</strong></summary>

![Sift reimbursement workspace with saved claim assessments and decisions](docs/assets/reimbursements.png)

</details>

## ⚙️ How it works

```mermaid
flowchart LR
    A[Receipts + supporting documents] --> B[Extract structured evidence]
    B --> C[Code checks + Jev assessment]
    C --> D[Eligible automatic approval]
    C --> E[Investigate unclear evidence]
    E --> C
    C --> F[Human review]
    F --> G[Save decision + held notification]
    D --> G
    F --> H[Scoped check → safety tests]
    H --> I[Activate + recheck pending claims]
    I --> C
```

One Next.js application handles the UI, API routes, and review services. **Code** enforces financial controls; **Jev** handles bounded semantic judgments and search; **Azure OpenAI** powers the investigation planner. Live mode stores records and private originals in **Supabase**. The local showcase uses private files and simulated providers.

Learning means **tested evidence-check reuse**, not model retraining. Saved human decisions survive rechecks. Approval records a decision; Sift does not move money.

## 🧰 Tech stack

| Layer | Tools |
| --- | --- |
| **App** | ![Next.js](https://img.shields.io/badge/Next.js-171717?style=flat-square&logo=nextdotjs) ![React](https://img.shields.io/badge/React-149ECA?style=flat-square&logo=react&logoColor=white) ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white) ![Node.js](https://img.shields.io/badge/Node.js-43853D?style=flat-square&logo=nodedotjs&logoColor=white) |
| **UI** | ![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white) ![shadcn/ui](https://img.shields.io/badge/shadcn%2Fui-171717?style=flat-square&logo=shadcnui) ![Radix UI](https://img.shields.io/badge/Radix_UI-171717?style=flat-square&logo=radixui) ![Lucide](https://img.shields.io/badge/Lucide-F56565?style=flat-square&logo=lucide&logoColor=white) |
| **AI** | ![Azure OpenAI](https://img.shields.io/badge/Azure_OpenAI-0078D4?style=flat-square) ![OpenAI](https://img.shields.io/badge/OpenAI-171717?style=flat-square) ![TypeSafe AI · Jev](https://img.shields.io/badge/TypeSafe_AI_%C2%B7_Jev-C026D3?style=flat-square) ![Vercel AI Gateway](https://img.shields.io/badge/Vercel_AI_Gateway-171717?style=flat-square&logo=vercel) |
| **Data & email** | ![Supabase](https://img.shields.io/badge/Supabase-3ECF8E?style=flat-square&logo=supabase&logoColor=171717) ![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=flat-square&logo=postgresql&logoColor=white) ![Zod](https://img.shields.io/badge/Zod-3E67B1?style=flat-square&logo=zod&logoColor=white) ![Resend](https://img.shields.io/badge/Resend-171717?style=flat-square&logo=resend) |
| **Testing** | ![Playwright](https://img.shields.io/badge/Playwright-2EAD33?style=flat-square) ![PGlite](https://img.shields.io/badge/PGlite-4169E1?style=flat-square) ![Node test runner](https://img.shields.io/badge/Node_test_runner-43853D?style=flat-square&logo=nodedotjs&logoColor=white) |
| **Built with** | ![Codex](https://img.shields.io/badge/Codex-171717?style=flat-square) ![Devin](https://img.shields.io/badge/Devin-2563EB?style=flat-square) ![GitHub](https://img.shields.io/badge/GitHub-171717?style=flat-square&logo=github) |

Devin contributed development, testing, and review support. The investigator inside Sift runs in the app; Devin is a development collaborator. The earlier [browser/voice prototype](docs/archive/browser-prototype.md) uses Grok voice and lives separately from the reimbursement app.

## 🚀 Try it locally

Requires **Node.js 22.18+** and npm. No API keys are needed for the local showcase.

```sh
git clone https://github.com/Cryplo/HackMIT26.git
cd HackMIT26/reconciliation
npm ci
NEXT_DIST_DIR=.next-showcase npm run demo -- --showcase --audit-ready --port 3002
```

Open **[127.0.0.1:3002/overview](http://127.0.0.1:3002/overview)** and choose **Start audit**. The launcher creates a fresh private dataset with 14 fictional claims and simulated providers. No real email is sent. **Reset demo** lets you replay the flow.

The cases cover ordinary claims, amount mismatches, policy-cap violations, duplicate and lookalike purchases, and matching, conflicting, or missing booking evidence. See the [showcase guide](reconciliation/docs/SHOWCASE.md) for the separate human-feedback learning rehearsal and [live setup](reconciliation/README.md#live-setup) for provider configuration.

One focused offline check:

```sh
node --conditions=react-server --import tsx scripts/check-showcase.ts
```

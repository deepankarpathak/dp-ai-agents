# Product Requirement Evaluation: TSP-248

## Convenience Fee Feature — P2M Transactions (RuPay CC, Credit Line on UPI, PPI on UPI)

| Field | Details |
|---|---|
| **Ticket** | TSP-248 |
| **Type** | Task |
| **Priority** | Highest |
| **Status** | Closed |
| **Reporter** | Mithun Nair (Product) |
| **Assignee** | Mukul Gupta (Dev) |
| **Created** | 9 Jul 2024 |
| **Last Updated** | 16 Jun 2025 |
| **Label** | Transaction |

---

## Scorecard

| # | Parameter | Score (out of 10) | Remarks |
|---|---|:---:|---|
| 1 | **Clarity of Problem Statement** | 6 | Background explains the "what" (NPCI convenience fee) but the "why" from a business/revenue perspective is missing. No data on merchant demand, expected volume, or revenue impact. |
| 2 | **Scope Definition** | 5 | Scope says "Acquiring only" but this was clarified only in comments (Aug 22), not in the description. Issuing vs. Acquiring boundary was ambiguous for weeks. The description still says "P2M Txns" generically. |
| 3 | **Functional Requirements** | 6 | Core split-tag mechanics (CCONFEE/PCONFEE), pipe separators, and API-level behavior are described. However, many critical behaviors were undefined upfront — OCL handling, multiple split tags, PG-side behavior, consult API timeouts — all surfaced only through dev/QA comments. |
| 4 | **Technical Specifications** | 5 | References NPCI XML specs and split tag format but lacks: API contract details (request/response payloads), sequence diagrams, DB schema changes, service interaction flow. The dev team had to ask for "detailed API Document and detailed description along with current request/response" (comment by Mukul, Aug 21). |
| 5 | **Edge Cases & Error Handling** | 4 | Critical gaps: (a) What happens when CF > base amount? — discovered as a bug in QA. (b) Deeplink tampering / fund-loss scenarios were requested by the assignee, not proactively documented. (c) Two-decimal validation, OCL merchant handling, multiple split tags — all raised as questions post-creation. |
| 6 | **Acceptance Criteria** | 3 | No formal acceptance criteria defined in the ticket. The QA team had to independently derive 48+ test cases (5 positive, 11 negative, 16 integration, 16 sensitive data, 16 DB). This should have been part of the requirement itself. |
| 7 | **Dependencies & Integration Points** | 4 | Multiple dependencies exist (PG side, Compliance service, TPAP Switch, NPCI) but none were explicitly listed. PG-side dependency caused multi-week blocks (Apr–May 2025). The ticket lacks a dependency matrix or RACI. |
| 8 | **Security & Compliance** | 5 | Fund-loss scenarios were eventually documented (deeplink tampering, refund/chargeback CONFEE deduction) but only after being explicitly requested by the tech lead. No threat model, no fraud-risk assessment upfront. For a payment feature, this is a significant gap. |
| 9 | **Rollout & Monitoring Plan** | 6 | A monitoring plan was eventually created (Confluence page linked in comments) with Grafana dashboards and feature flags (`CONVENIENCE_FEE_ENABLED_ON_DQR_FLOW_FOR_PPSL`, `IS_AMOUNT_CHECK_DISABLED_FOR_SPLIT_TAGS`). However, this was not part of the original requirement — it was added during implementation. No phased rollout plan or rollback strategy documented. |
| 10 | **Stakeholder Communication** | 7 | Active comment thread with Product (Mithun, Nishant), Dev (Mukul, Amit), QA (Prateek), and Tech Lead (Deepankar). Q&A table from Mithun (Aug 22) was well-structured. NPCI call was organized. However, the ticket itself became a "living document" via comments rather than having a clean, updated description. |
| 11 | **Timeline & Estimation** | 3 | No estimated delivery date, no sprint assignment visible, no milestones. The ticket took ~11 months from creation (Jul 2024) to QA sign-off (May 2025). There's no indication this timeline was planned or tracked against expectations. |
| 12 | **MIS & Reporting** | 5 | Mentioned briefly ("MIS for the split tag details for PG/Merchant basis split value and amount") but no detailed reporting requirements — what fields, what format, what dashboards, what frequency, who consumes it. |

---

## Overall Score: 4.9 / 10

---

## Key Strengths

1. **Active collaboration** — The comment thread shows healthy cross-functional engagement. Questions were raised, escalated, and answered with reasonable turnaround.
2. **NPCI alignment** — The team proactively set up a call with NPCI for clarification and documented responses in a structured Q&A format.
3. **Feature flags** — Implementation used proper feature flags for controlled rollout, which is a mature engineering practice.
4. **QA rigor** — Despite weak acceptance criteria, the QA team built a comprehensive test matrix (48+ cases across 6 categories) and caught a critical bug (CF > base amount passing unexpectedly).

---

## Critical Gaps & Recommendations

### 1. Missing Business Context (High Impact)

The PRD should answer: Why are we building this? What's the expected merchant adoption? What's the revenue/volume impact? Without this, prioritization and trade-off decisions during implementation become ad-hoc.

### 2. No Acceptance Criteria (High Impact)

A requirement of this complexity (payments, regulatory, multi-service) must have explicit acceptance criteria before development begins. The fact that QA had to reverse-engineer test cases from comments is a process failure.

### 3. Incomplete Upfront Analysis (High Impact)

At least 12 clarification questions were raised by the dev team after the ticket was created. Key ones:

- Is CF applicable only for PAY type flow?
- How should online merchants be categorized?
- What happens for OCL merchants?
- What are the fund-loss scenarios?

These should have been answered in the requirement document, not discovered during implementation.

### 4. No Architecture / System Design Reference (Medium Impact)

For a feature touching Switch, Compliance, PG, and NPCI XML — there should be a linked system design document with sequence diagrams, API contracts, and DB schema changes.

### 5. No Timeline or Milestone Tracking (Medium Impact)

An 11-month lifecycle with no visible milestones, sprint assignments, or delivery estimates. The PG-side block alone lasted ~6 weeks with no escalation path documented.

### 6. Description Staleness (Medium Impact)

The ticket description was never updated to reflect the final agreed-upon scope, clarifications, or design decisions. All institutional knowledge lives in 28 comments — making it nearly impossible for a new team member to understand the current state.

---

## Recommendation

This ticket should be treated as a **template for what to improve** in future payment feature PRDs. The following actions are recommended:

1. **Mandate a PRD template** with sections for: Business Context, Scope, Functional Requirements, API Contracts, Edge Cases, Acceptance Criteria, Dependencies, Security/Fraud Assessment, Rollout Plan, and MIS Requirements.
2. **Require a design review gate** before moving to development — ensuring technical specs, sequence diagrams, and DB changes are documented.
3. **Update the ticket description** as decisions are made (not just comments) so the description always reflects the current truth.
4. **Add sub-tasks** for each workstream (Switch changes, Compliance changes, PG integration, QA) with individual owners and timelines.

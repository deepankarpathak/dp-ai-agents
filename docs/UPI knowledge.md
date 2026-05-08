# UPI Reference

> **Purpose:** A practical domain reference for UPI product, operations, engineering, and risk teams.  
> **Scope:** Public-product understanding and conceptual flows; not a message-level API spec.  
> **Refreshed:** 2026-03-21  
> **Important note:** Public NPCI/RBI materials do **not** publish every internal switch, mapper, or participant interface in full detail. Wherever the public record is silent, this note uses a **conceptual mental model** and calls that out explicitly.

---

## 1) UPI in one minute

**UPI (Unified Payments Interface)** is NPCI’s instant payment system that lets a user link one or more participating bank accounts in a UPI app and transact using identifiers like a **VPA / UPI ID**, QR, or account details.[^about-upi][^bhim]  
At a high level, UPI supports:

- **P2P** money transfer
- **P2M** merchant payments
- **Push** and **pull / collect** payments
- **QR**, **intent**, and **collect** checkout journeys
- **UPI Lite** for low-value, faster, PIN-less payments
- **Mandates / AutoPay** for recurring or scheduled payments
- **International** acceptance variants
- **RuPay Credit Card on UPI**
- Related extensions like **Credit Line on UPI** and newer auth options.[^upi-product][^upi-lite][^autopay][^global][^rupay-upi][^credit-line][^auth-2025]

---

## 2) The most important mental models

### 2.1 UPI is **not** just an app

A customer may use **one app** but transact from **another bank’s account**.

Example:

- User opens **App A** (payer PSP / TPAP surface)
- The money is actually debited from **Bank B** (remitter / issuer bank)
- Payee may be represented by **Payee PSP C**
- Final credit lands in **Beneficiary Bank D**

This distinction matters in onboarding, payment routing, reconciliation, failure handling, and disputes.

### 2.2 Push vs Pull

- **Push** = the payer starts the payment and authorizes it now.
- **Pull / Collect** = the payee asks for money; the payer sees a request and authorizes later.

### 2.3 Alias first, account later

In most UPI journeys, the customer interacts with a **friendly identifier** (for example a VPA or QR).  
Under the hood, UPI still has to resolve that alias to the right destination rails and account context.

### 2.4 Authorization and movement are separate concerns

A payment typically has two broad phases:

1. **Address / payee resolution + user authorization**
2. **Debit at remitter bank + credit at beneficiary bank + confirmations**

### 2.5 “Mapper” is a useful product word, but public docs are limited

Teams often say **mapper** to mean the alias-resolution or directory layer that connects a UPI identifier to the right PSP/bank route.  
Public NPCI materials show the *effect* of this resolution, but not the full internal implementation. So the mapper section below is a **conceptual reference**, not a protocol-level public specification.

---

## 3) Key components of the UPI ecosystem


| Component                                                   | What it is                                    | What it does in practice                                                                                                                                         |
| ----------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **NPCI / UPI switch**                                       | Central scheme + routing layer                | Standardizes participant interaction, routes requests, performs address-resolution orchestration, supports clearing/settlement flows, and operates scheme rules. |
| **Payer / Remitter customer**                               | Person or business sending money              | Initiates a push payment or authorizes a collect request.                                                                                                        |
| **Payee / Beneficiary customer**                            | Person or business receiving money            | Receives funds or raises a collect request.                                                                                                                      |
| **Payer PSP**                                               | PSP on the sender side                        | Hosts the payer UX, captures intent, sends payment or collect-approval messages into UPI.                                                                        |
| **Payee PSP**                                               | PSP on the receiver side                      | Hosts the receiver / merchant-side presence, resolves payee information, may create collect requests or merchant acceptance flows.                               |
| **TPAP**                                                    | Third-party app provider                      | App surface used by the customer; usually works with sponsor/partner PSP banks.                                                                                  |
| **PSP bank**                                                | Scheme participant bank acting as PSP         | Provides PSP connectivity into UPI; may also be the user’s account-holding bank, but not always.                                                                 |
| **Remitter bank**                                           | Payer’s account-holding / issuing bank        | Authorizes and debits the payer’s source account.                                                                                                                |
| **Beneficiary bank**                                        | Payee’s account-holding / acquiring-side bank | Credits the payee / merchant account.                                                                                                                            |
| **Merchant / aggregator / acquirer stack**                  | Acceptance-side layer                         | Generates QR, collect, or intent requests; reconciles orders; receives payment status.                                                                           |
| **VPA / UPI ID**                                            | Alias / payment address                       | Human-friendly identifier used instead of exposing bank account details.                                                                                         |
| **UPI PIN (often called MPIN informally in product teams)** | Second-factor payment credential              | Used for authorization in standard UPI account transactions.[^rbi-upi][^auth-2025]                                                                               |
| **Mapper / directory (conceptual)**                         | Alias resolution layer                        | Used to resolve identifiers like a VPA/QR payload to the correct participant route and payee context.                                                            |
| **URCS / UDIR (back-office / dispute stack)**               | UPI dispute and issue-resolution layer        | Used for pending/failed/disputed transaction status, complaints, and refund/dispute operations in the supplied internal docs.[^udir-tsd][^udir-refund]           |


### 3.1 The four roles that are most often confused

#### Payer PSP vs Remitter bank

- **Payer PSP** = who the payer is interacting with on the app side
- **Remitter bank** = which bank account is actually being debited

These may be the same institution, but they often are not.

#### Payee PSP vs Beneficiary bank

- **Payee PSP** = who represents the payee / merchant on the UPI side
- **Beneficiary bank** = where the money is finally credited

---

## 4) Core identifiers and objects


| Term                      | Meaning                                                   | Notes                                                                                                                 |
| ------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **VPA / UPI ID**          | Virtual payment address like `name@bank`                  | Core alias used in send/request flows.                                                                                |
| **QR**                    | Encoded acceptance payload                                | Can be **static** or **dynamic** for merchant payments.[^upi-product]                                                 |
| **Intent / deeplink**     | Merchant checkout launches a UPI app with pre-filled data | Common in e-commerce and app checkout journeys.[^upi-product]                                                         |
| **Collect request**       | Payee asks payer to approve a debit                       | Used in pull payments / request money.[^bhim]                                                                         |
| **UPI PIN**               | Transaction authorization credential                      | Standard auth method for account-based UPI payments; newer biometric/face options are emerging.[^rbi-upi][^auth-2025] |
| **Mandate**               | Pre-consented future or recurring debit instruction       | Basis for AutoPay.                                                                                                    |
| **Lite balance**          | UPI Lite stored value / companion balance                 | Used for low-value, faster, PIN-less payments.[^upi-lite]                                                             |
| **Order / txn reference** | Merchant/order correlation ID                             | Important for reconciliation, refunds, and disputes.                                                                  |


---

## 5) Onboarding flows

### 5.1 Typical onboarding journey (high level)

A generic onboarding journey usually looks like this:

1. **App install / open**
2. **Mobile number verification / device possession check**
3. **Fetch eligible bank accounts for that mobile number**
4. **User selects a bank account**
5. **User creates or selects a VPA / UPI ID**
6. **User sets UPI PIN**
7. **Account becomes active for payment**

**What varies by PSP/bank/app:**

- exact device-binding technique
- whether the app is a TPAP or PSP bank app
- whether the app auto-suggests VPA handles
- whether additional silent verification / risk checks are done
- exact PIN set/reset route exposed to the user

---

### 5.2 VPA creation flow

A VPA flow is usually:

1. User chooses a preferred **handle / alias**
2. PSP validates format and checks **availability**
3. The alias is associated with the chosen UPI participant route and account context
4. The app confirms VPA creation and sets a default payment source if needed

#### Conceptual sequence

```text
User
  -> PSP app: choose VPA / handle
PSP app
  -> alias-resolution / availability layer: check handle
alias-resolution layer
  -> PSP app: available / unavailable
PSP app
  -> UPI participant setup: bind VPA to selected account route
PSP app
  -> User: VPA created
```

#### Practical notes

- A single user may have **multiple VPAs** across apps and handles.
- A VPA is an **address**, not the actual money store.
- Public NPCI materials show VPA usage widely, but not the full public mapper internals; treat the above as a conceptual product flow.[^about-upi][^bhim]

---

### 5.3 Account linking flow

NPCI’s public materials describe UPI as allowing users to add multiple participating bank accounts inside one UPI app.[^about-upi][^upi-product]

#### Typical flow

1. App verifies the user’s mobile number / bank relationship
2. App fetches bank accounts associated with the number
3. User picks a source account
4. App marks a default source account
5. User sets UPI PIN if needed
6. Linked account is now available for send/pay/collect approval

#### Why this matters

Account linking determines:

- the **remitter bank**
- available balance / debit rules
- whether Lite, mandates, credit line, or card-linked features are eligible
- which account is shown as the default source at checkout

---

### 5.4 UPI PIN (MPIN) set flow

RBI’s customer-facing UPI explainer says the user creates a UPI PIN using the **last 6 digits of the ATM/debit card**, **card expiry**, and the **OTP received on the registered mobile number**.[^rbi-upi]  
BHIM’s public instructions similarly mention setting UPI PIN with the **last 6 digits of the debit card and expiry date**.[^bhim]

#### Standard set-PIN flow

```text
User selects bank account
  -> App asks for debit-card details and/or bank-auth step
  -> Bank validates customer
  -> User enters OTP if required
  -> User creates new 4/6 digit UPI PIN (implementation-specific UX)
  -> PIN activation confirmed
```

#### Practical product note

Many internal teams say **MPIN**, but the customer-facing term across UPI is usually **UPI PIN**.

---

### 5.5 UPI PIN reset flow

A reset flow is conceptually similar to set-PIN, but triggered when the user forgets the PIN, changes device, or needs re-provisioning.

#### Typical reset flow

1. User selects **reset / forgot UPI PIN**
2. App asks for **bank-authenticated proof** (for example card credentials + OTP)
3. Bank validates the request
4. User sets a **new** UPI PIN
5. App reactivates the account for transactions

#### Newer scheme note

NPCI’s Oct 2025 circular introduced **UIDAI Face Authentication** as an additional option for **UPI PIN Set/Re-Set**, in lieu of card credentials or Aadhaar OTP, subject to participant rollout.[^auth-2025]

So the correct mental model today is:

- **Legacy / common public flow:** debit card + expiry + OTP
- **Possible alternative flow in newer rollouts:** Aadhaar / face-auth based set-reset journey
- **Actual availability:** bank/PSP/version dependent

---

### 5.6 Device binding and registration checks (conceptual)

Public sources explain the *customer* journey, but not every technical control used behind the scenes. In practice, onboarding often includes a device-ownership and mobile-number check before the app enables UPI on that device.

#### Why it exists

Device binding reduces:

- wrong-device onboarding
- fraudulent alias/account registration
- unauthorized collect approvals or pay flows on cloned sessions

#### Product-safe takeaway

Treat **device binding** as a mandatory onboarding control, but do **not** hard-code one single implementation method into requirements. Different PSPs and banks may use different mechanisms over time.

---

### 5.7 Mapper flow (conceptual)

Because you specifically asked for the **mapper flow**, here is the best public-safe way to think about it.

#### What “mapper” means in practice

A **mapper** is the alias-to-route resolution layer that answers questions like:

- Which participant owns this VPA?
- Which payee PSP should receive the address-resolution request?
- Which account context should be used after validation?
- Which bank should ultimately be credited?

#### Mapper during onboarding

```text
Create VPA
  -> check alias availability
  -> bind alias to user/account/participant route
  -> confirm activation
```

#### Mapper during transaction resolution

The supplied UDIR TSD describes a basic push transaction like this:

1. Customer enters payee UPI ID
2. Payer PSP sends the request to UPI
3. UPI sends it to the respective Payee PSP for address resolution
4. Payee PSP sends relevant account details back to UPI
5. UPI sends debit request to remitter bank
6. Remitter debits payer
7. UPI sends credit request to beneficiary bank
8. Beneficiary credits payee
9. Success confirmation goes back to payer side[^udir-tsd]

#### Practical takeaway

For product documentation, the cleanest phrasing is:

> **Mapper flow = identifier resolution + participant routing + validated payee context retrieval before debit/credit execution.**

That is precise enough for domain understanding without pretending public docs expose every internal interface.

---

## 6) UPI payment flows

### 6.1 Push flow (generic)

A **push** payment is the most familiar UPI flow.

#### Core idea

The payer already knows the payee identifier (VPA, QR, account+IFSC, etc.) and authorizes immediately.

#### Typical steps

1. Payer enters/scans payee details
2. Payer app validates payee
3. User enters amount and authorizes
4. Remitter bank debits payer
5. Beneficiary bank credits payee
6. Status is returned to both sides

---

### 6.2 Pull / collect flow (generic)

A **pull** or **collect** payment is request-based.

#### Core idea

The payee initiates a money request to the payer; the payer approves it later.

#### Typical steps

1. Payee / merchant creates a collect request
2. Payee PSP sends it into UPI
3. Payer PSP receives the pending request
4. Payer reviews and authorizes
5. Remitter bank debits payer
6. Beneficiary bank credits payee
7. Final status is returned

#### Good use cases

- merchant request flows
- bill-like payment reminders
- deferred payer approval
- request-money between individuals

BHIM’s public page explicitly mentions **Request Money / Collect money**.[^bhim]

---

### 6.3 P2P push flow

This is the canonical “send money to another person” journey.

#### Inputs that may be used

- VPA / UPI ID
- account number + IFSC
- QR
- sometimes mobile-linked aliases or app-specific surfaces

#### Conceptual sequence

```text
Payer
  -> Payer PSP: send to VPA / account / QR
Payer PSP
  -> NPCI / UPI: payment request
UPI
  -> Payee PSP: address resolution
Payee PSP
  -> UPI: payee account context
UPI
  -> Remitter bank: debit request
Remitter bank
  -> UPI: debit success/failure
UPI
  -> Beneficiary bank: credit request
Beneficiary bank
  -> UPI: credit success/failure
UPI
  -> Payer PSP / Payee PSP: final status
```

The UDIR TSD’s “basic UPI transaction” description closely matches this sequence.[^udir-tsd]

---

### 6.4 P2P pull / collect flow

This is “request money from another person.”

#### Example

A friend requests ₹500 from you. You receive the request in your UPI app, review it, then approve or decline.

#### Important differences vs push

- Payee starts the interaction
- Payer authorizes later
- Request expiry and presentation rules may vary by app/participant
- The payment still becomes a normal debit/credit flow once approved

---

### 6.5 P2M – scan and pay

NPCI’s UPI product materials explicitly call out **QR-based** payments and distinguish **static** and **dynamic** QR codes.[^upi-product]

#### Static QR

- Usually contains merchant identity / VPA
- Amount is often entered by the payer
- Common for small merchants and print QR acceptance

#### Dynamic QR

- Usually contains merchant identity **plus** amount and transaction metadata
- Common in POS, soundbox, billing, and formal checkout flows
- Better for order-level reconciliation

#### Basic scan-and-pay flow

1. Merchant presents QR
2. Payer scans QR in UPI app
3. App resolves merchant/payee details
4. User confirms amount (if not pre-filled)
5. User authorizes
6. Remitter debit and beneficiary credit happen
7. Merchant gets status

---

### 6.6 P2M – intent flow

NPCI’s UPI materials mention **intent-based payments**.[^upi-product]

#### What it is

A merchant app or website creates a UPI deeplink / intent that opens one of the user’s installed UPI apps with pre-filled details.

#### Typical sequence

```text
Merchant app / website
  -> OS / device: launch UPI intent
OS
  -> User: choose installed UPI app
Chosen UPI app
  -> User: show merchant, amount, remarks, source account
User
  -> UPI app: authorize payment
UPI app
  -> UPI rails / bank flow: execute payment
UPI app
  -> Merchant app / site: callback / redirect
```

#### Best use case

Online checkout where the merchant wants a smoother “pay in app” experience.

---

### 6.7 P2M – collect flow

This is the merchant-side version of request-money.

#### What it looks like

- Merchant asks the user for a UPI ID / mobile identifier
- Merchant / payee PSP raises a collect request
- User receives a pending request in the UPI app
- User opens it, checks merchant/amount, and authorizes

#### Best use case

When the merchant does not want to rely on scanning or app switch, or when the merchant already knows the payer’s UPI identifier.

---

### 6.8 Comparing P2P vs P2M flows


| Dimension           | P2P                            | P2M                                                     |
| ------------------- | ------------------------------ | ------------------------------------------------------- |
| Counterparty        | individual                     | merchant / business                                     |
| Common UX           | VPA, contact, QR, account+IFSC | QR, intent, collect                                     |
| Metadata            | usually lightweight            | often order/bill/reference-heavy                        |
| Reconciliation need | low to medium                  | high                                                    |
| Dispute themes      | wrong payee, pending, failed   | service/goods not received, refund, settlement mismatch |
| Refund importance   | occasional                     | very high                                               |


---

## 7) Advanced payment flows

### 7.1 UPI Lite

NPCI says **UPI LITE** is designed for **low-value transactions below ₹1000** in a **faster and pin-less** manner.[^upi-lite]  
NPCI’s guideline PDF also describes Lite as enabling easy, safe, instant, contactless payments without entering a UPI PIN.[^upi-lite-guide]

#### Mental model

UPI Lite is best understood as a **small-value companion balance / on-device payment mode** that reduces friction for frequent low-value spends.

#### Typical enablement flow

NPCI’s UPI Lite page says the user:

1. opens the UPI app
2. gets an option to enable UPI Lite
3. reads and accepts terms / service
4. authorizes using UPI PIN
5. activates the Lite balance[^upi-lite]

#### Typical transaction flow

1. User selects UPI Lite as the payment source (explicitly or through app rules)
2. User pays a low-value amount
3. Payment completes without standard UPI PIN entry for that spend
4. User tops up Lite from the linked bank account when needed

#### Product notes

- Exact UI and routing behavior may vary by app.
- Do not hard-code app-specific thresholds or defaulting rules from older branding PDFs into scheme logic.
- Treat Lite as a **faster low-value payment mode**, not a replacement for the main bank account.

---

### 7.2 UPI Lite X / Tap & Pay (related extension)

Although you asked for **Lite**, many teams now also discuss **Lite X** in the same breath.

NPCI’s guideline materials show **Tap & Pay / P2M offline proximity** style flows under Lite X.[^lite-x]

#### Why mention it

If you are building a complete domain reference, it helps to distinguish:

- **UPI Lite** = low-value, faster, pin-less balance-led experience
- **UPI Lite X / Tap & Pay** = proximity/tap-style extension in eligible scenarios

Use it as a related note, not as the default Lite mental model.

---

### 7.3 Mandates and UPI AutoPay

NPCI’s AutoPay page says customers can enable **e-mandates** using UPI apps for recurring use cases like mobile bills, electricity bills, and EMI payments.[^autopay]

#### Mental model

A mandate is a **pre-approved rule** for a future debit.

#### Mandate types you should think about

- **One-time future-dated**
- **Recurring**
- **Variable / bounded recurring** (scheme/biller dependent)
- **Pause / revoke / modify** lifecycle events

#### Core lifecycle

1. **Create mandate**
2. **User reviews mandate details**
3. **User authorizes mandate**
4. **Mandate becomes active**
5. **Merchant / biller executes as per schedule/rules**
6. **Customer gets execution notifications / history**
7. Mandate may be **paused, revoked, or modified**

---

### 7.4 AutoPay registration journeys

NPCI’s AutoPay guideline PDF explicitly shows three setup patterns:

- **Collect flow**
- **Mandate QR scan flow**
- **Intent flow**[^autopay-guide]

#### A) Collect-style mandate setup

Merchant initiates a recurring payment request; user authorizes the mandate inside the UPI app.

#### B) QR-based mandate setup

Merchant presents a QR that the customer scans to create and approve the mandate.

#### C) Intent-based mandate setup

Merchant checkout launches a UPI app; the user reviews schedule/frequency/amount and approves the mandate.

#### Product-safe takeaway

For design and PRD work, it is useful to separate:

- **mandate creation UX**
- **mandate storage/activation**
- **mandate execution UX**
- **mandate management UX** (pause/revoke/view)

---

### 7.5 Automatic payments execution flow

Once a mandate is active, execution usually follows this pattern:

```text
Merchant / biller
  -> sends execution request as per mandate rules
UPI rails / banks
  -> validate mandate state, validity window, amount rules
Remitter bank
  -> debit customer if valid
Beneficiary side
  -> receive funds / confirmation
Customer + merchant
  -> get execution status
```

#### Important distinction

**Mandate creation** needs active customer consent.  
**Mandate execution** is the subsequent scheduled debit within the consented rules.

---

### 7.6 International payments

There are two distinct mental models:

#### A) Outbound international merchant payments

NPCI’s **UPI Global Acceptance** material says UPI users can make **QR code-based payments at select international merchant locations**, and the flow includes entering UPI PIN to authorize.[^global]

#### B) Inbound-traveller UPI in India

NPCI’s **UPI One World** material describes a **PPI linked to UPI** for **foreign nationals / NRIs from G20 countries**, with issuance based on **passport and valid visa**, for merchant payments in India.[^one-world]

#### The clean way to explain this

- **Global Acceptance** = Indian UPI user pays abroad at supported merchants
- **One World** = inbound traveller gets a UPI-linked PPI experience for spending in India

#### Product caution

Availability depends on participant and rollout coverage; do not assume universal availability in every geography or app.

---

### 7.7 RuPay Credit Card on UPI

NPCI’s RuPay Credit Card on UPI material says RuPay credit cards can be linked to a UPI ID, and after linking, the customer can pay a **merchant** by scanning the UPI QR code; authentication is done using **UPI PIN**.[^rupay-upi]

#### Mental model

This is **merchant payment on a card-backed source**, surfaced through the UPI experience.

#### Typical flow

1. User adds / links eligible RuPay credit card
2. Card appears as a selectable payment source
3. User scans merchant QR or proceeds in supported merchant flow
4. User authorizes with UPI PIN
5. Merchant gets paid, while the customer is effectively using the credit card line

#### Important product distinction

This is best thought of as **P2M on a credit-card funding source**, not as a generic replacement for normal bank-to-bank UPI transfer behavior.

---

### 7.8 Credit Line on UPI (related advanced mode)

NPCI’s Credit Line on UPI page describes access to **pre-sanctioned credit lines from banks** for low-ticket, high-volume use cases.[^credit-line]

#### Why it matters

Teams often confuse:

- **RuPay Credit Card on UPI**
- **Credit Line on UPI**

They are not the same:


| Feature                      | Funding source                  | Typical mental model                              |
| ---------------------------- | ------------------------------- | ------------------------------------------------- |
| **RuPay Credit Card on UPI** | linked RuPay credit card        | card-led merchant payment via UPI                 |
| **Credit Line on UPI**       | pre-sanctioned bank credit line | bank credit line surfaced as a UPI payment source |


---

## 8) A practical reference for push / pull / intent / collect / QR


| Flow                   | Who starts it?               | Customer sees what?             | Common use case               |
| ---------------------- | ---------------------------- | ------------------------------- | ----------------------------- |
| **P2P Push**           | payer                        | payee details + amount          | send money to person          |
| **P2P Pull / Collect** | payee                        | pending request to approve      | request money                 |
| **P2M Scan & Pay**     | payer scans merchant QR      | merchant + amount               | offline/in-store payment      |
| **P2M Intent**         | merchant checkout            | app picker + prefilled payment  | app/web checkout              |
| **P2M Collect**        | merchant/payee               | pending collect request         | request-to-pay                |
| **Mandate / AutoPay**  | merchant/biller during setup | future/recurring consent screen | subscription, bill, EMI       |
| **UPI Lite**           | payer                        | low-value fast payment flow     | small-value frequent payments |
| **RuPay CC on UPI**    | payer                        | merchant flow using card source | merchant credit spend         |


---

## 9) Failure and status mental model

The UDIR TSD is useful because it explains *where* a transaction can fail and *which party* is then responsible.

The supplied UDIR document says a basic UPI transaction involves:

- **Payer PSP**
- **Payee PSP**
- **Remitter Bank**
- **Beneficiary Bank**
- **Merchants**[^udir-tsd]

It also explains:

- failures before debit are one class of problem
- debit-side issues sit with the remitter side
- deemed/pending credit-side issues sit with the beneficiary side
- successful P2M can still have goods/services/refund disputes[^udir-tsd]

#### A useful product lens


| Failure zone                               | Typical owner                    | Example issue                               |
| ------------------------------------------ | -------------------------------- | ------------------------------------------- |
| Before debit                               | payer-side / validation          | invalid payee, user abort, identifier issue |
| After debit, before final credit certainty | remitter / beneficiary / timeout | pending / deemed / reversal-required        |
| After success in P2M                       | merchant-side business issue     | goods not delivered, refund not processed   |


---

## 10) Appendix: UDIR / dispute and refund concepts (from the supplied PDFs)

> This section is based on the **user-provided internal UDIR documents**, not just public marketing pages.[^udir-tsd][^udir-refund]

### 10.1 Why include UDIR in a UPI reference?

Because in real products, “payment flow” is incomplete without:

- **pending / deemed** handling
- **reversal confirmation**
- **merchant complaints**
- **refund orchestration**

#### Two big APIs called out in the supplied TSD

- **ReqChkTxn**
- **ReqComplaint**[^udir-tsd]

---

### 10.2 Common UDIR status concepts


| Term                | Meaning                                                   |
| ------------------- | --------------------------------------------------------- |
| **DRC**             | Debit Reversal Confirmation                               |
| **TCC**             | Transaction Credit Confirmation                           |
| **RET**             | Beneficiary could not process credit and initiates return |
| **RRC**             | Return Reversal Confirmation                              |
| **PR2C**            | Payee response to complaint                               |
| **PTO / BTO**       | Payee / Beneficiary timeout                               |
| **URCS**            | NPCI back-office / reconciliation and dispute layer       |
| **UDIR / UPI Help** | Unified Dispute & Issue Resolution / complaint experience |


These are especially useful when documenting **pending**, **deemed**, **failed after debit**, and **merchant refund** flows.[^udir-tsd]

---

### 10.3 Merchant refund under UDIR

The supplied refund documents describe a **pre-approved refund** flow where the **beneficiary** (or payee through beneficiary) initiates the refund, UPI checks URCS, then the **remitter** processes the reversal and returns status to UPI.[^udir-refund][^udir-tsd]

#### Simple mental model

1. Customer raises complaint / refund need
2. Merchant side decides refund is needed
3. Beneficiary bank raises refund request
4. UPI checks back-office state
5. Remitter processes the reversal
6. Final refund status is broadcast to relevant parties

#### Important statuses in the supplied docs

- **RRC 501** = refund reversal confirmation success
- **RRC 502** = timeout / pending, later reconciliation path[^udir-refund][^udir-tsd]

#### Why this matters

For product teams, this explains why “merchant payment success” and “final customer resolution” may be different lifecycle stages.

---

## 11) What usually varies across PSPs / banks / versions

Do **not** hard-code the following as universal truths without checking the live scheme version and participant readiness:

- device-binding method
- exact VPA handle rules
- number of allowed VPAs
- which bank accounts are eligible
- UPI PIN set/reset route exposed to the user
- whether face-auth / biometric options are live
- Lite defaulting and app UX
- mandate categories, limits, and execution rules
- merchant collect vs intent preference
- RuPay card / credit line eligibility
- international acceptance availability
- dispute/refund surface behavior and SLA text

---

## 12) Suggested way to use this note in PRDs / architecture docs

#### Use this note for

- product definitions
- participant-role clarity
- UX flow mapping
- terminology standardization
- basic failure mental models
- internal onboarding for PMs / engineers / ops

#### Do **not** use this note as

- a substitute for the latest NPCI circular
- a message-level XML/API contract
- a final compliance interpretation
- a participant-certification document

---

## 13) Sources

#### Public / official sources

1. **NPCI – About UPI**
  [https://www.npci.org.in/product/upi/about-upi](https://www.npci.org.in/product/upi/about-upi)
2. **NPCI – UPI product page**
  [https://www.npci.org.in/product/upi](https://www.npci.org.in/product/upi)
3. **NPCI – BHIM UPI App**
  [https://www.npci.org.in/product/bhim](https://www.npci.org.in/product/bhim)
4. **RBI – UPI customer explainer / FAQ PDF**
  [https://rbi.org.in/commonman/Upload/english/Content/PDFs/UPI.pdf](https://rbi.org.in/commonman/Upload/english/Content/PDFs/UPI.pdf)
5. **NPCI – UPI Lite**
  [https://www.npci.org.in/product/upi/upi-lite](https://www.npci.org.in/product/upi/upi-lite)
6. **NPCI – UPI Lite Brand Guidelines (June 2023)**
  [https://www.npci.org.in/uploads/UPI_LITE_Brand_Guidelines_bfe23b57a9.pdf](https://www.npci.org.in/uploads/UPI_LITE_Brand_Guidelines_bfe23b57a9.pdf)
7. **NPCI – UPI AutoPay**
  [https://www.npci.org.in/product/autopay](https://www.npci.org.in/product/autopay)
8. **NPCI – UPI AutoPay Brand Guidelines**
  [https://www.npci.org.in/uploads/UPI_Auto_Pay_Brand_Guidelines_bcabed7282.pdf](https://www.npci.org.in/uploads/UPI_Auto_Pay_Brand_Guidelines_bcabed7282.pdf)
9. **NPCI – UPI Global Acceptance**
  [https://www.npci.org.in/product/upi-global-acceptance](https://www.npci.org.in/product/upi-global-acceptance)
10. **NPCI – UPI One World**
  [https://www.npci.org.in/product/upi-global-acceptance/upi-one-world](https://www.npci.org.in/product/upi-global-acceptance/upi-one-world)
11. **NPCI – RuPay Credit Card on UPI**
  [https://www.npci.org.in/product/rupay/credit-card-on-upi](https://www.npci.org.in/product/rupay/credit-card-on-upi)
12. **NPCI – Credit Line on UPI**
  [https://www.npci.org.in/product/upi/credit-line-on-upi](https://www.npci.org.in/product/upi/credit-line-on-upi)
13. **NPCI – Introduction of Additional Authentication Methods in UPI (OC-226, 7 Oct 2025)**
  [https://www.npci.org.in/uploads/UPI_OC_No_226_FY_2025_26_Introduction_of_Additional_Authentication_methods_in_UPI_42c3693399.pdf](https://www.npci.org.in/uploads/UPI_OC_No_226_FY_2025_26_Introduction_of_Additional_Authentication_methods_in_UPI_42c3693399.pdf)
14. **NPCI – UPI Lite X Brand Guidelines (related extension)**
  [https://www.npci.org.in/uploads/UPI_LITE_X_Brand_Guidelines_b5007d7240.pdf](https://www.npci.org.in/uploads/UPI_LITE_X_Brand_Guidelines_b5007d7240.pdf)

#### User-provided / internal supporting docs

1. **UPI Help – UDIR Technical Specification Document v2.2 (1 Jul 2024)**
2. **Understanding Document – Online Merchant Refund – UDIR (UPI Help) (5 Sep 2025)**

---

## Footnotes

[^about-upi]: NPCI’s “About UPI” page says UPI empowers users to add multiple participating bank and other allowed accounts into a UPI app.
[^upi-product]: NPCI’s UPI product page calls out QR-based payments, static vs dynamic QR, intent-based payments, and merchant / P2P use cases.
[^bhim]: NPCI’s BHIM page describes send-money via VPA/account/QR, request-money / collect, switching linked bank accounts, and setting/changing UPI PIN.
[^rbi-upi]: RBI’s customer-facing UPI explainer says users create a UPI PIN using the last 6 digits of the debit/ATM card, expiry details, and OTP received on the registered mobile number.
[^upi-lite]: NPCI’s UPI Lite page says UPI Lite is for low-value transactions below ₹1000 and is designed to be faster and pin-less.
[^upi-lite-guide]: NPCI’s UPI Lite guideline PDF describes Lite as enabling payments without entering UPI PIN and shows enable/top-up/payment journeys.
[^autopay]: NPCI’s AutoPay page says customers can enable e-mandates using UPI apps for recurring use cases such as bills and EMI.
[^autopay-guide]: NPCI’s AutoPay guideline PDF explicitly shows collect, QR, and intent registration journeys for mandate setup.
[^global]: NPCI’s UPI Global Acceptance page describes QR-based payments at select international merchant locations with UPI PIN authorization.
[^one-world]: NPCI’s UPI One World materials describe a PPI linked to UPI for inbound travellers / NRIs from G20 countries, with issuance based on passport and valid visa.
[^rupay-upi]: NPCI’s RuPay Credit Card on UPI page says linked RuPay credit cards can be used for merchant QR-based payments and authenticated with UPI PIN.
[^credit-line]: NPCI’s Credit Line on UPI page describes pre-sanctioned bank credit lines being surfaced as a UPI funding source.
[^auth-2025]: NPCI’s Oct 2025 circular introduces UIDAI Face Authentication as an additional option for UPI PIN set/re-set, and on-device biometric authentication for certain transaction scenarios, subject to participant rollout and safeguards.
[^lite-x]: NPCI’s UPI Lite X guideline material shows Tap & Pay / P2M offline style journeys as a related extension to Lite.
[^udir-tsd]: User-provided internal document: “UPI Help – UDIR Technical Specification Document v2.2 (1 Jul 2024)”.
[^udir-refund]: User-provided internal document: “Understanding Document – Online Merchant Refund – UDIR (UPI Help) (5 Sep 2025)”.
<h1 align="center">Zendvo</h1>

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-15.x-black?style=for-the-badge&logo=next.js" alt="Next.js 15" />
  <img src="https://img.shields.io/badge/TypeScript-5.x-blue?style=for-the-badge&logo=typescript" alt="TS 5" />
  <img src="https://img.shields.io/badge/Drizzle-ORM-teal?style=for-the-badge&logo=drizzle" alt="Drizzle" />
  <img src="https://img.shields.io/badge/Stellar-Soroban-black?style=for-the-badge&logo=stellar" alt="Stellar" />
</p>

**Zendvo** is a comprehensive expense, savings, and gifting platform available on web and mobile that transforms digital money transfers into memorable experiences. It leverages Stellar blockchain technology to enable users to send stablecoin (USDC) cash gifts that remain completely hidden and locked on-chain until a predetermined date and time. Additionally, it allows users to save toward specific items or goals, earn yield on those savings, and track their daily expenses accurately.

The project is structured as a monorepo containing a Next.js web application, a Flutter mobile application, an Express.js backend, and Stellar Soroban smart contracts.

## Features

- **Time-Locked Gifting**: Funds are locked in Soroban smart contracts and only released after a specified date and time, enforced entirely on-chain.
- **Stablecoin Preservation**: Uses USDC on Stellar to keep gift value stable from creation to reveal, eliminating volatility risk.
- **Yield on Savings**: Idle savings earn yield through Stellar's AMM liquidity pools or Blend Protocol lending, so balances grow while waiting.
- **Bank Integration**: Seamless on/off-ramps connecting stablecoin liquidity to local bank accounts, with Paystack powering Nigerian bank payouts.
- **Surprise Experience**: UI/UX built around anticipation, revealing gifts only at the exact unlock moment.
- **Low-Cost Global Transfers**: Stellar's 3–5 second finality and near-zero fees make cross-border gifting practical at any amount.
- **Expense Tracking**: Accurate daily expense calculation with categorization and spending summaries.

## Stack

### Frontend (`web/`)
- **Framework**: [Next.js 16](https://nextjs.org/) (App Router, React 19)
- **Styling**: Tailwind CSS 4, Framer Motion
- **Language**: [TypeScript 5](https://www.typescriptlang.org/)

### Backend (`backend/`)
- **Server Framework**: Node.js with [Express.js](https://expressjs.com/)
- **Database**: PostgreSQL with [Drizzle ORM](https://orm.drizzle.team/)
- **Language**: TypeScript 5
- **Task Scheduling**: Integrated background cleanup cron jobs
- **Integrations**: Stripe (Payments), Paystack (bank payouts), Nodemailer (Emails)

### Mobile (`mobile/`)
- **Framework**: [Flutter](https://flutter.dev/)
- **Language**: Dart

### Blockchain (`contracts/`)
- **Smart Contracts**: Stellar Soroban (Rust)
- **SDKs**: Stellar SDK, Soroban SDK

---

## Stellar Integration

Zendvo uses the Stellar ecosystem for its core financial primitives:

| Feature | Stellar Primitive |
|---|---|
| Time-locked gifts | Soroban smart contracts with `time_lock` logic |
| Stable transfers | USDC (Circle) on Stellar |
| Savings yield | Stellar AMM pools / Blend Protocol |
| Low-fee settlement | Stellar Consensus Protocol (SCP) |
| On/off-ramp | Anchor-compatible deposit/withdrawal |

> [!NOTE]
> Stellar does not have native proof-of-stake staking. Yield on savings is earned through liquidity provision in Stellar's built-in AMM or via the Blend Protocol lending market — both non-custodial and on-chain.

---

## Quick Start

This project is set up as a **PNPM Workspaces Monorepo**. Dependencies are hoisted and both servers can be run concurrently.

1. **Clone and prepare**:
   ```bash
   git clone https://github.com/codeze-us/zendvo.git
   cd zendvo
   # Copy and configure environment variables in the backend folder
   cp backend/.env.example backend/.env
   ```

2. **Install dependencies** (installs and hoists packages for all workspaces):
   ```bash
   pnpm install
   ```

3. **Database setup** (runs Drizzle Kit from the backend workspace):
   ```bash
   pnpm run db:push
   ```

4. **Run in development** (starts Next.js on port `3000` and Express on port `5000` concurrently):
   ```bash
   pnpm run dev
   ```

---

## Project Structure

```text
web/                      # Frontend Workspace (Next.js client)
├── src/
│   ├── app/              # UI Pages and layouts (pure client routes)
│   ├── components/       # Modular UI React components
│   ├── context/          # Client state & Auth contexts
│   ├── hooks/            # Client React hooks
│   ├── services/         # api.ts fetch client configuration
│   └── lib/              # Client-only utility functions
│
mobile/                   # Mobile Workspace (Flutter app)
├── lib/
│   ├── core/             # Core utilities, theme, routing
│   ├── features/         # Feature-based modular architecture
│   └── main.dart         # Flutter app entry point
│
backend/                  # Backend Workspace (Express, DB, Jobs)
├── src/
│   ├── api/              # API endpoints (migrated Next route handlers)
│   ├── server/           # Business services, cron jobs & audit logging
│   ├── lib/              # Drizzle DB setup, validations, token signing
│   ├── adapter.ts        # Express-to-Next standard Request/Response adapter
│   ├── routes.ts         # Express routes mapping
│   └── server.ts         # Express server entry point
├── migrations/           # Raw SQL database migrations
├── drizzle/              # Drizzle Kit schema metadata
└── __tests__/            # Centralized test suites (Jest/ts-jest)
│
contracts/                # Smart Contracts Workspace (Soroban)
├── src/                  # Rust smart contract source code
├── target/               # Compiled WASM contracts
└── Cargo.toml            # Rust dependencies and project metadata
```

## Documentation

- [Documentation Index](./docs/README.md)
- [Architecture Overview](./docs/architecture/overview.md)
- [Project Vision](./docs/context/project-overview.md)
- [Smart Contract Logic](./docs/blockchain/contracts.md)

## Use Cases

### Surprise Birthdays
Send a cash gift weeks in advance that only unlocks at exactly 12:00 AM on the recipient's birthday.

### Graduation Gifts
Lock funds until a graduation date, ensuring the gift lands at the right moment.

### Cross-Border Gifting
Send USDC from anywhere in the world to Nigerian recipients with local bank payout and time-locked reveal logic.

### Goal Savings
Set a savings target for an item or date, earn yield while saving, and withdraw when ready.

## Contributing

We welcome contributions. See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## License

MIT — see [LICENSE](./LICENSE).

## Support

- **Issues**: [GitHub Issues](https://github.com/codeze-us/zendvo/issues)
- **Website**: [www.zendvo.com](https://www.zendvo.com)

  <i>Decentralizing the art of surprise on Stellar</i>
</p>

---

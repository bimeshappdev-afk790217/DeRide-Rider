# DeRide — Rider App

React Native client for **DeRide**, a decentralized ride-hailing protocol running live on Polygon mainnet.

Fares settle on-chain directly between rider and driver, and matching runs across community-operated nodes rather than a centralized dispatch service — removing the platform from both the money path and the coordination path.

> This repository contains the rider-facing mobile client only. Smart contracts, matching nodes, and the driver client live in separate repositories.

---

## Protocol overview

| | |
|---|---|
| **Network** | Polygon mainnet |
| **Contracts** | Solidity, UUPS upgradeable proxy pattern |
| **Settlement** | On-chain escrow, rider → driver; the protocol never takes custody of funds |
| **Matching** | Distributed across community-run nodes |
| **Operators** | City operators stake to serve a region and receive a share of protocol fees, distributed automatically by contract |

Contracts are deployed and publicly verifiable on Polygon mainnet.

---

## This app

Built with React Native and Expo, in TypeScript.

- Ride request and live ride progress screens
- Wallet connection and on-chain fare settlement
- Relay-based communication with driver clients
- Test suite under `__tests__/`

## Getting started

```bash
npm install
cp .env.example .env    # fill in your own values
npx expo start
```

Requires Node.js 18+ and the Expo CLI. See `.env.example` for the configuration the app expects — no credentials are committed to this repository.

## Project status

Deployed to Polygon mainnet and validated through multi-device field testing against live contracts. Active development.

## Author

Built by Bheemesh Taarappagol as an independent project.

## License

MIT — see [LICENSE](LICENSE).

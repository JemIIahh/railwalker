# Blockscout fixtures

Responses recorded from `https://celo.blockscout.com` on 2026-10-21 for the buy gateway's payee wallet
(`0x20faAca5F980E29639A0FCC6dcA6988E18ed333B`, public on-chain data, no transactions of its own) and the ERC-8004 identity registry.

- `blockscout-es-*.json`: the Etherscan-compatible API (`/api?module=account&action=txlist|tokentx&sort=asc`), unchanged. These are the
  calls used to find a wallet's first activity, because the v2 token-transfers endpoint has no ordering parameter (it answers 422 to `sort`).
- `blockscout-v2-transfers-page{1,2}.json`: `/api/v2/addresses/<a>/token-transfers?type=ERC-20&filter=to`, trimmed to three items per page;
  `next_page_params` are the real ones. Newest first, and page 1 continues exactly where page 2 starts.

Tests build their scenarios (a wallet first active on a chosen date, funded by a chosen address) by copying these real items and
changing fields, so the shapes are real but the story is told by the test.

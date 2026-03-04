# CoinMax

A cryptocurrency trading and portfolio management web application built with React, Vite, and Supabase.

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite 7, TailwindCSS
- **Backend/Database**: Supabase (PostgreSQL)
- **Web3**: Thirdweb SDK (Base Sepolia Testnet)
- **UI**: Radix UI components, Framer Motion, Recharts, Lightweight Charts
- **Routing**: Wouter
- **i18n**: i18next + react-i18next
- **State**: TanStack React Query

## Project Structure

- `src/` - React application source
- `src/lib/supabase.ts` - Supabase client initialization
- `contracts/` - Smart contract related files
- `supabase/` - Supabase configuration
- `shared/` - Shared types/utilities
- `attached_assets/` - Static assets
- `public/` - Public static files

## AI Analysis Section

- Entire section (header, featured card, model pills) wrapped in a single `ai-wrapper-glass` frosted glass container
- Featured card (best model) has colored gradient glass with animated gauge, shimmer sweep, and corner orbs
- Compact model pills use subtle translucent glass style and auto-scroll via CSS marquee animation (`MarqueeRow` component duplicates children for seamless loop, pauses on hover/touch)
- `prefers-reduced-motion` support disables all animations

## Bottom Navigation

- Floating pill-shaped bar centered at bottom with rounded capsule design
- 5 icon-only tabs: Home, Trade, Vault (custom SVG coin icon), Strategy, Profile
- Active tab gets dark inset pill background with green (#00e7a0) icon glow
- Inactive icons are muted; no text labels
- Glass effect: `backdrop-filter: blur(24px)`, gradient background, outer shadow
- Responsive: slightly larger on desktop (sm: breakpoints)

## Configuration

- Vite dev server runs on port 5000 (host: 0.0.0.0)
- Environment variables prefixed with `VITE_` are exposed to the frontend
- Key env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_THIRDWEB_CLIENT_ID`, contract addresses, `VITE_VIP_RECEIVER_ADDRESS`

## VIP Subscription

- **Monthly**: $39/month (30 days)
- **Semi-Annual**: $169/6 months (180 days), saves $65
- Payment: x402-style direct USDC transfer to `VITE_VIP_RECEIVER_ADDRESS` via Thirdweb SDK `transfer()` (no smart contract call needed)
- Plan selection UI on profile page with expandable card showing both options
- Backend RPC `subscribe_vip` records plan + tx hash

## Database (Supabase)

- **Tables**: `profiles`, `node_memberships`, `node_milestones`, `node_rewards`, `vault_positions`, `vault_rewards`, `trade_bets`, `prediction_bets`, `transactions`, `strategies`, `strategy_subscriptions`, `hedge_positions`, `insurance_purchases`, `revenue_pools`, `revenue_events`, `system_config`, `ai_predictions`
- **RPCs**: `auth_wallet`, `purchase_node`, `get_node_overview`, `check_node_milestones`, `settle_node_fixed_yield`, `settle_node_pool_dividend`, `vault_deposit`, `vault_withdraw`, `place_trade_bet`, `get_trade_stats`, `subscribe_strategy`, `purchase_hedge`, `subscribe_vip`, `place_prediction_bet`, `get_vault_overview`, `get_strategy_overview`, `get_insurance_pool`, `get_referral_tree`, `get_node_milestone_requirements`
- **Edge Functions**: `api-proxy`, `ai-forecast`, `ai-forecast-multi`, `ai-prediction`, `news-predictions`, `ai-fear-greed`
- **Migrations**: `supabase/migrations/001-008` (must be applied in order via Supabase CLI or dashboard)
- All frontend data fetching goes through `src/lib/api.ts` using Supabase client; `toCamel()` converts snake_case DB columns to camelCase

## Node System

- **Large Node (MAX)**: $600 contribution + $6,000 USDC frozen. Daily 0.9% MA earnings. 120-day program with V1→V6 milestones (days 15/30/45/60/90/120). V5=800U holding. Success at V6 unlocks frozen funds.
- **Small Node (MINI)**: $100 contribution + $1,000 USDC frozen. Daily 0.5% MA earnings. Day 15: V2 unlocks earnings. Day 90: V4 unlocks frozen amount.
- **Large Node Purchase Flow**: Multi-step dialog triggered by "Apply Large Node" button. Step 1: Select rank level (V2-V6). Step 2: System checks vault holding + referral requirements with progress bars; if not met, shows CTA to vault/referral page. Step 3: Confirm payment. Small Node skips rank selection.
- Failure to meet milestones: earnings stopped, frozen funds reclaimed, node qualification cancelled.
- On-chain payment = contribution + frozen amount (MINI: $1,100, MAX: $6,600)
- Node data columns: `contribution_amount`, `frozen_amount`, `daily_rate`, `locked_earnings`, `released_earnings`, `available_balance`
- `NodePurchaseDialog` component in `src/components/nodes/node-purchase-section.tsx` handles both MAX and MINI purchase flows

## Running

```
npm run dev
```

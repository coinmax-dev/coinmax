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

## Configuration

- Vite dev server runs on port 5000 (host: 0.0.0.0)
- Environment variables prefixed with `VITE_` are exposed to the frontend
- Key env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_THIRDWEB_CLIENT_ID`, contract addresses

## Running

```
npm run dev
```

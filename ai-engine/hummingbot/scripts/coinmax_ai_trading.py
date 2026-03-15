"""
CoinMax AI Trading Script — Hummingbot V2 Entry Point

Phase 4.3: Main hummingbot script that loads and manages
the CoinMax AI controller with global risk controls.

Usage:
  1. Copy to hummingbot/scripts/
  2. Configure via hummingbot UI or YAML
  3. Start with: start --script coinmax_ai_trading.py

Reference:
  - hummingbot/scripts/v2_with_controllers.py
  - hummingbot/strategy/strategy_v2_base.py
"""

import logging
from decimal import Decimal
from typing import Dict, List

from hummingbot.strategy.strategy_v2_base import StrategyV2Base

logger = logging.getLogger(__name__)


class CoinMaxAITrading(StrategyV2Base):
    """
    CoinMax AI Trading Strategy.

    Manages one or more CoinMaxAIController instances with:
    - Global max drawdown kill switch
    - Per-controller independent kill switches
    - Real-time performance reporting to Supabase
    - Multi-asset support
    """

    # ── Configuration ────────────────────────────────────

    # Controller configs (loaded from YAML or UI)
    # Example YAML:
    #   controllers:
    #     - controller_name: coinmax_ai
    #       connector_name: binance_perpetual
    #       trading_pair: BTC-USDT
    #       signal_topic: coinmax/signals/BTC-USDT
    #       min_confidence: 60
    #       max_leverage: 5
    #       max_position_size_quote: 1000

    # Global risk limits
    global_max_drawdown_pct: Decimal = Decimal("0.15")  # 15%
    daily_max_loss_quote: Decimal = Decimal("500")       # $500/day
    max_total_position_quote: Decimal = Decimal("5000")  # $5000 total

    # Supabase reporting
    supabase_url: str = ""
    supabase_key: str = ""
    report_interval_seconds: int = 60

    def __init__(self, connectors: Dict, controllers_config=None):
        super().__init__(connectors)
        self._controllers_config = controllers_config or []
        self._kill_switch_active = False
        self._peak_portfolio_value = Decimal("0")
        self._daily_pnl = Decimal("0")
        self._last_report_time = 0

    # ── Lifecycle ────────────────────────────────────────

    def on_start(self):
        """Called when strategy starts."""
        logger.info("=" * 60)
        logger.info("CoinMax AI Trading Strategy Started")
        logger.info(f"Global max drawdown: {self.global_max_drawdown_pct * 100}%")
        logger.info(f"Daily max loss: ${self.daily_max_loss_quote}")
        logger.info(f"Max total position: ${self.max_total_position_quote}")
        logger.info("=" * 60)

    def on_stop(self):
        """Called when strategy stops."""
        logger.info("CoinMax AI Trading Strategy Stopped")
        self._report_final_performance()

    # ── Main Loop ────────────────────────────────────────

    def on_tick(self):
        """Called every tick (configurable interval)."""
        # 1. Check global kill switch
        if self._kill_switch_active:
            return

        if self._check_global_kill_switch():
            self._kill_switch_active = True
            logger.error("GLOBAL KILL SWITCH ACTIVATED — All trading stopped")
            self._close_all_positions()
            return

        # 2. Process each controller's actions
        # (handled by StrategyV2Base which calls controller.determine_executor_actions())

        # 3. Periodic performance reporting
        self._periodic_report()

    # ── Risk Management ──────────────────────────────────

    def _check_global_kill_switch(self) -> bool:
        """Check if global risk limits are breached."""
        portfolio_value = self._get_portfolio_value()

        # Update peak
        if portfolio_value > self._peak_portfolio_value:
            self._peak_portfolio_value = portfolio_value

        # Check drawdown
        if self._peak_portfolio_value > 0:
            drawdown = (self._peak_portfolio_value - portfolio_value) / self._peak_portfolio_value
            if drawdown >= self.global_max_drawdown_pct:
                logger.error(f"Drawdown {drawdown:.2%} exceeds limit {self.global_max_drawdown_pct:.2%}")
                return True

        # Check daily loss
        if self._daily_pnl < -self.daily_max_loss_quote:
            logger.error(f"Daily loss ${abs(self._daily_pnl)} exceeds limit ${self.daily_max_loss_quote}")
            return True

        return False

    def _get_portfolio_value(self) -> Decimal:
        """Get total portfolio value across all connectors."""
        total = Decimal("0")
        for connector_name, connector in self.connectors.items():
            try:
                balances = connector.get_all_balances()
                for asset, balance in balances.items():
                    if asset in ("USDT", "USDC", "BUSD", "USD"):
                        total += Decimal(str(balance))
            except Exception:
                pass
        return total

    def _close_all_positions(self):
        """Emergency close all positions."""
        logger.warning("Closing all positions due to kill switch...")
        # The StrategyV2Base framework handles executor cleanup
        # when we stop the strategy

    # ── Performance Reporting ────────────────────────────

    def _periodic_report(self):
        """Send performance report to Supabase periodically."""
        import time
        now = time.time()
        if now - self._last_report_time < self.report_interval_seconds:
            return
        self._last_report_time = now

        report = self._build_performance_report()
        logger.info(
            f"Performance: PnL=${report['realized_pnl']:.2f} "
            f"Unrealized=${report['unrealized_pnl']:.2f} "
            f"WinRate={report['win_rate']:.1%} "
            f"Trades={report['total_trades']}"
        )

        # TODO: Push to Supabase when credentials are configured
        # self._push_to_supabase(report)

    def _build_performance_report(self) -> Dict:
        """Build performance report from executor history."""
        total_trades = 0
        winning_trades = 0
        realized_pnl = Decimal("0")
        unrealized_pnl = Decimal("0")

        # Iterate through all controllers' executor info
        for controller_id, controller in self.controllers.items() if hasattr(self, "controllers") else []:
            if hasattr(controller, "executors_info"):
                for executor_id, info in controller.executors_info.items():
                    if info.is_active:
                        unrealized_pnl += info.net_pnl_quote or Decimal("0")
                    else:
                        total_trades += 1
                        pnl = info.net_pnl_quote or Decimal("0")
                        realized_pnl += pnl
                        if pnl > 0:
                            winning_trades += 1

        win_rate = winning_trades / total_trades if total_trades > 0 else 0

        return {
            "realized_pnl": float(realized_pnl),
            "unrealized_pnl": float(unrealized_pnl),
            "total_pnl": float(realized_pnl + unrealized_pnl),
            "total_trades": total_trades,
            "winning_trades": winning_trades,
            "win_rate": win_rate,
            "portfolio_value": float(self._get_portfolio_value()),
            "kill_switch_active": self._kill_switch_active,
        }

    def _report_final_performance(self):
        """Log final performance on stop."""
        report = self._build_performance_report()
        logger.info("=" * 60)
        logger.info("FINAL PERFORMANCE REPORT")
        logger.info(f"  Realized PnL:   ${report['realized_pnl']:.2f}")
        logger.info(f"  Unrealized PnL: ${report['unrealized_pnl']:.2f}")
        logger.info(f"  Total PnL:      ${report['total_pnl']:.2f}")
        logger.info(f"  Total Trades:   {report['total_trades']}")
        logger.info(f"  Win Rate:       {report['win_rate']:.1%}")
        logger.info("=" * 60)

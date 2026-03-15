"""
CoinMax AI Controller — Hummingbot V2 Directional Trading Controller

Phase 4.2: Receives trade signals from CoinMax AI engine via MQTT/WebSocket
and translates them into hummingbot executor actions.

Reference:
  - hummingbot/controllers/directional_trading/ai_livestream.py
  - hummingbot/strategy_v2/controllers/directional_trading_controller_base.py
  - hummingbot/strategy_v2/executors/position_executor/
"""

import json
import logging
import time
from decimal import Decimal
from typing import Dict, List, Optional, Set

from pydantic import Field

from hummingbot.strategy_v2.controllers.directional_trading_controller_base import (
    DirectionalTradingControllerBase,
    DirectionalTradingControllerConfigBase,
)
from hummingbot.strategy_v2.executors.position_executor.data_types import (
    PositionExecutorConfig,
    TrailingStop,
    TripleBarrierConfig,
)
from hummingbot.strategy_v2.executors.dca_executor.data_types import DCAExecutorConfig
from hummingbot.strategy_v2.models.executor_actions import CreateExecutorAction, StopExecutorAction
from hummingbot.core.data_type.common import TradeType
from hummingbot.remote_iface.messages import ExternalTopicFactory

logger = logging.getLogger(__name__)


class CoinMaxAIControllerConfig(DirectionalTradingControllerConfigBase):
    """Configuration for the CoinMax AI trading controller."""
    controller_name: str = "coinmax_ai"
    connector_name: str = "binance_perpetual"
    trading_pair: str = "BTC-USDT"

    # Signal source
    signal_source: str = Field(default="mqtt", description="mqtt or websocket")
    signal_topic: str = Field(default="coinmax/signals/BTC-USDT", description="MQTT topic for signals")
    supabase_url: str = Field(default="", description="Supabase URL for websocket signals")
    supabase_key: str = Field(default="", description="Supabase anon key")

    # Risk controls
    min_confidence: int = Field(default=60, ge=0, le=100, description="Minimum signal confidence to trade")
    max_leverage: int = Field(default=5, ge=1, le=50, description="Maximum leverage")
    max_position_size_quote: Decimal = Field(default=Decimal("1000"), description="Max position size in quote currency")
    max_drawdown_pct: Decimal = Field(default=Decimal("0.10"), description="Max drawdown before kill switch (10%)")
    cooldown_after_fill: int = Field(default=60, description="Seconds to wait after a fill before new trade")
    max_concurrent_executors: int = Field(default=3, description="Max open executors")

    # Strategy defaults
    default_stop_loss: Decimal = Field(default=Decimal("0.02"), description="Default stop-loss (2%)")
    default_take_profit: Decimal = Field(default=Decimal("0.03"), description="Default take-profit (3%)")
    trailing_stop_activation: Decimal = Field(default=Decimal("0.02"), description="Trailing stop activation (2%)")
    trailing_stop_delta: Decimal = Field(default=Decimal("0.005"), description="Trailing stop delta (0.5%)")
    time_limit_seconds: int = Field(default=3600, description="Default time limit for positions")


class CoinMaxAIController(DirectionalTradingControllerBase):
    """
    CoinMax AI trading controller.

    Receives signals from the CoinMax AI engine and creates
    position executors with triple barrier configuration.
    """

    def __init__(self, config: CoinMaxAIControllerConfig, *args, **kwargs):
        super().__init__(config, *args, **kwargs)
        self.config: CoinMaxAIControllerConfig = config
        self._signal_listener = None
        self._latest_signal: Optional[Dict] = None
        self._last_signal_time: float = 0
        self._last_fill_time: float = 0
        self._total_realized_pnl: Decimal = Decimal("0")
        self._peak_balance: Decimal = Decimal("0")
        self._processed_signal_ids: Set[str] = set()

    async def start(self):
        """Start listening for trade signals."""
        if self.config.signal_source == "mqtt":
            try:
                self._signal_listener = ExternalTopicFactory.create_async(
                    topic=self.config.signal_topic,
                    callback=self._handle_signal,
                )
                logger.info(f"CoinMax AI: Subscribed to MQTT topic {self.config.signal_topic}")
            except Exception as e:
                logger.error(f"CoinMax AI: Failed to subscribe to MQTT: {e}")
        else:
            logger.info("CoinMax AI: Using Supabase Realtime for signals")
            # Supabase realtime would be implemented here

    def _handle_signal(self, msg: str):
        """Process incoming trade signal from MQTT."""
        try:
            signal = json.loads(msg) if isinstance(msg, str) else msg

            # Validate signal
            if not self._validate_signal(signal):
                return

            # Deduplicate
            signal_id = signal.get("id", "")
            if signal_id in self._processed_signal_ids:
                logger.debug(f"CoinMax AI: Skipping duplicate signal {signal_id}")
                return
            self._processed_signal_ids.add(signal_id)
            # Keep set bounded
            if len(self._processed_signal_ids) > 1000:
                self._processed_signal_ids = set(list(self._processed_signal_ids)[-500:])

            self._latest_signal = signal
            self._last_signal_time = time.time()

            # Set hummingbot signal format
            action = signal.get("action", "HOLD")
            if action == "OPEN_LONG":
                self.processed_data["signal"] = 1
            elif action == "OPEN_SHORT":
                self.processed_data["signal"] = -1
            else:
                self.processed_data["signal"] = 0

            logger.info(
                f"CoinMax AI: Signal received — {action} "
                f"confidence={signal.get('confidence')}% "
                f"strength={signal.get('strength')} "
                f"strategy={signal.get('strategy_type')}"
            )

        except Exception as e:
            logger.error(f"CoinMax AI: Error processing signal: {e}")

    def _validate_signal(self, signal: Dict) -> bool:
        """Validate a signal meets minimum requirements."""
        confidence = signal.get("confidence", 0)
        if confidence < self.config.min_confidence:
            logger.debug(f"CoinMax AI: Signal confidence {confidence}% below minimum {self.config.min_confidence}%")
            return False

        strength = signal.get("strength", "NONE")
        if strength == "NONE":
            return False

        action = signal.get("action", "HOLD")
        if action not in ("OPEN_LONG", "OPEN_SHORT"):
            return False

        return True

    def determine_executor_actions(self) -> List:
        """Determine what executor actions to take based on current signal."""
        actions = []
        signal = self._latest_signal

        if not signal:
            return actions

        # Check cooldown
        if time.time() - self._last_fill_time < self.config.cooldown_after_fill:
            return actions

        # Check drawdown kill switch
        if not self._check_drawdown():
            logger.warning("CoinMax AI: Drawdown limit reached — kill switch active")
            return actions

        # Check max concurrent executors
        active_executors = len(self.executors_info) if hasattr(self, "executors_info") else 0
        if active_executors >= self.config.max_concurrent_executors:
            return actions

        # Check if we can create executor (inherited cooldown logic)
        action = signal.get("action", "HOLD")
        if action not in ("OPEN_LONG", "OPEN_SHORT"):
            return actions

        # Create executor based on strategy type
        strategy_type = signal.get("strategy_type", "directional")
        try:
            if strategy_type == "directional":
                executor_action = self._create_position_action(signal)
                if executor_action:
                    actions.append(executor_action)
            elif strategy_type == "dca":
                executor_action = self._create_dca_action(signal)
                if executor_action:
                    actions.append(executor_action)

            # Clear signal after processing
            self._latest_signal = None
            self.processed_data["signal"] = 0

        except Exception as e:
            logger.error(f"CoinMax AI: Error creating executor: {e}")

        return actions

    def _create_position_action(self, signal: Dict) -> Optional[CreateExecutorAction]:
        """Create a PositionExecutor with triple barrier config."""
        side = TradeType.BUY if signal["action"] == "OPEN_LONG" else TradeType.SELL
        leverage = min(signal.get("leverage", 2), self.config.max_leverage)
        amount = self._calculate_position_size(signal)

        stop_loss = Decimal(str(signal.get("stop_loss_pct", self.config.default_stop_loss)))
        take_profit = Decimal(str(signal.get("take_profit_pct", self.config.default_take_profit)))

        config = PositionExecutorConfig(
            trading_pair=self.config.trading_pair,
            connector_name=self.config.connector_name,
            side=side,
            amount=amount,
            leverage=leverage,
            triple_barrier_config=TripleBarrierConfig(
                stop_loss=stop_loss,
                take_profit=take_profit,
                time_limit=self.config.time_limit_seconds,
                trailing_stop=TrailingStop(
                    activation_price=self.config.trailing_stop_activation,
                    trailing_delta=self.config.trailing_stop_delta,
                ),
            ),
        )

        logger.info(
            f"CoinMax AI: Creating {side.name} executor — "
            f"amount={amount}, leverage={leverage}x, "
            f"SL={stop_loss}, TP={take_profit}"
        )

        return CreateExecutorAction(
            controller_id=self.config.id,
            executor_config=config,
        )

    def _create_dca_action(self, signal: Dict) -> Optional[CreateExecutorAction]:
        """Create a DCA executor for gradual position building."""
        side = TradeType.BUY if signal["action"] == "OPEN_LONG" else TradeType.SELL
        total_amount = self._calculate_position_size(signal)
        n_levels = signal.get("dca_levels", 4)
        step_pct = Decimal(str(signal.get("dca_step_pct", "0.015")))

        # Build DCA price levels
        amounts_pct = [Decimal("1") / Decimal(str(n_levels))] * n_levels
        prices = []
        for i in range(n_levels):
            prices.append(Decimal("-1") * step_pct * Decimal(str(i)))

        config = DCAExecutorConfig(
            trading_pair=self.config.trading_pair,
            connector_name=self.config.connector_name,
            side=side,
            amounts_quote=[total_amount * pct for pct in amounts_pct],
            prices=prices,
            leverage=min(signal.get("leverage", 2), self.config.max_leverage),
            stop_loss=Decimal(str(signal.get("stop_loss_pct", "0.04"))),
            take_profit=Decimal(str(signal.get("take_profit_pct", "0.03"))),
            time_limit=self.config.time_limit_seconds,
        )

        return CreateExecutorAction(
            controller_id=self.config.id,
            executor_config=config,
        )

    def _calculate_position_size(self, signal: Dict) -> Decimal:
        """Calculate position size based on signal and risk limits."""
        position_size_pct = Decimal(str(signal.get("position_size_pct", "0.5")))
        max_size = self.config.max_position_size_quote
        return max_size * position_size_pct

    def _check_drawdown(self) -> bool:
        """Check if drawdown exceeds the kill switch threshold."""
        if self._peak_balance <= 0:
            return True  # No data yet

        drawdown = (self._peak_balance - self._total_realized_pnl) / self._peak_balance
        return drawdown < self.config.max_drawdown_pct

# CoinMax V4 系统链路文档

## 一、总览

```
用户 USDT (BSC)
  → thirdweb Pay swap → USDC → Receiver Server 钱包
  → 前端回调成功 → 数据库记录
  → Engine 读取 DB → 铸造 cUSD → 存入 ERC4626 Vault
  → ERC4626 根据份额和 cUSD 质押 + Oracle 价格 → 铸造 MA 锁仓
  → 每日: cUSD 产出利息 → 铸造 MA → 待释放余额
  → 用户提现: 铸造 MA → 销毁比例 → 线性释放
  → 用户闪兑: MA burn → Receiver Server 通过 PancakeSwap 给用户 USDT
  → Receiver USDC → 跨链 ARB → 60/20/12/8% 分配
```

---

## 二、入金链路

### 2.1 用户存入金库

```
用户钱包 (BSC) 持有 USDT
  │
  ▼ [前端] thirdweb Pay / PancakeSwap V3
  │   USDT → Pool(0x92b7) → USDC
  │   USDC 直接转到 Receiver Server(0xe193)
  │   用户获得交易凭证 (TX Hash)
  │
  ▼ [前端回调] TX 成功
  │   POST /vault-record → 数据库记录:
  │   用户钱包地址, 金额, 计划类型, TX Hash, 时间
  │
  ▼ [Engine 后端] 读取 DB 新入金记录
  │   调用 VaultV4.mintDeposit(user, amount, planType)
  │     → 铸造 cUSD (1:1) → Vault 合约持有
  │     → 铸造 vault shares (cmVAULT) → 用户持有
  │     → 记录 StakePosition
  │
  ▼ [Engine 可选] 也可以不经过用户支付直接铸造
  │   管理员入金 / 测试 / 重复进单
  │   同样调 mintDeposit() 或 mintBonusDeposit()
  ▼
```

### 2.2 为什么经过 Engine

```
所有铸造操作由 Engine 控制:
  ✅ 真实入金 → Engine 铸造 cUSD + shares
  ✅ 管理员入金 → Engine 直接铸造 (无需 USDC)
  ✅ 体验金 → Engine 调 mintBonusDeposit (yieldLocked=true)
  ✅ 批量操作 → Engine 调 batchMintDeposit
  ✅ 重复进单 → Engine 随时可以再次铸造

用户不直接调合约 → 更安全, 更灵活
```

### 2.3 链上可见交易 (BSCScan)

```
TX1 (用户支付 — 前端发起):
  USDT Transfer: 用户 → PancakeSwap Pool(0x92b7)
  USDC Transfer: Pool(0x92b7) → Receiver(0xe193)

TX2 (Engine 铸造 — 后端发起):
  cUSD Mint: 0x0 → VaultV4(0x08a2)
  cmVAULT Mint: 0x0 → 用户 (vault shares)
```

### 2.4 存入计划

| 计划 | 周期 | 日利率 | 最低金额 |
|------|------|--------|---------|
| 5_DAYS | 5天 | 0.50% | $100 |
| 45_DAYS | 45天 | 0.70% | $100 |
| 90_DAYS | 90天 | 0.90% | $100 |
| 180_DAYS | 180天 | 1.00% | $300 |

---

## 三、每日收益结算 (Cron 12:00 SGT)

### 3.1 结算流程

```
pg_cron 触发 (04:00 UTC = 12:00 SGT)
  │
  ▼ [数据库] run_daily_settlement()
  │   1. settle_vault_daily() → 每个持仓日利息
  │   2. settle_node_fixed_yield() → 节点日收益
  │   3. settle_team_commission() → 直推+级差+同级+越级
  │
  ▼ [Edge Function: settle-v4]
  │   读取 DB 今日收益
  │   调用 VaultV4.settleYield(users[], cusdYields[], maAmounts[])
  │     → 铸造 cUSD 利息 (链上对账, 增加 ERC4626 totalAssets)
  │     → 铸造 MA → Release 合约
  │
  ▼ [数据库] 记录待释放余额
    ├─ 金库收益
    ├─ 经纪人奖励 (直推+级差+同级+越级)
    └─ 节点收益 (已解锁部分)
```

### 3.2 金库收益

```
每个 ACTIVE 持仓:
  日收益(USDT) = 本金 × 日利率
  日收益(MA) = 日收益(USDT) / Oracle MA价格

  cUSD 利息只作为链上对账记录
  数据库记录: 待释放余额 → 增加金库收益(MA)/日
  同时触发: 直推奖励 + 团队奖励
```

### 3.3 直推奖励 (10%)

```
用户A 产生金库日收益 = X MA
  │
  ▼ 查找 A 的直接推荐人 B
  │
  ├─ B 已存入 ≥ $100 金库？
  │   ├─ 否 → 跳过
  │   └─ 是 → B 获得: X × 10%
  │            记录: 待释放余额 → 经纪人奖励 → 直推收益
  ▼
```

### 3.4 团队奖励 (级差 + 同级 + 越级)

```
用户A 产生金库日收益 = X MA
  ▼ 沿安置推荐树向上遍历 (每个上线需已存 ≥$100 金库)
```

**等级与级差比例:**

| 等级 | 级差比例 | 说明 |
|------|---------|------|
| V1 | 5% | |
| V2 | 10% | |
| V3 | 15% | |
| V4 | 20% | |
| V5 | 25% | |
| V6 | 30% | |
| V6.5 | 40% | 隐藏等级 (superadmin设置) |
| V7 | 50% | |

**级差奖励 (无限代):** 当前上线级差比例 - 已分配最高比例 = 差额 → 获得 X × 差额

**同级奖励 (最多2代):** 当前上线等级 = 前一个已分配上线等级 → 获得 X × 该级别级差比例 × 10%

**越级奖励 (最多2代):** 当前上线级差比例 < 已分配最高比例 → 获得 X × 该上线级差比例 × 5%

直推奖励和团队奖励(级差+同级+越级)统一称为 **经纪人奖励**，记录在待释放余额 → 经纪人奖励 → 再分明细。

### 3.5 收益分类

```
待释放余额
  ├─ 金库收益          ← 每日利息产出 MA
  ├─ 经纪人奖励
  │   ├─ 直推收益      ← 直推下线日收益 × 10%
  │   ├─ 级差奖励      ← 安置树级差 (无限代)
  │   ├─ 同级奖励      ← 同等级级差 × 10% (最多2代)
  │   └─ 越级奖励      ← 被超越级差 × 5% (最多2代)
  └─ 节点收益          ← 符合标准激活后, 只计算解锁部分
```

---

## 四、节点系统

### 4.1 节点购买

```
用户 USDT → thirdweb Pay swap → USDC → Receiver Server(0xe193)
  → 前端回调 → DB 记录
  → Engine 调用 VaultV4.mintNode(user, nodeType, contributionUSDC)
    → 铸造 cUSD 配资 (10倍杠杆)
    → 记录 NodePosition

MAX 节点: $600 USDC → 铸造 $6,000 cUSD | 120天 | 0.9%/日
MINI 节点: $100 USDC → 铸造 $1,000 cUSD | 90天 | 0.9%/日
```

### 4.2 节点收益

```
节点每日产生 cUSD 利息 (链上对账记录)
数据库根据产出利息记录:
  MAX 节点: 即时解锁 → 待释放余额 → 节点收益
  MINI 节点: 锁仓 → 达标解锁/未达标销毁
```

### 4.3 节点激活等级

| 等级 | 金库存款 | MINI推荐 | 适用 |
|------|---------|---------|------|
| V1 | $100 | 3个MINI | MAX |
| V2 | $300 | 0 | MAX/MINI |
| V3 | $500 | 0 | MAX/MINI |
| V4 | $600 | 0 | MAX/MINI |
| V5 | $800 | 0 | MAX |
| V6 | $1,000 | 0 | MAX |

---

## 五、用户提现 (待释放余额 → MA → 线性释放)

### 5.1 提现流程

```
用户触发待释放余额提现
  │
  ▼ 数据库计算可提现 MA 总额
  │ = 金库收益 + 经纪人奖励 + 节点收益(已解锁)
  │
  ▼ 用户选择收益分成比例
  │
  ▼ [Edge Function: claim-v4]
  │   提现合约以数据库数据为标准
  │   1. Engine 铸造 MA → Release 合约
  │   2. 启动提现后先销毁 0%-20% MA (根据用户选择)
  │   3. 剩余 MA → 线性释放计划 → 平均释放到用户钱包
  ▼
```

### 5.2 收益分成比例

| 档位 | 销毁比例 | 释放周期 | 实际获得 |
|------|---------|---------|---------|
| A | 0% | 60天 | 100% MA (最慢) |
| B | 5% | 45天 | 95% MA |
| C | 10% | 30天 | 90% MA |
| D | 20% | 14天 | 80% MA (最快) |

---

## 六、资金跨链分配

### 6.1 USDC 跨链 (每笔入金即时)

```
用户支付成功 → USDC 到 Receiver Server(0xe193)
  │
  ▼ [Edge Function: vault-bridge-v4] 即时触发
  │   Receiver(0xe193) USDC → thirdweb Bridge → ARB
  │
  ▼ ARB 分配:
    ├─ 60% → 0x3869 (Trading + 闪兑储备)
    │         ├─ admin 存入 HL Vault(0xdfc2) AI交易
    │         └─ 部分留存做闪兑回流
    ├─ 20% → 0x85c3 (Investor)
    ├─ 12% → 0x1C4D (Marketing)
    └─  8% → 0xDf90 (Operations)
```

### 6.2 HyperLiquid 交易

```
0x3869 (ARB, HL 主钱包)
  ├─ admin 调用: 存入 HL Vault(0xdfc2) AI 策略交易
  │   通过 HL API 钱包(0xac5F) 执行自动化交易
  └─ 利润留在 0x3869，作为闪兑回流资金源
```

---

## 七、闪兑 (MA → USDT)

### 7.1 闪兑流程

```
用户持有 MA 代币 (BSC)
  │
  ▼ [前端] Approve MA → FlashSwap 合约
  ▼ [前端] FlashSwapV4.requestSwap(maAmount)
  │   ├─ 读取 Oracle 价格
  │   ├─ 计算 USDT 金额 = MA数量 × Oracle价格
  │   ├─ burn MA → 供应减少 → Oracle 价格调整
  │   └─ emit SwapRequested 事件
  │
  ▼ [Receiver Server 处理]
  │   资金来源: 0x3869(ARB) USDC → 跨链回 BSC → Receiver(0xe193)
  │   Receiver(0xe193) USDC
  │     → PancakeSwap V3 Pool(0x92b7)
  │     → Swap USDC → USDT
  │     → USDT 转给用户
  │
  ▼ FlashSwapV4.fulfillSwap() → 标记完成
```

### 7.2 链上可见交易

```
TX1 (用户发起):
  MA Transfer: 用户 → 0x000...000 (销毁)

TX2 (Receiver Server 执行):
  USDC Transfer: Receiver(0xe193) → PancakeSwap Pool(0x92b7)
  USDT Transfer: Pool(0x92b7) → Receiver(0xe193)
  USDT Transfer: Receiver(0xe193) → 用户
```

### 7.3 闪兑闭环

```
入金:
  用户 USDT → swap USDC → Receiver(0xe193) → 跨链 ARB
  → 60% → 0x3869 → 部分存入 HL Vault 交易

闪兑回流:
  0x3869(ARB) USDC → 跨链 BSC → Receiver(0xe193)
  → PancakeSwap USDC→USDT → 用户

MA 闪兑影响:
  burn MA → 流通量减少 → Oracle 背书价上升 → 价格支撑

资金循环:
  入金 USDC → HL 交易赚利润 → 利润+本金 → 回流 BSC → 闪兑给用户
```

### 7.4 Oracle 价格机制

```
价格 = max(地板价, max(背书价, 增值价))

背书价 = 全部 cUSD 总量 / MA 流通量
增值价 = 基础价 × (1 + 0.1%)^天数
地板价 = $0.90 (绝对最低)

MA 铸造 → 流通量增加 → 背书价微降 (但 cUSD 同步增加)
MA 销毁 → 流通量减少 → 背书价上升 → 价格支撑
```

---

## 八、合约地址 (BSC 主网)

| 合约 | 地址 | 类型 |
|------|------|------|
| CUSD | `0x512d6d3C33D4a018e35a7d4c89754e0e3E72fD4B` | ERC20 |
| MAToken | `0xc6d2dbC85DC3091C41692822A128c19F9eAc7988` | ERC20 |
| Oracle | `0xB73A4Ac36a36C92C8d6F6828ea431Ca30f1943a2` | 普通 |
| VaultV4 | `0x08a24206b7AcAA7cf68E8a5bE16fE6cE7a4D1744` | UUPS Proxy |
| FlashSwapV4 | `0x0CfDAE2C6521803Da077099dd9F44136D3e7Fb8C` | UUPS Proxy |
| ReleaseV4 | `0x1de32fF0aa9884536C8ba7Aa7fD1f6Ea6cf523Bc` | UUPS Proxy |

---

## 九、钱包

### BSC

| 角色 | 地址 | 用途 |
|------|------|------|
| Deployer | `0x1B6B492d8fbB8ded7dC6E1D48564695cE5BCB9b1` | 合约管理, DEFAULT_ADMIN |
| Engine V2 | `0xDd6660E403d0242c1BeE52a4de50484AAF004446` | 铸造 cUSD/MA, 结算, Oracle |
| Receiver Server | `0xe193ACcf11aBf508e8c7D0CeE03ea4E6f75B09ff` | 接收 USDC, 跨链, 闪兑出金 |

### ARB

| 角色 | 比例 | 地址 |
|------|------|------|
| Trading + 闪兑 | 60% | `0x3869100A4F165aE9C85024A32D90C5D7412D6b9c` |
| Investor | 20% | `0x85c3d07Ee3be12d6502353b4cA52B30cD85Ac5ff` |
| Marketing | 12% | `0x1C4D983620B3c8c2f7607c0943f2A5989e655599` |
| Operations | 8% | `0xDf90770C89732a7eba5B727fCd6a12f827102EE6` |

### HyperLiquid

| 角色 | 地址 |
|------|------|
| HL 主钱包 | `0x3869100A4F165aE9C85024A32D90C5D7412D6b9c` |
| HL API 钱包 | `0xac5FC34064147eC19B49b56E0a35594a0115B0b0` |
| HL Vault 金库 | `0xdfc24b077bc1425ad1dea75bcb6f8158e10df303` |

---

## 十、权限矩阵

| 合约 | 角色 | 持有者 |
|------|------|--------|
| CUSD | MINTER_ROLE | VaultV4 |
| MAToken | MINTER_ROLE | VaultV4, FlashSwapV4, ReleaseV4 |
| VaultV4 | ENGINE_ROLE | Engine (0xDd66) |
| VaultV4 | DEFAULT_ADMIN | Deployer |
| FlashSwapV4 | ENGINE_ROLE | Engine (0xDd66) |
| ReleaseV4 | ENGINE_ROLE | Engine (0xDd66), VaultV4 |
| Oracle | FEEDER_ROLE | Engine (0xDd66), Deployer |

**用户不直接调任何合约。所有铸造/结算操作通过 Engine。**

---

## 十一、PancakeSwap 配置

| 项目 | 地址/值 |
|------|---------|
| V3 SmartRouter | `0x13f4EA83D0bd40E75C8222255bc855a974568Dd4` |
| USDT/USDC Pool | `0x92b7807bF19b7DDdf89b706143896d05228f3121` |
| Fee Tier | 100 (0.01%) |
| Pool 流动性 | ~$34M USDT + ~$11M USDC |

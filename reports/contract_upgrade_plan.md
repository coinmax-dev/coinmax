# CoinMax 合约升级计划

> 生成时间: 2026-03-30
> 最后更新: 2026-03-30 (v2 — 反映已完成部署)
> 目标: 统一使用 thirdweb 基础设施 + 模块化升级

---

## 一、当前状态（已部署）

### BSC 在用合约

| 合约 | 地址 | 部署方式 | 可升级 | 状态 |
|------|------|---------|--------|------|
| **Vault** | `0xE0A80b82F42d009cdE772d5c34b1682C2D79e821` | Hardhat → UUPS Proxy | ✅ UUPS | ✅ depositPublic + purchaseNodePublic |
| **BatchBridgeV2** | `0x5BDc4220Ea06CfaD6B42fD1c69ce4D2BAA46C0Db` | Hardhat | ❌ 固定 | ✅ 新部署，USDT→swap→USDC→Stargate |
| **MA Token** | `0xdFaC84b2f9cfD02b3f44760E0Ff88b4EeC0e1593` | Hardhat | ❌ 固定 | 在用 |
| **Oracle** | `0xff5Ab71939Fa021A7BCa38Db8b3c1672D1B819dD` | Hardhat → UUPS Proxy | ✅ UUPS | 在用，$0.53 |
| **Engine** | `0x0990013669d28eC6401f46a78b612cdaBE88b789` | Hardhat → UUPS Proxy | ✅ UUPS | 在用 |
| **Release** | `0x842b48a616fA107bcd18e3656edCe658D4279f92` | Hardhat → UUPS Proxy | ✅ UUPS | 在用 |
| **FlashSwap BSC** | `0x95dfb27Fbd92A5C71C4028a4612e9Cbefdb8EE10` | Hardhat → UUPS Proxy | ✅ UUPS | 在用，需流动性 |
| **NodesV2** | `0x17DDad4C9c2fD61859D37dD40300c419cBdd4cE2` | Hardhat | ❌ 固定 | MINI=$100/MAX=$600 |
| **NodePool** | `0x7dE393D02C153cF943E0cf30C7B2B7A073E5e75a` | Hardhat | ❌ 固定 | →0xeb8A |
| **cUSD** | `0x90B99a1495E5DBf8bF44c3623657020BB1BDa3C6` | Hardhat | ❌ 固定 | Vault记账用 |
| **Forwarder** | `0x6EF9AD688dFD9B545158b05FC51ab38B9D5a8556` | Hardhat | ❌ 固定 | EIP-2771 |
| **Timelock** | `0x857c472F8587B2D3E7F90B10b99458104CcaCdfC` | Hardhat | ❌ 固定 | 24h延迟 |
| **PancakeSwap Pool** | `0x92b7807bF19b7DDdf89b706143896d05228f3121` | - | - | 0.01% USDT/USDC |

### ARB 在用合约

| 合约 | 地址 | 状态 |
|------|------|------|
| **FundRouter** | `0x71237E535d5E00CDf18A609eA003525baEae3489` | UUPS，30/8/12/20/30 分配 |
| **FlashSwap ARB** | `0x681a734AbE80D9f52236d70d29cA5504207b6d7C` | UUPS，placeholder config |

### 已废弃合约（不再使用）

| 合约 | 地址 | 废弃原因 |
|------|------|---------|
| SwapRouter | `0x5650383D9f8d8f80fc972b8F49A3cc31d3A7F7E3` | ✅ 被 Vault.depositPublic 替代 |
| BatchBridge V1 | `0x670dbfAA27C9a32023484B4BF7688171E70962f6` | ✅ 被 BatchBridgeV2 替代 |
| Gateway ×3 | `0xaC12...`, `0x38a6...`, `0x2F6E...` | PancakeSwap STF 错误 |
| Splitter | `0xcfF14557337368E4A9E09586B0833C5Bbf323845` | 被 BatchBridge 跨链替代 |
| InterestEngine | - | 利息走 DB 结算 |
| Factory | - | 部署完未再用 |

### 钱包

| 钱包 | 地址 | 用途 |
|------|------|------|
| deployer (全部admin) | `0x1B6B492d8fbB8ded7dC6E1D48564695cE5BCB9b1` | 所有合约 admin |
| 节点钱包 | `0xeb8AbD9b47F9Ca0d20e22636B2004B75E84BdcD9` | 节点资金接收 |
| VIP接收 | `0x927eDe64b4B8a7C08Cf4225924Fa9c6759943E0A` | VIP付款 |
| Server Wallet (4337) | `0x85e44A8Be3B0b08e437B16759357300A4Cd1d95b` | mint/role (非payable) |

---

## 二、当前资金链路（已实现）

### 金库入金
```
用户 USDT → approve Vault → Vault.depositPublic(amount, planIndex)
  → 拉取 USDT → 送 BatchBridgeV2 (累积)
  → mint cUSD 1:1 记账 → Oracle定价 → mint MA → 锁仓

BatchBridgeV2 (4h cron):
  → PancakeSwap V3 批量 swap USDT→USDC (0.01%)
  → Stargate 桥 USDC → ARB FundRouter
  → 5钱包 (30/8/12/20/30)
```

### 节点购买
```
用户 USDT → approve Vault → Vault.purchaseNodePublic(type, amount)
  → 拉取 USDT → 送 BatchBridgeV2
  → 同上跨链路径 → ARB → API分发 → 节点钱包
```

### MA 闪兑
```
卖: MA → FlashSwap → Oracle定价 → USDT (50%持仓规则, 0.3%手续费)
买: USDT → FlashSwap → Oracle定价 → MA
```

### 每日利息
```
Engine (cron) → 读 Vault 仓位 × dailyRate × Oracle价格
  → mint MA → Release 合约 → 线性释放
```

### 赎回
```
到期: claimPrincipal → 100% MA → 用户钱包
提前: earlyClaimPrincipal → 80% MA + 20% burn
  → 触发 recheck_ranks_on_vault_change (无限层上线降级检查)
```

---

## 三、升级计划（待执行）

### Phase 1: thirdweb 部署迁移 🔄 待执行

**目标**: 所有合约通过 thirdweb 部署，Dashboard 可视化管理

**为什么用 thirdweb 部署？**
- Dashboard 直接管理合约（读/写/升级）
- 内置 Explorer 查看合约状态
- 一键 publish + 多链部署
- Paymaster 集成（用户 0 gas）

**1.1 需要重新部署的合约（thirdweb CLI）**

| 合约 | 当前 | thirdweb 方案 | 优先级 |
|------|------|-------------|--------|
| MA Token | Hardhat 固定 | `npx thirdweb deploy` ERC20 Core + MintableERC20 模块 | P0 |
| Oracle | Hardhat UUPS | `npx thirdweb publish` → Dashboard 部署 UUPS proxy | P1 |
| Vault | Hardhat UUPS | `npx thirdweb publish` → Dashboard 升级 impl | P1 |
| Engine | Hardhat UUPS | `npx thirdweb publish` → Dashboard 升级 impl | P2 |
| Release | Hardhat UUPS | `npx thirdweb publish` → Dashboard 升级 impl | P2 |
| FlashSwap | Hardhat UUPS | `npx thirdweb publish` → Dashboard 升级 impl | P2 |
| BatchBridgeV2 | Hardhat 固定 | 保持，非核心 | P3 |

**1.2 MA Token 迁移（P0）**
- [ ] thirdweb Dashboard 部署 ERC20 Core (BSC)
- [ ] 安装 MintableERC20 模块
- [ ] grantRoles: Vault + Engine → minter
- [ ] 前端 + edge functions 切换地址
- [ ] 旧 MA Token pause

**1.3 publish 合约到 thirdweb**
- [ ] `npx thirdweb publish` — CoinMaxVault
- [ ] `npx thirdweb publish` — MAPriceOracle
- [ ] `npx thirdweb publish` — CoinMaxFlashSwap
- [ ] `npx thirdweb publish` — CoinMaxInterestEngine
- [ ] `npx thirdweb publish` — CoinMaxRelease
- [ ] Dashboard 可视化管理所有合约

### Phase 2: Paymaster + 0 Gas 体验

**目标**: 用户不需要 BNB，所有操作 0 gas

- [ ] thirdweb Dashboard 开启 BSC Paymaster
- [ ] 设置赞助规则：仅 Vault/FlashSwap 合约交互
- [ ] 每用户每日 gas 赞助上限
- [ ] 前端所有合约调用走 paymaster
- [ ] 测试：0 BNB 钱包完成存入/闪兑

### Phase 3: 功能验证

**3.1 入金流程**
- [x] Vault.depositPublic 接受 USDT ✅
- [x] Vault.purchaseNodePublic 接受 USDT ✅
- [x] BatchBridgeV2 USDT→swap→USDC→Stargate ✅ 已部署
- [ ] 真实用户存入测试
- [ ] BatchBridgeV2 跨链测试（需 BNB gas fee）
- [ ] ARB FundRouter 接收验证

**3.2 收益流程**
- [ ] 日利息结算: settle_vault_daily() → MA mint
- [ ] 收益提取: claim-yield → MA mintTo
- [ ] 释放: Release.createRelease() → 线性领取
- [ ] 闪兑: FlashSwap (需存入 USDT+MA 流动性)

**3.3 等级系统**
- [x] 升级: check_rank_promotion() 双向（升+降）✅
- [x] 降级: recheck_ranks_on_vault_change() 无限层 ✅
- [x] 每日批量: batch_check_rank_promotions() 含降级 ✅
- [x] 排除 BONUS 仓位 ✅
- [ ] 等级降级实际触发验证

**3.4 跨链**
- [x] BatchBridgeV2 部署 ✅
- [x] Vault.fundDistributor → BatchBridgeV2 ✅
- [ ] BatchBridgeV2 充值 BNB (Stargate gas)
- [ ] 首次 swapAndBridge() 执行验证
- [ ] ARB FundRouter flushAll() 验证
- [ ] 节点资金 ARB → API → 节点钱包

### Phase 4: 隐私增强

```
链上公开（投资者可验证）:
  ├── Vault: totalAssets() — 总存入
  ├── MA Token: totalSupply() — MA总量
  └── BatchBridgeV2: totalBridged/totalSwapped — 跨链统计

链下隐私（DB）:
  ├── 个人仓位/收益/推荐关系/等级
  └── 4h批量跨链混合多笔存入

增强:
  ├── 随机延迟 (3-5h)
  ├── 最小/最大批量金额
  └── 多路径跨链轮换
```

---

## 四、已完成清单

| 日期 | 完成项 |
|------|--------|
| 2026-03-30 | Vault 升级: depositPublic(USDT) + purchaseNodePublic(USDT) |
| 2026-03-30 | Vault 升级: 1:1 shares fix (首次存入 bug) |
| 2026-03-30 | Vault 最低存入 50 USDT |
| 2026-03-30 | BatchBridgeV2 部署: USDT→PancakeSwap→USDC→Stargate |
| 2026-03-30 | Vault.fundDistributor → BatchBridgeV2 |
| 2026-03-30 | SwapRouter 废弃（前端不再调用）|
| 2026-03-30 | 等级降级逻辑 + 无限层上线检查 |
| 2026-03-30 | Admin 合约页面: 3 tab (链路/配置/跨链) + 链路图 |
| 2026-03-30 | Admin 资金页面: 5 tab (余额/流转/跨链/闪兑/流水) |
| 2026-03-30 | Admin Cron 面板: 可编辑调度 + 手动触发 |
| 2026-03-30 | cUSD 地址修正为链上实际 (0x90B99a) |
| 2026-03-30 | 前端删除 EARLY_BIRD_DEPOSIT_RATE |

---

## 五、下一步优先级

| 优先级 | 任务 | 依赖 |
|--------|------|------|
| **P0** | 真实用户金库存入测试 | 无 |
| **P0** | BatchBridgeV2 充值 BNB + 首次跨链测试 | 无 |
| **P0** | FlashSwap 存入 USDT+MA 流动性 | 无 |
| **P1** | MA Token 迁移到 thirdweb 模块化 | 需停服 |
| **P1** | `npx thirdweb publish` 所有合约 | 无 |
| **P1** | Paymaster 0 gas 配置 | thirdweb Dashboard |
| **P2** | ARB 跨链端到端验证 | BatchBridgeV2 |
| **P2** | 节点考核 V6/V4 达标验证 | 等级系统 |
| **P3** | 隐私增强（随机延迟等）| Phase 3 完成 |

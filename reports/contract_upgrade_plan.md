# CoinMax 合约升级计划

> 生成时间: 2026-03-30
> 目标: 统一使用 thirdweb 基础设施 + Factory 部署 + 模块化升级

---

## 一、当前状态审计

### 在用合约清单

| 合约 | 地址 | 部署方式 | 可升级 | 问题 |
|------|------|---------|--------|------|
| Vault | `0xE0A80b82F42d009cdE772d5c34b1682C2D79e821` | Factory → ERC1967Proxy | ✅ UUPS | asset=cUSD 而非 USDC |
| MA Token | `0xE3d19D3299B0C2D6c5FDB74dBb79b102449Edc36` | 直接部署 | ❌ 固定 | 无 permit, 无模块化 |
| Oracle | `0x3EC635802091b9F95b2891f3fd2504499f710145` | 直接部署 | ⚠️ Initializable 但无 UUPS | 不可升级 |
| Release | `0xC80724a4133c90824A64914323fE856019D52B67` | Factory → ERC1967Proxy | ✅ UUPS | 正常 |
| FlashSwap | `0xabF960833168c3D69284De219F8Da0D8054d96e4` | 直接部署 | ✅ UUPS | 正常 |
| Splitter | `0xcfF14557337368E4A9E09586B0833C5Bbf323845` | 直接部署 | ❌ 固定 | 钱包列表私有=OK |
| BatchBridge | `0x670dbfAA27C9a32023484B4BF7688171E70962f6` | 直接部署 | ❌ 固定 | Owner=中继器(EIP7702不work) |
| NodePool | `0x7dE393D02C153cF943E0cf30C7B2B7A073E5e75a` | 直接部署 | ❌ 固定 | Owner=中继器 |

### 未使用合约

| 合约 | 说明 |
|------|------|
| Gateway | 写了没接入前端 |
| InterestEngine | 利息走 DB 结算 |
| cUSD | Vault 直接收 USDT |
| Factory | 部署完就没再用 |
| SwapRouter | 在用但可被 thirdweb Pay 替代 |

### 未使用/异常合约处置方案

| 合约 | 问题 | 处置方案 | 阶段 |
|------|------|---------|------|
| **BatchBridge** | 配好了但跨链失败 (Stargate quoteSend revert) | Phase 3: 修复 Stargate V2 参数 + Owner 转回 deployer; 或改用 thirdweb Bridge SDK | P2 |
| **Gateway** | 写了没接入前端 | Phase 3: 评估是否用 thirdweb Pay 替代; 若不用则标记 deprecated 并 pause | P2 |
| **InterestEngine** | 利息走 DB 结算不走链上 | Phase 3: 评估链上利息的必要性; 若保持 DB 则标记 deprecated; 若需链上验证则接入 | P3 |
| **cUSD** | Vault 直接收 USDT 不用 cUSD 记账 | Phase 3: Vault 重构时决定是否恢复 cUSD 记账; 当前标记 deprecated | P3 |
| **Factory** | 部署完未再使用 | Phase 3: 升级为 Factory V2, 统一管理所有合约部署/升级/角色 | P2 |
| **SwapRouter** | 可被 thirdweb Pay 替代 | Phase 1: thirdweb Pay 上线后 deprecated, 保留合约不删除 | P0 |

### 钱包状态

| 钱包 | 类型 | BSC 可用 | 说明 |
|------|------|---------|------|
| Server Wallet `0x85e44A` | ERC-4337 | ✅ 非payable | mint/grantRole OK |
| 中继器 `0xcb41` | EIP-7702 | ❌ 全部失败 | BSC 不支持 EIP-7702 |
| Deployer `0x1B6B` | EOA | ✅ 全部OK | 但私钥暴露风险 |

---

## 二、升级计划（5 个阶段）

### Phase 1: 支付优化 — thirdweb Pay + Paymaster

**目标**: 用户 0 gas、任意代币/法币完成所有购买

#### 1.1 当前三种购买链路审计

```
┌─────────────────────────────────────────────────────────────────────┐
│ 金库入金 (vault-deposit-dialog.tsx)                                  │
│ 用户 USDT → approve SwapRouter → swapAndDepositVault()              │
│          → PancakeSwap USDT→USDC → Vault.depositFrom()             │
│ 合约: SwapRouter + PancakeSwap + Vault                              │
│ 问题: 需要 BNB + 2笔签名 (approve + swap+deposit)                    │
├─────────────────────────────────────────────────────────────────────┤
│ 节点购买 (node-purchase-section.tsx)                                 │
│ V1: USDT → approve Node合约 → Node.purchase(type, USDT)             │
│ V2: USDT → approve SwapRouter → swapAndPurchaseNode()               │
│          → PancakeSwap USDT→USDC → NodesV2.purchase()              │
│ 合约: SwapRouter + PancakeSwap + NodesV2                            │
│ 问题: 需要 BNB + 2笔签名                                            │
├─────────────────────────────────────────────────────────────────────┤
│ VIP购买 (use-payment.ts → payVIPSubscribe)                          │
│ 用户 USDT → 直接 transfer → Server钱包(0x927e)                      │
│          → edge function vip-subscribe → DB激活                     │
│ 合约: 无 (纯 ERC20 transfer)                                        │
│ 问题: 需要 BNB + 1笔签名, 无合约验证                                  │
└─────────────────────────────────────────────────────────────────────┘
```

#### 1.2 优化方案: thirdweb Pay 统一入口

```
优化后（三种购买统一）:

  用户 任意代币/法币/信用卡
    ↓ thirdweb Pay (前端 SDK 自动 swap)
    ↓
  ┌─ 金库入金 → USDC 直接 → Vault.depositFrom() (无需 SwapRouter)
  ├─ 节点购买 → USDC 直接 → NodesV2.purchase() (无需 SwapRouter)
  └─ VIP购买  → USDT 直接 → Server钱包 (保持现有)

  = 用户 0 gas, 1次确认, 任意代币
```

**金库入金改动:**
- [ ] 前端: `vault-deposit-dialog.tsx` 改用 thirdweb Pay
- [ ] Vault 合约: 确认 `depositFrom()` 可被 Server Wallet 调用
- [ ] 废弃: SwapRouter 的 `swapAndDepositVault()` 不再需要
- [ ] 测试: USDT/USDC/BNB/信用卡 入金

**节点购买改动:**
- [ ] 前端: `node-purchase-section.tsx` 改用 thirdweb Pay
- [ ] NodesV2 合约: 确认可直接收 USDC (不经过 SwapRouter)
- [ ] 废弃: SwapRouter 的 `swapAndPurchaseNode()` 不再需要
- [ ] 测试: 各代币购买 MINI/MAX 节点

**VIP购买改动 (两种方案可选):**

方案A: thirdweb Pay (与金库/节点统一)
- [ ] 前端: `payVIPSubscribe` 改用 thirdweb Pay
- [ ] 支持任意代币/法币/信用卡
- [ ] 资金 → Server钱包 → edge function 激活

方案B: x402 协议 (更优雅)
- [ ] edge function 返回 HTTP 402 + 支付要求
- [ ] 前端 `fetchWithPayment` 自动处理支付流程
- [ ] 支付完成后自动激活 VIP
- [ ] 优势: 标准协议, 支持 ARB USDC, 链上验证
- [ ] `vip-subscribe` edge function 已有 x402 框架代码

推荐: **x402 (方案B)** — VIP 是订阅性质,适合 402 支付协议
- [ ] 测试: x402 支付流 + 自动激活

**SwapRouter 废弃评估:**
- [ ] 确认金库入金不再需要 SwapRouter
- [ ] 确认节点购买不再需要 SwapRouter
- [ ] SwapRouter 合约标记为 deprecated, 不删除
- [ ] admin-contracts 页面移除 SwapRouter

#### 1.3 Paymaster 代付 gas
- [ ] 在 thirdweb Dashboard 开启 BSC Paymaster
- [ ] 设置 gas 赞助规则（仅限 Vault/NodesV2/MA 合约交互）
- [ ] 前端: 所有合约调用自动走 paymaster
- [ ] 限额: 每用户每日 gas 赞助上限

#### 1.4 Session Key（可选）
- [ ] 用户首次 approve 后设置 session key
- [ ] 后续存入/购买无需重复 approve

#### 1.5 节点系统重构

> 节点购买后不产生团队奖励。必须存入金库激活节点后才开启收益。

**核心规则：购买节点 ≠ 激活。激活 = 金库存入达标。**

##### 大节点 (MAX) — 价格 600U, 冻结 6000U

**激活条件：**

| 激活等级 | 金库存入要求 | 额外条件 |
|---------|-----------|---------|
| V1 | ≥100U | 推荐 3 个小节点 |
| V2 | ≥300U | 无 |
| V3 | ≥500U | 无 |
| V4 | ≥600U | 无 |
| V5 | ≥800U | 无 |
| V6 | ≥1000U | 无 |

**收益规则：**
- 激活后**第二天**开始产生收益
- 每日收益 = 6000U × 0.9% = **54U 铸造 MA**
- 未激活 = 不启动收益

**达标考核时间线：**

```
Day 1-15:  激活后每日 54U → MA
           ├── 已激活: ✅ 正常领取
           └── 未激活: ❌ 无收益

Day 15:    考核 V1
           ├── V1 达标: Day 16-30 继续领取 54U/天
           └── V1 不达标: Day 16-30 收益暂停

Day 30:    考核 V2
           ├── V2 达标: Day 31-60 继续领取 54U/天
           └── V2 不达标: Day 31-60 收益暂停, 等级降为实际等级

Day 60:    考核 V4
           ├── V4 达标: Day 61-120 继续领取 54U/天
           └── V4 不达标: Day 61-120 收益暂停, 等级降为实际等级

Day 120:   考核 V6
           ├── V6 达标: 解锁 6000U 铸造 MA ✨
           └── V6 不达标: 不解锁, 等级降为实际等级
```

##### 小节点 (MINI) — 价格 100U, 冻结 1000U

**激活条件：**

| 激活等级 | 金库存入要求 |
|---------|-----------|
| V1 | ≥100U |
| V2 | ≥300U |
| V3 | ≥500U |
| V4 | ≥600U |

**收益规则：**
- 激活后**第二天**开始产生收益
- 每日收益 = 1000U × 0.9% = **9U 铸造 MA**
- 所有收益**锁仓**，达标后解锁

**达标考核时间线：**

```
Day 1-90:  激活后每日 9U → MA (锁仓)
           └── 每日铸造但锁仓，不可领取

Day 30:    考核 V2 (哪日达标次日解锁)
           ├── V2 达标: 解锁 Day 1-60 锁仓收益, 继续领取至 Day 90
           └── V2 不达标: 收益不可解锁, 等级降为实际等级

Day 90:    考核 V2
           ├── V2 达标: 解锁 Day 1-90 全部锁仓收益
           └── V2 不达标: 全部收益销毁 ☠️

Day 90:    同时考核 V4
           ├── V4 达标: 解锁 1000U 铸造 MA ✨
           └── V4 不达标: 不解锁
```

##### 节点改动清单

**DB 函数修改：**
- [ ] `check_node_activation()`: 更新激活条件表
  - MAX V1: 100U + 3 个 MINI 推荐
  - MAX V2-V6: 仅金库存入门槛
  - MINI V1-V4: 仅金库存入门槛
- [ ] `settle_node_fixed_yield()`:
  - 检查 `activated_rank IS NOT NULL` 才产生收益
  - MAX: 直接领取 54U/天
  - MINI: 锁仓 9U/天 (`locked_earnings`)
- [ ] `check_node_milestones()`:
  - MAX: Day 15(V1), 30(V2), 60(V4), 120(V6) 四个检查点
  - MINI: Day 30(V2解锁), 90(V2全解/V4解锁冻结) 三个检查点
  - 不达标: `earnings_paused = true`, `rank` 降为实际等级

**system_config 更新：**
- [ ] `MAX_ACTIVATION_TIERS`: 更新为 V1-V6 条件
- [ ] `MINI_ACTIVATION_TIERS`: 更新为 V1-V4 条件
- [ ] `MAX_MILESTONES`: Day 15/30/60/120 四个里程碑
- [ ] `MINI_MILESTONES`: Day 30/90 里程碑 + V4 解锁

**前端修改：**
- [ ] 节点详情页: 显示激活状态 + 考核时间线
- [ ] 收益页: MAX 显示可领取, MINI 显示锁仓中
- [ ] 里程碑进度条: 当前天数 / 下个考核点

**Edge function 修改：**
- [ ] `settle-node-interest`: 根据 MAX/MINI 分别处理
- [ ] `check-node-activation`: 金库存入达标时自动激活
- [ ] `check-node-qualification`: 达标考核 cron (每日检查)

**测试计划：**
- [ ] MAX 节点完整 120 天周期模拟
- [ ] MINI 节点完整 90 天周期模拟
- [ ] V2 不达标 → 收益暂停验证
- [ ] MINI Day 90 V2 不达标 → 收益销毁验证
- [ ] V6/V4 达标 → 冻结金额解锁验证
- [ ] 等级降级 → 实际等级验证

---

### Phase 2: MA Token 升级 — thirdweb 模块化

**目标**: MA Token 迁移到 thirdweb TokenERC20 + 自定义模块

**2.1 部署新 MA Token**
- [ ] 使用 thirdweb CLI 部署 TokenERC20 Core
- [ ] 安装 MintableERC20 模块（MINTER_ROLE 控制）
- [ ] 编写+安装自定义模块:
  ```solidity
  // CoinMaxMAExtension.sol (~80行)
  - blacklist mapping + transfer hook
  - supplyCap check on mint
  - mintLimit per-call check
  ```
- [ ] publish 到 thirdweb Dashboard

**2.2 迁移**
- [ ] 新合约部署到 BSC（CREATE2 确定性地址）
- [ ] 旧 MA Token 暂停 mint
- [ ] Vault/Release/FlashSwap 更新 MA Token 地址指向新合约
- [ ] 用户余额快照 → 新合约批量 airdrop
- [ ] 旧合约永久 pause

**2.3 获得的能力**
- ✅ ERC2612 permit() — 无 gas 授权
- ✅ Dashboard 直接管理 mint/burn/pause/blacklist
- ✅ 模块可装卸 — 后续加功能不需重部署
- ✅ CREATE2 — 可部署到 ARB 同地址

---

### Phase 3: 合约重构 — Factory + thirdweb 部署

**目标**: 所有合约统一通过 Factory 管理，thirdweb Dashboard 可视化

**3.1 CoinMaxFactory V2**

升级 Factory 合约，覆盖所有在用合约：

```solidity
contract CoinMaxFactoryV2 is Ownable {
    // 已有: Vault + Engine + Release (ERC1967Proxy)
    // 新增:
    address public oracleProxy;    // Oracle → UUPS 代理
    address public flashSwapProxy; // FlashSwap → 已经是 UUPS
    address public splitterClone;  // Splitter → Clone
    address public batchBridgeClone; // BatchBridge → Clone
    address public nodePoolClone;  // NodePool → Clone

    function deployOracle(...) external onlyOwner { ... }
    function deploySplitter(...) external onlyOwner { ... }
    function deployBatchBridge(...) external onlyOwner { ... }
    function deployNodePool(...) external onlyOwner { ... }

    // 统一 role 管理
    function grantRoleOn(address target, bytes32 role, address account) external onlyOwner { ... }
    function revokeRoleOn(address target, bytes32 role, address account) external onlyOwner { ... }

    // 统一升级
    function upgradeContract(address proxy, address newImpl) external onlyOwner { ... }
}
```

**3.2 重部署策略**

| 合约 | 当前 | 升级方案 | 需要迁移数据？ |
|------|------|---------|-------------|
| Oracle | 直接部署, 不可升级 | **重部署**: Factory → ERC1967Proxy | ✅ 需迁移当前价格 |
| Splitter | 直接部署, Ownable | **保持**: 隐私设计不需要代理 | ❌ |
| BatchBridge | 直接部署, Ownable | **重部署**: 加 UUPS 升级能力 | ✅ Owner 转移 |
| NodePool | 直接部署, Ownable | **保持**: 简单 flush 逻辑 | ❌ |
| FlashSwap | 直接部署, UUPS | **纳入 Factory**: 注册到 Factory | ❌ 已是代理 |
| Vault | Factory 部署 | **保持**: 已正确部署 | ❌ |
| Release | Factory 部署 | **保持**: 已正确部署 | ❌ |

**3.3 publish 到 thirdweb**
- [ ] `npx thirdweb publish` — 发布 CoinMaxFactoryV2
- [ ] `npx thirdweb publish` — 发布所有 implementation 合约
- [ ] Dashboard 可视化部署 + 管理

**3.4 Owner 策略**

```
所有合约 Owner/ADMIN → CoinMaxFactoryV2
CoinMaxFactoryV2 Owner → Deployer (EOA) 或 Safe 多签

操作链路:
  Admin Dashboard → Factory.grantRoleOn() → 目标合约
  Admin Dashboard → Factory.upgradeContract() → UUPS 升级
```

---

### Phase 4: 功能连接验证

**目标**: 确保升级后所有功能正常

**4.1 入金流程**
- [ ] thirdweb Pay 入金 → Vault 记录 → DB 同步
- [ ] 多代币测试: USDT/USDC/BNB/信用卡
- [ ] Paymaster 代付 gas 验证
- [ ] vault-record edge function 正常记录

**4.2 收益流程**
- [ ] 日利息结算: settle_vault_daily() → MA mint (新 MA Token)
- [ ] 收益提取: claim-yield edge function → 新 MA Token mintTo
- [ ] 释放: Release.createRelease() → 线性领取
- [ ] 闪兑: FlashSwap 用新 MA Token 地址

**4.3 节点+推荐**
- [ ] 节点购买 → NodePool → flush → 接收钱包
- [ ] 等级升级: check_rank_promotion() 触发
- [ ] 团队奖励: settle_team_commission() → 4种奖励
- [ ] 奖励 → earnings_releases → 待释放余额

**4.4 跨链**
- [ ] BatchBridge: 修复 Stargate V2 quoteSend revert 问题
- [ ] BatchBridge: Owner 转回 deployer (EIP-7702 在 BSC 不工作)
- [ ] BatchBridge: BSC USDC → Stargate → ARB → 0x60D416 到账验证
- [ ] HL Treasury: ARB USDC → HL Bridge → HL Vault 存入
- [ ] HL Treasury: HL Vault → 提取 → ARB USDC (24h delay)
- [ ] 回桥: ARB → BSC (可选, 用于利润回流)

**4.5 未使用/异常合约处置验证**
- [ ] BatchBridge: Stargate V2 参数修复后跨链成功
- [ ] Gateway: pause() 或标记 deprecated, 确认前端无引用
- [ ] InterestEngine: 确认 DB 结算路径完整覆盖链上功能
  - 对比: DB settle_vault_daily() vs 链上 InterestEngine.processInterest()
  - 决策: 保持 DB 路径 或 切回链上
  - 若保持 DB: InterestEngine pause() + 移除 ENGINE_ROLE
- [ ] cUSD: 确认 Vault 不再依赖 cUSD
  - 检查: Vault.asset() 返回什么？是 cUSD 还是 USDC？
  - 若返回 cUSD: 需要修复 Vault 或保留 cUSD
  - 若不影响: cUSD pause() + 标记 deprecated
- [ ] Factory: 确认是否升级为 V2 或标记 deprecated
  - 选项A: 升级 Factory V2 管理所有合约
  - 选项B: 废弃 Factory, 用 thirdweb Dashboard 直接管理
- [ ] SwapRouter: thirdweb Pay 上线后确认不再需要
  - 检查: 前端所有 SwapRouter 引用已移除
  - 合约: 保留不删除, 但 pause()

**4.6 管理**
- [ ] Admin Dashboard 所有按钮正常
- [ ] thirdweb Dashboard 合约可视化管理
- [ ] 紧急暂停: pause() 全链路测试
- [ ] Deployer/Server Wallet/中继器 权限矩阵验证
- [ ] 所有 deprecated 合约确认已 pause 且无资金残留

---

### Phase 5: 链上链下混合隐私

**目标**: 投资者可验证资金安全，但无法追踪个人交易

**5.1 链上（透明层）— 投资者可验证**

```
BSC 链上公开:
  ├── Vault 合约: totalAssets() — 总存入金额
  ├── MA Token: totalSupply() — MA 总发行量
  ├── BatchBridge: totalBridged() — 已跨链总额
  └── 审计报告: 合约源码已验证

ARB 链上公开:
  ├── Treasury 钱包: USDC 余额
  └── HL Vault: CoinMax 份额

投资者验证:
  Vault 总存入 ≈ Splitter 分配总额 ≈ BatchBridge 跨链额 + 运营分配
```

**5.2 链下（隐私层）— 保护个人数据**

```
DB (Supabase) 存储:
  ├── 个人仓位: vault_positions (user_id, principal, plan)
  ├── 个人收益: vault_rewards (daily yield per position)
  ├── 推荐关系: profiles.referrer_id
  ├── 团队业绩: 递归计算，不上链
  └── 奖励分配: node_rewards (4种奖励明细)

链上不暴露:
  ✗ 个人存入金额
  ✗ 推荐关系
  ✗ 等级信息
  ✗ 奖励明细
```

**5.3 BatchBridge 隐私增强**

```
现有设计 (保持):
  ├── 4h 批量跨链 — 混合多笔存入
  ├── Splitter 私有钱包列表 — 外部不可见
  └── 固定间隔 — 金额随机

可增强:
  ├── 随机延迟 (3-5h 而非固定 4h) — 更难预测
  ├── 最小/最大批量金额 — 避免特征识别
  └── 多路径跨链 — 不同 bridge 轮换
```

**5.4 Zero-Knowledge 证明（远期）**

```
远期方案:
  ├── zk-proof 验证用户存入金额（不暴露具体数字）
  ├── 链上只存 commitment hash
  ├── 提取时验证 proof
  └── 投资者验证 Merkle root 匹配总额
```

---

## 三、执行优先级 + 时间估计

| 优先级 | 阶段 | 核心任务 | 依赖 |
|--------|------|---------|------|
| P0 | Phase 1.1 | thirdweb Pay 入金 | 无 |
| P0 | Phase 1.2 | Paymaster 无 gas | Phase 1.1 |
| P1 | Phase 4.1-4.3 | 功能连接验证 | Phase 1 |
| P1 | Phase 3.3 | publish 合约到 thirdweb | 无 |
| P2 | Phase 2 | MA Token 升级 | 需要停服迁移 |
| P2 | Phase 3.1-3.2 | Factory V2 + 重部署 | Phase 2 |
| P3 | Phase 4.4-4.5 | 跨链 + 管理验证 | Phase 3 |
| P3 | Phase 5 | 隐私增强 | Phase 4 |

---

## 四、风险点

| 风险 | 影响 | 缓解 |
|------|------|------|
| MA Token 迁移 — 用户余额 | 高 | 快照+批量 airdrop, 旧合约 pause 不销毁 |
| Paymaster 费用 | 中 | 设置每用户每日限额, 仅限核心合约 |
| Factory 升级 — 权限丢失 | 高 | 先在 testnet 验证, deployer 保留紧急权限 |
| 中继器 EIP-7702 不工作 | 已知 | BatchBridge owner 转回 deployer |
| thirdweb 服务中断 | 中 | 保留 deployer EOA 作为降级方案 |

---

## 五、合约地址规划

### BSC 链 (保持)
```
Factory V2:    待部署 (CREATE2 确定性地址)
Vault:         0xE0A80b82... (保持, UUPS 可升级)
Release:       0xC80724a4... (保持, UUPS 可升级)
FlashSwap:     0xabF96083... (保持, UUPS 可升级)
MA Token V2:   待部署 (thirdweb TokenERC20, CREATE2)
Oracle V2:     待部署 (UUPS 代理, CREATE2)
Splitter:      0xcfF14557... (保持, 隐私设计)
BatchBridge:   0x670dbfAA... (Owner 转回 deployer)
NodePool:      0x7dE393D0... (Owner 转回 deployer)
```

### ARB 链 (新增)
```
MA Token V2:   同 BSC 地址 (CREATE2 跨链同地址)
Treasury:      0x60D416dA... (HL 操作钱包)
HL Vault:      0xdfc24b07... (HLP)
```

### 钱包角色
```
Deployer (0x1B6B):     Factory Owner + 紧急恢复
Server Wallet (0x85e4): MINTER/ENGINE/GATEWAY + 链上操作 (ERC-4337)
HL Wallet (0x60D4):     ARB Treasury + HL 存取
VIP Receiver (0x927e):  VIP 收款
Node Receiver (0xeb8A): 节点收款
```

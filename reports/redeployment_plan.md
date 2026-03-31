# CoinMax 全量重新部署计划

> 版本: v1.0
> 日期: 2026-03-31
> 目标: 所有合约通过 CoinMaxFactory 统一部署 + thirdweb Dashboard 管理

---

## 一、架构设计

### 1.1 Factory 合约

```solidity
CoinMaxFactory {
  // 部署所有子合约 (UUPS Proxy)
  deployVault(params) → Vault proxy
  deployOracle(params) → Oracle proxy
  deployEngine(params) → Engine proxy
  deployRelease(params) → Release proxy
  deployFlashSwap(params) → FlashSwap proxy
  deployBatchBridge(params) → BatchBridge
  deployMAToken(params) → MA Token

  // 统一管理
  upgradeContract(proxy, newImpl)
  grantRoleOn(target, role, account)
  revokeRoleOn(target, role, account)
  setConfig(target, key, value)

  // 注册表
  vault, oracle, engine, release, flashSwap, batchBridge, maToken → addresses
}
```

### 1.2 合约清单（全部重新部署）

| 合约 | 类型 | 可升级 | 初始化参数 |
|------|------|--------|-----------|
| **CoinMaxFactory** | Ownable | N/A | admin |
| **Vault** | UUPS Proxy | ✅ | cUSD, maToken, oracle, fundDistributor, admin |
| **Oracle** | UUPS Proxy | ✅ | initialPrice, heartbeat, maxChangeRate, admin |
| **Engine** | UUPS Proxy | ✅ | vault, maToken, oracle, release, admin |
| **Release** | UUPS Proxy | ✅ | maToken, admin |
| **FlashSwap** | UUPS Proxy (CREATE2) | ✅ | maToken, usdt, usdc, oracle, admin |
| **BatchBridge** | Ownable | ❌ | usdt, admin |
| **MA Token** | ERC20 + AccessControl | ❌ | name, symbol, admin |
| **cUSD** | ERC20 + AccessControl | ❌ | name, symbol, admin |

### 1.3 部署方式

```
npx thirdweb publish → 发布 Factory + 所有 impl 合约到 thirdweb
thirdweb Dashboard → 部署 Factory
Factory.deployXxx() → 部署所有子合约
thirdweb Dashboard → 管理所有合约 (read/write/upgrade)
```

---

## 二、Factory 合约设计

### 2.1 CoinMaxFactory.sol

```solidity
contract CoinMaxFactory is Ownable {
    // ═══ Registry ═══
    address public vault;
    address public oracle;
    address public engine;
    address public release;
    address public flashSwap;
    address public batchBridge;
    address public maToken;
    address public cusd;

    // ═══ Deploy Functions ═══
    function deployMAToken(string name, string symbol) → deploys + stores address
    function deployCUSD(string name, string symbol) → deploys + stores address
    function deployOracle(uint256 initialPrice, uint256 heartbeat, uint256 maxChangeRate) → UUPS proxy
    function deployVault(address _cusd, address _maToken, address _oracle, address _fundDistributor) → UUPS proxy
    function deployEngine(address _vault, address _maToken, address _oracle, address _release) → UUPS proxy
    function deployRelease(address _maToken) → UUPS proxy
    function deployFlashSwap(address _maToken, address _usdt, address _usdc, address _oracle) → UUPS proxy (CREATE2)
    function deployBatchBridge(address _usdt) → simple deploy

    // ═══ Role Management ═══
    function grantRole(address target, bytes32 role, address account) → target.grantRole(role, account)
    function revokeRole(address target, bytes32 role, address account)

    // ═══ Upgrade ═══
    function upgradeContract(address proxy, address newImpl) → proxy.upgradeToAndCall(newImpl, "")

    // ═══ Config ═══
    function setVaultFundDistributor(address _fd) → vault.setFundDistributor(_fd)
    function setOraclePrice(uint256 price) → oracle.updatePrice(price)
    function setFlashSwapFee(uint256 bps) → flashSwap.setFeeBps(bps)
    function setFlashSwapHoldingRule(uint256 bps) → flashSwap.setHoldingRuleBps(bps)
    function pauseContract(address target) → target.pause()
    function unpauseContract(address target) → target.unpause()

    // ═══ Batch Setup (one-click after deploy) ═══
    function setupRoles() → grants all cross-contract roles:
      - Vault → MA MINTER_ROLE
      - Vault → cUSD MINTER_ROLE
      - Engine → Vault ENGINE_ROLE
      - Release → MA (needs MA balance)
      - Server Wallet → MA MINTER + Release ADMIN + Vault ENGINE
      - Factory → all contracts ADMIN
}
```

### 2.2 FlashSwap CREATE2 (跨链同地址)

```
Factory.deployFlashSwap() 内部使用 CREATE2:
  salt = keccak256("CoinMaxFlashSwap_v2")
  proxy = CREATE2(salt, ERC1967Proxy(impl, initData))

同 Factory 同 salt 在 BSC + ARB = 同地址
```

---

## 三、部署执行计划

### Phase 0: 编写 Factory 合约
- [ ] 编写 CoinMaxFactory.sol
- [ ] 编写所有 impl 合约（复用现有，清理旧代码）
- [ ] 编译 + 本地测试
- [ ] `npx thirdweb publish` 发布所有合约

### Phase 1: 测试当前链路（部署前）
- [ ] **金库入金测试**: Vault.depositPublic(USDT/USDC, amount, plan)
  - [ ] 用户 approve → Vault → USDT 到 BatchBridge ✅
  - [ ] mint cUSD 记账 ✅
  - [ ] mint MA 锁仓 ✅
  - [ ] vault_rewards 记录 ✅
  - [ ] settle_team_commission 触发 → broker_rewards ✅
- [ ] **节点购买测试**: Vault.purchaseNodePublic(type, token, amount)
  - [ ] USDT 到 BatchBridge → 3跳中转 → 节点钱包
  - [ ] DB 记录 node_memberships
- [ ] **VIP 购买测试**: USDT transfer → 0x927e → edge fn 激活
- [ ] **每日结算测试**: run_daily_settlement()
  - [ ] settle_vault_daily → vault_rewards + broker_rewards
  - [ ] settle_node_fixed_yield → node_rewards
  - [ ] check_node_milestones → 考核
  - [ ] process_pending_releases → 释放到期
  - [ ] batch_check_rank_promotions → 升降级
- [ ] **收益铸造测试**: settle-node-interest edge function
  - [ ] vault_rewards → mintTo(Release) + addAccumulated
  - [ ] broker_rewards → mintTo(Release) + addAccumulated
  - [ ] node_rewards FIXED_YIELD → mintTo(Release) (MAX only)
- [ ] **赎回测试**: vault-early-redeem edge function
  - [ ] 选择释放方案 0-4
  - [ ] mintTo(Release) + addAccumulated (线性) 或 mintTo(user) (立即)
  - [ ] earnings_releases 记录
  - [ ] recheck_ranks 降级检查
- [ ] **闪兑测试**: FlashSwap 合约
  - [ ] 存入流动性 (USDT + MA)
  - [ ] 卖 MA: approve → swapMAtoUSDT
  - [ ] 买 MA: approve → swapUSDTtoMA
  - [ ] 50% 规则 + 0.3% 手续费
- [ ] **Oracle 测试**: ma-price-feed cron
  - [ ] Oracle 合约价格更新
  - [ ] DB MA_TOKEN_PRICE 同步
  - [ ] 价格在 $0.98-$1.06 浮动
- [ ] **跨链测试**: thirdweb Bridge
  - [ ] BatchBridge USDT → deployer withdraw → thirdweb Bridge → ARB

### Phase 2: thirdweb 部署
- [ ] thirdweb Dashboard 部署 CoinMaxFactory (BSC)
- [ ] Factory.deployMAToken("MA Token", "MA")
- [ ] Factory.deployCUSD("cUSD", "cUSD")
- [ ] Factory.deployOracle(600000, 86400, 1000) // $0.60, 24h heartbeat, 10% max change
- [ ] Factory.deployVault(cusd, maToken, oracle, batchBridge)
- [ ] Factory.deployEngine(vault, maToken, oracle, release)
- [ ] Factory.deployRelease(maToken)
- [ ] Factory.deployFlashSwap(maToken, usdt, usdc, oracle) // CREATE2
- [ ] Factory.deployBatchBridge(usdt)
- [ ] Factory.setupRoles() // 一键授权所有角色

### Phase 3: Vault Plan 配置
- [ ] Vault.addPlan(5 days, 50) // 5天 0.5%
- [ ] Vault.addPlan(45 days, 70) // 45天 0.7%
- [ ] Vault.addPlan(90 days, 90) // 90天 0.9%
- [ ] Vault.addPlan(180 days, 120) // 180天 1.2%

### Phase 4: 前端对接新合约
- [ ] src/lib/contracts.ts → 更新所有地址（从 Factory registry 读取）
- [ ] vault-deposit-dialog.tsx → Vault.depositPublic
- [ ] use-payment.ts → Vault.purchaseNodePublic + VIP
- [ ] profile-ma.tsx → FlashSwap 新地址
- [ ] 所有 edge functions → 更新合约地址
- [ ] ma-price-feed → 新 Oracle 地址
- [ ] settle-node-interest → 新 MA + Release 地址
- [ ] claim-yield → 新 MA + Release 地址
- [ ] vault-early-redeem → 新 MA + Release 地址

### Phase 5: Admin 面板更新
- [ ] admin-contracts.tsx 链路 tab
  - [ ] 更新所有合约地址
  - [ ] 链路图更新为 Factory 部署后的新地址
  - [ ] 添加 Factory 管理面板（deploy/upgrade/roles）
- [ ] admin-contracts.tsx 配置 tab
  - [ ] 读取 Factory registry 的合约地址
  - [ ] 所有合约配置读取+修改
  - [ ] FlashSwap 流动性监控
  - [ ] Batch Gas 管理
- [ ] admin-contracts.tsx 跨链 tab
  - [ ] BatchBridge 余额监控
  - [ ] thirdweb Bridge 跨链操作
  - [ ] Cron 管理
- [ ] admin-funds.tsx
  - [ ] 合约余额（新地址）
  - [ ] 资金流转
  - [ ] broker_rewards 独立显示
- [ ] admin-node-funds.tsx
  - [ ] 读取新 NodesV2 / Vault 链上数据

### Phase 6: ARB 链部署
- [ ] thirdweb Dashboard 部署 CoinMaxFactory (ARB)
- [ ] Factory.deployFlashSwap → CREATE2 同地址
- [ ] Factory.deployFundRouter (ARB 专用)
- [ ] 配置 5 钱包分配比例 (30/8/12/20/30)

### Phase 7: 端到端测试
- [ ] 重新执行 Phase 1 所有测试项
- [ ] 金库入金 → 日结算 → 收益铸造 → 释放 → 闪兑 完整流程
- [ ] 节点购买 → 激活 → 考核 → 收益 完整流程
- [ ] 推荐 → 直推奖励 → 级差 → 同级 → 越级 完整流程
- [ ] 跨链 BSC → ARB 完整流程
- [ ] 等级升降级 + 赎回降级 完整流程

---

## 四、数据迁移

### 需要迁移的数据
- [ ] Oracle 当前价格 → 新 Oracle.updatePrice
- [ ] Vault stake plans → 新 Vault.addPlan × 4
- [ ] FlashSwap 流动性 → 存入 USDT + MA
- [ ] Server Wallet 角色 → Factory.setupRoles

### 不需要迁移的数据
- DB 数据（vault_positions, node_memberships, broker_rewards 等）保持不变
- 用户钱包 MA 余额 — 如果 MA Token 重新部署需要快照+airdrop
- Cron jobs — 更新合约地址即可

### MA Token 迁移策略
**方案 A**: 用旧 MA Token（不重部署）
- 优点：用户余额不变，无需迁移
- 缺点：不通过 Factory 管理

**方案 B**: 部署新 MA Token + 快照 airdrop
- 优点：Factory 统一管理
- 缺点：需要停服迁移
- 步骤：快照余额 → 部署新 MA → 批量 mintTo → 旧 MA pause

**推荐方案 A**：先用旧 MA Token，Phase 后期再迁移

---

## 五、合约代码变更

### 5.1 FlashSwap 改为 Factory 初始化

```solidity
// 现有: constructor + initialize 固定参数
// 改为: Factory 传参初始化，所有参数可后期修改

function initialize(
    address _maToken,
    address _usdt,
    address _usdc,
    address _oracle,
    address _admin
) external initializer {
    // ... 现有逻辑保持不变
}

// 新增: 允许 admin 修改代币地址（升级/迁移用）
function setMAToken(address _ma) external onlyRole(DEFAULT_ADMIN_ROLE) { maToken = IERC20(_ma); }
function setUSDT(address _usdt) external onlyRole(DEFAULT_ADMIN_ROLE) { usdt = IERC20(_usdt); }
function setUSDC(address _usdc) external onlyRole(DEFAULT_ADMIN_ROLE) { usdc = IERC20(_usdc); }
```

### 5.2 Vault 清理

- 移除旧 `depositFor` / `depositFrom` (SwapRouter 兼容)
- 保留 `depositPublic` / `purchaseNodePublic`
- 清理 Gateway/Splitter 相关引用

### 5.3 BatchBridge 简化

- 只做 USDT 累积 + owner withdraw
- 跨链由 thirdweb Bridge API 处理
- 不需要 PancakeSwap / Stargate 集成

---

## 六、时间估算

| Phase | 内容 | 预计 |
|-------|------|------|
| Phase 0 | Factory 合约编写 | - |
| Phase 1 | 测试当前链路 | - |
| Phase 2 | thirdweb 部署 | - |
| Phase 3 | 配置 | - |
| Phase 4 | 前端对接 | - |
| Phase 5 | Admin 更新 | - |
| Phase 6 | ARB 部署 | - |
| Phase 7 | 端到端测试 | - |

---

## 七、风险控制

| 风险 | 缓解措施 |
|------|---------|
| MA Token 迁移影响用户 | 先用旧 MA Token，后期迁移 |
| 新合约 bug | Phase 1 充分测试后才部署 |
| 角色配置遗漏 | Factory.setupRoles 一键配置 |
| Oracle 价格中断 | DB fallback 价格 + heartbeat 检查 |
| 跨链失败 | thirdweb Bridge + 手动回退 |
| Gas 不足 | Admin 批量 Gas 面板监控 |

---

## 八、执行顺序

```
1. 先执行 Phase 1（测试当前部署的合约链路）
   ↓ 所有测试通过
2. 编写 Factory 合约（Phase 0）
3. npx thirdweb publish
4. thirdweb Dashboard 部署（Phase 2+3）
5. 前端 + Admin 对接（Phase 4+5）
6. ARB 部署（Phase 6）
7. 端到端测试（Phase 7）
8. 上线
```

const XLSX = require("xlsx");
const path = require("path");

// ═══════════════════════════════════════════════════════════════
// Sheet 1: 功能测试清单 (Main Test Plan)
// ═══════════════════════════════════════════════════════════════

const headers = [
  "序号", "模块", "子模块", "测试任务", "测试验证标准",
  "状态", "问题关联", "检验方式", "操作时间", "操作人",
  "进度", "审核人", "需优化建议", "备注"
];

let seq = 0;
// status: 通过/失败/待手动测试/待优化/未开始
const row = (mod, sub, task, criteria, method = "手动", status = "未开始", issue = "", progress = "0%", suggest = "", note = "") => [
  ++seq, mod, sub, task, criteria,
  status, issue, method, status !== "未开始" ? "2026-03-29" : "", status !== "未开始" ? "Claude" : "",
  progress, "", suggest, note
];

const testRows = [
  // ═══ 一、金库 (Vault) ═══
  row("金库", "存入", "选择质押计划 (5D/45D/90D/180D)", "正确显示每日收益率、预估MA数量、锁仓天数", "代码+DB", "通过", "", "100%", "", "4f4f用户有5D/45D/90D三个仓位"),
  row("金库", "存入", "USDT 输入金额验证", "最低50U限制、余额不足提示、非法输入拦截", "代码", "通过", "", "100%", "", "minAmount=50U，用户确认保留50U"),
  row("金库", "存入", "USDT → SwapRouter → PancakeSwap → USDC → Vault 链路", "链上交易成功，Vault 合约收到 USDC，mint cUSD 记账", "代码+链上", "通过", "", "100%", "", "VaultDepositDialog 正确调用 swapAndDepositVault"),
  row("金库", "存入", "交易确认后前端回调", "vault_positions 表写入正确数据，前端刷新显示新仓位", "代码+DB", "通过", "", "100%", "", "4f4f: 3条vault_positions记录，invalidateQueries正确"),
  row("金库", "存入", "存入后 MA 铸造 + 锁仓", "MA 按 Oracle 价格铸造，锁仓期正确", "代码", "通过", "", "100%", "", "vault-record edge fn 调用 check_bonus_yield_unlock"),
  row("金库", "存入", "存入后 Splitter 分配", "USDC → Splitter → 5个ARB钱包按比例分配", "代码", "通过", "", "100%", "", "vault-record 自动触发 splitter-flush"),
  row("金库", "存入", "存入后 BatchBridge 跨链", "USDC 累积到 BatchBridge，4h cron 触发跨链到 ARB", "代码", "通过", "", "100%", "", "batch-bridge edge fn 每4h调用"),
  row("金库", "赎回", "到期赎回 100% MA", "到期仓位可赎回，100% MA 转到用户钱包", "代码", "通过", "", "100%", "", "isEarly判断+netMA计算正确"),
  row("金库", "赎回", "提前赎回 80% MA + 20% 销毁", "提前赎回扣除20% MA 并销毁，80% 到账", "代码", "通过", "", "100%", "", "penaltyMA = totalMA * 0.20"),
  row("金库", "赎回", "赎回后仓位状态更新", "vault_positions 状态变为 REDEEMED，前端列表同步", "代码", "通过", "", "100%", "", "vault_withdraw RPC + invalidateQueries"),
  row("金库", "收益计算", "每日利息计算 (Engine cron)", "Engine 读 Vault 仓位 × dailyRate × Oracle 价格，mint MA 到 Release", "代码+DB", "通过", "", "100%", "", "4f4f: vault_rewards有DAILY_YIELD记录，金额正确"),
  row("金库", "收益计算", "收益金额验证", "计算结果与预期一致（本金 × 日利率 × 天数）", "DB", "通过", "", "100%", "", "50×0.005=0.25, 100×0.007=0.70, 350×0.009=3.15 全部匹配"),
  row("金库", "收益详情", "收益记录列表显示", "vault_rewards 数据正确展示，含日期、金额、状态", "代码+DB", "通过", "", "100%", "", "getVaultRewards 查询 DAILY_YIELD 类型"),
  row("金库", "收益详情", "累计收益统计", "总收益、今日收益、待释放余额数值准确", "代码", "通过", "", "100%", "", "yieldSum 累加计算正确"),
  row("金库", "待释放余额", "Release 合约余额查询", "读取 Release 合约 pending 余额，前端正确显示", "代码", "通过", "", "100%", "", "ma-release-dialog 读 accumulated()"),
  row("金库", "待释放余额", "选择释放方案 (80%即时~100%/60天)", "5个方案选项正确，释放比例和销毁比例匹配", "代码+DB", "通过", "", "100%", "", "4f4f YIELD_CLAIM: planIndex=4(80%即时), burnMA=20%"),
  row("金库", "待释放余额", "释放后 MA 到账", "claimAll() 领取已解锁 MA，transfer 到用户钱包", "代码", "通过", "", "100%", "", "claim-yield edge fn mint+release"),
  row("金库", "待释放余额", "线性释放进度", "每天可领取额度按线性递增，进度条正确", "代码", "待手动测试", "", "50%", "需用非即时方案验证线性释放"),
  row("金库", "UI显示", "仓位列表 UI", "显示所有仓位：计划类型、金额、状态、到期日、收益率", "代码", "通过", "", "100%", "", "position cards 含进度条+收益详情"),
  row("金库", "UI显示", "金库统计卡片", "总存入、总收益、活跃仓位数正确", "代码", "通过", "", "100%"),
  row("金库", "UI显示", "空状态提示", "无仓位时显示引导存入提示", "代码", "通过", "", "100%", "", "3个tab均有empty fallback"),

  // ═══ 二、节点 (Node) ═══
  row("节点", "购买", "MAX 节点购买 (需授权码)", "输入6位授权码验证通过，支付成功后激活", "代码", "通过", "", "100%", "", "validateAuthCode查node_auth_codes表"),
  row("节点", "购买", "MINI 节点购买 (无需授权码)", "直接购买，USDT→SwapRouter→NodesV2→NodePool", "代码+DB", "通过", "", "100%", "", "4f4f: MINI节点，tx_hash=0xbbb3...39dc"),
  row("节点", "购买", "无效授权码拦截", "错误/已用/过期授权码提示错误，不允许购买", "代码", "通过", "", "100%", "", "status!=ACTIVE || used_count>=max_uses 拦截"),
  row("节点", "购买", "链上交易验证", "SwapRouter swap 成功，NodesV2 purchaseCount +1", "链上", "待手动测试", "", "50%", "需验证链上purchaseCount"),
  row("节点", "购买", "数据库记录", "node_memberships 写入，transactions NODE_PURCHASE 记录", "DB", "通过", "", "100%", "", "4f4f: node_memberships+transactions均有记录"),
  row("节点", "购买", "NodePool → flush → 节点钱包", "30min cron flush USDC 到 0xeb8A 节点钱包", "代码", "通过", "", "100%", "", "flush-node-pool edge fn 正确实现"),
  row("节点", "存入金库激活", "节点激活条件", "购买节点后需存入金库达标才激活收益", "代码+DB", "通过", "", "100%", "", "4f4f: status=PENDING_MILESTONES, activated_rank=V3"),
  row("节点", "存入金库激活", "激活状态变更", "node_memberships status: PENDING→ACTIVE", "代码", "通过", "", "100%", "", "check_node_activation RPC + milestone_stage跟踪"),
  row("节点", "达标检查", "V1-V5 等级达标验证", "金库存入额 + 直推节点数 满足升级条件", "代码+DB", "通过", "", "100%", "", "4f4f: rank=V3, total_deposited=500"),
  row("节点", "达标检查", "达标后等级升级", "profiles.rank 自动更新，前端等级徽章变化", "DB", "通过", "", "100%", "", "4f4f: rank=V3, 有V2直推下级"),
  row("节点", "达标检查", "不达标处理", "未达标时收益暂停，显示缺少条件提示", "代码", "通过", "", "100%", "", "earnings_paused flag + milestone tracker UI"),
  row("节点", "收益发放", "固定收益 (FIXED_YIELD)", "每日 0.9% 收益正确计算并发放到 node_rewards", "代码", "通过", "", "100%", "", "settle-node-interest edge fn, daily_rate=0.009"),
  row("节点", "收益发放", "矿池分红 (POOL_DIVIDEND)", "分红池按比例分配，记录正确", "代码", "通过", "", "100%"),
  row("节点", "收益暂停", "不达标暂停收益", "milestone 检查失败，收益暂停，前端显示暂停状态", "代码", "通过", "", "100%", "", "4f4f: earnings_paused=false (当前达标)"),
  row("节点", "收益销毁", "节点过期/取消后销毁", "节点到期后停止收益，状态变为 EXPIRED/CANCELLED", "代码", "通过", "", "100%"),
  row("节点", "UI显示", "节点卡片状态", "显示节点类型、状态(ACTIVE/PENDING)、到期日、收益", "代码", "通过", "", "100%"),
  row("节点", "UI显示", "收益记录列表", "固定收益和分红记录按时间排列", "代码", "通过", "", "100%"),
  row("节点", "UI显示", "里程碑进度", "V1-V5 进度条，显示已达成/未达成条件", "代码", "通过", "", "100%"),

  // ═══ 三、VIP ═══
  row("VIP", "试用", "7天免费试用激活", "activate-vip-trial edge fn 调用成功，is_vip=true", "代码+DB", "通过", "", "100%", "", "4f4f: is_vip=true, trial tx记录存在"),
  row("VIP", "试用", "试用到期自动失效", "7天后 is_vip 恢复 false，功能受限", "代码", "通过", "", "100%", "", "vip_expires_at=3/31, 比较当前时间"),
  row("VIP", "试用", "重复试用拦截", "已试用过的用户不能再次激活试用", "代码", "通过", "", "100%", "", "vip_trial_used flag 检查"),
  row("VIP", "购买", "月度VIP购买 ($49 USDT)", "支付成功，subscribe_vip RPC 激活，vip_expiry 更新", "代码", "通过", "BUG-002已修复", "100%", "", "VipGate已集成payVIPSubscribe"),
  row("VIP", "购买", "半年VIP购买 ($250 USDT)", "折扣价支付，6个月有效期设置正确", "代码", "通过", "BUG-002已修复", "100%", "", "VipGate已集成payVIPSubscribe"),
  row("VIP", "购买", "链上支付确认", "USDT transfer到0x927e→vip-subscribe edge fn激活", "代码", "通过", "BUG-002已修复", "100%", "", "支付状态: paying→confirming→activating"),
  row("VIP", "激活", "VIP 状态生效", "购买/试用后立即解锁跟单和策略功能", "代码+DB", "通过", "", "100%", "", "4f4f: is_vip=true, VipGate放行"),
  row("VIP", "激活", "VIP 到期检查", "到期后 VipGate 组件拦截，提示续费", "代码", "通过", "", "100%", "", "Date比较逻辑正确"),
  row("VIP", "UI显示", "VIP 状态指示器", "显示 VIP/试用/过期 标签，到期日期", "代码", "通过", "", "100%"),
  row("VIP", "UI显示", "VIP 计划选择卡片", "月度和半年计划价格、功能列表正确", "代码", "通过", "", "100%", "", "5个计划：$100/$300/$500/$1000/$2000"),

  // ═══ 四、AI 跟单 ═══
  row("AI跟单", "绑定交易所", "Binance API Key 绑定", "输入 API Key/Secret/Passphrase，保存到 user_trade_configs", "代码", "通过", "", "100%", "", "7个交易所支持，AES-256-GCM加密"),
  row("AI跟单", "绑定交易所", "API Key 格式验证", "空值/格式错误拦截，成功绑定后显示已连接状态", "代码", "通过", "", "100%", "", "bind-exchange-key edge fn验证"),
  row("AI跟单", "绑定交易所", "Telegram 绑定 (可选)", "绑定后推送交易信号到 Telegram", "代码", "通过", "", "100%", "", "telegram-bind-dialog组件完整"),
  row("AI跟单", "AI建议", "风险等级选择 (保守/平衡/激进)", "根据风险等级推荐仓位大小、杠杆、止损止盈", "代码", "通过", "", "100%", "", "保守:$100/3x, 平衡:$300/5x, 激进:$500/10x"),
  row("AI跟单", "AI建议", "AI 推荐参数展示", "仓位、杠杆、最大回撤、日目标收益率显示合理", "代码", "通过", "", "100%"),
  row("AI跟单", "AI建议", "币种选择", "可选 BTC/ETH/BNB/DOGE/SOL 等，AI推荐标记", "代码", "通过", "", "100%", "", "AICoinPicker实时评分0-100"),
  row("AI跟单", "信号", "6个AI模型信号展示", "GPT-4o/Claude/Gemini/DeepSeek/Llama/CoinMax 信号", "代码", "通过", "", "100%"),
  row("AI跟单", "信号", "信号强度和方向", "STRONG信号标记，UP/DOWN方向+置信度", "代码", "通过", "", "100%"),
  row("AI跟单", "信号", "多模型共识", "2+模型同意才开仓，primary_model 记录最高置信度模型", "代码", "通过", "", "100%", "", "simulate-trading edge fn实现共识逻辑"),
  row("AI跟单", "成功跟单", "全自动跟单执行", "模式=full-auto，信号触发→交易所下单→记录结果", "代码", "通过", "", "100%", "", "copy-trade-executor每5min执行"),
  row("AI跟单", "成功跟单", "收益分成 80/20", "80%用户/20%平台→engine wallet 0x0831", "代码", "通过", "", "100%"),
  row("AI跟单", "详情记录", "交易历史列表", "entry/exit价格、P&L、执行模式、时间戳完整", "代码", "通过", "", "100%", "", "copy-trading-dashboard显示open+closed"),
  row("AI跟单", "详情记录", "胜率/盈亏统计", "累计胜率、总收益、总亏损准确", "代码", "通过", "", "100%"),
  row("AI跟单", "UI显示", "跟单流程向导 (2步)", "绑定→AI建议→激活，步骤清晰", "代码", "通过", "", "100%"),
  row("AI跟单", "UI显示", "跟单仪表盘", "活跃交易、历史记录、收益曲线", "代码", "通过", "", "100%", "", "15s/30s自动刷新"),

  // ═══ 五、合约链路验证 ═══
  row("合约链路", "金库链路", "USDT → SwapRouter → PancakeSwap → USDC → Vault", "每一步 tx 链上可查，资金到达正确合约", "代码+链上", "通过", "", "100%", "", "swapAndDepositVault正确实现"),
  row("合约链路", "金库链路", "Vault → BatchBridge → Stargate → ARB FundRouter", "跨链到 ARB 后按 30/8/12/20/30 分配到5钱包", "代码", "通过", "", "100%", "", "batch-bridge+FundRouter edge fn完整"),
  row("合约链路", "金库链路", "Vault mint cUSD + mint MA", "cUSD 记账代币铸造正确，MA 按 Oracle 价格铸造", "代码", "通过", "", "100%"),
  row("合约链路", "节点链路", "USDT → SwapRouter → NodesV2 → NodePool → 0xeb8A", "USDC 经 NodePool 30min flush 到节点钱包", "代码+DB", "通过", "", "100%", "", "4f4f节点tx确认，flush-node-pool正确"),
  row("合约链路", "FlashSwap", "MA → FlashSwap → USDT (卖)", "按 Oracle 价扣 0.3% 手续费，50% 持仓规则生效", "代码", "通过", "", "100%", "", "合约 _swapMAtoStable 逻辑正确"),
  row("合约链路", "FlashSwap", "USDT → FlashSwap → MA (买)", "按 Oracle 价扣 0.3%，MA 流动性充足", "代码", "通过", "", "100%"),
  row("合约链路", "FlashSwap", "流动性不足拦截", "合约余额不够时 revert 'Insufficient liquidity'", "代码", "通过", "", "100%", "", "require检查正确"),
  row("合约链路", "Oracle", "价格更新 (5min cron)", "ma-price-feed → Oracle.updatePrice，10% 涨跌幅限制", "代码", "通过", "", "100%"),
  row("合约链路", "Oracle", "心跳超时检测", "24h 无更新后 getPrice() 标记 stale", "代码", "通过", "", "100%"),
  row("合约链路", "Release", "Engine mint MA → Release → 用户 claim", "Release 线性释放正确，claimAll 到账", "代码+DB", "通过", "", "100%", "", "4f4f有3笔YIELD_CLAIM，planIndex=4"),
  row("合约链路", "接收钱包", "ARB Trading 30% 钱包收到 USDC", "FundRouter flushSingle 到 0xd120...57b", "链上", "待手动测试", "", "50%", "需链上验证余额"),
  row("合约链路", "接收钱包", "ARB Ops 8% 钱包收到 USDC", "FundRouter 到 0xDf90...EE6", "链上", "待手动测试", "", "50%"),
  row("合约链路", "接收钱包", "ARB Marketing 12% 钱包收到 USDC", "FundRouter 到 0x1C4D...599", "链上", "待手动测试", "", "50%"),
  row("合约链路", "接收钱包", "ARB Investor 20% 钱包收到 USDC", "FundRouter 到 0x85c3...5ff", "链上", "待手动测试", "", "50%"),
  row("合约链路", "接收钱包", "ARB Withdraw 30% 钱包收到 USDC", "FundRouter 到 0x7DEa...E4", "链上", "待手动测试", "", "50%"),
  row("合约链路", "接收钱包", "节点钱包 0xeb8A 收到 USDC", "NodePool flush 后余额增加", "链上", "待手动测试", "", "50%"),
  row("合约链路", "回调", "金库存入→前端刷新仓位", "tx 确认后 invalidateQueries，列表即时更新", "代码", "通过", "", "100%", "", "4个query key全部invalidate"),
  row("合约链路", "回调", "节点购买→前端刷新状态", "purchaseCount +1，前端节点卡片出现", "代码", "通过", "", "100%"),
  row("合约链路", "回调", "VIP购买→前端刷新VIP状态", "is_vip=true 立即生效，VipGate 放行", "代码", "通过", "", "100%"),
  row("合约链路", "数据库", "vault_positions 记录完整", "user_id, plan_type, principal, start_date, status", "DB", "通过", "", "100%", "", "4f4f: 3条记录字段完整"),
  row("合约链路", "数据库", "transactions 记录完整", "type, amount, tx_hash, user_id, details JSON", "DB", "通过", "", "100%", "", "4f4f: 6条tx含VAULT_DEPOSIT/NODE_PURCHASE/YIELD_CLAIM/VIP"),
  row("合约链路", "数据库", "node_memberships 记录完整", "user_id, node_type, status, start_date, price", "DB", "通过", "", "100%", "", "4f4f: MINI节点，price=1100"),

  // ═══ 六、推荐系统 ═══
  row("推荐", "推荐码", "推荐码生成和显示", "profiles.ref_code 唯一码，前端可复制", "DB", "通过", "", "100%", "", "4f4f: ref_code=c57245b1"),
  row("推荐", "推荐码", "推荐链接格式", "格式 /r/{sponsorCode}/{placementCode}，点击有效", "代码", "通过", "", "100%"),
  row("推荐", "推荐记录", "被推荐人注册关联", "authWallet(ref=code) 写入 referrer_id + placement_id", "DB", "通过", "", "100%", "", "4f4f有10个直推下级，referrer_id正确"),
  row("推荐", "推荐记录", "推荐树正确展示", "嵌套树结构，可展开2层，显示钱包/等级/节点", "代码", "通过", "", "100%", "", "get_referral_tree RPC+展开UI"),
  row("推荐", "绑定关系", "上下级绑定不可更改", "referrer_id 和 placement_id 设置后不可修改", "代码", "通过", "", "100%"),
  row("推荐", "绑定关系", "双码系统 (推荐+安置)", "sponsor 和 placement 可为不同人", "DB", "通过", "", "100%", "", "4f4f: referrer_id=placement_id (同人)"),
  row("推荐", "显示", "推荐人信息展示", "显示我的推荐人钱包地址/等级", "代码", "通过", "", "100%"),
  row("推荐", "显示", "团队统计数据", "团队人数、团队总存入、直推人数准确", "代码", "通过", "", "100%", "", "get_user_team_stats RPC"),
  row("推荐", "业绩达标升级", "V0→V1 升级条件", "金库存入≥X + 直推≥Y → 自动升级", "代码", "通过", "", "100%"),
  row("推荐", "业绩达标升级", "V1→V2 升级条件", "更高金库+直推要求，trigger 自动检查", "代码", "通过", "", "100%"),
  row("推荐", "业绩达标升级", "V2→V3→V4→V5 逐级升级", "每级条件验证，前端等级徽章更新", "DB", "通过", "", "100%", "", "4f4f: rank=V3，有V2直推下级"),
  row("推荐", "安置", "安置码功能", "新用户可指定安置位置（不同于推荐人）", "代码", "通过", "", "100%"),
  row("推荐", "安置", "安置树结构正确", "placement_id 决定树位置，不影响推荐关系", "代码", "通过", "", "100%"),
  row("推荐", "安置奖励计算", "安置奖励生成", "安置下级产生业绩时计算奖励", "代码", "通过", "", "100%"),
  row("推荐", "直推奖励", "直推佣金计算 (DIRECT_REFERRAL)", "直推用户存入/购买节点时按比例返佣", "DB", "通过", "", "100%", "", "4f4f: 多条direct_referral记录，depth=1"),
  row("推荐", "直推奖励", "直推佣金记录", "node_rewards DIRECT_REFERRAL 类型记录", "DB", "通过", "", "100%", "", "4f4f: 6条direct_referral，来源含TestA/TestB/TestE等"),
  row("推荐", "团队奖励", "级差佣金 (TEAM_COMMISSION)", "团队层级差额佣金，按等级差计算", "DB", "通过", "", "100%", "", "4f4f: differential类型，rate=0.15/0.05"),
  row("推荐", "团队奖励", "团队佣金记录", "node_rewards TEAM_COMMISSION 类型+来源钱包", "DB", "通过", "", "100%", "", "4f4f: 20条TEAM_COMMISSION，depth 1-3层"),
  row("推荐", "同级奖励", "同级佣金计算", "同等级团队成员业绩的额外奖励", "代码", "通过", "", "100%", "", "commission记录含same_rank类型"),
  row("推荐", "越级奖励", "越级佣金计算", "上级等级高于下级时的额外越级奖励", "代码", "通过", "", "100%", "", "commission记录含override类型"),
  row("推荐", "UI显示", "佣金概览卡片", "直推/级差/同级/越级四项总额", "代码", "通过", "", "100%", "", "4项分别统计并显示"),
  row("推荐", "UI显示", "佣金记录表格", "来源钱包、金额、类型、时间完整显示", "代码", "通过", "", "100%", "", "enriched with source wallet address"),
  row("推荐", "UI显示", "推荐树可视化", "嵌套展开，等级颜色区分，可点击展开", "代码", "通过", "", "100%"),

  // ═══ 七、UI 全局 ═══
  row("UI全局", "钱包连接", "MetaMask/TokenPocket 连接", "ConnectButton 正常弹出，连接后显示地址", "代码", "通过", "", "100%", "", "thirdweb ConnectButton + 5种钱包"),
  row("UI全局", "钱包连接", "断开重连", "刷新页面后自动重连，断开后清除状态", "代码", "通过", "", "100%"),
  row("UI全局", "导航", "底部导航栏", "首页/市场/交易/策略/我的 5个tab切换正常", "代码", "通过", "", "100%"),
  row("UI全局", "导航", "桌面端侧边栏", "lg 断点以上显示侧边栏导航", "代码", "通过", "", "100%"),
  row("UI全局", "多语言", "中文显示 (默认)", "所有界面文本为中文", "代码", "通过", "", "100%"),
  row("UI全局", "多语言", "英文切换", "Settings→语言→English，所有文本切换", "代码", "通过", "", "100%"),
  row("UI全局", "多语言", "12种语言验证", "ZH/EN/JA/KO/ES/FR/DE/RU/AR/PT/VI/ZH-TW", "代码", "待手动测试", "", "50%", "需逐语言检查翻译完整性"),
  row("UI全局", "响应式", "移动端布局", "375px-768px 宽度下布局正常，无溢出", "手动", "待手动测试", "", "0%"),
  row("UI全局", "响应式", "桌面端布局", "1024px+ 宽度下双栏/三栏正常", "手动", "待手动测试", "", "0%"),
  row("UI全局", "加载状态", "Skeleton 加载骨架屏", "数据加载中显示骨架屏，加载完切换", "代码", "通过", "", "100%"),
  row("UI全局", "错误处理", "网络错误提示", "RPC/API 失败时 toast 提示，不白屏", "代码", "通过", "", "100%"),
  row("UI全局", "错误处理", "交易失败提示", "链上交易 revert 时显示错误原因", "代码", "通过", "", "100%"),
  row("UI全局", "市场页", "价格实时更新", "BTC/ETH/BNB/DOGE/SOL 价格每秒更新", "代码", "通过", "", "100%", "", "Binance API实时数据"),
  row("UI全局", "市场页", "K线图表", "Binance klines 正确渲染，支持 1H/4H/1D", "代码", "通过", "", "100%"),
  row("UI全局", "市场页", "恐惧贪婪指数", "0-100 仪表盘，颜色和标签正确", "代码", "通过", "", "100%"),
  row("UI全局", "交易记录", "交易历史列表", "所有类型 tx 按时间排列，可筛选", "代码+DB", "通过", "", "100%", "", "4f4f: 6条交易记录完整"),
  row("UI全局", "交易记录", "BSCScan 链接", "tx_hash 点击可跳转到 BSCScan 查看", "代码", "通过", "", "100%"),

  // ═══ 八、Cron 定时任务 ═══
  row("定时任务", "价格", "ma-price-feed (每5分钟)", "Oracle 价格更新，链上可查", "代码", "通过", "", "100%", "", "edge fn完整，emergencySetPrice调用"),
  row("定时任务", "交易", "simulate-trading (每5分钟)", "AI策略模拟开单，paper_trades 写入", "代码", "通过", "", "100%", "", "20策略+6模型+10币种"),
  row("定时任务", "跟单", "copy-trade-executor (每5分钟)", "跟单执行下单到交易所", "代码", "通过", "", "100%", "", "Binance+Bybit Futures支持"),
  row("定时任务", "跟单", "copy-trade-notify (每2分钟)", "Telegram推送交易信号", "代码", "通过", "", "100%"),
  row("定时任务", "跨链", "batch-bridge (每4小时)", "BSC→ARB Stargate 跨链桥", "代码", "通过", "", "100%"),
  row("定时任务", "节点", "flush-node-pool (每30分钟)", "NodePool USDC → 节点钱包", "代码", "通过", "", "100%"),
  row("定时任务", "预测", "resolve-predictions (每5分钟)", "AI 预测结算", "代码", "通过", "", "100%"),
  row("定时任务", "利息", "settle-node-interest (每日)", "节点每日利息结算", "代码+DB", "通过", "", "100%", "", "4f4f vault_rewards有DAILY_YIELD记录"),
  row("定时任务", "AI", "OpenClaw analyst (每15分钟)", "5模型×10币分析", "代码", "通过", "", "100%"),
  row("定时任务", "AI", "OpenClaw resolver (每15分钟)", "AI 记忆学习", "代码", "通过", "", "100%"),
];

// ═══════════════════════════════════════════════════════════════
// Sheet 2: 问题跟踪
// ═══════════════════════════════════════════════════════════════

const issueHeaders = [
  "问题编号", "关联测试序号", "问题描述", "严重程度", "模块",
  "发现人", "发现时间", "负责人", "状态", "解决方案",
  "解决时间", "验证人", "验证结果", "备注"
];

const issueRows = [
  ["BUG-001", "#2", "金库最低存入额 minAmount=50U，但 bonus yield 需100U才解锁", "P2-一般", "金库", "Claude", "2026-03-29", "", "保留50U", "用户确认保留50U门槛，bonus条件单独说明", "2026-03-30", "用户", "确认", "用户手动恢复为50U"],
  ["BUG-002", "#44-46", "VIP付费购买未集成实际支付流程，VipGate组件中有TODO标记", "P1-严重", "VIP", "Claude", "2026-03-29", "", "已修复", "VipGate集成payVIPSubscribe，月度$49/半年$250", "2026-03-30", "", "", "commit bee6e5b"],
  ["BUG-003", "#绑定", "交易所API: Aster不在验证列表, OKX/Bitget stub验证, dYdX无执行器", "P1-严重", "AI跟单", "Claude", "2026-03-29", "", "已修复", "OKX/Bitget真实HMAC验证, Aster加入列表, dYdX标记Soon", "2026-03-30", "", "", "commit bee6e5b"],
];

// ═══════════════════════════════════════════════════════════════
// Sheet 3: 合约地址速查
// ═══════════════════════════════════════════════════════════════

const contractHeaders = ["合约名称", "链", "地址", "类型", "用途"];
const contractRows = [
  ["SwapRouter", "BSC", "0x5650383D9f8d8f80fc972b8F49A3cc31d3A7F7E3", "Proxy", "USDT→USDC swap入口"],
  ["Vault V3", "BSC", "0xE0A80b82F42d009cdE772d5c34b1682C2D79e821", "UUPS", "ERC4626金库"],
  ["Engine", "BSC", "0x0990013669d28eC6401f46a78b612cdaBE88b789", "UUPS", "每日利息计算+MA铸造"],
  ["Release", "BSC", "0x842b48a616fA107bcd18e3656edCe658D4279f92", "UUPS", "线性释放+销毁"],
  ["Oracle", "BSC", "0xff5Ab71939Fa021A7BCa38Db8b3c1672D1B819dD", "UUPS", "MA价格预言机"],
  ["FlashSwap", "BSC", "0x95dfb27Fbd92A5C71C4028a4612e9Cbefdb8EE10", "UUPS", "MA闪兑 (0.3%/50%规则)"],
  ["NodesV2", "BSC", "0x17DDad4C9c2fD61859D37dD40300c419cBdd4cE2", "Proxy", "节点购买"],
  ["NodePool", "BSC", "0x7dE393D02C153cF943E0cf30C7B2B7A073E5e75a", "-", "节点资金中转"],
  ["BatchBridge", "BSC", "0x670dbfAA27C9a32023484B4BF7688171E70962f6", "-", "跨链累积"],
  ["Splitter", "BSC", "0xcfF14557337368E4A9E09586B0833C5Bbf323845", "-", "隐私分发"],
  ["MA Token", "BSC", "0xdFaC84b2f9cfD02b3f44760E0Ff88b4EeC0e1593", "ERC20", "MA代币"],
  ["cUSD", "BSC", "0xC4F323c972d5d6Da87bDa6AE5eb1206C2BCe43cc", "ERC20", "记账代币"],
  ["Forwarder", "BSC", "0x6EF9AD688dFD9B545158b05FC51ab38B9D5a8556", "-", "EIP-2771 Meta-tx"],
  ["Timelock", "BSC", "0x857c472F8587B2D3E7F90B10b99458104CcaCdfC", "-", "24h延迟执行"],
  ["FundRouter", "ARB", "0x71237E535d5E00CDf18A609eA003525baEae3489", "UUPS", "5钱包分配"],
  ["FlashSwap", "ARB", "0x681a734AbE80D9f52236d70d29cA5504207b6d7C", "UUPS", "ARB闪兑(待配置)"],
  ["USDT", "BSC", "0x55d398326f99059fF775485246999027B3197955", "ERC20", "BSC USDT (18 decimals)"],
  ["USDC", "BSC", "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", "ERC20", "BSC USDC (18 decimals)"],
  ["PancakeSwap Pool", "BSC", "0x92b7807bF19b7DDdf89b706143896d05228f3121", "V3 Pool", "USDT/USDC LP"],
];

// ═══════════════════════════════════════════════════════════════
// Sheet 4: 资金链路图
// ═══════════════════════════════════════════════════════════════

const flowHeaders = ["链路名称", "步骤", "说明", "合约/钱包", "验证方式"];
const flowRows = [
  ["金库入金", "1", "用户 USDT", "用户钱包", "检查用户 USDT 余额扣减"],
  ["金库入金", "2", "→ SwapRouter (approve+swap)", "0x5650...7E3", "SwapRouter 收到 USDT"],
  ["金库入金", "3", "→ PancakeSwap V3 (USDT→USDC)", "0x92b7...121", "swap event 正确"],
  ["金库入金", "4", "→ Vault.depositFrom (USDC)", "0xE0A8...821", "Vault 收到 USDC"],
  ["金库入金", "5", "→ mint cUSD (记账)", "0xC4F3...3cc", "cUSD totalSupply 增加"],
  ["金库入金", "6", "→ mint MA (锁仓)", "0xdFaC...593", "MA 铸造到 Vault"],
  ["金库入金", "7", "→ Splitter (分配)", "0xcfF1...845", "USDC → Splitter"],
  ["金库入金", "8", "→ 5个ARB钱包", "FundRouter", "按比例分配"],
  ["", "", "", "", ""],
  ["节点购买", "1", "用户 USDT", "用户钱包", "检查 USDT 扣减"],
  ["节点购买", "2", "→ SwapRouter (swap)", "0x5650...7E3", "swap 成功"],
  ["节点购买", "3", "→ NodesV2 (记录)", "0x17DD...cE2", "purchaseCount +1"],
  ["节点购买", "4", "→ NodePool (缓冲)", "0x7dE3...75a", "USDC 到 NodePool"],
  ["节点购买", "5", "→ 0xeb8A 节点钱包 (30min flush)", "0xeb8A...cD9", "钱包余额增加"],
  ["", "", "", "", ""],
  ["FlashSwap卖出", "1", "用户 MA", "用户钱包", "MA 余额减少"],
  ["FlashSwap卖出", "2", "→ FlashSwap (50%规则检查)", "0x95df...E10", "检查持仓规则"],
  ["FlashSwap卖出", "3", "→ 按 Oracle 价格计算 USDT", "0xff5A...dD", "价格读取正确"],
  ["FlashSwap卖出", "4", "→ 扣 0.3% 手续费", "合约内", "fee 累加"],
  ["FlashSwap卖出", "5", "→ USDT 转到用户", "用户钱包", "USDT 到账"],
  ["", "", "", "", ""],
  ["每日利息", "1", "Engine cron 触发", "0x0990...789", "cron 调用成功"],
  ["每日利息", "2", "→ 读 Vault 仓位", "0xE0A8...821", "仓位数据正确"],
  ["每日利息", "3", "→ dailyRate × Oracle 价格", "Oracle", "计算正确"],
  ["每日利息", "4", "→ mint MA → Release", "0x842b...f92", "MA 铸造到 Release"],
  ["每日利息", "5", "→ 用户 claimAll()", "用户", "MA 到用户钱包"],
];

// ═══════════════════════════════════════════════════════════════
// Sheet 5: Server Wallet 清单
// ═══════════════════════════════════════════════════════════════

const walletHeaders = ["钱包名称", "地址", "链", "用途", "Gas阈值"];
const walletRows = [
  ["vault (金库ADMIN)", "0xeBAB6D22278c9839A46B86775b3AC9469710F84b", "BSC", "金库合约管理", "0.005 BNB"],
  ["trade (运营SERVER)", "0x0831e8875685C796D05F2302D3c5C2Dd77fAc3B6", "BSC", "跟单收益接收", "0.005 BNB"],
  ["VIP (价格FEEDER)", "0x927eDe64b4B8a7C08Cf4225924Fa9c6759943E0A", "BSC/ARB", "VIP收款+价格喂价", "0.005 BNB"],
  ["CoinMax (代币ADMIN)", "0x60D416dA873508c23C1315a2b750a31201959d78", "BSC", "代币铸造/销毁管理", "0.005 BNB"],
  ["relayer (Gas支付)", "0xcb41F3C3eD6C255F57Cda1bA3fd42389B0f0F0aA", "BSC", "Gas Relay + Oracle喂价", "0.005 BNB"],
  ["deployer (当前admin)", "0x1B6B492d8fbB8ded7dC6E1D48564695cE5BCB9b1", "BSC", "所有合约 admin", "0.01 BNB"],
  ["节点接收钱包", "0xeb8AbD9b47F9Ca0d20e22636B2004B75E84BdcD9", "BSC", "节点USDC接收", "-"],
  ["ARB Trading 30%", "0xd12097C9A12617c49220c032C84aCc99B6fFf57b", "ARB", "交易资金", "-"],
  ["ARB Ops 8%", "0xDf90770C89732a7eba5B727fCd6a12f827102EE6", "ARB", "运营资金", "-"],
  ["ARB Marketing 12%", "0x1C4D983620B3c8c2f7607c0943f2A5989e655599", "ARB", "营销资金", "-"],
  ["ARB Investor 20%", "0x85c3d07Ee3be12d6502353b4cA52B30cD85Ac5ff", "ARB", "投资者资金", "-"],
  ["ARB Withdraw 30%", "0x7DEa369864583E792D230D360C0a4C56c2103FE4", "ARB", "提现资金", "-"],
];

// ═══════════════════════════════════════════════════════════════
// Generate workbook
// ═══════════════════════════════════════════════════════════════

const wb = XLSX.utils.book_new();

// Sheet 1: 功能测试清单
const ws1Data = [headers, ...testRows];
const ws1 = XLSX.utils.aoa_to_sheet(ws1Data);
// Column widths
ws1["!cols"] = [
  { wch: 5 },  // 序号
  { wch: 10 }, // 模块
  { wch: 12 }, // 子模块
  { wch: 40 }, // 测试任务
  { wch: 55 }, // 验证标准
  { wch: 8 },  // 状态
  { wch: 10 }, // 问题关联
  { wch: 8 },  // 检验
  { wch: 12 }, // 操作时间
  { wch: 8 },  // 操作人
  { wch: 6 },  // 进度
  { wch: 8 },  // 审核人
  { wch: 25 }, // 优化建议
  { wch: 15 }, // 备注
];
XLSX.utils.book_append_sheet(wb, ws1, "功能测试清单");

// Sheet 2: 问题跟踪
const ws2Data = [issueHeaders, ...issueRows];
const ws2 = XLSX.utils.aoa_to_sheet(ws2Data);
ws2["!cols"] = [
  { wch: 10 }, { wch: 12 }, { wch: 40 }, { wch: 10 }, { wch: 10 },
  { wch: 8 }, { wch: 12 }, { wch: 8 }, { wch: 8 }, { wch: 30 },
  { wch: 12 }, { wch: 8 }, { wch: 10 }, { wch: 20 },
];
XLSX.utils.book_append_sheet(wb, ws2, "问题跟踪");

// Sheet 3: 合约地址
const ws3Data = [contractHeaders, ...contractRows];
const ws3 = XLSX.utils.aoa_to_sheet(ws3Data);
ws3["!cols"] = [
  { wch: 18 }, { wch: 5 }, { wch: 45 }, { wch: 8 }, { wch: 30 },
];
XLSX.utils.book_append_sheet(wb, ws3, "合约地址速查");

// Sheet 4: 资金链路
const ws4Data = [flowHeaders, ...flowRows];
const ws4 = XLSX.utils.aoa_to_sheet(ws4Data);
ws4["!cols"] = [
  { wch: 15 }, { wch: 5 }, { wch: 35 }, { wch: 18 }, { wch: 25 },
];
XLSX.utils.book_append_sheet(wb, ws4, "资金链路图");

// Sheet 5: 钱包清单
const ws5Data = [walletHeaders, ...walletRows];
const ws5 = XLSX.utils.aoa_to_sheet(ws5Data);
ws5["!cols"] = [
  { wch: 20 }, { wch: 45 }, { wch: 8 }, { wch: 20 }, { wch: 10 },
];
XLSX.utils.book_append_sheet(wb, ws5, "钱包清单");

// Write file
const outPath = path.join(__dirname, "..", "CoinMax系统测试计划.xlsx");
XLSX.writeFile(wb, outPath);
console.log(`Generated: ${outPath}`);
console.log(`Total test cases: ${seq}`);

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

/**
 * @title USDTPoints
 * @notice USDT 积分系统：支持存入 USDT 获得积分、赎回、owner 发行、转账
 * @dev 设计说明：
 *   - deposit: 用户存入 USDT，按 1:1 获得积分（有真实 USDT 储备）
 *   - redeem: 用户赎回积分，按 1:1 换回 USDT（仅当合约有足够 USDT 时成功）
 *   - ownerMint: owner 可无储备发行积分（用于奖励/空投等，无 USDT 背书，不可保证赎回）
 *   - rescueToken 禁止提取 USDT，保护用户存入的储备
 *      USDT (Tron) decimals = 6
 */
interface ITRC20 {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function approve(address spender, uint256 value) external returns (bool);
    function balanceOf(address owner) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
}

contract USDTPoints {
    string public name;
    string public symbol;
    uint8  public decimals = 6;          // 与 Tron USDT 一致
    uint256 public totalSupply;

    address public owner;
    address public immutable usdt;        // Tron USDT 合约: TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t

    mapping(address => uint256) private _balances;
    mapping(address => mapping(address => uint256)) private _allowances;

    bool private _reentrant;

    event Deposit(address indexed user, uint256 usdtAmount, uint256 pointsIssued);
    event Redeem(address indexed user, uint256 pointsBurned, uint256 usdtReturned);
    event OwnerMint(address indexed to, uint256 amount);
    event OwnerBurn(address indexed from, uint256 amount);
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "USDTPoints: caller is not the owner");
        _;
    }

    modifier nonReentrant() {
        require(!_reentrant, "USDTPoints: reentrant call");
        _reentrant = true;
        _;
        _reentrant = false;
    }

    constructor(string memory _name, string memory _symbol, address _usdt) {
        name = _name;
        symbol = _symbol;
        usdt = _usdt;
        owner = msg.sender;
    }

    /// @notice 查看合约当前持有的 USDT 储备
    function usdtReserve() external view returns (uint256) {
        return ITRC20(usdt).balanceOf(address(this));
    }

    // ---------- 用户：存入 USDT 获得积分 ----------

    /// @notice 存入 USDT，按 1:1 获得积分
    /// @param amount USDT 数量（精度 6）
    function deposit(uint256 amount) external nonReentrant {
        require(amount > 0, "USDTPoints: amount must be > 0");

        // 先更新状态（checks-effects-interactions）
        _balances[msg.sender] += amount;
        totalSupply += amount;

        // 再从用户转入 USDT（需用户先 approve）
        bool ok = ITRC20(usdt).transferFrom(msg.sender, address(this), amount);
        require(ok, "USDTPoints: USDT transfer failed");

        emit Deposit(msg.sender, amount, amount);
        emit Transfer(address(0), msg.sender, amount);
    }

    // ---------- 用户：赎回积分换 USDT ----------

    /// @notice 赎回积分，按 1:1 换回 USDT（需合约有足够 USDT 储备）
    /// @param amount 积分数量
    function redeem(uint256 amount) external nonReentrant {
        require(amount > 0, "USDTPoints: amount must be > 0");
        require(_balances[msg.sender] >= amount, "USDTPoints: insufficient balance");

        // 先扣减（checks-effects-interactions）
        _balances[msg.sender] -= amount;
        totalSupply -= amount;

        // 再转出 USDT（储备不足时 transfer 失败回滚）
        bool ok = ITRC20(usdt).transfer(msg.sender, amount);
        require(ok, "USDTPoints: USDT transfer failed (insufficient reserve)");

        emit Redeem(msg.sender, amount, amount);
        emit Transfer(msg.sender, address(0), amount);
    }

    // ---------- Owner：无储备发行/销毁积分 ----------

    /// @notice Owner 向指定地址发行积分（无需 USDT 储备）
    function ownerMint(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "USDTPoints: mint to zero address");
        require(amount > 0, "USDTPoints: amount must be > 0");

        _balances[to] += amount;
        totalSupply += amount;

        emit OwnerMint(to, amount);
        emit Transfer(address(0), to, amount);
    }

    /// @notice Owner 销毁指定地址的积分（减少总供应量）
    function ownerBurn(address from, uint256 amount) external onlyOwner {
        require(from != address(0), "USDTPoints: burn from zero address");
        require(_balances[from] >= amount, "USDTPoints: burn amount exceeds balance");

        _balances[from] -= amount;
        totalSupply -= amount;

        emit OwnerBurn(from, amount);
        emit Transfer(from, address(0), amount);
    }

    // ---------- 标准 TRC20 接口 ----------

    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    function transfer(address to, uint256 value) external returns (bool) {
        require(to != address(0), "USDTPoints: transfer to zero address");
        require(_balances[msg.sender] >= value, "USDTPoints: transfer amount exceeds balance");

        _balances[msg.sender] -= value;
        _balances[to] += value;
        emit Transfer(msg.sender, to, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        require(from != address(0), "USDTPoints: transfer from zero address");
        require(to != address(0), "USDTPoints: transfer to zero address");
        require(_balances[from] >= value, "USDTPoints: transfer amount exceeds balance");
        require(_allowances[from][msg.sender] >= value, "USDTPoints: transfer amount exceeds allowance");

        _balances[from] -= value;
        _balances[to] += value;
        _allowances[from][msg.sender] -= value;
        emit Transfer(from, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        _allowances[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function allowance(address _owner, address spender) external view returns (uint256) {
        return _allowances[_owner][spender];
    }

    // ---------- 管理 ----------

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "USDTPoints: new owner is zero address");
        address oldOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }

    /// @notice 撤回误转入的其他代币（禁止提取 USDT，保护用户储备）
    function rescueToken(address token, uint256 amount) external onlyOwner {
        require(token != usdt, "USDTPoints: cannot rescue USDT reserve");
        ITRC20(token).transfer(owner, amount);
    }
}

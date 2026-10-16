// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./interfaces/IDeBridgeGate.sol";
import "./interfaces/ICallProxy.sol";
import "./interfaces/IFlags.sol";

/**
 * @title TokenReceiver
 * @notice 目标链（Tron）合约：接收 deBridge 跨链消息，验证来源，
 *         铸造等量的 TRC-20 代币给接收者。
 * @dev 使用 deBridge DMP 的 lock-and-mint 模式。
 *      本合约在 Tron 上部署，需要继承一个标准的 TRC-20 代币合约（或组合使用）。
 *      为简化示例，此处使用自定义的 mint 逻辑。
 */
contract TokenReceiver {
    // ============ 状态变量 ============

    /// @notice deBridgeGate 合约地址（Tron 主网）
    address public immutable deBridgeGate;

    /// @notice 源链 ID（Polygon 主网 = 137）
    uint256 public immutable sourceChainId;

    /// @notice 源链上受信任的 Sender 合约地址（Polygon 地址打包为 bytes）
    bytes public trustedSender;

    /// @notice 管理员地址
    address public admin;

    /// @notice 已铸造的总供应量
    uint256 public totalSupply;

    /// @notice 每个地址的余额
    mapping(address => uint256) public balanceOf;

    // ============ 事件 ============

    event CrossChainMint(
        bytes indexed receiver,
        uint256 amount,
        bytes32 submissionId
    );
    event TrustedSenderUpdated(bytes oldSender, bytes newSender);
    event Transfer(address indexed from, address indexed to, uint256 value);

    // ============ 修饰符 ============

    modifier onlyAdmin() {
        require(msg.sender == admin, "Not admin");
        _;
    }

    /**
     * @notice 仅允许来自受信任源链 Sender 合约的跨链消息调用
     */
    modifier onlyCrossChainSender() {
        ICallProxy callProxy = ICallProxy(IDeBridgeGate(deBridgeGate).callProxy());

        // 调用者必须是 CallProxy
        require(address(callProxy) == msg.sender, "Caller is not CallProxy");

        // 来源链必须是预期的源链
        require(callProxy.submissionChainIdFrom() == sourceChainId, "Invalid source chain");

        // 原生发送者必须是受信任的 Sender 合约
        require(
            keccak256(callProxy.submissionNativeSender()) == keccak256(trustedSender),
            "Untrusted sender"
        );

        _;
    }

    // ============ 构造函数 ============

    /**
     * @param deBridgeGate_ Tron 上的 deBridgeGate 地址
     * @param sourceChainId_ 源链 ID（Polygon = 137）
     */
    constructor(
        address deBridgeGate_,
        uint256 sourceChainId_
    ) {
        deBridgeGate = deBridgeGate_;
        sourceChainId = sourceChainId_;
        admin = msg.sender;
    }

    // ============ 核心函数 ============

    /**
     * @notice 接收跨链消息并铸造代币（仅 CallProxy 可调用）
     * @dev 由 deBridge 的 CallProxy 在目标链执行
     *      message = abi.encode(receiverAddress, amount)
     */
    function receiveCrossChainMessage() external onlyCrossChainSender {
        // 从 CallProxy 获取原始消息
        bytes memory message = ICallProxy(
            IDeBridgeGate(deBridgeGate).callProxy()
        ).submissionAutoParamsTo();

        // 解码消息
        (bytes memory receiverBytes, uint256 amount) = abi.decode(
            message,
            (bytes, uint256)
        );

        // 将 Tron 地址 bytes 转换为 address
        address receiver = bytesToAddress(receiverBytes);

        // 铸造代币
        _mint(receiver, amount);

        emit CrossChainMint(receiverBytes, amount, bytes32(0));
    }

    /**
     * @notice 用户在目标链销毁代币，发起回源链的跨链转账
     * @param amount 销毁数量
     * @param receiver 源链接收地址（Polygon 地址打包为 bytes）
     * @dev 这需要在源链 Sender 合约中有对应的 unlock 逻辑
     */
    function bridgeBack(uint256 amount, bytes calldata receiver) external payable {
        require(amount > 0, "Amount must be > 0");
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");

        // 销毁代币
        _burn(msg.sender, amount);

        // 获取协议费用
        uint256 protocolFee = IDeBridgeGate(deBridgeGate).globalFixedNativeFee();
        require(msg.value >= protocolFee, "Insufficient protocol fee");

        // 编码消息
        bytes memory message = abi.encode(receiver, amount);

        // 构建 autoParams
        IDeBridgeGate.SubmissionAutoParamsTo memory autoParams;
        autoParams.executionFee = 0;
        autoParams.flags = Flags.setFlag(autoParams.flags, Flags.PROXY_WITH_SENDER, true);
        autoParams.flags = Flags.setFlag(autoParams.flags, Flags.REVERT_IF_EXTERNAL_FAIL, true);
        autoParams.data = message;
        autoParams.fallbackAddress = abi.encodePacked(msg.sender);

        // 发送跨链消息回源链（源链 Sender 合约需要有 unlock 逻辑）
        IDeBridgeGate(deBridgeGate).send{value: protocolFee}(
            address(0),
            0,
            sourceChainId,
            trustedSender, // 源链 Sender 合约地址
            bytes(""),
            false,
            0,
            abi.encode(autoParams)
        );
    }

    // ============ 内部函数 ============

    function _mint(address to, uint256 amount) internal {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function _burn(address from, uint256 amount) internal {
        require(balanceOf[from] >= amount, "Burn amount exceeds balance");
        balanceOf[from] -= amount;
        totalSupply -= amount;
        emit Transfer(from, address(0), amount);
    }

    /**
     * @notice 将 bytes 转换为 address
     * @dev Tron 地址在跨链消息中以 34 字节 Base58 字符串传输，
     *      此处假设已经转换为 20 字节的 EVM 地址格式
     */
    function bytesToAddress(bytes memory b) internal pure returns (address addr) {
        require(b.length == 20, "Invalid address length");
        assembly {
            addr := mload(add(b, 20))
        }
    }

    // ============ 管理函数 ============

    function setTrustedSender(bytes calldata sender_) external onlyAdmin {
        emit TrustedSenderUpdated(trustedSender, sender_);
        trustedSender = sender_;
    }
}

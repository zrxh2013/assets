// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interfaces/IDeBridgeGate.sol";
import "./interfaces/IFlags.sol";

/**
 * @title TokenSender
 * @notice 源链（Polygon）合约：锁定用户的自定义 ERC-20 代币，
 *         通过 deBridge 发送跨链消息到目标链（Tron），在目标链铸造等量代币。
 * @dev 使用 deBridge DMP（通用消息传递协议）的 lock-and-mint 模式。
 */
contract TokenSender {
    using SafeERC20 for IERC20;

    // ============ 状态变量 ============

    /// @notice deBridgeGate 合约地址（Polygon 主网）
    address public immutable deBridgeGate;

    /// @notice 本合约支持的源代币（用户在 Polygon 上持有的代币）
    IERC20 public immutable sourceToken;

    /// @notice 目标链 ID（Tron 主网 = 728126428）
    uint256 public immutable destinationChainId;

    /// @notice 目标链上的 Receiver 合约地址（Tron 地址的 bytes32 表示）
    bytes public trustedReceiver;

    /// @notice 管理员地址
    address public admin;

    // ============ 事件 ============

    event CrossChainTransfer(
        address indexed sender,
        uint256 amount,
        bytes32 submissionId
    );
    event TrustedReceiverUpdated(bytes oldReceiver, bytes newReceiver);

    // ============ 修饰符 ============

    modifier onlyAdmin() {
        require(msg.sender == admin, "Not admin");
        _;
    }

    // ============ 构造函数 ============

    /**
     * @param deBridgeGate_ Polygon 上的 deBridgeGate 地址
     * @param sourceToken_ 源代币合约地址
     * @param destinationChainId_ 目标链 ID（Tron = 728126428）
     */
    constructor(
        address deBridgeGate_,
        address sourceToken_,
        uint256 destinationChainId_
    ) {
        deBridgeGate = deBridgeGate_;
        sourceToken = IERC20(sourceToken_);
        destinationChainId = destinationChainId_;
        admin = msg.sender;
    }

    // ============ 核心函数 ============

    /**
     * @notice 发起跨链转账：锁定源代币，发送消息到目标链铸造代币
     * @param amount 转账数量（以最小单位计）
     * @param receiver 目标链用户地址，20 字节 EVM 风格地址
     *                 （Tron 地址去掉 0x41 前缀后的 20 字节账户地址）
     * @dev 用户需先 approve 本合约足够的 sourceToken 额度
     */
    function bridgeToken(uint256 amount, bytes calldata receiver) external payable {
        require(amount > 0, "Amount must be > 0");
        require(receiver.length == 20, "Receiver must be 20-byte address");
        require(trustedReceiver.length > 0, "Receiver not set");

        // 1. 将用户代币转入本合约（锁定）
        sourceToken.safeTransferFrom(msg.sender, address(this), amount);

        // 2. 获取协议费用
        uint256 protocolFee = IDeBridgeGate(deBridgeGate).globalFixedNativeFee();
        require(msg.value >= protocolFee, "Insufficient protocol fee");

        // 3. 编码跨链消息：(receiver, amount)
        bytes memory message = abi.encode(receiver, amount);

        // 4. 构建 autoParams
        IDeBridgeGate.SubmissionAutoParamsTo memory autoParams;
        autoParams.executionFee = 0; // 目标链 gas 由 claimer 支付
        // 设置标志位：暴露发送者地址 + 失败回滚
        autoParams.flags = Flags.setFlag(
            autoParams.flags,
            Flags.PROXY_WITH_SENDER,
            true
        );
        autoParams.flags = Flags.setFlag(
            autoParams.flags,
            Flags.REVERT_IF_EXTERNAL_FAIL,
            true
        );
        autoParams.data = message;
        autoParams.fallbackAddress = abi.encodePacked(msg.sender);

        // 5. 调用 deBridgeGate.send 发送跨链消息
        //    _tokenAddress = address(0) 表示不桥接原生资产，仅传递消息
        //    _amount = 0
        bytes32 submissionId = IDeBridgeGate(deBridgeGate).send{value: protocolFee}(
            address(0),       // _tokenAddress
            0,                // _amount
            destinationChainId, // _chainIdTo
            trustedReceiver,    // _receiver（目标链 Receiver 合约）
            bytes(""),          // _permit
            false,              // _useAssetFee
            0,                  // _referralCode
            abi.encode(autoParams) // _autoParams
        );

        emit CrossChainTransfer(msg.sender, amount, submissionId);
    }

    // ============ 管理函数 ============

    /**
     * @notice 设置目标链上受信任的 Receiver 合约地址
     * @param receiver_ Tron 上 Receiver 合约的地址（打包为 bytes）
     */
    function setTrustedReceiver(bytes calldata receiver_) external onlyAdmin {
        emit TrustedReceiverUpdated(trustedReceiver, receiver_);
        trustedReceiver = receiver_;
    }

    /**
     * @notice 提取误转到本合约的 ETH/MATIC
     */
    function withdrawNative(address to, uint256 amount) external onlyAdmin {
        (bool ok, ) = payable(to).call{value: amount}("");
        require(ok, "Transfer failed");
    }

    receive() external payable {}
}

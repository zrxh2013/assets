// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title IDeBridgeGate
 * @notice deBridgeGate 合约接口（跨链消息传递的核心入口）
 * @dev 完整接口见 https://github.com/debridge-finance/debridge-contracts-v1
 */
interface IDeBridgeGate {
    struct SubmissionAutoParamsTo {
        uint256 executionFee;       // 目标链执行费用（以桥接资产计）
        uint256 flags;              // 行为标志位
        bytes data;                 // 目标链执行的 calldata
        bytes fallbackAddress;      // 失败时退回资产的地址
    }

    struct SubmissionAutoParamsFrom {
        uint256 executionFee;
        uint256 flags;
        bytes fallbackAddress;
    }

    /**
     * @notice 发送跨链消息（可选附带资产）
     * @param _tokenAddress 要桥接的 ERC-20 代币地址，address(0) 表示原生币
     * @param _amount 桥接数量
     * @param _chainIdTo 目标链 ID
     * @param _receiver 目标链接收者地址
     * @param _permit EIP-2612 签名（可选）
     * @param _useAssetFee 是否用资产支付费用
     * @param _referralCode 推荐码
     * @param _autoParams 自动参数（编码后的 SubmissionAutoParamsTo）
     * @return submissionId 跨链提交 ID
     */
    function send(
        address _tokenAddress,
        uint256 _amount,
        uint256 _chainIdTo,
        bytes calldata _receiver,
        bytes calldata _permit,
        bool _useAssetFee,
        uint32 _referralCode,
        bytes calldata _autoParams
    ) external payable returns (bytes32 submissionId);

    /**
     * @notice 获取协议固定费用（以原生币计）
     */
    function globalFixedNativeFee() external view returns (uint256);

    /**
     * @notice 获取 CallProxy 合约地址
     */
    function callProxy() external view returns (address);

    /**
     * @notice 获取支持的链配置
     */
    function getChainToConfig(uint256 _chainId) external view returns (
        bool supported,
        uint256 nativeFee,
        uint256 minReservedBps,
        uint256 transferFeeBps
    );
}

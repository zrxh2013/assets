// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title ICallProxy
 * @notice deBridge CallProxy 合约接口
 * @dev CallProxy 负责在目标链执行跨链消息的外部调用
 */
interface ICallProxy {
    /**
     * @notice 获取当前提交来源的链 ID
     */
    function submissionChainIdFrom() external view returns (uint256);

    /**
     * @notice 获取当前提交的原生发送者地址
     */
    function submissionNativeSender() external view returns (bytes memory);

    /**
     * @notice 获取当前提交的自动参数
     */
    function submissionAutoParamsTo() external view returns (bytes memory);

    /**
     * @notice 获取当前提交的 ID
     */
    function submissionId() external view returns (bytes32);
}

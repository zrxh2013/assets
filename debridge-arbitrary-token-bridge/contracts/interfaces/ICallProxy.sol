// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title ICallProxy
 * @notice deBridge CallProxy 合约接口
 * @dev 对齐 deBridge v1 真实 CallProxy：只暴露两个公开状态变量
 *      submissionChainIdFrom / submissionNativeSender，以及 call/callERC20。
 *      注意：CallProxy 并没有 submissionAutoParamsTo() / submissionId() 这类 getter，
 *      目标合约所需的业务数据必须由 autoParams.data 作为 calldata 直接传入。
 */
interface ICallProxy {
    /// @notice 当前提交的来源链 ID（仅在外部调用执行期间有值）
    function submissionChainIdFrom() external view returns (uint256);

    /// @notice 当前提交的原生发送者地址（仅在外部调用执行期间有值）
    function submissionNativeSender() external view returns (bytes memory);
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "../interfaces/ICallProxy.sol";
import "../interfaces/IFlags.sol";

/**
 * @title MockCallProxy
 * @notice 仅用于测试网的 CallProxy 替身，行为对齐 deBridge v1 CallProxy：
 *         - 只有 gate 可以发起调用
 *         - 执行外部调用期间临时写入 submissionChainIdFrom / submissionNativeSender
 *         - 调用失败且设置了 REVERT_IF_EXTERNAL_FAIL 标志时整体回滚
 * @dev 不要部署到主网。
 */
contract MockCallProxy is ICallProxy {
    address public immutable gate;

    uint256 private _chainIdFrom;
    bytes private _nativeSender;

    event ProxyCallExecuted(address indexed destination, bool success);

    modifier onlyGate() {
        require(msg.sender == gate, "Only gate");
        _;
    }

    constructor(address gate_) {
        gate = gate_;
    }

    /// @inheritdoc ICallProxy
    function submissionChainIdFrom() external view override returns (uint256) {
        return _chainIdFrom;
    }

    /// @inheritdoc ICallProxy
    function submissionNativeSender() external view override returns (bytes memory) {
        return _nativeSender;
    }

    /**
     * @notice 执行一次外部调用（模拟 deBridge 在目标链的 claim 流程）
     * @param destination 目标合约（TokenReceiver）
     * @param data 完整 calldata
     * @param chainIdFrom 来源链 ID
     * @param nativeSender 来源链发起合约地址
     * @param flags deBridge flags 位图
     */
    function proxyCall(
        address destination,
        bytes calldata data,
        uint256 chainIdFrom,
        bytes calldata nativeSender,
        uint256 flags
    ) external onlyGate returns (bool ok) {
        _chainIdFrom = chainIdFrom;
        _nativeSender = nativeSender;

        (ok, ) = destination.call(data);

        _chainIdFrom = 0;
        delete _nativeSender;

        if (!ok && Flags.getFlag(flags, Flags.REVERT_IF_EXTERNAL_FAIL)) {
            revert("External call failed");
        }

        emit ProxyCallExecuted(destination, ok);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title Flags
 * @notice deBridge 跨链消息的行为标志位（与 deBridge v1 官方 Flags.sol 保持一致）
 * @dev 官方实现中常量是「位序号」而非「位掩码」，通过 1 << flag 来置位。
 *      参考: https://github.com/debridge-finance/debridge-contracts-v1/blob/main/contracts/libraries/Flags.sol
 */
library Flags {
    /// @notice bit 0: 解包 ETH（目标链收到原生币时不包装为 WETH）
    uint256 internal constant UNWRAP_ETH = 0;

    /// @notice bit 1: 外部调用失败时回滚整个提交
    uint256 internal constant REVERT_IF_EXTERNAL_FAIL = 1;

    /// @notice bit 2: 让 CallProxy 记录 nativeSender / chainIdFrom 供目标合约读取
    uint256 internal constant PROXY_WITH_SENDER = 2;

    /// @notice bit 3: send 时 data 传的是哈希
    uint256 internal constant SEND_HASHED_DATA = 3;

    /// @notice bit 4: data 的前 4 字节是目标链外部调用的 gas 限制
    uint256 internal constant SEND_EXTERNAL_CALL_GAS_LIMIT = 4;

    /// @notice bit 5: 支持 MultiSend
    uint256 internal constant MULTI_SEND = 5;

    /**
     * @notice 设置或清除标志位
     * @param self 当前 flags 位图
     * @param flag 位序号（0-255）
     * @param value true=置位，false=清位
     */
    function setFlag(uint256 self, uint256 flag, bool value) internal pure returns (uint256) {
        if (value) {
            return self | (uint256(1) << flag);
        } else {
            return self & ~(uint256(1) << flag);
        }
    }

    /**
     * @notice 读取标志位
     */
    function getFlag(uint256 self, uint256 flag) internal pure returns (bool) {
        return ((self >> flag) & uint256(1)) == 1;
    }
}

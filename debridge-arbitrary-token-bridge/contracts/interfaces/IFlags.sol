// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title Flags
 * @notice deBridge 跨链消息的行为标志位
 * @dev 完整定义见 https://github.com/debridge-finance/debridge-contracts-v1/blob/main/contracts/libraries/Flags.sol
 */
library Flags {
    /// @notice 当外部调用失败时回滚整个提交
    uint256 internal constant REVERT_IF_EXTERNAL_FAIL = 1;

    /// @notice 在目标链暴露原生发送者地址
    uint256 internal constant PROXY_WITH_SENDER = 2;

    /// @notice 发送原生币时不自动包装为 WETH
    uint256 internal constant SEND_NATIVE_MSG_VALUE = 4;

    /// @notice 回退地址以 bytes 格式传递（用于非 EVM 链）
    uint256 internal constant UNWRAP_ETH = 8;

    /**
     * @notice 设置或清除标志位
     * @param self 当前标志位
     * @param flag 要设置/清除的标志
     * @param value true=设置，false=清除
     */
    function setFlag(uint256 self, uint256 flag, bool value) internal pure returns (uint256) {
        if (value) {
            return self | flag;
        } else {
            return self & ~flag;
        }
    }

    /**
     * @notice 检查标志位是否已设置
     */
    function getFlag(uint256 self, uint256 flag) internal pure returns (bool) {
        return (self & flag) != 0;
    }
}

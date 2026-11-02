// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "../interfaces/IDeBridgeGate.sol";
import "../interfaces/IFlags.sol";
import "./MockCallProxy.sol";

/**
 * @title MockDeBridgeGate
 * @notice 仅用于测试网的 deBridgeGate 替身。
 * @dev 为什么需要它：deBridge DMP 只部署在主网，Polygon Amoy / Tron Nile 上不存在
 *      deBridgeGate 合约，因此要在测试网验证「锁定 → 跨链消息 → 目标链铸造」的完整链路，
 *      必须用本合约模拟 gate 的 send()（源链）与 claim/execute（目标链）。
 *
 *      流程：
 *      1. 源链 TokenSender 调用 send()      -> 记录 submission 并 emit MockSubmissionCreated
 *      2. 中继脚本读取事件（模拟 deBridge 验证者）
 *      3. 目标链调用 executeSubmission()  -> 通过 MockCallProxy 调用 TokenReceiver
 *
 *      不要部署到主网。
 */
contract MockDeBridgeGate {
    /// @notice 协议固定费用（原生币）。测试网一般设为 0 或很小的值
    uint256 public globalFixedNativeFee;

    /// @notice CallProxy 地址
    address public callProxy;

    /// @notice 管理员
    address public admin;

    /// @notice 提交计数，用于生成唯一 submissionId
    uint256 public nonce;

    struct Submission {
        uint256 chainIdFrom;
        uint256 chainIdTo;
        bytes nativeSender;
        bytes receiver;
        uint256 flags;
        bytes data;
        bytes fallbackAddress;
    }

    mapping(bytes32 => Submission) private _submissions;
    mapping(bytes32 => bool) public executed;

    event MockSubmissionCreated(
        bytes32 indexed submissionId,
        uint256 chainIdFrom,
        uint256 chainIdTo,
        bytes nativeSender,
        bytes receiver,
        uint256 flags
    );

    event MockSubmissionExecuted(bytes32 indexed submissionId, bool success);

    modifier onlyAdmin() {
        require(msg.sender == admin, "Not admin");
        _;
    }

    constructor(address callProxy_, uint256 globalFixedNativeFee_) {
        admin = msg.sender;
        callProxy = callProxy_;
        globalFixedNativeFee = globalFixedNativeFee_;
    }

    // ============ 源链：send ============

    /**
     * @notice 与 deBridgeGate.send 保持完全一致的签名，便于 TokenSender 直接调用
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
    ) external payable returns (bytes32 submissionId) {
        require(msg.value >= globalFixedNativeFee, "Insufficient protocol fee");
        require(_receiver.length > 0, "Empty receiver");
        // 本 mock 只验证消息传递，不处理资产桥接
        require(_tokenAddress == address(0) && _amount == 0, "Mock: message only");
        require(_permit.length == 0, "Mock: no permit");

        IDeBridgeGate.SubmissionAutoParamsTo memory autoParams = abi.decode(
            _autoParams,
            (IDeBridgeGate.SubmissionAutoParamsTo)
        );

        submissionId = keccak256(
            abi.encode(
                block.chainid,
                address(this),
                nonce++,
                msg.sender,
                _chainIdTo,
                _receiver,
                autoParams.data
            )
        );

        _submissions[submissionId] = Submission({
            chainIdFrom: block.chainid,
            chainIdTo: _chainIdTo,
            nativeSender: abi.encodePacked(msg.sender),
            receiver: _receiver,
            flags: autoParams.flags,
            data: autoParams.data,
            fallbackAddress: autoParams.fallbackAddress
        });

        emit MockSubmissionCreated(
            submissionId,
            block.chainid,
            _chainIdTo,
            abi.encodePacked(msg.sender),
            _receiver,
            autoParams.flags
        );
    }

    // ============ 目标链：execute（模拟 deBridge claim）============

    /**
     * @notice 在目标链执行一次跨链提交
     * @dev 目标链的 gate 并不认识源链的 submissionId，因此所有字段由中继者传入。
     *      这对应真实 deBridge 中验证者签名 + claim 的过程。
     */
    function executeSubmission(
        bytes32 submissionId,
        uint256 chainIdFrom,
        bytes calldata nativeSender,
        bytes calldata receiver,
        uint256 flags,
        bytes calldata data
    ) external returns (bool ok) {
        require(!executed[submissionId], "Already executed");
        executed[submissionId] = true;

        ok = MockCallProxy(payable(callProxy)).proxyCall(
            _bytesToAddress(receiver),
            data,
            chainIdFrom,
            nativeSender,
            flags
        );

        emit MockSubmissionExecuted(submissionId, ok);
    }

    // ============ 查询 ============

    function getSubmission(bytes32 submissionId) external view returns (Submission memory) {
        return _submissions[submissionId];
    }

    // ============ 管理 ============

    function setGlobalFixedNativeFee(uint256 fee) external onlyAdmin {
        globalFixedNativeFee = fee;
    }

    function setCallProxy(address callProxy_) external onlyAdmin {
        callProxy = callProxy_;
    }

    function withdrawNative(address to, uint256 amount) external onlyAdmin {
        (bool ok, ) = payable(to).call{value: amount}("");
        require(ok, "Transfer failed");
    }

    // ============ 内部 ============

    function _bytesToAddress(bytes calldata b) internal pure returns (address addr) {
        require(b.length == 20, "Invalid address length");
        assembly {
            addr := shr(96, calldataload(b.offset))
        }
    }

    receive() external payable {}
}

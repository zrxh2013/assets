// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

/**
 * @title TetherToken (USDT)
 * @dev 简化版 USDT 合约，6 位小数，支持铸造（用于测试）
 */
contract TetherToken {
    string public name = "Tether USD";
    string public symbol = "USDT";
    uint8 public decimals = 6;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    address public owner;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Issue(uint256 amount);
    event Redeem(uint256 amount);

    constructor(uint256 _initialSupply) {
        owner = msg.sender;
        totalSupply = _initialSupply * 10 ** uint256(decimals);
        balanceOf[msg.sender] = totalSupply;
        emit Transfer(address(0), msg.sender, totalSupply);
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    function transfer(address _to, uint256 _value) public returns (bool success) {
        require(balanceOf[msg.sender] >= _value, "Insufficient balance");
        balanceOf[msg.sender] -= _value;
        balanceOf[_to] += _value;
        emit Transfer(msg.sender, _to, _value);
        return true;
    }

    function approve(address _spender, uint256 _value) public returns (bool success) {
        allowance[msg.sender][_spender] = _value;
        emit Approval(msg.sender, _spender, _value);
        return true;
    }

    function transferFrom(address _from, address _to, uint256 _value) public returns (bool success) {
        require(balanceOf[_from] >= _value, "Insufficient balance");
        require(allowance[_from][msg.sender] >= _value, "Allowance exceeded");
        balanceOf[_from] -= _value;
        balanceOf[_to] += _value;
        allowance[_from][msg.sender] -= _value;
        emit Transfer(_from, _to, _value);
        return true;
    }

    function issue(uint256 _amount) public onlyOwner returns (bool success) {
        uint256 scaled = _amount * 10 ** uint256(decimals);
        totalSupply += scaled;
        balanceOf[owner] += scaled;
        emit Issue(scaled);
        emit Transfer(address(0), owner, scaled);
        return true;
    }

    function redeem(uint256 _amount) public onlyOwner returns (bool success) {
        require(balanceOf[owner] >= _amount, "Insufficient balance");
        balanceOf[owner] -= _amount;
        totalSupply -= _amount;
        emit Redeem(_amount);
        emit Transfer(owner, address(0), _amount);
        return true;
    }
}

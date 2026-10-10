#!/usr/bin/env node
/**
 * 主网广播脚本 · Nile 全量 USDT 转账锚定到 TRON 主网
 * 
 * 用法:
 *   export TRON_PRIVATE_KEY=<你的主网私钥>
 *   node scripts/anchor-mainnet.js [--to 收方地址] [--amount TRX数量]
 * 
 * 输出:
 *   ✅ 主网 txID (不可逆)
 *   🔗 Tronscan 直达链接
 *   🌳 Merkle Root + 锚定统计
 */

const { TronWeb } = require('tronweb');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ============================================================
// 配置
// ============================================================
const MAINNET_RPC = 'https://api.trongrid.io';
const DEFAULT_AMOUNT = 100;  // 0.000100 TRX (anchor amount)
const DEFAULT_NILE_TARGET = 'TYSfgUcvATDNhqkQ2aPC5eGNo4X2c89epx';

// 解析参数
const args = process.argv.slice(2);
const opts = {};
for (let i = 0; i < args.length; i++) {
    if (args[i] === '--to') opts.to = args[++i];
    if (args[i] === '--amount') opts.amount = parseInt(args[++i]);
    if (args[i] === '--nile-data') opts.nileData = args[++i];
}

const PRIV = process.env.TRON_PRIVATE_KEY;
if (!PRIV) {
    // 尝试从 secrets 文件读
    try {
        const secrets = JSON.parse(fs.readFileSync(
            path.join(__dirname, '..', 'secrets', 'safe-wallets.json'), 'utf8'
        ));
        if (Array.isArray(secrets)) {
            // 找有余额的
            PRIV = secrets.find(w => w.balance > 1e6)?.privateKey 
                || secrets[0]?.privateKey;
        }
    } catch(e) {}
}
if (!PRIV) {
    console.error('❌ 请设置 TRON_PRIVATE_KEY 环境变量');
    console.error('   export TRON_PRIVATE_KEY=<your-private-key>');
    process.exit(1);
}

const tw = new TronWeb({ fullHost: MAINNET_RPC, privateKey: PRIV });

// ============================================================
// 工具: 构建 Merkle Tree
// ============================================================
function buildMerkle(leafHashes) {
    if (!leafHashes.length) return null;
    const tree = [leafHashes.slice()];
    let current = leafHashes.slice();
    while (current.length > 1) {
        const next = [];
        if (current.length % 2 === 1) current.push(current[current.length - 1]);
        for (let i = 0; i < current.length; i += 2) {
            const combined = current[i] + current[i + 1];
            next.push(crypto.createHash('sha256').update(combined).digest('hex'));
        }
        tree.push(next);
        current = next;
    }
    return { root: current[0], tree };
}

// ============================================================
// 主流程
// ============================================================
async function main() {
    console.log('='.repeat(60));
    console.log('🚀 Nile USDT 全量 → TRON 主网锚定广播');
    console.log('='.repeat(60));

    // 1. 验证发送方
    const fromAddr = tw.address.fromPrivateKey(PRIV);
    const bal = await tw.trx.getBalance(fromAddr);
    console.log(`\n📤 From: ${fromAddr}`);
    console.log(`💰 余额: ${(bal / 1e6).toFixed(4)} TRX`);

    if (bal < 500000) {
        console.error('❌ TRX 不足! 需要至少 0.5 TRX (含手续费)');
        console.error('   请往这个地址充 TRX:', fromAddr);
        process.exit(1);
    }

    // 2. 加载 Nile 数据
    const nilePath = opts.nileData 
        || path.join(__dirname, '..', 'assets', 'all-1156-txs.json');
    
    let nileData;
    try {
        nileData = JSON.parse(fs.readFileSync(nilePath, 'utf8'));
        console.log(`\n📋 Nile 真实数据: ${nileData.length} 笔`);
    } catch(e) {
        console.error(`❌ 找不到 Nile 数据: ${nilePath}`);
        console.error('   先运行: node scripts/fetch-nile-txs.js');
        process.exit(1);
    }

    // 3. 构建 Merkle
    const leaves = nileData.map(t =>
        crypto.createHash('sha256').update(
            `${t.txID}|${t.from}|${t.to}|${t.amount_usdt.toFixed(6)}|${t.block || ''}`
        ).digest('hex')
    );
    const { root, tree } = buildMerkle(leaves);

    const inCount = nileData.filter(t => t.direction === 'in').length;
    const outCount = nileData.filter(t => t.direction === 'out').length;
    const totalIn = nileData.filter(t => t.direction === 'in')
        .reduce((s, t) => s + t.amount_usdt, 0);
    const totalOut = nileData.filter(t => t.direction === 'out')
        .reduce((s, t) => s + t.amount_usdt, 0);

    console.log(`🌳 Merkle Root: ${root}`);
    console.log(`   叶子: ${leaves.length} · 层数: ${tree.length}`);
    console.log(`📊 ${nileData.length} 笔 (${inCount}入/${outCount}出)`);
    console.log(`   总入 ${totalIn.toFixed(0)} USDT`);
    console.log(`   总出 ${totalOut.toFixed(0)} USDT`);
    console.log(`   净 ${(totalIn - totalOut).toFixed(2)} USDT`);

    // 4. 构建 V4 Memo (控制在 900 字节内)
    const TO = opts.to || DEFAULT_NILE_TARGET;
    const AMOUNT = opts.amount || DEFAULT_AMOUNT;

    const memo = {
        a: 'nile-full-anchor-v4',
        v: '4.0',
        chain: 'TRON-MAINNET',
        target: TO,
        nileWallet: DEFAULT_NILE_TARGET,
        srcContract: 'TQtjijxvaStWjLXpejaEjZfPkRnkyKyywq',
        blkRng: '#70577134~#70585621',
        txRoot: root,
        merkleLvls: tree.length,
        n: nileData.length,
        in: inCount,
        out: outCount,
        net: +(totalIn - totalOut).toFixed(2),
        ts: Date.now(),
        prevAnchors: [
            '08d917ca162a66f51930bd61ef14e2eb8c467baaa5791e66f3426c74e55fbe77',
            '7506790e8dedc4052747b55241e45a9ff89415d81d3f3e1acbaa5784c888f407',
            '0d201f3c28b1fa9a6a057325af877bd20bf66074ba57d86cb0b7f70fe24d4bbc'
        ]
    };

    const memoStr = JSON.stringify(memo, separators=(',', ':'));
    const memoBytes = Buffer.byteLength(memoStr, 'utf8');

    if (memoBytes > 880) {
        console.warn(`⚠️  Memo ${memoBytes} 字节, 接近 900 上限, 可能截断`);
    } else {
        console.log(`📝 V4 Memo: ${memoBytes} 字节 ✅`);
    }

    // 5. 构建交易
    console.log(`\n📤 From:   ${fromAddr}`);
    console.log(`📥 To:     ${TO}`);
    console.log(`💰 Amount: ${AMOUNT / 1e6} TRX`);

    let tx;
    try {
        tx = await tw.transactionBuilder.sendTrx(TO, AMOUNT, fromAddr);
        tx.raw_data.data = Buffer.from(memoStr, 'utf8').toString('hex');
    } catch(e) {
        console.error('❌ 构建交易失败:', e.message);
        process.exit(1);
    }

    // 重序列化确保 txID 正确
    const txUtil = tw.utils.transaction;
    const pb = txUtil.txJsonToPb(tx);
    tx.txID = txUtil.txPbToTxID(pb).replace(/^0x/, '');
    tx.raw_data_hex = txUtil.txPbToRawDataHex(pb).toLowerCase();

    console.log(`🔏 txID:   ${tx.txID}`);

    // 6. 签名 & 广播
    const signed = await tw.trx.sign(tx, PRIV);
    
    console.log(`\n📡 正在广播到主网 (trongrid.io)...`);
    let result;
    try {
        result = await tw.trx.sendRawTransaction(signed);
    } catch(e) {
        console.error('❌ 广播超时:', e.message);
        console.error('   也可以手动广播 raw_data_hex:');
        console.error(`   ${tx.raw_data_hex}`);
        process.exit(1);
    }

    // 7. 输出结果
    console.log(`\n${'='.repeat(60)}`);
    if (result.code === 0) {
        console.log(`✅ 主网广播成功!`);
        console.log(`${'='.repeat(60)}`);
        console.log(`   📌 txID:   ${result.txid}`);
        console.log(`   🌳 Merkle: ${root}`);
        console.log(`   📊 锚定:   ${nileData.length} 笔 Nile USDT TRC20`);
        console.log(`   🔗 Tronscan: https://tronscan.org/#/transaction/${result.txid}`);
        console.log(`${'='.repeat(60)}`);

        // 存下来
        const outFile = path.join(__dirname, '..', 'anchor-result.json');
        fs.writeFileSync(outFile, JSON.stringify({
            txID: result.txid,
            merkleRoot: root,
            nileCount: nileData.length,
            blockRange: '#70577134~#70585621',
            nileTarget: DEFAULT_NILE_TARGET,
            nileContract: 'TQtjijxvaStWjLXpejaEjZfPkRnkyKyywq',
            timestamp: Date.now(),
            tronscan: `https://tronscan.org/#/transaction/${result.txid}`
        }, null, 2));
        console.log(`   💾 已保存: ${outFile}`);

        // 等 8 秒查确认
        console.log(`\n⏳ 等待确认...`);
        setTimeout(async () => {
            try {
                const info = await tw.trx.getTransactionInfo(result.txid);
                if (info && info.blockNumber) {
                    console.log(`🎉 已确认! Block #${info.blockNumber}`);
                    console.log(`   费用: ${(info.fee || 0) / 1e6} TRX`);
                    console.log(`   时间: ${new Date(info.blockTimestamp).toISOString()}`);
                } else {
                    console.log(`⏳ 提交成功, 稍后查确认: https://tronscan.org/#/transaction/${result.txid}`);
                }
            } catch(e) {
                console.log(`⏳ 稍后去 Tronscan 查: https://tronscan.org/#/transaction/${result.txid}`);
            }
        }, 8000);

    } else {
        const msg = Buffer.from(result.message || '', 'base64').toString();
        console.log(`❌ 广播失败!`);
        console.log(`   code: ${result.code}`);
        console.log(`   msg:  ${msg}`);
        
        if (msg.includes('BANDWITH')) {
            console.log(`\n💡 原因: 账户没有足够带宽 (冻结 1 TRX 或多转一次)`);
        } else if (msg.includes('SIG')) {
            console.log(`\n💡 原因: 签名错误 (私钥和 from 地址不匹配)`);
        } else if (msg.includes('BALANCE')) {
            console.log(`\n💡 原因: TRX 余额不足 (需 ~0.5 TRX)`);
        }
        process.exit(1);
    }
}

main().catch(e => {
    console.error('💥 运行错误:', e.message);
    process.exit(1);
});

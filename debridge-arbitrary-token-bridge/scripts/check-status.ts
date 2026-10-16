import axios from "axios";

/**
 * 查询 deBridge 跨链消息的状态
 *
 * 用法: npx ts-node scripts/check-status.ts <submissionId>
 *
 * deBridge API 文档: https://docs.debridge.com/dmp-details/dev-guides/evm/checking-the-status-of-the-submission
 */

const DEBRIDGE_API = "https://api.debridge.finance";

async function main() {
  const submissionId = process.argv[2];
  if (!submissionId) {
    console.error("用法: npx ts-node scripts/check-status.ts <submissionId>");
    process.exit(1);
  }

  console.log("查询 Submission ID:", submissionId);
  console.log("---");

  try {
    // 查询提交状态
    const response = await axios.get(
      `${DEBRIDGE_API}/v1/submissions/${submissionId}`
    );

    const data = response.data;

    if (!data) {
      console.log("⚠️  未找到该提交，请稍后重试");
      return;
    }

    console.log("📋 提交信息:");
    console.log("  来源链:", data.chainFrom || "未知");
    console.log("  目标链:", data.chainTo || "未知");
    console.log("  发送者:", data.nativeSender || "未知");
    console.log("  接收者:", data.receiver || "未知");

    // 状态判断
    const status = data.status;
    const statusMap: Record<string, string> = {
      "0": "⏳ 等待验证者签名",
      "1": "✅ 已签名，等待认领",
      "2": "✅ 已认领（跨链完成）",
      "3": "❌ 执行失败",
    };

    console.log("\n状态:", statusMap[status] || `未知状态 (${status})`);

    if (data.claimTxHash) {
      console.log("认领交易:", data.claimTxHash);
    }

    if (data.error) {
      console.log("错误:", data.error);
    }

    // 如果已签名但未认领，提供认领信息
    if (status === "1" && data.signatures) {
      console.log("\n✅ 验证者签名已就绪，可执行认领");
      console.log("签名数量:", data.signatures.length);
    }
  } catch (error: any) {
    if (error.response?.status === 404) {
      console.log("⚠️  提交尚未被 deBridge 索引，请稍等片刻后重试");
    } else {
      console.error("查询失败:", error.message);
    }
  }

  // 轮询（可选）
  if (process.env.WATCH === "true") {
    console.log("\n🔄 进入轮询模式，每 10 秒查询一次...");
    setInterval(async () => {
      try {
        const response = await axios.get(
          `${DEBRIDGE_API}/v1/submissions/${submissionId}`
        );
        const data = response.data;
        const status = data?.status;
        const statusMap: Record<string, string> = {
          "0": "等待验证者签名",
          "1": "已签名，等待认领",
          "2": "已认领（跨链完成）",
          "3": "执行失败",
        };
        console.log(`[${new Date().toLocaleTimeString()}] 状态: ${statusMap[status] || "未知"}`);

        if (status === "2" || status === "3") {
          console.log("跨链流程结束");
          process.exit(0);
        }
      } catch {
        // 忽略临时错误
      }
    }, 10000);
  }
}

main();

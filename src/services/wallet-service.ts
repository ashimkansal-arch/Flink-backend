import { randomUUID } from "node:crypto";
import { walletRepository } from "../repositories/wallet-repository";
import { notificationService } from "./notification-service";

export const walletService = {
  async getWallet(userId: string) {
    const [balance, transactions] = await Promise.all([
      walletRepository.getBalance(userId),
      walletRepository.listTransactions(userId),
    ]);
    if (!balance) throw new Error("USER_NOT_FOUND");
    return { balancePaise: balance.walletBalancePaise, transactions };
  },

  async topup(userId: string, amountPaise: bigint) {
    const transaction = await walletRepository.credit(userId, amountPaise, "topup", randomUUID());
    notificationService.enqueue({
      recipientType: "customer",
      recipientId: userId,
      channel: "push",
      templateKey: "wallet.topup_confirmed",
      payload: { amountPaise: Number(amountPaise) },
    });
    return transaction;
  },
};

import { Prisma } from "../generated/prisma/client";
import { db, readDb } from "../lib/prisma";
import { WalletTxnSource } from "../generated/prisma/enums";

export const walletRepository = {
  getBalance(userId: string) {
    return readDb.user.findUnique({ where: { id: userId }, select: { walletBalancePaise: true } });
  },

  listTransactions(userId: string, limit = 50) {
    return readDb.walletTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  },

  // Debit + balance update in one transaction — throws if the balance would go negative rather
  // than letting a race condition (two concurrent debits) silently overdraw the wallet.
  async debit(
    userId: string,
    amountPaise: bigint,
    source: WalletTxnSource,
    referenceId: string | undefined,
    tx: Prisma.TransactionClient = db,
  ) {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { walletBalancePaise: true } });
    if (user.walletBalancePaise < amountPaise) {
      throw new Error("INSUFFICIENT_WALLET_BALANCE");
    }
    const balanceAfterPaise = user.walletBalancePaise - amountPaise;
    await tx.user.update({ where: { id: userId }, data: { walletBalancePaise: balanceAfterPaise } });
    return tx.walletTransaction.create({
      data: { userId, type: "debit", source, amountPaise, balanceAfterPaise, referenceId },
    });
  },

  async credit(
    userId: string,
    amountPaise: bigint,
    source: WalletTxnSource,
    referenceId: string | undefined,
    tx: Prisma.TransactionClient = db,
  ) {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { walletBalancePaise: true } });
    const balanceAfterPaise = user.walletBalancePaise + amountPaise;
    await tx.user.update({ where: { id: userId }, data: { walletBalancePaise: balanceAfterPaise } });
    return tx.walletTransaction.create({
      data: { userId, type: "credit", source, amountPaise, balanceAfterPaise, referenceId },
    });
  },
};

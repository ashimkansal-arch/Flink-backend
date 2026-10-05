import { userRepository } from "../repositories/user-repository";
import { referralRepository } from "../repositories/referral-repository";

export const referralService = {
  async getReferralSummary(userId: string) {
    const [user, referrals] = await Promise.all([userRepository.findById(userId), referralRepository.listByReferrer(userId)]);
    if (!user) throw new Error("USER_NOT_FOUND");
    return { referralCode: user.referralCode, referrals };
  },
};

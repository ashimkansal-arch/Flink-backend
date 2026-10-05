import { userRepository } from "../repositories/user-repository";
import { toCustomerAddressDto } from "../lib/api-schemas";

export const customerService = {
  // Status checks run in requireAuth("customer") before this handler.
  async getProfile(userId: string) {
    const user = await userRepository.findProfileById(userId);
    if (!user) throw new Error("USER_NOT_FOUND");

    const { addresses, _count, ...profile } = user;
    const homeAddress = addresses[0] ? toCustomerAddressDto(addresses[0]) : null;

    return {
      ...profile,
      // BigInt is not JSON-serializable — expose paise as a decimal string.
      walletBalancePaise: user.walletBalancePaise.toString(),
      totalBookings: _count.bookings,
      homeAddress,
      isProfileComplete: Boolean(user.fullName?.trim()),
      hasHomeLocation: homeAddress != null,
      isHomeSetupComplete: user.homeProfile?.homeType != null && user.homeProfile?.homeSize != null,
    };
  },
};

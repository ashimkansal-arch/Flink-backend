import { addressRepository } from "../repositories/address-repository";
import { coverageZoneRepository } from "../repositories/coverage-zone-repository";
import { homeProfileRepository, type UpsertHomeProfileInput } from "../repositories/home-profile-repository";
import { userRepository } from "../repositories/user-repository";
import {
  normalizeConfirmLocationBody,
  toCustomerAddressDto,
  type ConfirmLocationBody,
} from "../lib/api-schemas";

export interface UpdateCustomerDetailsInput {
  fullName: string;
  email: string;
  gender: "male" | "female" | "other";
}

export const customerProfileService = {
  async listAddresses(customerId: string) {
    const rows = await addressRepository.findByUser(customerId);
    return rows.map(toCustomerAddressDto);
  },

  async confirmLocation(customerId: string, body: ConfirmLocationBody) {
    const input = normalizeConfirmLocationBody(body);
    const isServiceable = await coverageZoneRepository.isLocationServiceable(
      input.latitude,
      input.longitude,
    );
    const fields = { ...input, isServiceable };

    const address = body.addressId
      ? await addressRepository.updateOwned(body.addressId, customerId, fields)
      : await addressRepository.createForUser(customerId, fields);
    if (!address) throw new Error("ADDRESS_NOT_FOUND");

    return { address: toCustomerAddressDto(address), isServiceable };
  },

  async setDefaultAddress(customerId: string, addressId: string) {
    const address = await addressRepository.setDefault(customerId, addressId);
    if (!address) throw new Error("ADDRESS_NOT_FOUND");
    return toCustomerAddressDto(address);
  },

  async updateDetails(customerId: string, input: UpdateCustomerDetailsInput) {
    return userRepository.updateProfileDetails(customerId, {
      fullName: input.fullName.trim(),
      email: input.email.trim().toLowerCase(),
      gender: input.gender,
    });
  },

  async getHomeDetails(customerId: string) {
    return homeProfileRepository.findByUser(customerId);
  },

  async setHomeDetails(customerId: string, input: UpsertHomeProfileInput) {
    return homeProfileRepository.upsert(customerId, input);
  },
};

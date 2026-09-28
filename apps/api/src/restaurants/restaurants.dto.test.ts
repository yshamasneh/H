import assert from "node:assert/strict";
import { test } from "node:test";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { AdminCreateBusinessDto, RestaurantRegisterDto } from "./restaurants.dto";

const publicBody = {
  countryCode: "+970",
  phoneNumber: "0591234567",
  ownerFullName: "Restaurant Owner",
  password: "Owner@123",
  confirmPassword: "Owner@123",
  restaurantName: "Falafel House",
  addressLine: "Al-Manara Square, Ramallah"
};

async function errorsFor(body: Record<string, unknown>) {
  const dto = plainToInstance(RestaurantRegisterDto, body);
  return validate(dto, { whitelist: true, forbidNonWhitelisted: true });
}

test("public registration accepts a body with no business type", async () => {
  assert.equal((await errorsFor(publicBody)).length, 0);
});

test("public registration still accepts RESTAURANT, which older app builds send", async () => {
  assert.equal((await errorsFor({ ...publicBody, businessType: "RESTAURANT" })).length, 0);
});

test("public registration rejects SUPERMARKET, in any casing or shape", async () => {
  for (const businessType of ["SUPERMARKET", "supermarket", "Supermarket", " SUPERMARKET", ["SUPERMARKET"], { $ne: "RESTAURANT" }, 1, null]) {
    const errors = await errorsFor({ ...publicBody, businessType });
    // null counts as absent for @IsOptional(); everything else has to fail validation.
    if (businessType === null) continue;
    assert.ok(
      errors.some((error) => error.property === "businessType"),
      `businessType ${JSON.stringify(businessType)} must be rejected`
    );
  }
});

test("public registration cannot smuggle in fields that would elevate the account", async () => {
  for (const extra of [{ role: "ADMIN" }, { status: "APPROVED" }, { approveImmediately: true }, { isOpen: true }, { ownerUserId: "x" }]) {
    const errors = await errorsFor({ ...publicBody, ...extra });
    assert.ok(errors.length > 0, `${Object.keys(extra)[0]} must be rejected`);
  }
});

test("the admin creation DTO is where a SUPERMARKET can be requested", async () => {
  const dto = plainToInstance(AdminCreateBusinessDto, {
    countryCode: "+970",
    phoneNumber: "0591234567",
    ownerFullName: "Owner",
    password: "Owner@1234",
    businessName: "JOVO MARKET",
    addressLine: "Ramallah",
    businessType: "SUPERMARKET"
  });
  assert.equal((await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).length, 0);
});

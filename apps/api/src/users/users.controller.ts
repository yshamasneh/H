import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../auth/jwt-auth.guard";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CreateAddressDto, DeletePushTokenDto, RegisterPushTokenDto, UpdateAddressDto, UpdateMyProfileDto } from "./users.dto";
import { UsersService } from "./users.service";

@ApiTags("my-account")
@ApiBearerAuth()
@Controller("users/me")
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  profile(@Req() request: AuthenticatedRequest) {
    return this.users.getProfile(request.user.id);
  }

  @Patch()
  updateProfile(@Req() request: AuthenticatedRequest, @Body() input: UpdateMyProfileDto) {
    return this.users.updateProfile(request.user.id, input);
  }

  @Delete()
  @HttpCode(204)
  @ApiOperation({ summary: "Deactivate and anonymize the authenticated customer account" })
  deleteAccount(@Req() request: AuthenticatedRequest) {
    return this.users.deleteMyAccount(request.user.id);
  }

  @Get("addresses")
  addresses(@Req() request: AuthenticatedRequest) {
    return this.users.listAddresses(request.user.id);
  }

  @Post("addresses")
  createAddress(@Req() request: AuthenticatedRequest, @Body() input: CreateAddressDto) {
    return this.users.createAddress(request.user.id, input);
  }

  @Patch("addresses/:addressId")
  updateAddress(
    @Req() request: AuthenticatedRequest,
    @Param("addressId", new ParseUUIDPipe()) addressId: string,
    @Body() input: UpdateAddressDto
  ) {
    return this.users.updateAddress(request.user.id, addressId, input);
  }

  @Delete("addresses/:addressId")
  @HttpCode(204)
  deleteAddress(
    @Req() request: AuthenticatedRequest,
    @Param("addressId", new ParseUUIDPipe()) addressId: string
  ) {
    return this.users.deleteAddress(request.user.id, addressId);
  }

  @Post("push-tokens")
  registerPush(@Req() request: AuthenticatedRequest, @Body() input: RegisterPushTokenDto) {
    return this.users.registerPushToken(request.user.id, input);
  }

  @Delete("push-tokens")
  @HttpCode(204)
  unregisterPush(@Req() request: AuthenticatedRequest, @Body() input: DeletePushTokenDto) {
    return this.users.unregisterPushToken(request.user.id, input.token);
  }
}

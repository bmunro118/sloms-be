import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  ParseIntPipe,
  Query,
  HttpCode,
  HttpStatus,
  Request,
  UseGuards,
} from "@nestjs/common";
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiQuery,
  ApiBody,
} from "@nestjs/swagger";
import { PagingDto } from "../common/paging";
import { IsString, IsNotEmpty, MinLength, MaxLength } from "class-validator";
import { UsersService, AuditEvent } from "./users.service";
import { CreateUserDto } from "./dto/create-user.dto";
import { UpdateUserDto } from "./dto/update-user.dto";
import { ChangePasswordDto } from "./dto/change-password.dto";
import { FindAuditLogQueryDto } from "./dto/find-audit-log-query.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { Role } from "./entities/role.enum";

class ResetPasswordDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @MaxLength(100)
  newPassword: string;
}

@ApiTags("users")
@ApiBearerAuth("access-token")
@Controller("users")
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // ─── Self-service (any authenticated user) ────────────────────────────────
  // IMPORTANT: these static routes must be declared BEFORE /:id routes,
  // otherwise NestJS will match "me" as the :id param.

  /**
   * GET /users/me
   * Returns the currently authenticated user's profile.
   */
  @Get("me")
  @Roles(Role.Admin, Role.Manager, Role.Operative, Role.ReadOnly, Role.Customer)
  @ApiOperation({
    summary: "Get own profile",
    description:
      "Returns the currently authenticated user's profile (passwordHash excluded). Available to all authenticated users.",
  })
  @ApiOkResponse({ description: "The authenticated user's profile object." })
  getProfile(@Request() req: any) {
    return this.usersService.findOne(req.user.userId);
  }

  /**
   * PATCH /users/me/password
   * Allows the currently authenticated user to change their own password.
   * Requires the current password to be supplied for verification.
   */
  @Patch("me/password")
  @HttpCode(HttpStatus.OK)
  @Roles(Role.Admin, Role.Manager, Role.Operative, Role.ReadOnly, Role.Customer)
  @ApiOperation({
    summary: "Change own password",
    description:
      "Changes the authenticated user's password. Requires the current password for verification.",
  })
  @ApiBody({
    type: ChangePasswordDto,
    examples: {
      example: {
        summary: "Change password",
        value: {
          currentPassword: "OldPassword1!",
          newPassword: "NewPassword1!",
        },
      },
    },
  })
  @ApiOkResponse({ description: "Returns a confirmation message on success." })
  changePassword(@Request() req: any, @Body() dto: ChangePasswordDto) {
    return this.usersService.changePassword(req.user.userId, dto);
  }

  // ─── User Management (Admin only) ─────────────────────────────────────────

  /**
   * GET /users/audit-log
   * Returns paginated user audit log entries. Admin only.
   * Optional filters: userId, event
   */
  @Get("audit-log")
  @Roles(Role.Admin)
  @ApiOperation({
    summary: "Get user audit log",
    description:
      "Returns paginated audit trail entries for user authentication events. Admin only.",
  })
  @ApiQuery({ name: "userId", required: false, type: Number, description: "Filter by user ID" })
  @ApiQuery({ name: "event", required: false, type: String, description: "Filter by event type (LOGIN_SUCCESS, LOGIN_FAILURE, LOGIN_LOCKED, ACCOUNT_LOCKED, ACCOUNT_UNLOCKED)" })
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiQuery({ name: "limit", required: false, type: Number })
  @ApiOkResponse({ description: "Paged audit log entries." })
  getAuditLog(@Query() query: FindAuditLogQueryDto) {
    const parsedUserId =
      query.userId !== undefined ? parseInt(query.userId, 10) : undefined;
    return this.usersService.getAuditLog(query, parsedUserId, query.event);
  }

  /**
   * GET /users
   * GET /users?includeInactive=true
   * Returns all users (without passwordHash). Admin only.
   */
  @Get()
  @Roles(Role.Admin)
  @ApiOperation({
    summary: "List all users",
    description:
      "Returns all user records (passwordHash excluded). Admin only.",
  })
  @ApiQuery({
    name: "includeInactive",
    required: false,
    type: Boolean,
    description: "Set to true to include deactivated accounts.",
  })
  @ApiQuery({
    name: "page",
    required: false,
    type: Number,
    description: "Page number (1-based, default 1)",
  })
  @ApiQuery({
    name: "limit",
    required: false,
    type: Number,
    description: "Records per page (default 25, max 100)",
  })
  @ApiOkResponse({ description: "Paged result containing user objects." })
  findAll(
    @Query("includeInactive") includeInactive?: string,
    @Query() paging?: PagingDto,
  ) {
    return this.usersService.findAll(includeInactive === "true", paging);
  }

  /**
   * GET /users/:id
   * Returns a single user (without passwordHash). Admin only.
   */
  @Get(":id")
  @Roles(Role.Admin)
  @ApiOperation({
    summary: "Get a user by ID",
    description:
      "Returns a single user record (passwordHash excluded). Admin only.",
  })
  @ApiOkResponse({ description: "The requested user object." })
  findOne(@Param("id", ParseIntPipe) id: number) {
    return this.usersService.findOne(id);
  }

  /**
   * POST /users
   * Creates a new user. Admin only.
   * The authenticated user's username is recorded as createdBy.
   */
  @Post()
  @Roles(Role.Admin)
  @ApiOperation({
    summary: "Create a new user",
    description:
      "Creates a new user account with a hashed password. Admin only.",
  })
  @ApiBody({
    type: CreateUserDto,
    examples: {
      staff: {
        summary: "Staff user (Operative)",
        value: {
          username: "jsmith",
          password: "Password1!",
          fullName: "John Smith",
          email: "jsmith@example.com",
          role: "Operative",
        },
      },
      manager: {
        summary: "Manager user",
        value: {
          username: "sarahm",
          password: "Password1!",
          fullName: "Sarah Mills",
          email: "sarahm@example.com",
          role: "Manager",
        },
      },
      readOnly: {
        summary: "Read-only user",
        value: {
          username: "viewer01",
          password: "Password1!",
          fullName: "View Only",
          email: "viewer@example.com",
          role: "ReadOnly",
        },
      },
      customer: {
        summary: "Customer portal user",
        value: {
          username: "cust_acme",
          password: "Password1!",
          fullName: "ACME Contact",
          email: "contact@acme.com",
          role: "Customer",
          linkedCustomerId: 42,
        },
      },
    },
  })
  @ApiCreatedResponse({ description: "The newly created user object." })
  create(@Body() dto: CreateUserDto, @Request() req: any) {
    return this.usersService.create(dto, req.user?.username);
  }

  /**
   * PUT /users/:id
   * Full update of a user record (username, role, active flag, etc.). Admin only.
   */
  @Put(":id")
  @Roles(Role.Admin)
  @ApiOperation({
    summary: "Update a user",
    description:
      "Updates username, role, email, full name, active flag, or password. Admin only.",
  })
  @ApiBody({
    type: UpdateUserDto,
    examples: {
      updateRole: {
        summary: "Promote to Manager",
        value: {
          role: "Manager",
        },
      },
      updateEmail: {
        summary: "Update email address",
        value: {
          email: "newemail@example.com",
        },
      },
      updateCustomerLink: {
        summary: "Link a customer user to a different customer account",
        value: {
          linkedCustomerId: 99,
        },
      },
      deactivate: {
        summary: "Deactivate account inline",
        value: {
          isActive: false,
        },
      },
    },
  })
  @ApiOkResponse({ description: "The updated user object." })
  update(@Param("id", ParseIntPipe) id: number, @Body() dto: UpdateUserDto) {
    return this.usersService.update(id, dto);
  }

  /**
   * DELETE /users/:id
   * Permanently deletes a user account. Admin only.
   * Cannot delete your own account.
   */
  @Delete(":id")
  @HttpCode(HttpStatus.OK)
  @Roles(Role.Admin)
  @ApiOperation({
    summary: "Delete a user",
    description:
      "Permanently deletes a user account. Admin only. You cannot delete your own account.",
  })
  @ApiOkResponse({ description: "Returns a confirmation message on success." })
  remove(@Param("id", ParseIntPipe) id: number, @Request() req: any) {
    return this.usersService.remove(id, req.user.userId);
  }

  /**
   * PATCH /users/:id/deactivate
   * Soft-disables a user account. Admin only.
   */
  @Patch(":id/deactivate")
  @HttpCode(HttpStatus.OK)
  @Roles(Role.Admin)
  @ApiOperation({
    summary: "Deactivate a user",
    description:
      "Soft-disables the user account (isActive = false). Admin only.",
  })
  @ApiOkResponse({ description: "The deactivated user object." })
  deactivate(@Param("id", ParseIntPipe) id: number) {
    return this.usersService.deactivate(id);
  }

  /**
   * PATCH /users/:id/reactivate
   * Re-enables a previously deactivated user. Admin only.
   */
  @Patch(":id/reactivate")
  @HttpCode(HttpStatus.OK)
  @Roles(Role.Admin)
  @ApiOperation({
    summary: "Reactivate a user",
    description:
      "Re-enables a previously deactivated user account (isActive = true). Admin only.",
  })
  @ApiOkResponse({ description: "The reactivated user object." })
  reactivate(@Param("id", ParseIntPipe) id: number) {
    return this.usersService.reactivate(id);
  }

  /**
   * PATCH /users/:id/unlock
   * Clears any active lockout and resets the failed login counter. Admin only.
   */
  @Patch(":id/unlock")
  @HttpCode(HttpStatus.OK)
  @Roles(Role.Admin)
  @ApiOperation({
    summary: "Unlock a user account",
    description:
      "Clears any active login lockout and resets the failed login counter. Admin only.",
  })
  @ApiOkResponse({ description: "The unlocked user object." })
  async unlockAccount(@Param("id", ParseIntPipe) id: number, @Request() req: any) {
    const user = await this.usersService.unlockAccount(id);
    // Fire-and-forget audit entry
    this.usersService
      .writeAuditLog(
        user.username,
        AuditEvent.ACCOUNT_UNLOCKED,
        `Manually unlocked by ${req.user?.username}`,
        id,
      )
      .catch(() => {});
    return user;
  }

  /**
   * PATCH /users/:id/reset-password
   * Admin sets a new password for any user without needing the current password.
   */
  @Patch(":id/reset-password")
  @HttpCode(HttpStatus.OK)
  @Roles(Role.Admin)
  @ApiOperation({
    summary: "Reset a user's password",
    description:
      "Allows an Admin to set a new password for any user without requiring the current password.",
  })
  @ApiBody({
    type: ResetPasswordDto,
    examples: {
      example: {
        summary: "Reset to a new password",
        value: {
          newPassword: "NewPassword1!",
        },
      },
    },
  })
  @ApiOkResponse({ description: "Returns a confirmation message on success." })
  resetPassword(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: ResetPasswordDto,
  ) {
    return this.usersService.resetPassword(id, dto.newPassword);
  }
}

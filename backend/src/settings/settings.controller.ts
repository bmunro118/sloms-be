import {
  Controller,
  Get,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
  ApiNoContentResponse,
  ApiQuery,
  ApiBody,
} from "@nestjs/swagger";
import { PagingDto } from "../common/paging";
import { SettingsService } from "./settings.service";
import { UpdateSettingDto } from "./dto/update-setting.dto";
import { UpsertUserSettingDto } from "./dto/upsert-user-setting.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { Role } from "../users/entities/role.enum";
import {
  CurrentUser,
  CurrentUserPayload,
} from "../auth/decorators/current-user.decorator";

@ApiTags("settings")
@ApiBearerAuth("access-token")
@Controller("settings")
@UseGuards(JwtAuthGuard, RolesGuard)
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  /**
   * GET /settings
   * GET /settings?includeHidden=true
   */
  @Get()
  @Roles(Role.ReadOnly, Role.Operative, Role.Manager, Role.Admin)
  @ApiOperation({ summary: "List all settings" })
  @ApiQuery({ name: "includeHidden", required: false, type: Boolean })
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
  @ApiOkResponse({ description: "Paged result containing setting objects." })
  findAll(
    @Query("includeHidden") includeHidden?: string,
    @Query() paging?: PagingDto,
  ) {
    return this.settingsService.findAll(includeHidden === "true", paging);
  }

  // ─── User Settings ───────────────────────────────────────────────────────────
  // NOTE: these static `user` / `user/:key` routes MUST be declared BEFORE the
  // dynamic `:key` routes below. NestJS/Express match in declaration order, so a
  // `:key` handler placed first would swallow `GET /settings/user` (matching it
  // as key="user") and 403 the Customer role.

  /**
   * GET /settings/user
   * Returns all settings for the current user
   */
  @Get("user")
  @Roles(Role.ReadOnly, Role.Operative, Role.Manager, Role.Admin, Role.Customer)
  @ApiOperation({ summary: "Get all settings for the current user" })
  @ApiOkResponse({ description: "Array of user setting objects." })
  findUserSettings(@CurrentUser() user: CurrentUserPayload) {
    return this.settingsService.findUserSettings(user.userId);
  }

  /**
   * GET /settings/user/:key
   */
  @Get("user/:key")
  @Roles(Role.ReadOnly, Role.Operative, Role.Manager, Role.Admin, Role.Customer)
  @ApiOperation({ summary: "Get a specific setting for the current user" })
  @ApiOkResponse({ description: "The user setting object." })
  findUserSetting(
    @CurrentUser() user: CurrentUserPayload,
    @Param("key") key: string,
  ) {
    return this.settingsService.findUserSetting(user.userId, key);
  }

  /**
   * PUT /settings/user/:key
   * Upsert a setting for the current user
   */
  @Put("user/:key")
  @Roles(Role.ReadOnly, Role.Operative, Role.Manager, Role.Admin, Role.Customer)
  @ApiOperation({ summary: "Set a setting for the current user" })
  @ApiBody({ type: UpsertUserSettingDto })
  @ApiOkResponse({ description: "The updated user setting object." })
  upsertUserSetting(
    @CurrentUser() user: CurrentUserPayload,
    @Param("key") key: string,
    @Body() dto: UpsertUserSettingDto,
  ) {
    return this.settingsService.upsertUserSetting(user.userId, key, dto);
  }

  /**
   * DELETE /settings/user/:key
   */
  @Delete("user/:key")
  @Roles(Role.ReadOnly, Role.Operative, Role.Manager, Role.Admin, Role.Customer)
  @ApiOperation({ summary: "Delete a setting for the current user" })
  @ApiNoContentResponse({ description: "Setting deleted." })
  deleteUserSetting(
    @CurrentUser() user: CurrentUserPayload,
    @Param("key") key: string,
  ) {
    return this.settingsService.deleteUserSetting(user.userId, key);
  }

  /**
   * GET /settings/:key
   */
  @Get(":key")
  @Roles(Role.ReadOnly, Role.Operative, Role.Manager, Role.Admin)
  @ApiOperation({ summary: "Get a setting by key" })
  @ApiOkResponse({ description: "The requested setting object." })
  findOne(@Param("key") key: string) {
    return this.settingsService.findOne(key);
  }

  /**
   * GET /settings/:key/value
   * Returns just the raw value string for a setting key
   */
  @Get(":key/value")
  @Roles(Role.ReadOnly, Role.Operative, Role.Manager, Role.Admin)
  @ApiOperation({ summary: "Get the raw value of a setting" })
  @ApiOkResponse({ description: "The raw value string for the setting." })
  getValue(@Param("key") key: string) {
    return this.settingsService.getValue(key);
  }

  /**
   * PUT /settings/:key
   * Full update of a setting record
   */
  @Put(":key")
  @Roles(Role.Admin)
  @ApiOperation({ summary: "Update a setting" })
  @ApiBody({
    type: UpdateSettingDto,
    examples: {
      updateValue: {
        summary: "Update the value only",
        value: {
          val: "noreply@sloms.com",
        },
      },
      updateFull: {
        summary: "Full update with all fields",
        value: {
          val: "noreply@sloms.com",
          description: "Default sender address for outgoing emails",
          exposed: true,
        },
      },
      hideFromFrontend: {
        summary: "Hide a setting from the frontend",
        value: {
          exposed: false,
        },
      },
    },
  })
  @ApiOkResponse({ description: "The updated setting object." })
  update(@Param("key") key: string, @Body() dto: UpdateSettingDto) {
    return this.settingsService.update(key, dto);
  }

  /**
   * PATCH /settings/:key/value
   * Quickly set just the value of a setting
   */
  @Patch(":key/value")
  @Roles(Role.Admin)
  @ApiOperation({ summary: "Set the value of a setting" })
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        val: {
          type: "string",
          description: "The new value to set for the setting",
        },
      },
      required: ["val"],
    },
    examples: {
      emailAddress: {
        summary: "Set an email address value",
        value: { val: "noreply@sloms.com" },
      },
      numericValue: {
        summary: "Set a numeric string value",
        value: { val: "30" },
      },
      flagValue: {
        summary: "Set a boolean flag value",
        value: { val: "true" },
      },
    },
  })
  @ApiOkResponse({ description: "The updated setting object." })
  setValue(@Param("key") key: string, @Body("val") val: string) {
    return this.settingsService.setValue(key, val);
  }
}

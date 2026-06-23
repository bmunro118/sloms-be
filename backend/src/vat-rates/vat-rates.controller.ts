import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  ParseIntPipe,
  UseGuards,
} from "@nestjs/common";
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiBody,
} from "@nestjs/swagger";
import { VatRatesService } from "./vat-rates.service";
import { CreateVatRateDto } from "./dto/create-vat-rate.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { Role } from "../users/entities/role.enum";

@ApiTags("vat-rates")
@ApiBearerAuth("access-token")
@Controller("vat-rates")
@UseGuards(JwtAuthGuard, RolesGuard)
export class VatRatesController {
  constructor(private readonly vatRatesService: VatRatesService) {}

  /**
   * GET /vat-rates
   */
  @Get()
  @Roles(Role.ReadOnly, Role.Operative, Role.Manager, Role.Admin)
  @ApiOperation({ summary: "List all VAT rates (most recent first)" })
  @ApiOkResponse({ description: "Array of VAT rate objects." })
  findAll() {
    return this.vatRatesService.findAll();
  }

  /**
   * GET /vat-rates/current
   */
  @Get("current")
  @Roles(Role.ReadOnly, Role.Operative, Role.Manager, Role.Admin)
  @ApiOperation({ summary: "Get the currently active VAT rate" })
  @ApiOkResponse({ description: "The currently active VAT rate." })
  findCurrent() {
    return this.vatRatesService.findCurrent();
  }

  /**
   * POST /vat-rates
   */
  @Post()
  @Roles(Role.Admin)
  @ApiOperation({ summary: "Create a new VAT rate" })
  @ApiBody({
    type: CreateVatRateDto,
    examples: {
      standard: {
        summary: "Standard UK rate",
        value: {
          rate: 20,
          label: "Standard UK",
          validFrom: "2011-01-04",
        },
      },
    },
  })
  @ApiCreatedResponse({ description: "The newly created VAT rate." })
  create(@Body() dto: CreateVatRateDto) {
    return this.vatRatesService.create(dto);
  }

  /**
   * PATCH /vat-rates/:id/close
   * Set validTo on a rate to mark it as no longer active
   */
  @Patch(":id/close")
  @Roles(Role.Admin)
  @ApiOperation({ summary: "Close a VAT rate by setting its end date" })
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        validTo: { type: "string", format: "date", example: "2025-12-31" },
      },
      required: ["validTo"],
    },
  })
  @ApiOkResponse({ description: "The closed VAT rate." })
  close(
    @Param("id", ParseIntPipe) id: number,
    @Body("validTo") validTo: string,
  ) {
    return this.vatRatesService.close(id, validTo);
  }
}

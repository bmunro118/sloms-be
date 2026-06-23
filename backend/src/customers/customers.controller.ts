import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Patch,
  Body,
  Param,
  ParseIntPipe,
  Query,
  HttpCode,
  HttpStatus,
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
import { CustomersService } from "./customers.service";
import { CreateCustomerDto } from "./dto/create-customer.dto";
import { UpdateCustomerDto } from "./dto/update-customer.dto";
import { CreateCustomerAddressDto } from "./dto/create-customer-address.dto";
import { UpdateCustomerAddressDto } from "./dto/update-customer-address.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { Role } from "../users/entities/role.enum";

@ApiTags("customers")
@ApiBearerAuth("access-token")
@Controller("customers")
@UseGuards(JwtAuthGuard, RolesGuard)
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  // ─── Customers ────────────────────────────────────────────────────────────

  /**
   * GET /customers
   * GET /customers?includeSuspended=true
   */
  @Get()
  @Roles(Role.ReadOnly, Role.Operative, Role.Manager, Role.Admin)
  @ApiOperation({ summary: "List all customers" })
  @ApiQuery({ name: "includeSuspended", required: false, type: Boolean })
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
  @ApiOkResponse({ description: "Paged result containing customer objects." })
  findAll(
    @Query("includeSuspended") includeSuspended?: string,
    @Query() paging?: PagingDto,
  ) {
    return this.customersService.findAll(includeSuspended === "true", paging);
  }

  /**
   * GET /customers/:id
   */
  @Get(":id")
  @Roles(Role.ReadOnly, Role.Operative, Role.Manager, Role.Admin)
  @ApiOperation({ summary: "Get a customer by ID" })
  @ApiOkResponse({ description: "The requested customer object." })
  findOne(@Param("id", ParseIntPipe) id: number) {
    return this.customersService.findOne(id);
  }

  /**
   * POST /customers
   */
  @Post()
  @Roles(Role.Operative, Role.Manager, Role.Admin)
  @ApiOperation({ summary: "Create a new customer" })
  @ApiBody({
    type: CreateCustomerDto,
    examples: {
      minimal: {
        summary: "Minimal — company name only",
        value: {
          companyName: "Acme Hearing Ltd",
        },
      },
      full: {
        summary: "Full customer record",
        value: {
          accountNumber: "ACC-001",
          centreNumber: "C001",
          companyName: "Acme Hearing Ltd",
          invBuildingName: "Acme House",
          invAddressLn1: "12 High Street",
          invAddressLn2: "Deansgate",
          invTownOrCity: "Manchester",
          invCounty: "Greater Manchester",
          invPostCode: "M1 1AA",
          contactName: "Jane Doe",
          contactEmail: "jane.doe@acme.com",
          reportEmail: "reports@acme.com",
          contactPhone: "0161 000 0000",
          contactMobile: "07700 900000",
          contactFax: "0161 000 0001",
          band: "NHS1",
        },
      },
    },
  })
  @ApiCreatedResponse({ description: "The newly created customer object." })
  create(@Body() dto: CreateCustomerDto) {
    return this.customersService.create(dto);
  }

  /**
   * PUT /customers/:id
   */
  @Put(":id")
  @Roles(Role.Operative, Role.Manager, Role.Admin)
  @ApiOperation({ summary: "Update a customer" })
  @ApiBody({
    type: UpdateCustomerDto,
    examples: {
      updateContact: {
        summary: "Update contact details",
        value: {
          contactName: "John Smith",
          contactEmail: "john.smith@acme.com",
          contactPhone: "0161 111 2222",
        },
      },
      updateAddress: {
        summary: "Update invoice address",
        value: {
          invAddressLn1: "99 New Street",
          invTownOrCity: "Birmingham",
          invPostCode: "B1 1BB",
        },
      },
      updateBand: {
        summary: "Change price band",
        value: {
          band: "NHS2",
        },
      },
    },
  })
  @ApiOkResponse({ description: "The updated customer object." })
  update(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: UpdateCustomerDto,
  ) {
    return this.customersService.update(id, dto);
  }

  /**
   * PATCH /customers/:id/suspend
   */
  @Patch(":id/suspend")
  @Roles(Role.Manager, Role.Admin)
  @ApiOperation({ summary: "Suspend a customer" })
  @ApiOkResponse({ description: "The suspended customer object." })
  suspend(@Param("id", ParseIntPipe) id: number) {
    return this.customersService.suspend(id);
  }

  /**
   * PATCH /customers/:id/reinstate
   */
  @Patch(":id/reinstate")
  @Roles(Role.Manager, Role.Admin)
  @ApiOperation({ summary: "Reinstate a suspended customer" })
  @ApiOkResponse({ description: "The reinstated customer object." })
  reinstate(@Param("id", ParseIntPipe) id: number) {
    return this.customersService.reinstate(id);
  }

  // ─── Addresses ────────────────────────────────────────────────────────────

  /**
   * GET /customers/:customerId/addresses
   */
  @Get(":customerId/addresses")
  @Roles(Role.ReadOnly, Role.Operative, Role.Manager, Role.Admin)
  @ApiOperation({ summary: "List all addresses for a customer" })
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
  @ApiOkResponse({ description: "Paged result containing address objects." })
  findAllAddresses(
    @Param("customerId", ParseIntPipe) customerId: number,
    @Query() paging?: PagingDto,
  ) {
    return this.customersService.findAllAddresses(customerId, paging);
  }

  /**
   * GET /customers/:customerId/addresses/:addressId
   */
  @Get(":customerId/addresses/:addressId")
  @Roles(Role.ReadOnly, Role.Operative, Role.Manager, Role.Admin)
  @ApiOperation({ summary: "Get a specific address for a customer" })
  @ApiOkResponse({ description: "The requested address object." })
  findOneAddress(
    @Param("customerId", ParseIntPipe) customerId: number,
    @Param("addressId", ParseIntPipe) addressId: number,
  ) {
    return this.customersService.findOneAddress(customerId, addressId);
  }

  /**
   * POST /customers/:customerId/addresses
   */
  @Post(":customerId/addresses")
  @Roles(Role.Operative, Role.Manager, Role.Admin)
  @ApiOperation({ summary: "Add an address to a customer" })
  @ApiBody({
    type: CreateCustomerAddressDto,
    examples: {
      minimal: {
        summary: "Minimal delivery address",
        value: {
          delAddressLn1: "5 Warehouse Road",
          delTownOrCity: "Leeds",
          delPostCode: "LS1 1AA",
          defaultAddress: false,
        },
      },
      full: {
        summary: "Full site address",
        value: {
          siteCompanyName: "Acme North Site",
          delBuildingName: "Block B",
          delAddressLn1: "5 Warehouse Road",
          delAddressLn2: "Holbeck",
          delTownOrCity: "Leeds",
          delCounty: "West Yorkshire",
          delPostCode: "LS1 1AA",
          siteContactName: "Bob Jones",
          siteContactEmail: "bob.jones@acme.com",
          siteContactPhone: "0113 000 0000",
          siteContactMobile: "07700 900001",
          defaultAddress: true,
        },
      },
    },
  })
  @ApiCreatedResponse({ description: "The newly created address object." })
  createAddress(
    @Param("customerId", ParseIntPipe) customerId: number,
    @Body() dto: CreateCustomerAddressDto,
  ) {
    return this.customersService.createAddress(customerId, dto);
  }

  /**
   * PUT /customers/:customerId/addresses/:addressId
   */
  @Put(":customerId/addresses/:addressId")
  @Roles(Role.Operative, Role.Manager, Role.Admin)
  @ApiOperation({ summary: "Update a customer address" })
  @ApiBody({
    type: UpdateCustomerAddressDto,
    examples: {
      updatePostcode: {
        summary: "Correct the postcode",
        value: {
          delPostCode: "LS2 2BB",
        },
      },
      updateContact: {
        summary: "Update site contact",
        value: {
          siteContactName: "Alice Brown",
          siteContactEmail: "alice.brown@acme.com",
          siteContactPhone: "0113 111 2222",
        },
      },
    },
  })
  @ApiOkResponse({ description: "The updated address object." })
  updateAddress(
    @Param("customerId", ParseIntPipe) customerId: number,
    @Param("addressId", ParseIntPipe) addressId: number,
    @Body() dto: UpdateCustomerAddressDto,
  ) {
    return this.customersService.updateAddress(customerId, addressId, dto);
  }

  /**
   * DELETE /customers/:customerId/addresses/:addressId
   * Soft-deletes (sets Void = true)
   */
  @Delete(":customerId/addresses/:addressId")
  @HttpCode(HttpStatus.OK)
  @Roles(Role.Manager, Role.Admin)
  @ApiOperation({ summary: "Soft-delete a customer address" })
  @ApiOkResponse({ description: "The voided address object." })
  removeAddress(
    @Param("customerId", ParseIntPipe) customerId: number,
    @Param("addressId", ParseIntPipe) addressId: number,
  ) {
    return this.customersService.removeAddress(customerId, addressId);
  }

  /**
   * PATCH /customers/:customerId/addresses/:addressId/set-default
   */
  @Patch(":customerId/addresses/:addressId/set-default")
  @Roles(Role.Operative, Role.Manager, Role.Admin)
  @ApiOperation({ summary: "Set an address as the default for a customer" })
  @ApiOkResponse({ description: "The updated default address object." })
  setDefaultAddress(
    @Param("customerId", ParseIntPipe) customerId: number,
    @Param("addressId", ParseIntPipe) addressId: number,
  ) {
    return this.customersService.setDefaultAddress(customerId, addressId);
  }
}

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
  Res,
  HttpCode,
  HttpStatus,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { Response } from 'express';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiProduces,
  ApiQuery,
  ApiBody,
} from '@nestjs/swagger';
import { PagingDto, PagedResult } from '../common/paging';
import { Order } from './entities/order.entity';
import { OrdersService } from './orders.service';
import { OrderBreakdownService } from '../order-breakdown/order-breakdown.service';
import { FindOrdersQueryDto } from './dto/find-orders-query.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { CreateOrderedItemDto } from './dto/create-ordered-item.dto';
import { UpdateOrderedItemDto } from './dto/update-ordered-item.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../users/entities/role.enum';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../auth/decorators/current-user.decorator';

function toCustomerView(order: Order) {
  return {
    orderNumber: order.orderNumber,
    orderBatch: order.orderBatch,
    customerRef: order.customerRef,
    orderContact: order.orderContact,
    receivedOn: order.receivedOn,
    dispatchedOn: order.dispatchedOn,
    status: order.status,
    statusChangedOn: order.statusChangedOn,
    itemCount: order.itemCount,
  };
}

@ApiTags('orders')
@ApiBearerAuth('access-token')
@Controller('orders')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly orderBreakdownService: OrderBreakdownService,
  ) {}

  // ─── Orders ───────────────────────────────────────────────────────────────

  /**
   * GET /orders
   * GET /orders?includeVoided=true
   * GET /orders?customerId=123
   */
  @Get()
  @Roles(Role.ReadOnly, Role.Operative, Role.Manager, Role.Admin, Role.Customer)
  @ApiOperation({
    summary: 'List all orders',
    description:
      'Staff roles can filter by customerId. Customer role users automatically see only their own orders.',
  })
  @ApiQuery({ name: 'includeVoided', required: false, type: Boolean })
  @ApiQuery({ name: 'customerId', required: false, type: Number })
  @ApiQuery({
    name: 'status',
    required: false,
    type: String,
    description:
      'Filter by order status: Received, InProduction, Ready, Dispatched, Voided',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number (1-based, default 1)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Records per page (default 25, max 100)',
  })
  @ApiOkResponse({ description: 'Paged result containing order objects.' })
  async findAll(
    @CurrentUser() user: CurrentUserPayload,
    @Query() query: FindOrdersQueryDto,
  ) {
    const { includeVoided, customerId, status } = query;
    const paging = query;
    // Customer role: always scope to their linked customer — ignore any customerId query param
    if (user.role === Role.Customer) {
      if (!user.linkedCustomerId) {
        throw new ForbiddenException(
          'Your account is not linked to a customer',
        );
      }
      const result = await this.ordersService.findByCustomer(
        user.linkedCustomerId,
        includeVoided === 'true',
        paging,
        status,
      );
      return new PagedResult(
        result.data.map(toCustomerView),
        result.total,
        paging,
      );
    }

    if (customerId) {
      return this.ordersService.findByCustomer(
        parseInt(customerId, 10),
        includeVoided === 'true',
        paging,
        status,
      );
    }
    return this.ordersService.findAll(includeVoided === 'true', paging, status);
  }

  /**
   * GET /orders/items/:serialNumber
   * Lookup a single item by serial number alone — no order context required.
   *
   * IMPORTANT: declared BEFORE the `:orderNumber/:orderBatch` routes so NestJS
   * does not match "items" as an :orderNumber value (ParseIntPipe would 400).
   */
  @Get('items/:serialNumber')
  @Roles(Role.ReadOnly, Role.Operative, Role.Manager, Role.Admin, Role.Customer)
  @ApiOperation({
    summary: 'Get an ordered item by serial number',
    description:
      'Looks up a single item by its serial number without needing to know the order number. ' +
      'Customer role users can only view items belonging to their linked customer account.',
  })
  @ApiOkResponse({ description: 'The requested ordered item object.' })
  async findItem(
    @CurrentUser() user: CurrentUserPayload,
    @Param('serialNumber') serialNumber: string,
  ) {
    const item = await this.ordersService.findItem(serialNumber);

    if (user.role === Role.Customer) {
      const order = await this.ordersService.findOne(
        item.parentOrder,
        item.parentBatch,
      );
      if (order.customerAccount !== user.linkedCustomerId) {
        throw new ForbiddenException('You do not have access to this item');
      }
    }

    return item;
  }

  /**
   * GET /orders/:orderNumber/:orderBatch/tracking
   */
  @Get(':orderNumber/:orderBatch/tracking')
  @Roles(Role.ReadOnly, Role.Operative, Role.Manager, Role.Admin, Role.Customer)
  @ApiOperation({
    summary: 'Get order tracking',
    description:
      'Returns the status history and item-level progress for an order. ' +
      'Customer role users can only view their own orders.',
  })
  @ApiOkResponse({ description: 'Order tracking object.' })
  async getTracking(
    @CurrentUser() user: CurrentUserPayload,
    @Param('orderNumber', ParseIntPipe) orderNumber: number,
    @Param('orderBatch', ParseIntPipe) orderBatch: number,
  ) {
    const tracking = await this.ordersService.getTracking(
      orderNumber,
      orderBatch,
    );

    if (user.role === Role.Customer) {
      const order = await this.ordersService.findOne(orderNumber, orderBatch);
      if (order.customerAccount !== user.linkedCustomerId) {
        throw new ForbiddenException('You do not have access to this order');
      }
    }

    return tracking;
  }

  /**
   * GET /orders/:orderNumber/:orderBatch
   */
  @Get(':orderNumber/:orderBatch')
  @Roles(Role.ReadOnly, Role.Operative, Role.Manager, Role.Admin, Role.Customer)
  @ApiOperation({
    summary: 'Get a single order',
    description:
      'Customer role users can only view orders belonging to their linked customer account.',
  })
  @ApiOkResponse({ description: 'The requested order object.' })
  async findOne(
    @CurrentUser() user: CurrentUserPayload,
    @Param('orderNumber', ParseIntPipe) orderNumber: number,
    @Param('orderBatch', ParseIntPipe) orderBatch: number,
  ) {
    const order = await this.ordersService.findOne(orderNumber, orderBatch);

    if (
      user.role === Role.Customer &&
      order.customerAccount !== user.linkedCustomerId
    ) {
      throw new ForbiddenException('You do not have access to this order');
    }

    return user.role === Role.Customer ? toCustomerView(order) : order;
  }

  /**
   * POST /orders
   */
  @Post()
  @Roles(Role.Operative, Role.Manager, Role.Admin)
  @ApiOperation({
    summary: 'Create a new order',
    description:
      'The orderNumber is assigned automatically when omitted. Supply it only ' +
      'to add a new batch under an existing order.',
  })
  @ApiBody({
    type: CreateOrderDto,
    examples: {
      minimal: {
        summary: 'Minimal order (order number is auto-assigned)',
        value: {
          customerAccount: 42,
        },
      },
      full: {
        summary: 'Full order with an explicit number (e.g. an extra batch)',
        value: {
          orderNumber: 10001,
          orderBatch: 2,
          customerAccount: 42,
          customerRef: 'PO-2024-001',
          orderContact: 'Jane Doe',
          deliveryAddress: 7,
          receivedOn: '2024-06-01T09:00:00.000Z',
          priceBand: 'NHS1',
        },
      },
    },
  })
  @ApiCreatedResponse({ description: 'The newly created order object.' })
  create(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateOrderDto) {
    return this.ordersService.create(dto, user.username);
  }

  /**
   * PUT /orders/:orderNumber/:orderBatch
   */
  @Put(':orderNumber/:orderBatch')
  @Roles(Role.Operative, Role.Manager, Role.Admin)
  @ApiOperation({ summary: 'Update an order' })
  @ApiBody({
    type: UpdateOrderDto,
    examples: {
      updateContact: {
        summary: 'Update order contact and reference',
        value: {
          customerRef: 'PO-2024-002',
          orderContact: 'John Smith',
        },
      },
      updateDelivery: {
        summary: 'Change delivery address',
        value: {
          deliveryAddress: 12,
        },
      },
      updateBand: {
        summary: 'Change price band',
        value: {
          priceBand: 'NHS2',
        },
      },
    },
  })
  @ApiOkResponse({ description: 'The updated order object.' })
  update(
    @Param('orderNumber', ParseIntPipe) orderNumber: number,
    @Param('orderBatch', ParseIntPipe) orderBatch: number,
    @Body() dto: UpdateOrderDto,
  ) {
    return this.ordersService.update(orderNumber, orderBatch, dto);
  }

  /**
   * DELETE /orders/:orderNumber/:orderBatch
   * Soft-deletes (sets Void = true)
   */
  @Delete(':orderNumber/:orderBatch')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.Manager, Role.Admin)
  @ApiOperation({ summary: 'Void an order (soft-delete)' })
  @ApiOkResponse({ description: 'The voided order object.' })
  void(
    @CurrentUser() user: CurrentUserPayload,
    @Param('orderNumber', ParseIntPipe) orderNumber: number,
    @Param('orderBatch', ParseIntPipe) orderBatch: number,
  ) {
    return this.ordersService.void(orderNumber, orderBatch, user.username);
  }

  /**
   * PATCH /orders/:orderNumber/:orderBatch/dispatch
   */
  @Patch(':orderNumber/:orderBatch/dispatch')
  @Roles(Role.Operative, Role.Manager, Role.Admin)
  @ApiOperation({ summary: 'Mark an order as dispatched' })
  @ApiOkResponse({ description: 'The dispatched order object.' })
  dispatch(
    @Param('orderNumber', ParseIntPipe) orderNumber: number,
    @Param('orderBatch', ParseIntPipe) orderBatch: number,
  ) {
    return this.ordersService.dispatch(orderNumber, orderBatch);
  }

  // ─── Order Breakdown ──────────────────────────────────────────────────────

  /**
   * GET /orders/:orderNumber/:orderBatch/invoice
   * Generates and downloads a PDF invoice for the order.
   */
  @Get(':orderNumber/:orderBatch/breakdown')
  @Roles(Role.ReadOnly, Role.Operative, Role.Manager, Role.Admin, Role.Customer)
  @ApiOperation({ summary: 'Download a PDF order breakdown for an order' })
  @ApiProduces('application/pdf')
  @ApiOkResponse({ description: 'PDF file download.' })
  async downloadInvoice(
    @CurrentUser() user: CurrentUserPayload,
    @Param('orderNumber', ParseIntPipe) orderNumber: number,
    @Param('orderBatch', ParseIntPipe) orderBatch: number,
    @Res() res: Response,
  ) {
    if (user.role === Role.Customer) {
      const order = await this.ordersService.findOne(orderNumber, orderBatch);
      if (order.customerAccount !== user.linkedCustomerId) {
        throw new ForbiddenException('You do not have access to this order');
      }
    }

    const pdf = await this.orderBreakdownService.generateOrderBreakdown(
      orderNumber,
      orderBatch,
    );
    const filename = `SLI${String(orderNumber).padStart(6, '0')}-breakdown.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdf);
  }

  // ─── Ordered Items ────────────────────────────────────────────────────────
  //
  // Route structure:
  //   GET    /orders/items/:serialNumber                              — lookup by serial only (no order needed)
  //   GET    /orders/:orderNumber/:orderBatch/items                  — list all items on an order
  //   POST   /orders/:orderNumber/:orderBatch/items                  — add item to a specific order
  //   GET    /orders/:orderNumber/:orderBatch/items/:serialNumber     — get specific item on a specific order
  //   PUT    /orders/:orderNumber/:orderBatch/items/:serialNumber     — update item
  //   DELETE /orders/:orderNumber/:orderBatch/items/:serialNumber     — void item
  //   PATCH  /orders/:orderNumber/:orderBatch/items/:serialNumber/checkout       — checkout
  //   PATCH  /orders/:orderNumber/:orderBatch/items/:serialNumber/unchecked-out  — reverse checkout
  //
  // IMPORTANT: GET /orders/items/:serialNumber must be declared before
  //            GET /orders/:orderNumber/:orderBatch so NestJS doesn't swallow
  //            "items" as an :orderNumber value.

  /**
   * GET /orders/:orderNumber/:orderBatch/items
   */
  @Get(':orderNumber/:orderBatch/items')
  @Roles(Role.ReadOnly, Role.Operative, Role.Manager, Role.Admin, Role.Customer)
  @ApiOperation({
    summary: 'List all items on an order',
    description:
      'Customer role users can only view items on orders belonging to their linked customer account.',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number (1-based, default 1)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Records per page (default 25, max 100)',
  })
  @ApiOkResponse({
    description: 'Paged result containing ordered item objects.',
  })
  async findItems(
    @CurrentUser() user: CurrentUserPayload,
    @Param('orderNumber', ParseIntPipe) orderNumber: number,
    @Param('orderBatch', ParseIntPipe) orderBatch: number,
    @Query() paging?: PagingDto,
  ) {
    if (user.role === Role.Customer) {
      const order = await this.ordersService.findOne(orderNumber, orderBatch);
      if (order.customerAccount !== user.linkedCustomerId) {
        throw new ForbiddenException('You do not have access to this order');
      }
    }

    return this.ordersService.findItems(orderNumber, orderBatch, paging);
  }

  /**
   * POST /orders/:orderNumber/:orderBatch/items
   */
  @Post(':orderNumber/:orderBatch/items')
  @Roles(Role.Operative, Role.Manager, Role.Admin)
  @ApiOperation({
    summary: 'Add an item to an order',
    description:
      'The orderNumber and orderBatch are taken from the URL path. ' +
      'Any parentOrder / parentBatch values in the body are ignored in favour of the path params. ' +
      'The serialNumber and week are assigned automatically by the server and are ignored if supplied.',
  })
  @ApiBody({
    type: CreateOrderedItemDto,
    examples: {
      minimal: {
        summary: 'Minimal item (serial number is auto-assigned)',
        value: {},
      },
      full: {
        summary: 'Full hearing aid item',
        value: {
          patientInitial: 'J',
          patientSurname: 'Smith',
          modelCode: 'HA-PRO-3',
          customerRef: 'PO-2024-001',
          side: 'R',
          description: 'Pro Hearing Aid Right',
          category: 'Hearing Aid',
          price: 149.99,
          vent: 1.5,
          colour: 'Beige',
          tubing: 'Standard',
          options: 'Wax guard',
        },
      },
    },
  })
  @ApiCreatedResponse({ description: 'The newly created ordered item object.' })
  createItem(
    @CurrentUser() user: CurrentUserPayload,
    @Param('orderNumber', ParseIntPipe) orderNumber: number,
    @Param('orderBatch', ParseIntPipe) orderBatch: number,
    @Body() dto: CreateOrderedItemDto,
  ) {
    // Path params take precedence over anything in the body
    dto.parentOrder = orderNumber;
    dto.parentBatch = orderBatch;
    return this.ordersService.createItem(dto, user.username);
  }

  /**
   * GET /orders/:orderNumber/:orderBatch/items/:serialNumber
   */
  @Get(':orderNumber/:orderBatch/items/:serialNumber')
  @Roles(Role.ReadOnly, Role.Operative, Role.Manager, Role.Admin, Role.Customer)
  @ApiOperation({
    summary: 'Get a specific item on a specific order',
    description:
      'Returns the item only if it belongs to the given order. ' +
      "Customer role users can only view items on their linked customer's orders.",
  })
  @ApiOkResponse({ description: 'The requested ordered item object.' })
  async findOneItem(
    @CurrentUser() user: CurrentUserPayload,
    @Param('orderNumber', ParseIntPipe) orderNumber: number,
    @Param('orderBatch', ParseIntPipe) orderBatch: number,
    @Param('serialNumber') serialNumber: string,
  ) {
    const order = await this.ordersService.findOne(orderNumber, orderBatch);

    if (
      user.role === Role.Customer &&
      order.customerAccount !== user.linkedCustomerId
    ) {
      throw new ForbiddenException('You do not have access to this order');
    }

    const item = await this.ordersService.findItem(serialNumber);

    // Verify the item actually belongs to the order in the path
    if (item.parentOrder !== orderNumber || item.parentBatch !== orderBatch) {
      throw new ForbiddenException(
        `Item ${serialNumber} does not belong to order ${orderNumber}/${orderBatch}`,
      );
    }

    return item;
  }

  /**
   * PUT /orders/:orderNumber/:orderBatch/items/:serialNumber
   */
  @Put(':orderNumber/:orderBatch/items/:serialNumber')
  @Roles(Role.Operative, Role.Manager, Role.Admin)
  @ApiOperation({ summary: 'Update an ordered item' })
  @ApiBody({
    type: UpdateOrderedItemDto,
    examples: {
      updatePatient: {
        summary: 'Update patient details',
        value: {
          patientInitial: 'A',
          patientSurname: 'Jones',
        },
      },
      updateModel: {
        summary: 'Change model and price',
        value: {
          modelCode: 'HA-PRO-5',
          description: 'Pro Hearing Aid Right v5',
          price: 179.99,
        },
      },
      updateSide: {
        summary: 'Correct side',
        value: {
          side: 'L',
        },
      },
    },
  })
  @ApiOkResponse({ description: 'The updated ordered item object.' })
  async updateItem(
    @Param('orderNumber', ParseIntPipe) orderNumber: number,
    @Param('orderBatch', ParseIntPipe) orderBatch: number,
    @Param('serialNumber') serialNumber: string,
    @Body() dto: UpdateOrderedItemDto,
  ) {
    const item = await this.ordersService.findItem(serialNumber);

    if (item.parentOrder !== orderNumber || item.parentBatch !== orderBatch) {
      throw new ForbiddenException(
        `Item ${serialNumber} does not belong to order ${orderNumber}/${orderBatch}`,
      );
    }

    return this.ordersService.updateItem(serialNumber, dto);
  }

  /**
   * DELETE /orders/:orderNumber/:orderBatch/items/:serialNumber
   * Soft-deletes (sets Void = true)
   */
  @Delete(':orderNumber/:orderBatch/items/:serialNumber')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.Manager, Role.Admin)
  @ApiOperation({ summary: 'Void an ordered item (soft-delete)' })
  @ApiOkResponse({ description: 'The voided ordered item object.' })
  async voidItem(
    @CurrentUser() user: CurrentUserPayload,
    @Param('orderNumber', ParseIntPipe) orderNumber: number,
    @Param('orderBatch', ParseIntPipe) orderBatch: number,
    @Param('serialNumber') serialNumber: string,
  ) {
    const item = await this.ordersService.findItem(serialNumber);

    if (item.parentOrder !== orderNumber || item.parentBatch !== orderBatch) {
      throw new ForbiddenException(
        `Item ${serialNumber} does not belong to order ${orderNumber}/${orderBatch}`,
      );
    }

    return this.ordersService.voidItem(serialNumber, user.username);
  }

  /**
   * PATCH /orders/:orderNumber/:orderBatch/items/:serialNumber/checkout
   */
  @Patch(':orderNumber/:orderBatch/items/:serialNumber/checkout')
  @Roles(Role.Operative, Role.Manager, Role.Admin)
  @ApiOperation({ summary: 'Mark an ordered item as checked out' })
  @ApiOkResponse({ description: 'The checked-out ordered item object.' })
  async checkoutItem(
    @Param('orderNumber', ParseIntPipe) orderNumber: number,
    @Param('orderBatch', ParseIntPipe) orderBatch: number,
    @Param('serialNumber') serialNumber: string,
  ) {
    const item = await this.ordersService.findItem(serialNumber);

    if (item.parentOrder !== orderNumber || item.parentBatch !== orderBatch) {
      throw new ForbiddenException(
        `Item ${serialNumber} does not belong to order ${orderNumber}/${orderBatch}`,
      );
    }

    return this.ordersService.checkoutItem(serialNumber);
  }

  /**
   * PATCH /orders/:orderNumber/:orderBatch/items/:serialNumber/unchecked-out
   */
  @Patch(':orderNumber/:orderBatch/items/:serialNumber/unchecked-out')
  @Roles(Role.Operative, Role.Manager, Role.Admin)
  @ApiOperation({ summary: 'Reverse a checkout on an ordered item' })
  @ApiOkResponse({ description: 'The updated ordered item object.' })
  async uncheckedOutItem(
    @Param('orderNumber', ParseIntPipe) orderNumber: number,
    @Param('orderBatch', ParseIntPipe) orderBatch: number,
    @Param('serialNumber') serialNumber: string,
  ) {
    const item = await this.ordersService.findItem(serialNumber);

    if (item.parentOrder !== orderNumber || item.parentBatch !== orderBatch) {
      throw new ForbiddenException(
        `Item ${serialNumber} does not belong to order ${orderNumber}/${orderBatch}`,
      );
    }

    return this.ordersService.uncheckedOutItem(serialNumber);
  }
}

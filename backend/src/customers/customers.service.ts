import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PagingDto, PagedResult } from '../common/paging';
import { PrismaService } from '../prisma/prisma.service';
import { serializePrisma } from '../prisma/prisma-serializer';
import { Customer } from './entities/customer.entity';
import { CustomerAddress } from './entities/customer-address.entity';
import { OnboardResult } from './entities/onboard-result.entity';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { CreateCustomerAddressDto } from './dto/create-customer-address.dto';
import { UpdateCustomerAddressDto } from './dto/update-customer-address.dto';
import { OnboardCustomerDto } from './dto/onboard-customer.dto';
import { UsersService } from '../users/users.service';
import { Role } from '../users/entities/role.enum';
import { MailService } from '../mail/mail.service';
import { temporaryPassword } from '../auth/crypto.util';

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly mail: MailService,
  ) {}

  private get portalUrl(): string {
    return process.env.PORTAL_URL ?? 'https://portal.soniclabs.co.uk';
  }

  /**
   * Onboards an existing customer to the web portal:
   *   1. creates a Customer-role user login linked to the customer account,
   *   2. emails a welcome message with first-login credentials.
   *
   * The login username is the customer's email. A temporary password is
   * generated; the user is flagged to change it on first sign-in (handled by
   * UsersService.create).
   */
  async onboard(
    id: number,
    dto: OnboardCustomerDto,
    actor?: string,
  ): Promise<OnboardResult> {
    const customer = await this.findOne(id);

    if (customer.suspended) {
      throw new BadRequestException(
        'Cannot onboard a suspended customer; reinstate the account first',
      );
    }

    const loginEmail = (dto.email ?? customer.contactEmail ?? '').trim();
    if (!loginEmail) {
      throw new BadRequestException(
        'No email available to onboard this customer. Provide an email or set the customer contactEmail first.',
      );
    }

    const tempPassword = temporaryPassword();

    // UsersService.create enforces the Customer-role invariants (username must
    // be a valid email, linkedCustomerId required), hashes the password, sets
    // mustChangePassword = true and twoFactorMethod = 'email', and throws
    // ConflictException if this login already exists.
    const user = await this.users.create(
      {
        username: loginEmail,
        password: tempPassword,
        email: loginEmail,
        fullName: dto.fullName ?? customer.contactName ?? undefined,
        role: Role.Customer,
        linkedCustomerId: id,
      },
      actor,
    );

    await this.mail.sendWelcome(loginEmail, {
      username: loginEmail,
      temporaryPassword: tempPassword,
      companyName: customer.companyName,
      portalUrl: this.portalUrl,
    });

    return { customerId: id, loginEmail, user };
  }

  async findAll(
    includeSuspended = false,
    paging = new PagingDto(),
  ): Promise<PagedResult<Customer>> {
    const where = includeSuspended ? {} : { suspended: false };
    const [customers, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        orderBy: { companyName: 'asc' },
        skip: paging.offset,
        take: paging.limit,
      }),
      this.prisma.customer.count({ where }),
    ]);

    return new PagedResult(
      serializePrisma<Customer[]>(customers),
      total,
      paging,
    );
  }

  async findOne(id: number): Promise<Customer> {
    const customer = await this.prisma.customer.findUnique({
      where: { customerId: id },
      include: { addresses: true },
    });

    if (!customer) {
      throw new NotFoundException(`Customer #${id} not found`);
    }

    return serializePrisma<Customer>(customer);
  }

  async create(dto: CreateCustomerDto): Promise<Customer> {
    const customer = await this.prisma.customer.create({ data: dto });
    return serializePrisma<Customer>(customer);
  }

  async update(id: number, dto: UpdateCustomerDto): Promise<Customer> {
    await this.findOne(id);

    await this.prisma.customer.update({
      where: { customerId: id },
      data: dto,
    });

    return this.findOne(id);
  }

  async suspend(id: number): Promise<Customer> {
    await this.findOne(id);

    await this.prisma.customer.update({
      where: { customerId: id },
      data: {
        suspended: true,
        suspendedOn: new Date(),
      },
    });

    return this.findOne(id);
  }

  async reinstate(id: number): Promise<Customer> {
    await this.findOne(id);

    await this.prisma.customer.update({
      where: { customerId: id },
      data: {
        suspended: false,
        suspendedOn: null,
      },
    });

    return this.findOne(id);
  }

  async findAllAddresses(
    customerId: number,
    paging = new PagingDto(),
  ): Promise<PagedResult<CustomerAddress>> {
    await this.findOne(customerId);

    const where = { customerAccount: customerId, void: false };
    const [addresses, total] = await Promise.all([
      this.prisma.customerAddress.findMany({
        where,
        orderBy: [{ defaultAddress: 'desc' }, { addressId: 'asc' }],
        skip: paging.offset,
        take: paging.limit,
      }),
      this.prisma.customerAddress.count({ where }),
    ]);

    return new PagedResult(
      serializePrisma<CustomerAddress[]>(addresses),
      total,
      paging,
    );
  }

  async findOneAddress(
    customerId: number,
    addressId: number,
  ): Promise<CustomerAddress> {
    await this.findOne(customerId);

    const address = await this.prisma.customerAddress.findFirst({
      where: {
        addressId,
        customerAccount: customerId,
      },
    });

    if (!address) {
      throw new NotFoundException(
        `Address #${addressId} not found for customer #${customerId}`,
      );
    }

    return serializePrisma<CustomerAddress>(address);
  }

  async createAddress(
    customerId: number,
    dto: CreateCustomerAddressDto,
  ): Promise<CustomerAddress> {
    await this.findOne(customerId);

    if (dto.defaultAddress) {
      await this.prisma.customerAddress.updateMany({
        where: {
          customerAccount: customerId,
          defaultAddress: true,
        },
        data: { defaultAddress: false },
      });
    }

    const address = await this.prisma.customerAddress.create({
      data: {
        ...dto,
        customerAccount: customerId,
      },
    });

    return serializePrisma<CustomerAddress>(address);
  }

  async updateAddress(
    customerId: number,
    addressId: number,
    dto: UpdateCustomerAddressDto,
  ): Promise<CustomerAddress> {
    const address = await this.findOneAddress(customerId, addressId);

    if (dto.defaultAddress && !address.defaultAddress) {
      await this.prisma.customerAddress.updateMany({
        where: {
          customerAccount: customerId,
          defaultAddress: true,
        },
        data: { defaultAddress: false },
      });
    }

    await this.prisma.customerAddress.update({
      where: { addressId },
      data: dto,
    });

    return this.findOneAddress(customerId, addressId);
  }

  async removeAddress(
    customerId: number,
    addressId: number,
  ): Promise<CustomerAddress> {
    await this.findOneAddress(customerId, addressId);

    await this.prisma.customerAddress.update({
      where: { addressId },
      data: { void: true },
    });

    return this.findOneAddress(customerId, addressId);
  }

  async setDefaultAddress(
    customerId: number,
    addressId: number,
  ): Promise<CustomerAddress> {
    await this.findOne(customerId);

    await this.prisma.customerAddress.updateMany({
      where: {
        customerAccount: customerId,
        defaultAddress: true,
      },
      data: { defaultAddress: false },
    });

    await this.findOneAddress(customerId, addressId);

    await this.prisma.customerAddress.update({
      where: { addressId },
      data: { defaultAddress: true },
    });

    return this.findOneAddress(customerId, addressId);
  }
}

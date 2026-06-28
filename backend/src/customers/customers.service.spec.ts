import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { MailService } from '../mail/mail.service';
import { Role } from '../users/entities/role.enum';

const mockPrisma = {
  customer: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  customerAddress: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
};

const mockUsers = {
  create: jest.fn(),
};

const mockMail = {
  sendWelcome: jest.fn(),
};

function makeCustomer(overrides = {}) {
  return {
    customerId: 1,
    accountNumber: 'ACC001',
    centreNumber: null,
    companyName: 'Acme Ltd',
    suspended: false,
    suspendedOn: null,
    createdOn: new Date(),
    addresses: [],
    ...overrides,
  };
}

function makeAddress(overrides = {}) {
  return {
    addressId: 1,
    customerAccount: 1,
    siteCompanyName: 'Acme Site',
    defaultAddress: false,
    void: false,
    createdOn: new Date(),
    ...overrides,
  };
}

describe('CustomersService', () => {
  let service: CustomersService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomersService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: UsersService, useValue: mockUsers },
        { provide: MailService, useValue: mockMail },
      ],
    }).compile();

    service = module.get<CustomersService>(CustomersService);
  });

  // ─── findAll ─────────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('filters out suspended customers by default', async () => {
      mockPrisma.customer.findMany.mockResolvedValue([makeCustomer()]);
      mockPrisma.customer.count.mockResolvedValue(1);

      await service.findAll();

      expect(mockPrisma.customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { suspended: false } }),
      );
    });

    it('includes suspended customers when flag is true', async () => {
      mockPrisma.customer.findMany.mockResolvedValue([]);
      mockPrisma.customer.count.mockResolvedValue(0);

      await service.findAll(true);

      expect(mockPrisma.customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });

    it('returns paged result', async () => {
      mockPrisma.customer.findMany.mockResolvedValue([makeCustomer()]);
      mockPrisma.customer.count.mockResolvedValue(1);

      const result = await service.findAll();
      expect(result.total).toBe(1);
      expect(result.data).toHaveLength(1);
    });
  });

  // ─── findOne ─────────────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('throws NotFoundException when customer does not exist', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(null);
      await expect(service.findOne(99)).rejects.toThrow(NotFoundException);
    });

    it('returns customer with addresses', async () => {
      const customer = makeCustomer({ addresses: [makeAddress()] });
      mockPrisma.customer.findUnique.mockResolvedValue(customer);

      const result = await service.findOne(1);
      expect(result.customerId).toBe(1);
    });
  });

  // ─── create ──────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('creates and returns a customer', async () => {
      const customer = makeCustomer();
      mockPrisma.customer.create.mockResolvedValue(customer);

      const result = await service.create({ companyName: 'Acme Ltd' } as any);
      expect(result.companyName).toBe('Acme Ltd');
    });
  });

  // ─── update ──────────────────────────────────────────────────────────────────

  describe('update', () => {
    it('throws NotFoundException when customer does not exist', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(null);
      await expect(service.update(99, {} as any)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('updates and returns the customer', async () => {
      const customer = makeCustomer({ companyName: 'New Name' });
      mockPrisma.customer.findUnique.mockResolvedValue(customer);
      mockPrisma.customer.update.mockResolvedValue(customer);

      const result = await service.update(1, {
        companyName: 'New Name',
      } as any);
      expect(result.companyName).toBe('New Name');
    });
  });

  // ─── suspend / reinstate ─────────────────────────────────────────────────────

  describe('suspend', () => {
    it('throws NotFoundException when customer does not exist', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(null);
      await expect(service.suspend(99)).rejects.toThrow(NotFoundException);
    });

    it('sets suspended=true and suspendedOn', async () => {
      const customer = makeCustomer();
      const suspended = makeCustomer({
        suspended: true,
        suspendedOn: new Date(),
      });
      mockPrisma.customer.findUnique
        .mockResolvedValueOnce(customer) // findOne check
        .mockResolvedValueOnce(suspended); // findOne after update
      mockPrisma.customer.update.mockResolvedValue(suspended);

      const result = await service.suspend(1);
      expect(result.suspended).toBe(true);
    });
  });

  describe('reinstate', () => {
    it('sets suspended=false', async () => {
      const customer = makeCustomer({ suspended: true });
      const reinstated = makeCustomer({ suspended: false, suspendedOn: null });
      mockPrisma.customer.findUnique
        .mockResolvedValueOnce(customer)
        .mockResolvedValueOnce(reinstated);
      mockPrisma.customer.update.mockResolvedValue(reinstated);

      const result = await service.reinstate(1);
      expect(result.suspended).toBe(false);
    });
  });

  // ─── onboard ─────────────────────────────────────────────────────────────────

  describe('onboard', () => {
    it('throws NotFoundException when customer does not exist', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(null);
      await expect(service.onboard(99, {})).rejects.toThrow(NotFoundException);
    });

    it('rejects onboarding a suspended customer', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(
        makeCustomer({ suspended: true }),
      );
      await expect(service.onboard(1, {})).rejects.toThrow(BadRequestException);
      expect(mockUsers.create).not.toHaveBeenCalled();
    });

    it('rejects when no email is available', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(
        makeCustomer({ contactEmail: null }),
      );
      await expect(service.onboard(1, {})).rejects.toThrow(BadRequestException);
      expect(mockUsers.create).not.toHaveBeenCalled();
    });

    it('creates a linked Customer-role user and emails a welcome message', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(
        makeCustomer({
          contactEmail: 'jane@acme.com',
          contactName: 'Jane Doe',
        }),
      );
      mockUsers.create.mockResolvedValue({
        userId: 7,
        username: 'jane@acme.com',
      });

      const result = await service.onboard(1, {}, 'admin');

      expect(mockUsers.create).toHaveBeenCalledWith(
        expect.objectContaining({
          username: 'jane@acme.com',
          email: 'jane@acme.com',
          fullName: 'Jane Doe',
          role: Role.Customer,
          linkedCustomerId: 1,
        }),
        'admin',
      );
      // A temporary password is generated and forwarded to user creation.
      expect(mockUsers.create.mock.calls[0][0].password).toBeTruthy();
      // The welcome email goes to the login address with the same password.
      expect(mockMail.sendWelcome).toHaveBeenCalledWith(
        'jane@acme.com',
        expect.objectContaining({
          username: 'jane@acme.com',
          temporaryPassword: mockUsers.create.mock.calls[0][0].password,
        }),
      );
      expect(result).toEqual(
        expect.objectContaining({ customerId: 1, loginEmail: 'jane@acme.com' }),
      );
    });

    it('prefers the explicit email over the customer contact email', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(
        makeCustomer({ contactEmail: 'jane@acme.com' }),
      );
      mockUsers.create.mockResolvedValue({ userId: 8 });

      await service.onboard(1, { email: 'portal@acme.com' });

      expect(mockUsers.create).toHaveBeenCalledWith(
        expect.objectContaining({ username: 'portal@acme.com' }),
        undefined,
      );
    });
  });

  // ─── Addresses ───────────────────────────────────────────────────────────────

  describe('findAllAddresses', () => {
    it('throws NotFoundException when customer does not exist', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(null);
      await expect(service.findAllAddresses(99)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('only returns non-voided addresses', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(makeCustomer());
      mockPrisma.customerAddress.findMany.mockResolvedValue([makeAddress()]);
      mockPrisma.customerAddress.count.mockResolvedValue(1);

      await service.findAllAddresses(1);

      expect(mockPrisma.customerAddress.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ void: false }),
        }),
      );
    });

    it('returns paged result', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(makeCustomer());
      mockPrisma.customerAddress.findMany.mockResolvedValue([makeAddress()]);
      mockPrisma.customerAddress.count.mockResolvedValue(1);

      const result = await service.findAllAddresses(1);
      expect(result.total).toBe(1);
    });
  });

  describe('findOneAddress', () => {
    it('throws NotFoundException when address does not exist', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(makeCustomer());
      mockPrisma.customerAddress.findFirst.mockResolvedValue(null);

      await expect(service.findOneAddress(1, 99)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns the address', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(makeCustomer());
      mockPrisma.customerAddress.findFirst.mockResolvedValue(makeAddress());

      const result = await service.findOneAddress(1, 1);
      expect(result.addressId).toBe(1);
    });
  });

  describe('createAddress', () => {
    it('clears existing default when creating a new default address', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(makeCustomer());
      mockPrisma.customerAddress.updateMany.mockResolvedValue({});
      mockPrisma.customerAddress.create.mockResolvedValue(
        makeAddress({ defaultAddress: true }),
      );

      await service.createAddress(1, { defaultAddress: true } as any);

      expect(mockPrisma.customerAddress.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { defaultAddress: false } }),
      );
    });

    it('does not clear defaults when creating non-default address', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(makeCustomer());
      mockPrisma.customerAddress.create.mockResolvedValue(makeAddress());

      await service.createAddress(1, { defaultAddress: false } as any);

      expect(mockPrisma.customerAddress.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('removeAddress', () => {
    it('soft-deletes by setting void=true', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(makeCustomer());
      const address = makeAddress();
      mockPrisma.customerAddress.findFirst
        .mockResolvedValueOnce(address) // findOneAddress before update
        .mockResolvedValueOnce(makeAddress({ void: true })); // findOneAddress after
      mockPrisma.customerAddress.update.mockResolvedValue(
        makeAddress({ void: true }),
      );

      await service.removeAddress(1, 1);

      expect(mockPrisma.customerAddress.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { void: true } }),
      );
    });
  });

  describe('setDefaultAddress', () => {
    it('clears all existing defaults before setting the new one', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(makeCustomer());
      mockPrisma.customerAddress.updateMany.mockResolvedValue({});
      const address = makeAddress({ defaultAddress: false });
      mockPrisma.customerAddress.findFirst
        .mockResolvedValueOnce(address) // findOneAddress validation
        .mockResolvedValueOnce(makeAddress({ defaultAddress: true })); // return after update
      mockPrisma.customerAddress.update.mockResolvedValue({});

      const result = await service.setDefaultAddress(1, 1);

      expect(mockPrisma.customerAddress.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { defaultAddress: false } }),
      );
      expect(mockPrisma.customerAddress.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { defaultAddress: true } }),
      );
      expect(result.defaultAddress).toBe(true);
    });
  });
});

const { PrismaClient } = require('@prisma/client');

async function main() {
  const prisma = new PrismaClient();

  try {
    console.log('✅ Connected to database successfully!\n');

    // List all tables in the database
    const result = await prisma.$queryRaw`SELECT TABLE_NAME
                                         FROM INFORMATION_SCHEMA.TABLES
                                         WHERE TABLE_TYPE = 'BASE TABLE'
                                         ORDER BY TABLE_NAME`;

    console.log('📋 Tables in database:');
    if (result.length === 0) {
      console.log('  No tables found.');
    } else {
      result.forEach(table => {
        console.log(`  - ${table}`);
      });
    }

    // Test querying User model
    console.log('\n🔍 Testing User model query...');
    const users = await prisma.user.findMany({ take: 1 });
    if (users.length > 0) {
      console.log(`  Found ${users.length} user(s)`);
      console.log('  Sample:', JSON.stringify(users[0], null, 2));
    } else {
      console.log('  No users found in database.');
    }

    // Test querying Customer model
    console.log('\n🔍 Testing Customer model query...');
    const customers = await prisma.customer.findMany({ take: 1 });
    if (customers.length > 0) {
      console.log(`  Found ${customers.length} customer(s)`);
      console.log('  Sample:', JSON.stringify(customers[0], null, 2));
    } else {
      console.log('  No customers found in database.');
    }

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.code) {
      console.error('Error code:', error.code);
    }
  } finally {
    await prisma.$disconnect();
    console.log('\n✅ Disconnected from database.');
  }
}

main();
